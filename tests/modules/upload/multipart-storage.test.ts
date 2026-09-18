/**
 * M2 — multipart storage unit tests (no network, no R2).
 *
 * The R2 wrapper is exercised against a scripted fake S3 client asserting
 * exact command shapes; the local staging backend is covered end-to-end by
 * the transfer integration suite (real fs). Also covers provider error
 * classification used for logging/retry decisions.
 */
import { Readable } from 'stream';
import {
  classifyProviderError,
  LocalMultipartStorage,
  R2MultipartStorage,
} from '../../../src/modules/upload/storage/multipart-storage';

function fakeS3(handlers: Record<string, (input: any) => any>) {
  const calls: Array<{ name: string; input: any }> = [];
  return {
    calls,
    client: {
      send: jest.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        calls.push({ name, input: cmd.input });
        const out = handlers[name];
        if (!out) throw new Error(`unexpected command ${name}`);
        const v = out(cmd.input);
        return v instanceof Promise ? v : Promise.resolve(v);
      }),
    } as any,
  };
}

const partBody = (size: number) => Readable.from(Buffer.alloc(size, 9));

describe('R2MultipartStorage', () => {
  test('create → part → complete issues exact commands with quoted-ETag normalization', async () => {
    const { client, calls } = fakeS3({
      CreateMultipartUploadCommand: () => ({ UploadId: 'up-1' }),
      UploadPartCommand: () => ({ ETag: '"abc123"' }),
      CompleteMultipartUploadCommand: () => ({}),
    });
    const s = new R2MultipartStorage(client, 'test-bucket');
    await expect(s.createUpload('k', 'application/pdf')).resolves.toBe('up-1');
    await expect(s.uploadPart('k', 'up-1', 3, partBody(8), 8)).resolves.toBe('abc123');
    await s.completeUpload('k', 'up-1', [
      { partNumber: 1, etag: 'a', size: 5 },
      { partNumber: 2, etag: 'b', size: 8 },
    ]);
    expect(calls.map((c) => c.name)).toEqual([
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]);
    expect(calls[1].input).toMatchObject({ PartNumber: 3, ContentLength: 8 });
    expect(calls[2].input.MultipartUpload).toEqual({
      Parts: [
        { ETag: 'a', PartNumber: 1 },
        { ETag: 'b', PartNumber: 2 },
      ],
    });
  });

  test('missing ETag is a hard error (never recorded)', async () => {
    const { client } = fakeS3({ UploadPartCommand: () => ({}) });
    const s = new R2MultipartStorage(client, 'test-bucket');
    await expect(s.uploadPart('k', 'up-1', 1, partBody(8), 8)).rejects.toThrow('no ETag');
  });

  test('abort swallows NoSuchUpload but rethrows real failures', async () => {
    const gone = fakeS3({
      AbortMultipartUploadCommand: () => {
        throw Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
      },
    });
    await expect(
      new R2MultipartStorage(gone.client, 'b').abortUpload('k', 'up-1'),
    ).resolves.toBeUndefined();

    const broken = fakeS3({
      AbortMultipartUploadCommand: () => {
        throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      },
    });
    await expect(new R2MultipartStorage(broken.client, 'b').abortUpload('k', 'up-1')).rejects.toThrow(
      'denied',
    );
  });

  test('statObject maps NotFound → null; sniffPrefix bounds the read', async () => {
    const { client } = fakeS3({
      HeadObjectCommand: () => {
        throw Object.assign(new Error('missing'), { name: 'NotFound' });
      },
      GetObjectCommand: (input: any) => {
        expect(input.Range).toBe('bytes=0-99');
        return { Body: (async function* () { yield Buffer.alloc(500, 1); })() };
      },
    });
    const s = new R2MultipartStorage(client, 'b');
    await expect(s.statObject('k')).resolves.toBeNull();
    await expect(s.sniffPrefix('k', 100)).resolves.toHaveLength(100);
  });
});

describe('classifyProviderError', () => {
  test.each([
    [{ name: 'NoSuchUpload' }, { notFound: true, retryable: false }],
    [{ name: 'NotFound' }, { notFound: true, retryable: false }],
    [{ name: 'TimeoutError' }, { notFound: false, retryable: true }],
    [{ name: 'NetworkingError' }, { notFound: false, retryable: true }],
    [{ $metadata: { httpStatusCode: 503 } }, { notFound: false, retryable: true }],
    [{ name: 'AccessDenied' }, { notFound: false, retryable: false }],
  ])('%p → %p', (err, expected) => {
    expect(classifyProviderError(err)).toMatchObject(expected);
  });
});

describe('LocalMultipartStorage (unit smoke; full path in integration)', () => {
  test('rejects unsafe keys', async () => {
    const s = new LocalMultipartStorage();
    await expect(s.createUpload('../evil')).rejects.toThrow('Invalid storage key');
    await expect(s.statObject('../evil')).rejects.toThrow('Invalid storage key');
  });
});

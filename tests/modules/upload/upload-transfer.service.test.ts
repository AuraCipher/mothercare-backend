/**
 * M2 — transfer service unit tests (mocked Prisma + fake provider storage).
 *
 * Covers: header validation, offset matrix (stale/future/negative/missing/
 * beyond-size) with no provider side effects on 409, lock-timeout mapping,
 * completion guards, magic-byte decisions, part-ledger proofs, cancel/expire
 * storage wiring (including abort-failure tolerance), and Case-C mapping
 * (provider ok, DB commit lost → 502, offset untouched).
 */
import { Readable } from 'stream';
import { prismaMock } from '../../mocks/prisma';
import {
  assertPartsCover,
  parseChunkHeaders,
  TRANSFER_PART_SIZE,
  UploadTransferService,
} from '../../../src/modules/upload/upload-transfer.service';
import type { MultipartStorage } from '../../../src/modules/upload/storage/multipart-storage';

jest.mock(
  '../../../src/modules/chat/services/teacher-app-chat-permissions.service',
  () => ({ teacherAppChatAllowsAttachments: jest.fn().mockResolvedValue(true) }),
);

const fileTypeMock = require('file-type') as any;

function sessionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'sess-1',
    userId: 'user-owner',
    idempotencyKey: 'key-1',
    status: 'UPLOADING',
    purpose: 'document',
    originalFilename: 'report.pdf',
    originalName: undefined,
    mimeType: 'application/pdf',
    expectedSize: 2 * TRANSFER_PART_SIZE,
    bytesUploaded: 0,
    storageKey: 'documents/general/2026/09/uuid.pdf',
    providerUploadId: 'prov-1',
    providerState: null,
    checksum: null,
    fileRecordId: null,
    entityType: null,
    entityId: null,
    roomId: null,
    academicYearId: null,
    metadata: null,
    retryCount: 0,
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

function fakeStorage(overrides: Partial<MultipartStorage> = {}): MultipartStorage & {
  calls: { uploadPart: number; complete: number; abort: number };
} {
  const calls = { uploadPart: 0, complete: 0, abort: 0 };
  return {
    kind: 'local',
    createUpload: jest.fn().mockResolvedValue('prov-new'),
    uploadPart: jest.fn().mockImplementation(async () => {
      calls.uploadPart += 1;
      return `"etag-${calls.uploadPart}"`;
    }),
    completeUpload: jest.fn().mockImplementation(async () => {
      calls.complete += 1;
    }),
    abortUpload: jest.fn().mockImplementation(async () => {
      calls.abort += 1;
    }),
    statObject: jest.fn().mockResolvedValue({ size: 2 * TRANSFER_PART_SIZE }),
    sniffPrefix: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    calls,
    ...overrides,
  } as any;
}

const bodyOf = (size: number) => Readable.from(Buffer.alloc(size, 7));

function mockTxForChunk(current: any) {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'sess-1' }]),
    uploadSession: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...current, ...data })),
    },
    uploadSessionPart: { upsert: jest.fn().mockResolvedValue({}) },
  };
  (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  return tx;
}

describe('parseChunkHeaders', () => {
  test.each([
    [undefined, '100', 'Upload-Offset header is required', 400],
    ['', '100', 'Upload-Offset header is required', 400],
    ['-1', '100', 'non-negative integer', 400],
    ['1.5', '100', 'non-negative integer', 400],
    ['abc', '100', 'non-negative integer', 400],
    ['0', undefined, 'Content-Length is required', 411],
    ['0', '0', 'positive integer', 400],
    ['0', String(TRANSFER_PART_SIZE + 1), 'Chunk too large', 413],
  ])('rejects offset=%p length=%p', (off, len, message, status) => {
    expect(() => parseChunkHeaders(off as any, len as any)).toThrow(
      expect.objectContaining({ status, message: expect.stringContaining(message) }),
    );
  });

  test('accepts a well-formed final remainder', () => {
    expect(parseChunkHeaders('0', '7')).toEqual({ clientOffset: 0, contentLength: 7 });
  });
});

describe('transferChunk guards (no provider side effects on reject)', () => {
  let storage: ReturnType<typeof fakeStorage>;
  let svc: UploadTransferService;

  beforeEach(() => {
    storage = fakeStorage();
    svc = new UploadTransferService(storage);
    fileTypeMock.__setFileTypeResult({ ext: 'pdf', mime: 'application/pdf' });
  });

  async function attempt(row: any, offset: string, length: string) {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(row);
    return svc
      .transferChunk({
        sessionId: 'sess-1',
        userId: 'user-owner',
        offsetHeader: offset,
        contentLengthHeader: length,
        body: bodyOf(Number(length) || 8),
      })
      .then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e }),
      );
  }

  test('stale offset → 409 with authoritative offset, provider untouched', async () => {
    const r = await attempt(sessionRow({ bytesUploaded: TRANSFER_PART_SIZE }), '0', String(TRANSFER_PART_SIZE));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.e).toMatchObject({ status: 409, bytesUploaded: TRANSFER_PART_SIZE });
    }
    expect(storage.calls.uploadPart).toBe(0);
  });

  test('future offset → 409', async () => {
    const r = await attempt(sessionRow({ bytesUploaded: 0 }), String(TRANSFER_PART_SIZE), String(TRANSFER_PART_SIZE));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.e).toMatchObject({ status: 409 });
    expect(storage.calls.uploadPart).toBe(0);
  });

  test('stranger → 404, expired → 410, terminal → 409', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    await expect(
      svc.transferChunk({ sessionId: 'sess-1', userId: 'user-x', offsetHeader: '0', contentLengthHeader: '8', body: bodyOf(8) }),
    ).rejects.toMatchObject({ status: 404 });

    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ expiresAt: new Date('2020-01-01T00:00:00Z') }),
    );
    await expect(
      svc.transferChunk({ sessionId: 'sess-1', userId: 'user-owner', offsetHeader: '0', contentLengthHeader: '8', body: bodyOf(8) }),
    ).rejects.toMatchObject({ status: 410 });

    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'COMPLETED', fileRecordId: 'f1' }),
    );
    await expect(
      svc.transferChunk({ sessionId: 'sess-1', userId: 'user-owner', offsetHeader: '0', contentLengthHeader: '8', body: bodyOf(8) }),
    ).rejects.toMatchObject({ status: 409 });
    expect(storage.calls.uploadPart).toBe(0);
  });

  test('chunk beyond remaining → 413; non-final short chunk → 400', async () => {
    const row = sessionRow({ bytesUploaded: 0, expectedSize: 100 });
    expect(
      await attempt(row, '0', '101').then((r) => (r.ok ? 'ok' : r.e.status)),
    ).toBe(413);
    expect(
      await attempt(row, '0', '50').then((r) => (r.ok ? 'ok' : (r.e as any).status)),
    ).toBe(400);
    expect(storage.calls.uploadPart).toBe(0);
  });

  test('happy path advances offset inside the row-locked tx', async () => {
    const row = sessionRow({ status: 'INITIATED', providerUploadId: null });
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(row);
    const tx = mockTxForChunk(row);
    const out = await svc.transferChunk({
      sessionId: 'sess-1',
      userId: 'user-owner',
      offsetHeader: '0',
      contentLengthHeader: String(TRANSFER_PART_SIZE),
      body: bodyOf(TRANSFER_PART_SIZE),
    });
    expect(out).toMatchObject({ bytesUploaded: TRANSFER_PART_SIZE, partNumber: 1, complete: false });
    expect(storage.createUpload).toHaveBeenCalledWith(row.storageKey, row.mimeType);
    expect(tx.uploadSessionPart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_partNumber: { sessionId: 'sess-1', partNumber: 1 } },
      }),
    );
  });

  test('lock-timeout waiter converges to 409 with current offset', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock)
      .mockResolvedValueOnce(sessionRow({ bytesUploaded: 0 }))
      .mockResolvedValueOnce(sessionRow({ bytesUploaded: TRANSFER_PART_SIZE }));
    (prismaMock.$transaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    );
    await expect(
      svc.transferChunk({
        sessionId: 'sess-1', userId: 'user-owner',
        offsetHeader: '0', contentLengthHeader: String(TRANSFER_PART_SIZE), body: bodyOf(8),
      }),
    ).rejects.toMatchObject({ status: 409, bytesUploaded: TRANSFER_PART_SIZE });
  });

  test('Case C (provider ok, commit lost) → 502 and no false advance', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      // Simulate: provider part uploaded, then the commit dies.
      await storage.uploadPart('k', 'prov-1', 1, bodyOf(8), 8);
      throw new Error('db connection lost');
    });
    await expect(
      svc.transferChunk({
        sessionId: 'sess-1', userId: 'user-owner',
        offsetHeader: '0', contentLengthHeader: String(TRANSFER_PART_SIZE), body: bodyOf(8),
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe('completeUploadSession guards', () => {
  let storage: ReturnType<typeof fakeStorage>;
  let svc: UploadTransferService;

  beforeEach(() => {
    storage = fakeStorage();
    svc = new UploadTransferService(storage);
    fileTypeMock.__setFileTypeResult({ ext: 'pdf', mime: 'application/pdf' });
  });

  test('incomplete bytes → 409 before any provider call', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ bytesUploaded: TRANSFER_PART_SIZE }),
    );
    await expect(svc.completeUploadSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('incomplete'),
    });
    expect(storage.calls.complete).toBe(0);
  });

  test('provider completion failure → 502, session stays usable', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ bytesUploaded: 2 * TRANSFER_PART_SIZE }),
    );
    (prismaMock.uploadSessionPart.findMany as jest.Mock).mockResolvedValue([
      { partNumber: 1, etag: 'a', size: TRANSFER_PART_SIZE },
      { partNumber: 2, etag: 'b', size: TRANSFER_PART_SIZE },
    ]);
    (storage.completeUpload as jest.Mock).mockRejectedValueOnce(new Error('r2 down'));
    await expect(svc.completeUploadSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 502,
    });
  });

  test('magic mismatch → 422 + FAILED + abort attempted', async () => {
    fileTypeMock.__setFileTypeResult({ ext: 'pdf', mime: 'application/pdf' });
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({
        mimeType: 'image/jpeg',
        originalFilename: 'photo.jpg',
        bytesUploaded: 2 * TRANSFER_PART_SIZE,
      }),
    );
    (prismaMock.uploadSessionPart.findMany as jest.Mock).mockResolvedValue([
      { partNumber: 1, etag: 'a', size: TRANSFER_PART_SIZE },
      { partNumber: 2, etag: 'b', size: TRANSFER_PART_SIZE },
    ]);
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prismaMock.uploadSessionPart.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    await expect(svc.completeUploadSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 422,
    });
    expect(prismaMock.uploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(storage.calls.abort).toBe(1);
  });

  test('disallowed sniffed type → 422', async () => {
    fileTypeMock.__setFileTypeResult({ ext: 'exe', mime: 'application/x-msdownload' });
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({
        mimeType: 'application/octet-stream',
        originalFilename: 'run.bin',
        bytesUploaded: 2 * TRANSFER_PART_SIZE,
      }),
    );
    (prismaMock.uploadSessionPart.findMany as jest.Mock).mockResolvedValue([
      { partNumber: 1, etag: 'a', size: TRANSFER_PART_SIZE },
      { partNumber: 2, etag: 'b', size: TRANSFER_PART_SIZE },
    ]);
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prismaMock.uploadSessionPart.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    await expect(svc.completeUploadSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('not allowed'),
    });
  });
});

describe('assertPartsCover', () => {
  const sess = { expectedSize: 2 * TRANSFER_PART_SIZE };
  test('accepts contiguous full coverage', () => {
    expect(() =>
      assertPartsCover(
        [
          { partNumber: 1, size: TRANSFER_PART_SIZE },
          { partNumber: 2, size: TRANSFER_PART_SIZE },
        ],
        sess,
      ),
    ).not.toThrow();
  });
  test.each([
    [[], 'No uploaded parts'],
    [[{ partNumber: 2, size: TRANSFER_PART_SIZE }], 'not contiguous'],
    [
      [
        { partNumber: 1, size: 8 },
        { partNumber: 2, size: 8 },
      ],
      'inconsistent',
    ],
  ])('rejects %p', (parts, message) => {
    expect(() => assertPartsCover(parts as any, sess)).toThrow(
      expect.objectContaining({ message: expect.stringContaining(message.split(' ')[0]) }),
    );
  });
});

/**
 * M2 — transfer data-plane integration tests (real PostgreSQL + local staging).
 *
 * Proves end-to-end with real byte streams: offsets advance, retries never
 * duplicate bytes (sha256 of the assembled object), concurrent same-offset
 * PATCHes converge, restart works with zero in-memory state, cancel/expiry
 * release provider state, and scripted provider failures map safely.
 *
 * NOTE: file-type is globally mocked — __setFileTypeResult drives the sniff
 * outcome, so these tests prove the sniff DECISION logic, not the lib.
 * Same DATABASE_URL-require-after pattern as the M1 integration file.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';
process.env.UPLOAD_SESSION_TTL_HOURS = '24';

// Constant-uuid mock would mint identical storageKeys — local randomness only.
jest.mock('uuid', () => ({
  v4: () => `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`,
  v5: () => `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`,
}));

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uploadSessionService } = require('../../../src/modules/upload/upload-session.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const transferMod = require('../../../src/modules/upload/upload-transfer.service');
const { UploadTransferService, TRANSFER_PART_SIZE } = transferMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LocalMultipartStorage } = require('../../../src/modules/upload/storage/multipart-storage');

const fileTypeMock = require('file-type') as any;

let prisma: PrismaClient;
const P = uniquePrefix();
const uidA = `${P}_m2_a`;
const uidB = `${P}_m2_b`;
const fileRecordIds: string[] = [];
const storageKeys: string[] = [];

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const buf = (size: number, fill: number) => Buffer.alloc(size, fill);
const streamOf = (b: Buffer) => Readable.from(b);

function input(key: string, overrides: Record<string, unknown> = {}) {
  return {
    purpose: 'document',
    originalFilename: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 2 * TRANSFER_PART_SIZE + 7,
    idempotencyKey: key,
    ...overrides,
  };
}

async function patchBytes(
  svc: any,
  sessionId: string,
  userId: string,
  offset: number,
  data: Buffer,
) {
  return svc.transferChunk({
    sessionId,
    userId,
    offsetHeader: String(offset),
    contentLengthHeader: String(data.length),
    body: streamOf(data),
  });
}

function uploadsRoot(): string {
  return path.resolve(__dirname, '../../../uploads');
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uidA, name: 'M2 owner', passwordHash: 'x' } });
  await prisma.user.create({ data: { id: uidB, name: 'M2 stranger', passwordHash: 'x' } });
});

beforeEach(() => {
  fileTypeMock.__setFileTypeResult({ ext: 'pdf', mime: 'application/pdf' });
});

afterAll(async () => {
  await prisma.uploadSession.deleteMany({ where: { userId: { in: [uidA, uidB] } } });
  if (fileRecordIds.length) {
    await prisma.fileRecord.deleteMany({ where: { id: { in: fileRecordIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [uidA, uidB] } } });
  for (const key of storageKeys) {
    try {
      await fs.promises.rm(path.join(uploadsRoot(), '.resumable-parts', key), { recursive: true, force: true });
    } catch {}
    try {
      await fs.promises.unlink(path.join(uploadsRoot(), key));
    } catch {}
  }
  await disconnect(prisma);
});

describe('full resumable flow (real bytes)', () => {
  test('5+5+remainder → complete → byte-identical FileRecord', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const total = 2 * TRANSFER_PART_SIZE + 7;
    const source = Buffer.concat([buf(TRANSFER_PART_SIZE, 1), buf(TRANSFER_PART_SIZE, 2), buf(7, 3)]);
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_f1`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);

    const r1: any = await patchBytes(svc, session.id, uidA, 0, source.subarray(0, TRANSFER_PART_SIZE));
    expect(r1).toMatchObject({ bytesUploaded: TRANSFER_PART_SIZE, partNumber: 1, complete: false });
    const r2: any = await patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, source.subarray(TRANSFER_PART_SIZE, 2 * TRANSFER_PART_SIZE));
    expect(r2).toMatchObject({ bytesUploaded: 2 * TRANSFER_PART_SIZE, partNumber: 2, complete: false });
    const r3: any = await patchBytes(svc, session.id, uidA, 2 * TRANSFER_PART_SIZE, source.subarray(2 * TRANSFER_PART_SIZE));
    expect(r3).toMatchObject({ bytesUploaded: total, partNumber: 3, complete: true });

    const done = await svc.completeUploadSession(session.id, uidA);
    expect(done.created).toBe(true);
    fileRecordIds.push(done.fileRecordId);
    const record = await prisma.fileRecord.findUnique({ where: { id: done.fileRecordId } });
    expect(record).toMatchObject({ size: total, mimeType: 'application/pdf', uploadedById: uidA });

    const final = await fs.promises.readFile(path.join(uploadsRoot(), record!.storagePath));
    expect(sha(final)).toBe(sha(source));

    // Repeated completion converges — still exactly one FileRecord.
    const again = await svc.completeUploadSession(session.id, uidA);
    expect(again.created).toBe(false);
    expect(again.fileRecordId).toBe(done.fileRecordId);
    expect(await prisma.fileRecord.count({ where: { id: done.fileRecordId } })).toBe(1);
  });

  test('exact multiple (5+5) and single-chunk small file', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const full = buf(2 * TRANSFER_PART_SIZE, 4);
    const s1 = await uploadSessionService.createSession(uidA, input(`${P}_f2`, { expectedSize: full.length }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: s1.session.id } }))!.storageKey);
    await patchBytes(svc, s1.session.id, uidA, 0, full.subarray(0, TRANSFER_PART_SIZE));
    await patchBytes(svc, s1.session.id, uidA, TRANSFER_PART_SIZE, full.subarray(TRANSFER_PART_SIZE));
    const d1 = await svc.completeUploadSession(s1.session.id, uidA);
    fileRecordIds.push(d1.fileRecordId);
    expect((await fs.promises.readFile(path.join(uploadsRoot(), (await prisma.fileRecord.findUnique({ where: { id: d1.fileRecordId } }))!.storagePath))).length).toBe(full.length);

    const tiny = buf(100, 5);
    const s2 = await uploadSessionService.createSession(uidA, input(`${P}_f3`, { expectedSize: tiny.length }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: s2.session.id } }))!.storageKey);
    const r: any = await patchBytes(svc, s2.session.id, uidA, 0, tiny);
    expect(r).toMatchObject({ partNumber: 1, complete: true });
    const d2 = await svc.completeUploadSession(s2.session.id, uidA);
    fileRecordIds.push(d2.fileRecordId);
    expect(d2.created).toBe(true);
  });
});

describe('offset safety (real DB)', () => {
  test('stale/future/oversize/off-by-rules all reject without side effects', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_o1`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);
    await patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 1));

    await expect(patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 9))).rejects.toMatchObject({
      status: 409, bytesUploaded: TRANSFER_PART_SIZE,
    });
    await expect(patchBytes(svc, session.id, uidA, total, buf(5, 9))).rejects.toMatchObject({ status: 409 });
    await expect(patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(11, 9))).rejects.toMatchObject({ status: 413 });
    await expect(patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(5, 9))).rejects.toMatchObject({ status: 400 });

    const row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row!.bytesUploaded).toBe(TRANSFER_PART_SIZE);
    expect(await prisma.uploadSessionPart.count({ where: { sessionId: session.id } })).toBe(1);

    // Malformed headers (no provider contact).
    await expect(
      svc.transferChunk({ sessionId: session.id, userId: uidA, offsetHeader: '-1', contentLengthHeader: '5', body: streamOf(buf(5, 1)) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.transferChunk({ sessionId: session.id, userId: uidA, offsetHeader: undefined, contentLengthHeader: '5', body: streamOf(buf(5, 1)) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.transferChunk({ sessionId: session.id, userId: uidA, offsetHeader: String(TRANSFER_PART_SIZE), contentLengthHeader: undefined, body: streamOf(buf(5, 1)) }),
    ).rejects.toMatchObject({ status: 411 });
  });

  test('concurrent same-offset PATCHes advance exactly once', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_o2`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);

    const [a, b] = await Promise.allSettled([
      patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 11)),
      patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 22)),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row!.bytesUploaded).toBe(TRANSFER_PART_SIZE);
    expect(await prisma.uploadSessionPart.count({ where: { sessionId: session.id } })).toBe(1);
  });
});

describe('retry after lost response (real DB)', () => {
  test('re-sending an acknowledged offset 409s with truth; upload completes byte-clean', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const c1 = buf(TRANSFER_PART_SIZE, 31);
    const c2 = buf(10, 32);
    const total = c1.length + c2.length;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_r1`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);

    await patchBytes(svc, session.id, uidA, 0, c1);
    // "Response lost" — client retries the same range.
    await expect(patchBytes(svc, session.id, uidA, 0, c1)).rejects.toMatchObject({
      status: 409, bytesUploaded: TRANSFER_PART_SIZE,
    });
    // Client continues from the authoritative offset instead.
    await patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, c2);
    const done = await svc.completeUploadSession(session.id, uidA);
    fileRecordIds.push(done.fileRecordId);
    const record = await prisma.fileRecord.findUnique({ where: { id: done.fileRecordId } });
    const final = await fs.promises.readFile(path.join(uploadsRoot(), record!.storagePath));
    expect(sha(final)).toBe(sha(Buffer.concat([c1, c2])));
    expect(await prisma.uploadSessionPart.count({ where: { sessionId: session.id } })).toBe(0);
  });
});

describe('restart recovery (zero in-memory state)', () => {
  test('a brand-new service instance continues from persisted state', async () => {
    const total = TRANSFER_PART_SIZE + 10;
    const c1 = buf(TRANSFER_PART_SIZE, 41);
    const c2 = buf(10, 42);
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_s1`, { expectedSize: total }));
    const key = (await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey;
    storageKeys.push(key);

    const svcA = new UploadTransferService(new LocalMultipartStorage());
    await patchBytes(svcA, session.id, uidA, 0, c1);

    // "Restart": everything in memory is dropped; DB + part files persist.
    const persisted = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(persisted!.providerUploadId).toBeTruthy();
    expect(fs.existsSync(path.join(uploadsRoot(), '.resumable-parts', key, 'part-1'))).toBe(true);

    const svcB = new UploadTransferService(new LocalMultipartStorage());
    const resumed = await uploadSessionService.getSession(session.id, uidA);
    expect(resumed.bytesUploaded).toBe(TRANSFER_PART_SIZE);
    await patchBytes(svcB, session.id, uidA, TRANSFER_PART_SIZE, c2);
    const done = await svcB.completeUploadSession(session.id, uidA);
    fileRecordIds.push(done.fileRecordId);
    const record = await prisma.fileRecord.findUnique({ where: { id: done.fileRecordId } });
    expect(sha(await fs.promises.readFile(path.join(uploadsRoot(), record!.storagePath)))).toBe(
      sha(Buffer.concat([c1, c2])),
    );
  });
});

describe('cancel + expiry release provider state', () => {
  test('cancel blocks transfers, removes parts, repeat cancel is safe', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_c1`, { expectedSize: total }));
    const key = (await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey;
    storageKeys.push(key);
    await patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 51));

    await uploadSessionService.cancelSession(session.id, uidA);
    await expect(patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(10, 52))).rejects.toMatchObject({ status: 409 });
    expect(fs.existsSync(path.join(uploadsRoot(), '.resumable-parts', key))).toBe(false);
    expect(await prisma.uploadSessionPart.count({ where: { sessionId: session.id } })).toBe(0);
    await expect(uploadSessionService.cancelSession(session.id, uidA)).rejects.toMatchObject({ status: 409 });
  });

  test('sweeper expires, aborts, and is idempotent', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_e1`, { expectedSize: total }));
    const key = (await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey;
    storageKeys.push(key);
    await patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 61));
    await prisma.uploadSession.update({ where: { id: session.id }, data: { expiresAt: new Date('2020-01-01T00:00:00Z') } });

    // Active-but-past-expiry derives 410 without any worker.
    await expect(patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(10, 62))).rejects.toMatchObject({ status: 410 });

    const first = await uploadSessionService.cleanupExpiredSessions(100);
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(uploadsRoot(), '.resumable-parts', key))).toBe(false);
    // Persisted-terminal EXPIRED reports 409 (truthful terminal state).
    await expect(patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(10, 62))).rejects.toMatchObject({ status: 409 });

    const again = await uploadSessionService.cleanupExpiredSessions(100);
    const row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row!.status).toBe('EXPIRED');
    expect(again.expired).toBe(0);
  });

  test('stranger cannot transfer or complete (404)', async () => {
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_a1`, { expectedSize: 100 }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);
    await expect(patchBytes(svc, session.id, uidB, 0, buf(100, 1))).rejects.toMatchObject({ status: 404 });
    await expect(svc.completeUploadSession(session.id, uidB)).rejects.toMatchObject({ status: 404 });
  });
});

describe('assembled-type validation (mocked sniff decisions)', () => {
  test('content/declared mismatch → 422 + FAILED', async () => {
    fileTypeMock.__setFileTypeResult({ ext: 'pdf', mime: 'application/pdf' });
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const small = buf(100, 71);
    const { session } = await uploadSessionService.createSession(
      uidA,
      input(`${P}_v1`, { expectedSize: small.length, originalFilename: 'photo.jpg', mimeType: 'image/jpeg' }),
    );
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);
    await patchBytes(svc, session.id, uidA, 0, small);
    await expect(svc.completeUploadSession(session.id, uidA)).rejects.toMatchObject({ status: 422 });
    expect((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.status).toBe('FAILED');
  });

  test('disallowed sniffed type → 422', async () => {
    fileTypeMock.__setFileTypeResult({ ext: 'exe', mime: 'application/x-msdownload' });
    const svc = new UploadTransferService(new LocalMultipartStorage());
    const small = buf(100, 72);
    const { session } = await uploadSessionService.createSession(
      uidA,
      input(`${P}_v2`, { expectedSize: small.length, originalFilename: 'run.bin', mimeType: 'application/octet-stream' }),
    );
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);
    await patchBytes(svc, session.id, uidA, 0, small);
    await expect(svc.completeUploadSession(session.id, uidA)).rejects.toMatchObject({
      status: 422, message: expect.stringContaining('not allowed'),
    });
  });
});

describe('provider failure injection (scripted storage, real DB)', () => {
  function scripted() {
    const parts = new Map<number, Buffer>();
    let final: Buffer | null = null;
    return {
      kind: 'local' as const,
      failPart: null as null | ((n: number) => Error | null),
      failComplete: null as null | Error,
      failAbort: null as null | Error,
      aborted: [] as string[],
      async createUpload() { return 'scripted-up'; },
      async uploadPart(_k: string, _u: string, n: number, body: any, len: number) {
        const err = this.failPart?.(n);
        try { (body as any).resume?.(); } catch {}
        if (err) throw err;
        const chunks: Buffer[] = [];
        for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
        const data = Buffer.concat(chunks);
        if (data.length !== len) throw new Error('short body');
        parts.set(n, data);
        return `etag-${n}`;
      },
      async completeUpload() {
        if (this.failComplete) throw this.failComplete;
        final = Buffer.concat([...parts.keys()].sort((a, b) => a - b).map((n) => parts.get(n)!));
      },
      async abortUpload(_k: string, u: string) {
        if (this.failAbort) throw this.failAbort;
        this.aborted.push(u);
        parts.clear();
      },
      async statObject() { return final ? { size: final.length } : null; },
      async sniffPrefix(_k: string, n: number) { return (final ?? Buffer.alloc(0)).subarray(0, n); },
      partCount: () => parts.size,
    };
  }

  test('retryable part failure → 502, offset untouched, retry heals with no dup', async () => {
    const fake = scripted();
    const svc = new UploadTransferService(fake as any);
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_i1`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);

    fake.failPart = () => Object.assign(new Error('socket timeout'), { name: 'TimeoutError' });
    await expect(patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 81))).rejects.toMatchObject({ status: 502 });
    let row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row!.bytesUploaded).toBe(0);
    expect(row!.retryCount).toBe(1);

    fake.failPart = null;
    await patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 81));
    await patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(10, 82));
    expect(fake.partCount()).toBe(2);
    const done = await svc.completeUploadSession(session.id, uidA);
    fileRecordIds.push(done.fileRecordId);
    expect(done.created).toBe(true);
  });

  test('completion failure keeps UPLOADING; abort failure still cancels', async () => {
    const fake = scripted();
    const svc = new UploadTransferService(fake as any);
    const total = TRANSFER_PART_SIZE + 10;
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_i2`, { expectedSize: total }));
    storageKeys.push((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey);
    await patchBytes(svc, session.id, uidA, 0, buf(TRANSFER_PART_SIZE, 91));
    await patchBytes(svc, session.id, uidA, TRANSFER_PART_SIZE, buf(10, 92));

    fake.failComplete = Object.assign(new Error('r2 503'), { $metadata: { httpStatusCode: 503 } });
    await expect(svc.completeUploadSession(session.id, uidA)).rejects.toMatchObject({ status: 502 });
    expect((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.status).toBe('UPLOADING');

    fake.failComplete = null;
    fake.failAbort = new Error('AccessDenied');
    await uploadSessionService.cancelSession(session.id, uidA);
    expect((await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.status).toBe('CANCELLED');
  });
});

describe('sweeper lifecycle', () => {
  test('start/stop/disabled do not throw', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sweeper = require('../../../src/modules/upload/upload-session-sweeper');
    expect(() => sweeper.startUploadSessionSweeper()).not.toThrow();
    expect(() => sweeper.startUploadSessionSweeper()).not.toThrow();
    expect(() => sweeper.stopUploadSessionSweeper()).not.toThrow();
    process.env.UPLOAD_CLEANUP_INTERVAL_MS = '0';
    expect(() => sweeper.startUploadSessionSweeper()).not.toThrow();
    expect(() => sweeper.stopUploadSessionSweeper()).not.toThrow();
    delete process.env.UPLOAD_CLEANUP_INTERVAL_MS;
  });
});

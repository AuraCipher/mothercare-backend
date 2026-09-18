/**
 * M1 — UploadSession real-PostgreSQL integration tests.
 *
 * Runs against the dedicated TEST database (mcs_test on :5434 — never
 * production). Proves what mocks cannot: the [userId, idempotencyKey]
 * uniqueness under true concurrency, single-winner finalization
 * (exactly one FileRecord), deterministic expiry, and that the
 * migration applied with the expected tables/indexes.
 *
 * NOTE: the service is required AFTER pointing DATABASE_URL at the test
 * database, because src/lib/prisma.ts binds the URL at import time.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';
process.env.UPLOAD_SESSION_TTL_HOURS = '24';

// The global tests/__mocks__/uuid.ts returns a CONSTANT uuid, which would
// mint the same storageKey for every session here (unique-constraint
// collisions unrelated to production, where uuidv4 is random). Override
// with real randomness for this file only — the shared mock is untouched.
jest.mock('uuid', () => ({
  v4: () => `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`,
  v5: () => `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`,
}));

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uploadSessionService } = require('../../../src/modules/upload/upload-session.service');

let prisma: PrismaClient;
const P = uniquePrefix();
const uidA = `${P}_user_a`;
const uidB = `${P}_user_b`;
const fileRecordIds: string[] = [];

function input(key: string, overrides: Record<string, unknown> = {}) {
  return {
    purpose: 'document',
    originalFilename: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 1024,
    idempotencyKey: key,
    ...overrides,
  };
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uidA, name: 'M1 owner', passwordHash: 'x' } });
  await prisma.user.create({ data: { id: uidB, name: 'M1 stranger', passwordHash: 'x' } });
});

afterAll(async () => {
  await prisma.uploadSession.deleteMany({ where: { userId: { in: [uidA, uidB] } } });
  if (fileRecordIds.length) {
    await prisma.fileRecord.deleteMany({ where: { id: { in: fileRecordIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [uidA, uidB] } } });
  await disconnect(prisma);
});

describe('M1 migration', () => {
  test('upload_sessions table + key indexes exist', async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'upload_sessions'
    `;
    expect(tables.map((r) => r.tablename)).toContain('upload_sessions');
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'upload_sessions'
    `;
    const names = indexes.map((r) => r.indexname);
    expect(names).toContain('upload_sessions_userId_status_idx');
    expect(names).toContain('upload_sessions_status_expiresAt_idx');
    expect(names).toContain('upload_sessions_userId_idempotencyKey_key');
  });
});

describe('create → get roundtrip', () => {
  test('persists server-minted key, zero offset, ~24h expiry', async () => {
    const before = Date.now();
    const { session, created } = await uploadSessionService.createSession(uidA, input(`${P}_k1`));
    expect(created).toBe(true);
    expect(session.status).toBe('INITIATED');
    expect(session.bytesUploaded).toBe(0);

    const row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row).toMatchObject({ userId: uidA, purpose: 'document', expectedSize: 1024 });
    expect(row!.storageKey).toMatch(/^documents\//);
    expect(row!.providerUploadId).toBeNull();
    const ttl = row!.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 60_000);

    const read = await uploadSessionService.getSession(session.id, uidA);
    expect(read).toMatchObject({ id: session.id, status: 'INITIATED' });
  });
});

describe('idempotency (real concurrency)', () => {
  test('sequential duplicate key reuses the same row', async () => {
    const first = await uploadSessionService.createSession(uidA, input(`${P}_k2`));
    const second = await uploadSessionService.createSession(uidA, input(`${P}_k2`));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    const count = await prisma.uploadSession.count({
      where: { userId: uidA, idempotencyKey: `${P}_k2` },
    });
    expect(count).toBe(1);
  });

  test('concurrent duplicate creates converge to exactly one row', async () => {
    const key = `${P}_k3`;
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => uploadSessionService.createSession(uidA, input(key))),
    );
    const ids = new Set(results.map((r: any) => r.session.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r: any) => r.created).length).toBe(1);
    const count = await prisma.uploadSession.count({ where: { userId: uidA, idempotencyKey: key } });
    expect(count).toBe(1);
  });

  test('DB-level unique constraint rejects raw duplicates (P2002)', async () => {
    const key = `${P}_k4`;
    await prisma.uploadSession.create({
      data: {
        userId: uidA,
        idempotencyKey: key,
        purpose: 'document',
        originalFilename: 'a.pdf',
        mimeType: 'application/pdf',
        expectedSize: 10,
        storageKey: `${P}/raw-1.pdf`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await expect(
      prisma.uploadSession.create({
        data: {
          userId: uidA,
          idempotencyKey: key,
          purpose: 'document',
          originalFilename: 'b.pdf',
          mimeType: 'application/pdf',
          expectedSize: 10,
          storageKey: `${P}/raw-2.pdf`,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('same key under a different user is a different session', async () => {
    const key = `${P}_k5`;
    const a = await uploadSessionService.createSession(uidA, input(key));
    const b = await uploadSessionService.createSession(uidB, input(key));
    expect(a.session.id).not.toBe(b.session.id);
  });
});

describe('finalize single-winner (real concurrency)', () => {
  test('concurrent finalizes create exactly one FileRecord', async () => {
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_k6`));
    // Simulate the M2 transfer layer: bytes fully uploaded.
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'UPLOADING', bytesUploaded: 1024 },
    });
    const [r1, r2] = await Promise.all([
      uploadSessionService.finalizeSession(session.id, uidA),
      uploadSessionService.finalizeSession(session.id, uidA),
    ]);
    const winners = [r1, r2].filter((r: any) => r.created);
    const losers = [r1, r2].filter((r: any) => !r.created);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].session.fileRecordId).toBe(winners[0].session.fileRecordId);
    fileRecordIds.push(winners[0].session.fileRecordId);

    const records = await prisma.fileRecord.findMany({
      where: { storagePath: (await prisma.uploadSession.findUnique({ where: { id: session.id } }))!.storageKey },
    });
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({ size: 1024, mimeType: 'application/pdf', uploadedById: uidA });

    const done = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(done!.status).toBe('COMPLETED');

    // Repeated finalize after completion: same link, still one record.
    const again = await uploadSessionService.finalizeSession(session.id, uidA);
    expect(again.created).toBe(false);
    expect(again.session.fileRecordId).toBe(winners[0].session.fileRecordId);
  });
});

describe('expiry determinism', () => {
  test('past-expiry session reads EXPIRED; cancel/finalize are 410; fresh stays usable', async () => {
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_k7`));
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date('2020-01-01T00:00:00Z') },
    });
    const read = await uploadSessionService.getSession(session.id, uidA);
    expect(read.status).toBe('EXPIRED');
    await expect(uploadSessionService.cancelSession(session.id, uidA)).rejects.toMatchObject({
      status: 410,
    });

    const fresh = await uploadSessionService.createSession(uidA, input(`${P}_k8`));
    expect((await uploadSessionService.getSession(fresh.session.id, uidA)).status).toBe('INITIATED');
  });

  test('expireSession persists EXPIRED and is idempotent', async () => {
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_k9`));
    const first = await uploadSessionService.expireSession(session.id);
    expect(first.status).toBe('EXPIRED');
    const row = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    expect(row!.status).toBe('EXPIRED');
    const second = await uploadSessionService.expireSession(session.id);
    expect(second.status).toBe('EXPIRED');
    await expect(uploadSessionService.cancelSession(session.id, uidA)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('authorization + room validation (real DB)', () => {
  test('stranger cannot read or cancel (404)', async () => {
    const { session } = await uploadSessionService.createSession(uidA, input(`${P}_k10`));
    await expect(uploadSessionService.getSession(session.id, uidB)).rejects.toMatchObject({
      status: 404,
    });
    await expect(uploadSessionService.cancelSession(session.id, uidB)).rejects.toMatchObject({
      status: 404,
    });
  });

  test('unknown room is 404 (positive membership path is unit-covered)', async () => {
    await expect(
      uploadSessionService.createSession(
        uidA,
        input(`${P}_k11`, { purpose: 'chat', roomId: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

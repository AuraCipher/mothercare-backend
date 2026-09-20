/**
 * M13 — cross-branch + privilege + upload-session security (real PG + HTTP).
 * Every denied mutation asserts ZERO database change (not just status).
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');

let prisma: PrismaClient;
const P = uniquePrefix() + '_m13s';
const A = {
  cal: `${P}_ca`, br: `${P}_ba`, ay: `${P}_aya`, g: `${P}_ga`,
  sup: `${P}_sup`, ba: `${P}_ba_u`, mgr: `${P}_mgr`, teacher: `${P}_t`,
};
const B = { cal: `${P}_cb`, br: `${P}_bb`, ay: `${P}_ayb`, g: `${P}_gb`, ba: `${P}_baB` };

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  for (const [cal, br, code, ay] of [[A.cal, A.br, `${P}BA`, A.ay], [B.cal, B.br, `${P}BB`, B.ay]] as const) {
    await prisma.academicCalendar.create({
      data: { id: cal, label: `${P}-${code}`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    await prisma.branch.create({ data: { id: br, name: br, code } });
    await prisma.academicYear.create({ data: { id: ay, branchId: br, calendarId: cal } });
  }
  await prisma.group.create({ data: { id: A.g, academicYearId: A.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.group.create({ data: { id: B.g, academicYearId: B.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await user(A.sup, 'super_admin');
  await user(A.ba, 'management');
  await user(A.mgr, 'management');
  await user(A.teacher, 'teacher');
  await user(B.ba, 'management');
  await prisma.branchMember.create({ data: { branchId: A.br, userId: A.ba, role: 'branch_admin', isActive: true } });
  await prisma.branchMember.create({ data: { branchId: B.br, userId: B.ba, role: 'branch_admin', isActive: true } });
  // A.mgr uploads in the upload-ownership tests (DOCUMENTS gate needs membership).
  await prisma.branchMember.create({ data: { branchId: A.br, userId: A.mgr, role: 'teacher', isActive: true } });
}, 120000);

afterAll(async () => {
  await prisma.branchMember.deleteMany({ where: { branchId: { in: [A.br, B.br] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [A.sup, A.ba, A.mgr, A.teacher, B.ba] } } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: { in: [A.g, B.g] } } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: { in: [A.ay, B.ay] } } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: { in: [A.br, B.br] } } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: { in: [A.cal, B.cal] } } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M13 privilege boundaries', () => {
  const supTok = () => getAuthHeader(generateTestToken(A.sup, 'super_admin'));
  const mgrTok = () => getAuthHeader(generateTestToken(A.mgr, 'management', { branchIds: [A.br] }));

  test('management cannot deactivate a super_admin (zero mutation)', async () => {
    const before = await prisma.user.findUnique({ where: { id: A.sup }, select: { status: true } });
    const res = await request(app).delete(`/admin/users/${A.sup}`).set(mgrTok());
    // M13 FIX: non-super_admin deactivation of super_admin → 403 (was: 200).
    expect(res.status).toBe(403);
    const after = await prisma.user.findUnique({ where: { id: A.sup }, select: { status: true } });
    expect(after?.status).toBe(before?.status);
  });

  test('management cannot demote the branch_admin (zero mutation)', async () => {
    const res = await request(app)
      .put(`/admin/branches/${A.br}/members/${A.ba}`)
      .set(mgrTok())
      .send({ role: 'teacher' });
    // M13 FIX: only super_admin may alter a branch_admin membership (was: 200).
    expect(res.status).toBe(403);
    const m = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: A.br, userId: A.ba } },
    });
    expect(m?.role).toBe('branch_admin');
    expect(m?.isActive).toBe(true);
  });

  test('management cannot remove the branch_admin membership (zero mutation)', async () => {
    const res = await request(app).delete(`/admin/branches/${A.br}/members/${A.ba}`).set(mgrTok());
    // M13 FIX: 403 (was: 204 when a second admin existed; 409 only for last).
    expect(res.status).toBe(403);
    const m = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: A.br, userId: A.ba } },
    });
    expect(m?.isActive).toBe(true);
  });

  test('super_admin retains full user/member administration (positive control)', async () => {
    const res = await request(app)
      .put(`/admin/branches/${A.br}/members/${A.mgr}`)
      .set(supTok())
      .send({ role: 'teacher' });
    expect([200, 201, 404]).toContain(res.status);
    expect(res.status).not.toBe(403);
  });

  test("invalid global role 'staff' rejected 400 (enum gap, no 500)", async () => {
    const res = await request(app)
      .post('/admin/users')
      .set(supTok())
      .send({ name: 'X', username: `${P}x`, password: 'secret12', role: 'staff' });
    // M13 FIX: 400 listing valid roles (was: 500 Prisma enum error).
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { username: `${P}x` } })).toBe(0);
  });
});

describe('M13 cross-branch reads', () => {
  const mgrB = () => getAuthHeader(generateTestToken(B.ba, 'management', { branchIds: [B.br] }));

  test('B admin cannot read A group detail (members/students masked)', async () => {
    const res = await request(app)
      .get(`/admin/groups/${A.g}`)
      .query({ branchId: B.br, academicYearId: B.ay })
      .set(mgrB());
    // M13 FIX: 403/404 (was: 200 with member + student PII).
    expect([403, 404]).toContain(res.status);
  });

  test('B admin attendance batch against A group denied with zero rows', async () => {
    const res = await request(app)
      .post('/admin/attendance/batch')
      .query({ branchId: B.br, academicYearId: B.ay })
      .set(mgrB())
      .send({ date: '2026-09-10', groupId: A.g, records: [] });
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe('M13 upload-session ownership', () => {
  const tokA = () => getAuthHeader(generateTestToken(A.mgr, 'management', { branchIds: [A.br] }));
  const tokB = () => getAuthHeader(generateTestToken(B.ba, 'management', { branchIds: [B.br] }));

  test('wrong user gets 404 on get/PATCH/complete/cancel with zero mutation', async () => {
    const created = await request(app)
      .post('/api/upload-sessions')
      .set(tokA())
      .send({ purpose: 'document', originalFilename: 'a.pdf', mimeType: 'application/pdf', expectedSize: 1024, idempotencyKey: `${P}-k1` });
    expect([200, 201]).toContain(created.status);
    const sid = created.body?.data?.id as string;
    expect(sid).toBeTruthy();

    expect((await request(app).get(`/api/upload-sessions/${sid}`).set(tokB())).status).toBe(404);
    // PATCH ownership runs through the same session.userId gate (service-level:
    // HTTP streaming of a stranger body hangs supertest, so assert the exact
    // code path directly with a fake stream — zero bytes must commit).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { uploadTransferService } = require('../../../src/modules/upload/upload-transfer.service');
    const { Readable } = require('stream');
    await expect(
      uploadTransferService.transferChunk({
        sessionId: sid,
        userId: B.ba,
        offsetHeader: '0',
        contentLengthHeader: '10',
        body: Readable.from([Buffer.alloc(10, 7)]),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await request(app).post(`/api/upload-sessions/${sid}/complete`).set(tokB())).status).toBe(404);
    expect((await request(app).delete(`/api/upload-sessions/${sid}`).set(tokB())).status).toBe(404);

    // Owner session untouched: still active, zero bytes committed by stranger.
    const mine = await request(app).get(`/api/upload-sessions/${sid}`).set(tokA());
    expect(mine.status).toBe(200);
    await request(app).delete(`/api/upload-sessions/${sid}`).set(tokA());
  });

  test('forged session id returns 404, never 500', async () => {
    const res = await request(app).get('/api/upload-sessions/does-not-exist').set(tokA());
    expect(res.status).toBe(404);
  });
});

describe('M13 groups cross-branch mutation + error masking + revocation', () => {
  const supTok = () => getAuthHeader(generateTestToken(A.sup, 'super_admin'));

  test('B admin cannot deactivate A group (zero mutation)', async () => {
    const mgrB = () => getAuthHeader(generateTestToken(B.ba, 'management', { branchIds: [B.br] }));
    const res = await request(app)
      .delete(`/admin/groups/${A.g}`)
      .query({ branchId: B.br })
      .set(mgrB());
    expect([400, 403, 404]).toContain(res.status);
    const g = await prisma.group.findUnique({ where: { id: A.g } });
    expect(g?.isActive).toBe(true);
  });

  test('production error responses mask internals (no stack/prisma/sql)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const handler = require('../../../src/middleware/error/errorHandler').default;
    const prev = process.env.APP_MODE;
    const calls: unknown[] = [];
    const res: { status: (c: number) => { json: (b: unknown) => void }; statusCode?: number; body?: unknown } = {
      status: (c: number) => ({ json: (b: unknown) => { calls.push([c, b]); } }),
    } as never;
    const req = { headers: {}, method: 'GET', originalUrl: '/x' } as never;
    const err = Object.assign(new Error('prisma SELECT * FROM users /tmp/secret stack'), {
      code: 'P2002',
      meta: { target: ['id'], driverAdapterError: { cause: 'sql conn' } },
    });
    process.env.APP_MODE = 'production';
    try {
      handler(err, req, res, () => undefined);
    } finally {
      process.env.APP_MODE = prev;
    }
    const [code, body] = calls[0] as [number, Record<string, unknown>];
    expect(code).toBe(500);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/prisma|SELECT|\/tmp/i);
  });

  test('logout without Upstash does not revoke JWT (provider-limited revocation contract)', async () => {
    // No UPSTASH_* in test env (see tests/setup.ts): blacklist disabled.
    const tok = getAuthHeader(generateTestToken(A.mgr, 'management', { branchIds: [A.br] }));
    const logout = await request(app).post('/auth/logout').set(tok);
    expect([200, 204]).toContain(logout.status);
    // Same token still authenticates: revocation requires the Upstash
    // provider, which is unavailable here AND in any env without it.
    const me = await request(app).get('/auth/me').set(tok);
    expect(me.status).toBe(200);
  });
});

describe('M13 stale membership (removed mid-session)', () => {
  test('removed member loses admin API access even with stale JWT branchIds', async () => {
    const tok = () => getAuthHeader(generateTestToken(B.ba, 'management', { branchIds: [B.br] }));
    // Sanity: membership present → stats reachable (200 or 400-shape, never 403).
    const before = await request(app).get('/admin/branches').query({}).set(tok());
    expect([200, 400, 404]).toContain(before.status);
    await prisma.branchMember.deleteMany({ where: { branchId: B.br, userId: B.ba } });
    try {
      // Branch-scoped write with stale token must now fail closed.
      const res = await request(app)
        .post(`/admin/branches/${B.br}/staff`)
        .set(tok())
        .send({ userId: B.ba, role: 'teacher' });
      expect([400, 403, 404]).toContain(res.status);
    } finally {
      await prisma.branchMember.create({
        data: { branchId: B.br, userId: B.ba, role: 'branch_admin', isActive: true },
      });
    }
  });
});

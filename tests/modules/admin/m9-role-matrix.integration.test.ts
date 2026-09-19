/**
 * M9 §2/§12 — role/API isolation matrix (real PG + real HTTP + real JWT).
 *
 * Proves on the real stack: super_admin-only endpoints deny management/
 * teacher/student; branch-admin endpoints deny non-admins; module-scoped
 * /admin endpoints remain available to management BY DESIGN (module RBAC);
 * /admin role gate denies teacher/student entirely.
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
const P = uniquePrefix();
const branchId = `${P}_br`;
const ayId = `${P}_ay`;
const U = {
  sup: `${P}_sup`,
  mgr: `${P}_mgr`,
  ba: `${P}_ba`,
  tchr: `${P}_tchr`,
  stud: `${P}_stud`,
};

function tok(uid: string, role: 'super_admin' | 'management' | 'teacher' | 'student', branchIds: string[] = []) {
  return getAuthHeader(generateTestToken(uid, role, { branchIds }));
}

beforeAll(async () => {
  prisma = createTestPrisma();
  const cal = await prisma.academicCalendar.create({
    data: { id: `${P}_cal`, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: branchId, name: `${P} branch`, code: `${P}BR` } });
  await prisma.academicYear.create({ data: { id: ayId, branchId, calendarId: cal.id, status: 'ACTIVE' } });
  await prisma.user.createMany({
    data: [
      { id: U.sup, name: 'M9 Sup', passwordHash: 'x', role: 'super_admin' },
      { id: U.mgr, name: 'M9 Mgr', passwordHash: 'x', role: 'management' },
      { id: U.ba, name: 'M9 BA', passwordHash: 'x', role: 'management' },
      { id: U.tchr, name: 'M9 Tchr', passwordHash: 'x', role: 'teacher' },
      { id: U.stud, name: 'M9 Stud', passwordHash: 'x', role: 'student' },
    ],
  });
  // ba = branch_admin at this branch; mgr = plain management (legacy-unrestricted path).
  await prisma.branchMember.create({ data: { branchId, userId: U.ba, role: 'branch_admin', isActive: true } });
}, 120000);

afterAll(async () => {
  await prisma.branchMember.deleteMany({ where: { branchId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ayId } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: branchId } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: `${P}_cal` } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M9 role/API isolation — super_admin-only endpoints', () => {
  test('GET /api-keys: sup allowed; management/teacher/student denied', async () => {
    const rSup = await request(app).get('/api-keys').set(tok(U.sup, 'super_admin'));
    expect([200, 400]).toContain(rSup.status);
    for (const [uid, role] of [[U.mgr, 'management'], [U.tchr, 'teacher'], [U.stud, 'student']] as const) {
      const r = await request(app).get('/api-keys').set(tok(uid, role, [branchId]));
      expect(r.status).toBe(403);
    }
  });

  test('POST /admin/invitations: sup passes gate; others denied', async () => {
    const body = { email: `${P}@x.test`, branchId };
    const rSup = await request(app).post('/admin/invitations').set(tok(U.sup, 'super_admin')).send(body);
    expect([200, 201, 400]).toContain(rSup.status);
    for (const [uid, role] of [[U.mgr, 'management'], [U.tchr, 'teacher'], [U.stud, 'student']] as const) {
      const r = await request(app).post('/admin/invitations').set(tok(uid, role, [branchId])).send(body);
      expect(r.status).toBe(403);
    }
  });

  test('POST /branches/:id/staff (principal only): ba passes gate; mgr/teacher denied', async () => {
    const body = { userId: U.tchr, role: 'teacher' };
    const rBa = await request(app).post(`/branches/${branchId}/staff`).set(tok(U.ba, 'management', [branchId])).send(body);
    // ba is branch_admin: passes gate (201 created or 400/409 on re-run) — never 403.
    expect([200, 201, 400, 409]).toContain(rBa.status);
    const rMgr = await request(app).post(`/branches/${branchId}/staff`).set(tok(U.mgr, 'management', [branchId])).send(body);
    expect(rMgr.status).toBe(403);
    const rTchr = await request(app).post(`/branches/${branchId}/staff`).set(tok(U.tchr, 'teacher', [branchId])).send(body);
    expect(rTchr.status).toBe(403);
  });
});

describe('M9 role/API isolation — module-scoped admin endpoints (intended access)', () => {
  test('GET /admin/branches/:id/stats: sup + branch-admin + management allowed (module RBAC)', async () => {
    for (const [uid, role] of [[U.sup, 'super_admin'], [U.ba, 'management'], [U.mgr, 'management']] as const) {
      const r = await request(app)
        .get(`/admin/branches/${branchId}/stats`)
        .query({ branchId, academicYearId: ayId })
        .set(tok(uid, role, [branchId]));
      expect([200, 400]).toContain(r.status);
      expect(r.status).not.toBe(403);
    }
  });

  test('teacher + student denied at /admin role gate', async () => {
    for (const [uid, role] of [[U.tchr, 'teacher'], [U.stud, 'student']] as const) {
      const r = await request(app)
        .get(`/admin/branches/${branchId}/stats`)
        .query({ branchId, academicYearId: ayId })
        .set(tok(uid, role, [branchId]));
      expect(r.status).toBe(403);
    }
  });

  test('wrong-branch management denied by branch scope', async () => {
    const r = await request(app)
      .get(`/admin/branches/${branchId}/stats`)
      .query({ branchId, academicYearId: ayId })
      .set(tok(U.mgr, 'management', ['other-branch']));
    expect([400, 403]).toContain(r.status);
  });
});

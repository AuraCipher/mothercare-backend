/**
 * M9 §10 — staff attendance behavior lock (real PG + real HTTP).
 *
 * CURRENT FACT (audit): POST /admin/attendance/staff/batch writes
 * StaffAttendance rows and fires NO notification of any kind (no system
 * feed, no outbox row, no message). This test locks that behavior so the
 * Phase-10 decision (add staff-absence notify vs keep silent) is made
 * deliberately, never by accident.
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
const P = uniquePrefix() + '_m9ss';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  admin: `${P}_admin`,
  staff: `${P}_staff`,
};

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.user.create({ data: { id: ids.admin, name: ids.admin, passwordHash: 'x', role: 'super_admin' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  await prisma.user.create({ data: { id: ids.staff, name: ids.staff, passwordHash: 'x', role: 'management' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.staff, role: 'worker', isActive: true } });
}, 120000);

afterAll(async () => {
  await prisma.staffAttendance.deleteMany({ where: { staffUserId: ids.staff } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.staff] } } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M9 staff attendance — currently silent by design', () => {
  test('absent staff write persists with zero notifications anywhere', async () => {
    const token = getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
    const res = await request(app)
      .post('/admin/attendance/staff/batch')
      .query({ branchId: ids.br, academicYearId: ids.ay })
      .set(token)
      .send({ date: '2026-09-10', records: [{ staffUserId: ids.staff, status: 'absent', note: 'sick' }] });
    expect(res.status).toBe(200);
    expect(res.body?.data?.saved).toBe(1);

    const row = await prisma.staffAttendance.findFirst({
      where: { staffUserId: ids.staff, date: new Date('2026-09-10') },
    });
    expect(row?.status).toBe('absent');

    // No notification surface touched: no outbox rows, no messages to staff.
    expect(await prisma.attendanceNotification.count({ where: { studentId: ids.staff } })).toBe(0);
    expect(await prisma.paymentNotification.count({ where: { studentId: ids.staff } })).toBe(0);
    const rooms = await prisma.chatRoom.findMany({
      where: { members: { some: { userId: ids.staff } } },
      select: { id: true },
    });
    if (rooms.length > 0) {
      expect(
        await prisma.chatMessage.count({ where: { roomId: { in: rooms.map((r) => r.id) } } }),
      ).toBe(0);
    }
  });
});

/**
 * M14 §14/§15 — family idempotencyKey: lost-response retry and concurrent
 * duplicate converge onto one FamilyPayment (real PG + real HTTP).
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
const P = uniquePrefix() + '_m14fi';
const ids = {
  cal: `${P}_cal`, br: `${P}_br`, ay: `${P}_ay`, g: `${P}_g`,
  admin: `${P}_admin`, u: `${P}_u`, st: `${P}_st`, fam: `${P}_fam`, fee: `${P}_fee`,
};

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.user.create({ data: { id: ids.admin, name: 'a', passwordHash: 'x', role: 'super_admin' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  await prisma.user.create({ data: { id: ids.u, name: 'u', passwordHash: 'x', role: 'student' } });
  await prisma.student.create({
    data: { id: ids.st, academicYearId: ids.ay, groupId: ids.g, name: 'S', userId: ids.u, status: 'ACTIVE', isActive: true },
  });
  await prisma.family.create({ data: { id: ids.fam, name: 'F' } });
  await prisma.student.update({ where: { id: ids.st }, data: { familyId: ids.fam } });
  await prisma.studentFee.create({
    data: { id: ids.fee, academicYearId: ids.ay, studentId: ids.st, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
}, 120000);

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { studentId: ids.st } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: ids.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: ids.fee } }).catch(() => undefined);
  await prisma.student.update({ where: { id: ids.st }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: ids.st } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: ids.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.u] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M14 family idempotency', () => {
  const tok = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const q = () => ({ branchId: ids.br });
  const body = (key?: string) => ({
    familyId: ids.fam,
    academicYearId: ids.ay,
    amountPaidPaise: 50000,
    paymentMethod: 'CASH',
    ...(key ? { idempotencyKey: key } : {}),
    students: [{ studentId: ids.st, amountPaidPaise: 50000, previousMonths: [{ studentFeeId: ids.fee, amountPaise: 50000 }] }],
  });

  test('sequential identical retry with key: one header, paid once, idempotent:true', async () => {
    const key = `${P}-famkey-1`;
    const r1 = await request(app).post('/admin/family-payments/allocate').query(q()).set(tok()).send(body(key));
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/admin/family-payments/allocate').query(q()).set(tok()).send(body(key));
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(r2.body?.data?.familyPayment?.id ?? r2.body?.data?.id).toBe(
      r1.body?.data?.familyPayment?.id ?? r1.body?.data?.id,
    );
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.fee } });
    expect(fee?.paidAmount).toBe(50000);
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBe(1);
    expect(await prisma.payment.count({ where: { studentId: ids.st } })).toBe(1);
  });

  test('concurrent same-key submits: one header, no double-pay', async () => {
    const key = `${P}-famkey-2`;
    const [a, b] = await Promise.all([
      request(app).post('/admin/family-payments/allocate').query(q()).set(tok()).send(body(key)),
      request(app).post('/admin/family-payments/allocate').query(q()).set(tok()).send(body(key)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.fee } });
    // Sequential test paid 50000 already; concurrent pair must add exactly one more 50000... no:
    // both raced the same key — winner creates ONE payment batch (50000 total).
    expect(fee?.paidAmount).toBe(100000);
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBe(2);
  });

  test('different keys are independent operations (legitimate repeats allowed)', async () => {
    const r = await request(app).post('/admin/family-payments/allocate').query(q()).set(tok()).send(body(`${P}-famkey-3`));
    // Fee is now PAID (100000/100000): identical amounts no longer fit → clean 400, no rows.
    expect(r.status).toBe(400);
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBe(2);
  });
});

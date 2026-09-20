/**
 * M12 §§21–22 — cross-branch financial isolation (real PG + real HTTP).
 * Branch-B admin must not touch Branch-A fees/families/payments/receipts.
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
const P = uniquePrefix() + '_m12x';
const A = { cal: `${P}_ca`, br: `${P}_ba`, ay: `${P}_aya`, g: `${P}_ga`, admin: `${P}_aa`, u: `${P}_ua`, st: `${P}_sa`, fee: `${P}_fa`, fam: `${P}_fama` };
const B = { cal: `${P}_cb`, br: `${P}_bb`, ay: `${P}_ayb`, admin: `${P}_ab` };

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: A.cal, label: `${P}-ca`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.academicCalendar.create({
    data: { id: B.cal, label: `${P}-cb`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: A.br, name: 'A', code: `${P}BA` } });
  await prisma.branch.create({ data: { id: B.br, name: 'B', code: `${P}BB` } });
  await prisma.academicYear.create({ data: { id: A.ay, branchId: A.br, calendarId: A.cal } });
  await prisma.academicYear.create({ data: { id: B.ay, branchId: B.br, calendarId: B.cal } });
  await prisma.group.create({ data: { id: A.g, academicYearId: A.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.user.create({ data: { id: A.admin, name: 'aa', passwordHash: 'x', role: 'super_admin' } });
  await prisma.branchMember.create({ data: { branchId: A.br, userId: A.admin, role: 'branch_admin', isActive: true } });
  await prisma.user.create({ data: { id: B.admin, name: 'ab', passwordHash: 'x', role: 'management' } });
  await prisma.branchMember.create({ data: { branchId: B.br, userId: B.admin, role: 'branch_admin', isActive: true } });
  await prisma.user.create({ data: { id: A.u, name: 'u', passwordHash: 'x', role: 'student' } });
  await prisma.student.create({
    data: { id: A.st, academicYearId: A.ay, groupId: A.g, name: 'S', userId: A.u, status: 'ACTIVE', isActive: true },
  });
  await prisma.family.create({ data: { id: A.fam, name: 'F' } });
  await prisma.student.update({ where: { id: A.st }, data: { familyId: A.fam } });
  await prisma.studentFee.create({
    data: { id: A.fee, academicYearId: A.ay, studentId: A.st, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: A.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: A.st } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: A.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: A.fee } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: A.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: A.ay } }).catch(() => undefined);
  await prisma.student.update({ where: { id: A.st }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: A.st } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: A.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [A.admin, B.admin, A.u] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: { in: [A.br, B.br] } } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: A.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: { in: [A.ay, B.ay] } } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: { in: [A.br, B.br] } } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: { in: [A.cal, B.cal] } } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M12 cross-branch financial isolation', () => {
  const adminA = () => getAuthHeader(generateTestToken(A.admin, 'super_admin'));
  const adminB = () => getAuthHeader(generateTestToken(B.admin, 'management', { branchIds: [B.br] }));

  test('B admin cannot pay A fee (scope mismatch, zero mutation)', async () => {
    const res = await request(app)
      .post('/admin/payments')
      .query({ branchId: B.br })
      .set(adminB())
      .send({ studentFeeId: A.fee, amount: 50000, paymentMethod: 'CASH' });
    expect([400, 403, 404]).toContain(res.status);
    expect(await prisma.payment.count({ where: { studentFeeId: A.fee } })).toBe(0);
    const fee = await prisma.studentFee.findUnique({ where: { id: A.fee } });
    expect(fee?.paidAmount).toBe(0);
  });

  test('B admin cannot run family payment for A family (zero mutation)', async () => {
    const res = await request(app)
      .post('/admin/family-payments')
      .query({ branchId: B.br })
      .set(adminB())
      .send({ familyId: A.fam, academicYearId: A.ay, payments: [{ studentFeeId: A.fee, amount: 50000 }] });
    expect([400, 403, 404]).toContain(res.status);
    expect(await prisma.payment.count({ where: { studentId: A.st } })).toBe(0);
    expect(await prisma.familyPayment.count({ where: { familyId: A.fam } })).toBe(0);
  });

  test('A admin pays normally (positive control) + B admin cannot read the receipt', async () => {
    const pay = await request(app)
      .post('/admin/payments')
      .query({ branchId: A.br })
      .set(adminA())
      .send({ studentFeeId: A.fee, amount: 50000, paymentMethod: 'CASH' });
    expect(pay.status).toBe(201);
    const pid = pay.body?.data?.payment?.id as string;
    const rB = await request(app).get(`/admin/payments/${pid}/receipt`).query({ branchId: B.br }).set(adminB());
    expect([400, 403, 404]).toContain(rB.status);
    const rA = await request(app).get(`/admin/payments/${pid}/receipt`).query({ branchId: A.br }).set(adminA());
    expect(rA.status).toBe(200);
  });
});

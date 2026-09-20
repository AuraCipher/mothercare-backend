/**
 * M12 §16/§17 — revert head-allocation staleness + revert replay/concurrency
 * (real PG + real HTTP).
 *
 * CURRENT FACT UNDER TEST: reverting a payment re-aggregates the fee but
 * leaves PaymentHeadAllocation rows with revertedAt=null, so a legitimate
 * re-allocation of the same heads is rejected as exceeding remaining due.
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
const P = uniquePrefix() + '_m12r';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  head: `${P}_head`,
  admin: `${P}_admin`,
  uA: `${P}_uA`,
  stA: `${P}_stA`,
  fee: `${P}_fee`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.feeHead.create({ data: { id: ids.head, name: 'Tuition', category: 'MONTHLY' } });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  await user(ids.uA, 'student');
  await prisma.student.create({
    data: { id: ids.stA, academicYearId: ids.ay, groupId: ids.g, name: ids.stA, userId: ids.uA, status: 'ACTIVE', isActive: true },
  });
  await prisma.studentFee.create({
    data: {
      id: ids.fee, academicYearId: ids.stA ? ids.ay : ids.ay, studentId: ids.stA, month: 9, year: 2026,
      totalAmount: 100000, netAmount: 100000, status: 'UNPAID',
      feeHeadBreakdown: [{ feeHeadId: ids.head, name: 'Tuition', amount: 100000, category: 'MONTHLY' }],
    },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.paymentHeadAllocation.deleteMany({ where: { studentFeeId: ids.fee } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: ids.stA } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: ids.fee } }).catch(() => undefined);
  await prisma.feeHead.deleteMany({ where: { id: ids.head } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: ids.stA } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.uA] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M12 revert head-allocation staleness + replay', () => {
  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const allocBody = (amt: number) => ({
    studentId: ids.stA,
    amountPaidPaise: amt,
    paymentMethod: 'CASH',
    currentMonth: { studentFeeId: ids.fee, heads: [{ feeHeadId: ids.head, amountPaise: amt }] },
  });

  test('allocate heads → revert → re-allocate same heads works (allocations voided)', async () => {
    const r1 = await request(app).post('/admin/payments/allocate').query({ branchId: ids.br }).set(token()).send(allocBody(60000));
    expect(r1.status).toBe(201);
    const pid = r1.body?.data?.payments?.[0]?.id as string;
    expect(pid).toBeTruthy();

    const rr = await request(app).post(`/admin/payments/${pid}/revert`).query({ branchId: ids.br }).set(token()).send({ reason: 'test revert' });
    expect(rr.status).toBe(200);
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.fee } });
    expect(fee?.paidAmount).toBe(0);
    expect(fee?.status).toBe('UNPAID');

    // M12 FIX: reverted payment's head allocations are voided, so the same
    // heads can be re-allocated (was: 400 "exceeds its remaining due").
    const r2 = await request(app).post('/admin/payments/allocate').query({ branchId: ids.br }).set(token()).send(allocBody(60000));
    expect(r2.status).toBe(201);
    const fee2 = await prisma.studentFee.findUnique({ where: { id: ids.fee } });
    expect(fee2?.paidAmount).toBe(60000);
  });

  test('revert replay + concurrent reverts: single reversal, clean 400s', async () => {
    const r = await request(app).post('/admin/payments/allocate').query({ branchId: ids.br }).set(token()).send(allocBody(20000));
    expect(r.status).toBe(201);
    const pid = r.body?.data?.payments?.[0]?.id as string;

    const [a, b] = await Promise.all([
      request(app).post(`/admin/payments/${pid}/revert`).query({ branchId: ids.br }).set(token()).send({ reason: 'x1' }),
      request(app).post(`/admin/payments/${pid}/revert`).query({ branchId: ids.br }).set(token()).send({ reason: 'x2' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);

    const rAgain = await request(app).post(`/admin/payments/${pid}/revert`).query({ branchId: ids.br }).set(token()).send({ reason: 'x3' });
    expect(rAgain.status).toBe(400);
    const rows = await prisma.payment.findMany({ where: { id: pid } });
    expect(rows.filter((p) => p.revertedAt).length).toBe(1);
  });
});

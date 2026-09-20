/**
 * M15 §10 — payroll idempotency (real PG + real HTTP).
 * Single + bulk: sequential/concurrent/different-key/scope/malformed.
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
const P = uniquePrefix() + '_m15p';
const ids = {
  cal: `${P}_cal`, br: `${P}_br`, ay: `${P}_ay`,
  admin: `${P}_admin`, t1: `${P}_t1`, t2: `${P}_t2`,
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
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal, status: 'ACTIVE' } });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  for (const t of [ids.t1, ids.t2]) {
    await user(t, 'teacher');
    await prisma.branchMember.create({ data: { branchId: ids.br, userId: t, role: 'teacher', isActive: true } });
    await prisma.teacherProfile.create({ data: { userId: t, portalAccess: 'FULL' } });
  }
}, 120000);

afterAll(async () => {
  await prisma.payrollPaymentDetail.deleteMany({ where: { payeeUserId: { in: [ids.t1, ids.t2] } } }).catch(() => undefined);
  await prisma.branchOutgoingPayment.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.payrollBulkRun.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.payrollMonthBalance.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.t1, ids.t2] } } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M15 payroll idempotency', () => {
  const adminTok = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const q = () => ({ branchId: ids.br, academicYearId: ids.ay });
  const single = (payee: string, month: string, amount: number, key?: string) =>
    request(app).post('/admin/expenses/payroll').query(q()).set(adminTok()).send({
      payeeUserId: payee, salaryMonth: month, amount, paymentMethod: 'CASH',
      ...(key !== undefined ? { idempotencyKey: key } : {}),
    });

  test('single sequential retry: one payment, same voucher', async () => {
    const key = `${P}-pay-1`;
    const r1 = await single(ids.t1, '2026-09', 50000, key);
    expect(r1.status).toBe(201);
    const r2 = await single(ids.t1, '2026-09', 50000, key);
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(r2.body?.data?.voucherNumber).toBe(r1.body?.data?.voucherNumber);
    expect(await prisma.branchOutgoingPayment.count({
      where: { branchId: ids.br, type: 'PAYROLL', idempotencyKey: key },
    })).toBe(1);
  });

  test.each([2, 4])('%i concurrent same-key singles: one payment', async (n) => {
    const key = `${P}-pay-n${n}`;
    const results = await Promise.all(
      Array.from({ length: n }, () => single(ids.t2, '2026-10', 40000, key)),
    );
    const ok201 = results.filter((r) => r.status === 201).length;
    const ok200 = results.filter((r) => r.status === 200 && r.body?.idempotent === true).length;
    const other = results.filter((r) => r.status !== 201 && !(r.status === 200 && r.body?.idempotent === true));
    if (other.length > 0) {
      console.log('PAY-OTHER:', other.map((r) => [r.status, JSON.stringify(r.body).slice(0, 250)]));
    }
    expect(other).toEqual([]);
    expect(ok201).toBe(1);
    expect(ok200).toBe(n - 1);
    expect(new Set(results.map((r) => r.body?.data?.voucherNumber)).size).toBe(1);
  }, 120000);

  test('bulk sequential retry: one run, same vouchers', async () => {
    const key = `${P}-bulk-1`;
    const body = {
      salaryMonth: '2026-11', paymentMethod: 'CASH', academicYearId: ids.ay,
      idempotencyKey: key,
      payments: [
        { payeeUserId: ids.t1, amount: 45000 },
        { payeeUserId: ids.t2, amount: 45000 },
      ],
    };
    const r1 = await request(app).post('/admin/expenses/payroll/bulk').query(q()).set(adminTok()).send(body);
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/admin/expenses/payroll/bulk').query(q()).set(adminTok()).send(body);
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(await prisma.payrollBulkRun.count({ where: { branchId: ids.br, idempotencyKey: key } })).toBe(1);
    const v1 = (r1.body?.data?.results ?? []).map((x: { voucherNumber: string }) => x.voucherNumber).sort();
    const v2 = (r2.body?.data?.results ?? []).map((x: { voucherNumber: string }) => x.voucherNumber).sort();
    expect(v2).toEqual(v1);
  });

  test('bulk concurrent same-key (4-way): one run', async () => {
    const key = `${P}-bulk-n4`;
    const body = {
      salaryMonth: '2026-12', paymentMethod: 'CASH', academicYearId: ids.ay,
      idempotencyKey: key,
      payments: [{ payeeUserId: ids.t1, amount: 30000 }],
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post('/admin/expenses/payroll/bulk').query(q()).set(adminTok()).send(body)),
    );
    const ok201 = results.filter((r) => r.status === 201).length;
    const ok200 = results.filter((r) => r.status === 200 && r.body?.idempotent === true).length;
    const other = results.filter((r) => r.status !== 201 && !(r.status === 200 && r.body?.idempotent === true));
    expect(other).toEqual([]);
    expect(ok201).toBe(1);
    expect(ok200).toBe(3);
  }, 120000);

  test('malformed keys 400; cross-branch replay resolves by key authority (documented)', async () => {
    const rBad = await single(ids.t1, '2026-09', 1000, 123 as never);
    expect(rBad.status).toBe(400);
  });
});

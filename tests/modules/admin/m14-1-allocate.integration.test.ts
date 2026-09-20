/**
 * M14.1 — allocate-single idempotency (real PG + real HTTP).
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
const P = uniquePrefix() + '_m141a';
const ids = {
  cal: `${P}_cal`, br: `${P}_br`, ay: `${P}_ay`, g: `${P}_g`,
  admin: `${P}_admin`, teacher: `${P}_teacher`,
};
const createdUserIds: string[] = [];

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
  createdUserIds.push(id);
}

async function mkStudent(tag: string, months: number[]) {
  const u = `${P}_u${tag}`;
  const s = `${P}_s${tag}`;
  await user(u, 'student');
  await prisma.student.create({
    data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
  });
  for (const m of months) {
    await prisma.studentFee.create({
      data: {
        id: `${P}_f${tag}m${m}`, academicYearId: ids.ay, studentId: s, month: m, year: 2026,
        totalAmount: 100000, netAmount: 100000, status: 'UNPAID',
      },
    });
  }
  return s;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  await user(ids.teacher, 'teacher');
}, 120000);

afterAll(async () => {
  const students = await prisma.student.findMany({ where: { academicYearId: ids.ay }, select: { id: true } });
  const sids = students.map((s) => s.id);
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: sids } } }).catch(() => undefined);
  await prisma.paymentOperation.deleteMany({ where: { studentId: { in: sids } } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M14.1 allocate-single idempotency', () => {
  const adminTok = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const q = () => ({ branchId: ids.br });
  const al = (studentId: string, feeId: string, amount: number, key?: string) =>
    request(app).post('/admin/payments/allocate').query(q()).set(adminTok()).send({
      studentId, amountPaidPaise: amount, paymentMethod: 'CASH',
      ...(key !== undefined ? { idempotencyKey: key } : {}),
      previousMonths: [{ studentFeeId: feeId, amountPaise: amount }],
    });

  test('sequential retry same key: one effect, same receipt', async () => {
    const st = await mkStudent('seq', [9, 10]);
    const key = `${P}-al-1`;
    const fee = `${P}_fseqm9`;
    const r1 = await al(st, fee, 60000, key);
    expect(r1.status).toBe(201);
    const r2 = await al(st, fee, 60000, key);
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(r2.body?.data?.receiptNumber).toBe(r1.body?.data?.receiptNumber);
    const f = await prisma.studentFee.findUnique({ where: { id: fee } });
    expect(f?.paidAmount).toBe(60000);
    expect(f?.status).toBe('PARTIAL');
    expect(await prisma.payment.count({ where: { studentFeeId: fee } })).toBe(1);
    expect(await prisma.paymentOperation.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  test.each([2, 4, 8])('%i concurrent same-key: one effect, rest converge', async (n) => {
    const st = await mkStudent(`c${n}`, [9, 10]);
    const fee = `${P}_fc${n}m9`;
    const key = `${P}-al-n${n}`;
    const results = await Promise.all(
      Array.from({ length: n }, () => al(st, fee, 60000, key)),
    );
    const ok201 = results.filter((r) => r.status === 201).length;
    const ok200 = results.filter((r) => r.status === 200 && r.body?.idempotent === true).length;
    const other = results.filter((r) => r.status !== 201 && !(r.status === 200 && r.body?.idempotent === true));
    expect(other).toEqual([]);
    expect(ok201).toBe(1);
    expect(ok200).toBe(n - 1);
    expect(new Set(results.map((r) => r.body?.data?.receiptNumber)).size).toBe(1);
    const f = await prisma.studentFee.findUnique({ where: { id: fee } });
    expect(f?.paidAmount).toBe(60000);
    expect(await prisma.payment.count({ where: { studentFeeId: fee } })).toBe(1);
  }, 120000);

  test('different keys stay independent', async () => {
    const st = await mkStudent('diff', [9]);
    const fee = `${P}_fdiffm9`;
    const r1 = await al(st, fee, 20000, `${P}-al-d1`);
    const r2 = await al(st, fee, 20000, `${P}-al-d2`);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const f = await prisma.studentFee.findUnique({ where: { id: fee } });
    expect(f?.paidAmount).toBe(40000);
  });

  test('same key, different student → 409, zero effect', async () => {
    const st = await mkStudent('scope', [9]);
    const before = await prisma.payment.count({ where: { studentId: st } });
    const res = await al(st, `${P}_fseqm9`, 10000, `${P}-al-1`);
    expect(res.status).toBe(409);
    expect(await prisma.payment.count({ where: { studentId: st } })).toBe(before);
  });

  test('malformed keys rejected; teacher denied', async () => {
    const st = await mkStudent('mal', [9]);
    const fee = `${P}_fmalm9`;
    expect((await al(st, fee, 10000, 123 as never)).status).toBe(400);
    expect((await al(st, fee, 10000, 'x'.repeat(129))).status).toBe(400);
    const tok = getAuthHeader(generateTestToken(ids.teacher, 'teacher'));
    const denied = await request(app).post('/admin/payments/allocate').query(q()).set(tok).send({
      studentId: st, amountPaidPaise: 10000, paymentMethod: 'CASH',
      previousMonths: [{ studentFeeId: fee, amountPaise: 10000 }],
      idempotencyKey: `${P}-al-t`,
    });
    expect(denied.status).toBe(403);
    expect(await prisma.paymentOperation.count({ where: { idempotencyKey: `${P}-al-t` } })).toBe(0);
  });
});

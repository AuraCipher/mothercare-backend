/**
 * M12 §§7–11,15–22 — family model, membership authZ, contention, revert,
 * generation, receipts, isolation, invariants (real PG + real HTTP).
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
const P = uniquePrefix() + '_m12f';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  head: `${P}_head`,
  admin: `${P}_admin`,
  teacher: `${P}_teacher`,
  uA: `${P}_uA`,
  uB: `${P}_uB`,
  uC: `${P}_uC`,
  stA: `${P}_stA`,
  stB: `${P}_stB`,
  stC: `${P}_stC`,
  fam: `${P}_fam`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
}

async function mkFee(id: string, st: string, month: number, net = 100000) {
  await prisma.studentFee.create({
    data: { id, academicYearId: ids.ay, studentId: st, month, year: 2026, totalAmount: net, netAmount: net, status: 'UNPAID' },
  });
}

async function waitFor(fn: () => Promise<number>, want: number, timeoutMs = 20000): Promise<number> {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last >= want) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
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
  await prisma.feeStructure.create({
    data: { id: `${P}_fs`, academicYearId: ids.ay, groupId: ids.g, feeHeadId: ids.head, amount: 50000 },
  });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  await user(ids.teacher, 'teacher');
  for (const [u, s] of [[ids.uA, ids.stA], [ids.uB, ids.stB], [ids.uC, ids.stC]] as const) {
    await user(u, 'student');
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await prisma.family.create({ data: { id: ids.fam, name: `${P} Family`, fatherName: 'M12Father' } });
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: ids.fam } });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: ids.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.feeStructure.deleteMany({ where: { id: `${P}_fs` } }).catch(() => undefined);
  await prisma.feeHead.deleteMany({ where: { id: ids.head } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: ids.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher, ids.uA, ids.uB, ids.uC] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: ids.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.feeStructure.deleteMany({ where: { id: `${P}_fs` } }).catch(() => undefined);
  await prisma.feeHead.deleteMany({ where: { id: ids.head } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: ids.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher, ids.uA, ids.uB, ids.uC] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M12 family membership authorization (§10)', () => {
  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));

  test('non-member student fee rejected with zero mutation', async () => {
    await mkFee(`${P}_feeC`, ids.stC, 9);
    const before = await prisma.payment.count({ where: { studentId: ids.stC } });
    const res = await request(app)
      .post('/admin/family-payments')
      .query({ branchId: ids.br })
      .set(token())
      .send({
        familyId: ids.fam,
        academicYearId: ids.ay,
        payments: [{ studentFeeId: `${P}_feeC`, amount: 50000, paymentMethod: 'CASH' }],
      });
    // M12 FIX: membership enforced (was: 201 with a family-linked payment
    // for a non-member). No rows, no notifies, no receipt.
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { studentId: ids.stC } })).toBe(before);
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBe(0);
  });

  test('substituted studentId outside the family rejected (no override hole)', async () => {
    await mkFee(`${P}_feeC2`, ids.stC, 10);
    const res = await request(app)
      .post('/admin/family-payments')
      .query({ branchId: ids.br })
      .set(token())
      .send({
        familyId: ids.fam,
        academicYearId: ids.ay,
        payments: [{ studentFeeId: `${P}_feeC2`, studentId: ids.stA, amount: 10000, paymentMethod: 'CASH' }],
      });
    // Fee belongs to C (non-member); override claims A — still rejected.
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { studentFeeId: `${P}_feeC2` } })).toBe(0);
  });
});

describe('M12 N-way family contention (§11: 4 and 8 concurrent)', () => {
  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));

  async function contentionRound(n: number, month: number) {
    const feeA = `${P}_k${n}A`;
    const feeB = `${P}_k${n}B`;
    await prisma.studentFee.create({
      data: { id: feeA, academicYearId: ids.ay, studentId: ids.stA, month, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
    });
    await prisma.studentFee.create({
      data: { id: feeB, academicYearId: ids.ay, studentId: ids.stB, month, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
    });
    const body = {
      familyId: ids.fam,
      academicYearId: ids.ay,
      amountPaidPaise: 200000,
      paymentMethod: 'CASH',
      students: [
        { studentId: ids.stA, amountPaidPaise: 100000, previousMonths: [{ studentFeeId: feeA, amountPaise: 100000 }] },
        { studentId: ids.stB, amountPaidPaise: 100000, previousMonths: [{ studentFeeId: feeB, amountPaise: 100000 }] },
      ],
    };
    const q = { branchId: ids.br };
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        request(app).post('/admin/family-payments/allocate').query(q).set(token()).send(body)),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const bad = results.filter((r) => r.status === 400).length;
    const other = results.filter((r) => r.status !== 201 && r.status !== 400);
    return { ok, bad, other, feeA, feeB };
  }

  test.each([4, 8])('%i concurrent full-balance allocates: one winner, exact balances', async (n) => {
    const month = n === 4 ? 7 : 8;
    const { ok, bad, other, feeA, feeB } = await contentionRound(n, month);
    expect(other).toEqual([]);
    expect(ok).toBe(1);
    expect(bad).toBe(n - 1);
    const fa = await prisma.studentFee.findUnique({ where: { id: feeA } });
    const fb = await prisma.studentFee.findUnique({ where: { id: feeB } });
    expect(fa?.paidAmount).toBe(100000);
    expect(fb?.paidAmount).toBe(100000);
    expect(fa?.status).toBe('PAID');
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBeGreaterThanOrEqual(1);
    // Winner's notifies only: each student exactly one family message.
    for (const st of [ids.stA, ids.stB]) {
      const c = await waitFor(async () =>
        prisma.chatMessage.count({
          where: { room: { studentId: st, kind: 'system_payment' as never }, content: { contains: 'M12Father Family' } },
        }), 1);
      expect(c).toBe(1);
    }
  }, 120000);
});

describe('M12 fee generation (§18)', () => {  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));

  test('generate creates once; repeat skips without duplicates', async () => {
    const body = { month: 11, year: 2026, academicYearId: ids.ay, groupIds: [ids.g], mode: 'generate' };
    const r1 = await request(app).post('/admin/student-fees/generate').query({ branchId: ids.br }).set(token()).send(body);
    expect(r1.status).toBe(200);
    expect(r1.body?.data?.generated ?? r1.body?.generated ?? 0).toBeGreaterThanOrEqual(2);
    const count1 = await prisma.studentFee.count({ where: { academicYearId: ids.ay, month: 11, year: 2026 } });
    const r2 = await request(app).post('/admin/student-fees/generate').query({ branchId: ids.br }).set(token()).send(body);
    expect(r2.status).toBe(200);
    expect(await prisma.studentFee.count({ where: { academicYearId: ids.ay, month: 11, year: 2026 } })).toBe(count1);
  });
});

describe('M12 receipt authorization (§15/§22)', () => {
  const adminTok = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const teacherTok = () => getAuthHeader(generateTestToken(ids.teacher, 'teacher'));

  test('teacher denied on payment receipt; admin allowed; unauthenticated rejected', async () => {
    await mkFee(`${P}_feeR`, ids.stA, 6);
    const pay = await request(app).post('/admin/payments').query({ branchId: ids.br }).set(adminTok()).send({
      studentFeeId: `${P}_feeR`, amount: 10000, paymentMethod: 'CASH',
    });
    expect(pay.status).toBe(201);
    const pid = pay.body?.data?.payment?.id as string;
    expect(pid).toBeTruthy();

    const rTeacher = await request(app).get(`/admin/payments/${pid}/receipt`).set(teacherTok());
    expect(rTeacher.status).toBe(403);
    const rNone = await request(app).get(`/admin/payments/${pid}/receipt`);
    expect([401, 403, 404]).toContain(rNone.status);
    const rAdmin = await request(app).get(`/admin/payments/${pid}/receipt`).query({ branchId: ids.br }).set(adminTok());
    expect(rAdmin.status).toBe(200);
    expect(rAdmin.body?.data?.receiptNumber ?? rAdmin.body?.receiptNumber).toBeTruthy();
  });
});

/**
 * M10 §6 — family allocation contention (real PG, concurrent HTTP).
 * Two simultaneous full-balance family-allocates: exactly one must win;
 * balances must never double-spend; notifications converge.
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
const P = uniquePrefix() + '_m10fc';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  admin: `${P}_admin`,
  uA: `${P}_uA`,
  uB: `${P}_uB`,
  stA: `${P}_stA`,
  stB: `${P}_stB`,
  fam: `${P}_fam`,
  feeA: `${P}_feeA`,
  feeB: `${P}_feeB`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
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
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'Class 1', section: 'A', displayOrder: 1 } });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  for (const [u, s] of [[ids.uA, ids.stA], [ids.uB, ids.stB]] as const) {
    await user(u, 'student');
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await prisma.family.create({ data: { id: ids.fam, name: `${P} Family`, fatherName: 'M10Father' } });
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: ids.fam } });
  for (const [f, s] of [[ids.feeA, ids.stA], [ids.feeB, ids.stB]] as const) {
    await prisma.studentFee.create({
      data: { id: f, academicYearId: ids.ay, studentId: s, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
    });
  }
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: ids.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: { in: [ids.feeA, ids.feeB] } } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: ids.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.uA, ids.uB] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M10 family allocation contention', () => {
  test('two simultaneous full-balance allocates: one wins, no double-spend, notifies converge', async () => {
    const token = getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
    const body = {
      familyId: ids.fam,
      academicYearId: ids.ay,
      amountPaidPaise: 200000,
      paymentMethod: 'CASH',
      students: [
        { studentId: ids.stA, amountPaidPaise: 100000, previousMonths: [{ studentFeeId: ids.feeA, amountPaise: 100000 }] },
        { studentId: ids.stB, amountPaidPaise: 100000, previousMonths: [{ studentFeeId: ids.feeB, amountPaise: 100000 }] },
      ],
    };
    const url = '/admin/family-payments/allocate';
    const q = { branchId: ids.br };
    const [r1, r2] = await Promise.all([
      request(app).post(url).query(q).set(token).send(body),
      request(app).post(url).query(q).set(token).send(body),
    ]);
    for (const f of [ids.feeA, ids.feeB]) {
      const fee = await prisma.studentFee.findUnique({ where: { id: f } });
      console.log('FEE', f, fee?.paidAmount, fee?.status);
    }
    console.log('FPS:', await prisma.familyPayment.count({ where: { familyId: ids.fam } }));
    console.log('PAYS:', JSON.stringify(await prisma.payment.findMany({ where: { studentId: { in: [ids.stA, ids.stB] } }, select: { receiptNumber: true, amount: true } })));
    // Exactly one winner (201); loser fails cleanly (400), never 500.
    // Note: Array.sort() is lexicographic; [201, 400] is the sorted order.
    expect([r1.status, r2.status].sort()).toEqual([201, 400]);

    // No double-spend: paid amounts equal sticker exactly once.
    const feeA = await prisma.studentFee.findUnique({ where: { id: ids.feeA } });
    const feeB = await prisma.studentFee.findUnique({ where: { id: ids.feeB } });
    expect(feeA?.paidAmount).toBe(100000);
    expect(feeB?.paidAmount).toBe(100000);
    expect(feeA?.status).toBe('PAID');
    expect(feeB?.status).toBe('PAID');
    expect(await prisma.familyPayment.count({ where: { familyId: ids.fam } })).toBe(1);

    // Notifications converge: one family message per student (winner only).
    for (const st of [ids.stA, ids.stB]) {
      const n = await waitFor(async () =>
        prisma.chatMessage.count({
          where: { room: { studentId: st, kind: 'system_payment' as never }, content: { contains: 'M10Father Family' } },
        }), 1);
      expect(n).toBe(1);
    }
  }, 60000);
});

/**
 * M12 §§2–6,25 — individual lifecycle, partials, duplicates, overpayment,
 * multi-fee isolation, invariants (real PG + real HTTP).
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
const P = uniquePrefix() + '_m12c';
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
  feeA1: `${P}_feeA1`,
  feeA2: `${P}_feeA2`,
  feeB1: `${P}_feeB1`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
}

async function mkFee(id: string, st: string, month: number, net = 100000) {
  await prisma.studentFee.create({
    data: { id, academicYearId: ids.ay, studentId: st, month, year: 2026, totalAmount: net, netAmount: net, status: 'UNPAID' },
  });
}

async function waitFor(fn: () => Promise<number>, want: number, timeoutMs = 15000): Promise<number> {
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
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  for (const [u, s] of [[ids.uA, ids.stA], [ids.uB, ids.stB]] as const) {
    await user(u, 'student');
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await mkFee(ids.feeA1, ids.stA, 9);
  await mkFee(ids.feeA2, ids.stA, 10);
  await mkFee(ids.feeB1, ids.stB, 9);
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: { in: [ids.feeA1, ids.feeA2, ids.feeB1] } } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.uA, ids.uB] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M12 individual lifecycle + partials + invariants', () => {
  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const pay = (fee: string, amount: number, extra: Record<string, unknown> = {}) =>
    request(app).post('/admin/payments').query({ branchId: ids.br }).set(token()).send({
      studentFeeId: fee, amount, paymentMethod: 'CASH', ...extra,
    });

  test('three partials converge to PAID; invariant sum(payments)+remaining=obligation', async () => {
    for (const amt of [30000, 30000, 40000]) {
      const r = await pay(ids.feeA1, amt);
      expect(r.status).toBe(201);
    }
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.feeA1 } });
    expect(fee?.paidAmount).toBe(100000);
    expect(fee?.status).toBe('PAID');
    const rows = await prisma.payment.findMany({ where: { studentFeeId: ids.feeA1, revertedAt: null } });
    const sum = rows.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBe(100000);
    // Invariant: sum(valid payments) + remaining == obligation.
    expect(sum + (100000 - (fee?.paidAmount ?? 0))).toBe(100000);
    // History + notifies correspond 1:1.
    expect(rows).toHaveLength(3);
    const n = await waitFor(async () =>
      prisma.chatMessage.count({ where: { room: { studentId: ids.stA, kind: 'system_payment' as never } } }), 3);
    expect(n).toBe(3);
  });

  test('duplicate idempotencyKey: concurrent double submit → one payment, idempotent:true', async () => {
    const key = `${P}-idem-1`;
    const [r1, r2] = await Promise.all([
      pay(ids.feeA2, 25000, { idempotencyKey: key }),
      pay(ids.feeA2, 25000, { idempotencyKey: key }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 201]);
    console.log('DB2:', JSON.stringify(r2.body).slice(0, 200));
    const winner = r1.status === 201 ? r1 : r2;
    const replay = r1.status === 200 ? r1 : r2;
    expect(replay.body?.idempotent).toBe(true);
    // Winner nests under data.payment; replay returns the row directly.
    const winnerId = winner.body?.data?.payment?.id ?? winner.body?.data?.id;
    expect(replay.body?.data?.id).toBe(winnerId);
    expect(await prisma.payment.count({ where: { studentFeeId: ids.feeA2, revertedAt: null } })).toBe(1);
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.feeA2 } });
    expect(fee?.paidAmount).toBe(25000);
    expect(fee?.status).toBe('PARTIAL');
  });

  test('lost-response replay with same key converges (no second transaction)', async () => {
    const key = `${P}-idem-2`;
    const r1 = await pay(ids.feeA2, 25000, { idempotencyKey: key });
    expect(r1.status).toBe(201);
    // "Response lost" — client retries identically.
    const r2 = await pay(ids.feeA2, 25000, { idempotencyKey: key });
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(await prisma.payment.count({ where: { studentFeeId: ids.feeA2, revertedAt: null } })).toBe(2);
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.feeA2 } });
    expect(fee?.paidAmount).toBe(50000);
  });

  test('overpayment policy: exact→PAID, below→PARTIAL, above→OVERPAID (permitted by design)', async () => {
    const r = await pay(ids.feeB1, 100001);
    expect(r.status).toBe(201);
    const fee = await prisma.studentFee.findUnique({ where: { id: ids.feeB1 } });
    expect(fee?.status).toBe('OVERPAID');
    expect(fee?.paidAmount).toBe(100001);
  });

  test('multi-fee isolation: paying Sep never touches Oct or sibling', async () => {
    const oct = await prisma.studentFee.findUnique({ where: { id: ids.feeA2 } });
    expect(oct?.status).toBe('PARTIAL'); // from earlier partials, untouched by feeA1/feeB1 flows
    const b = await prisma.studentFee.findUnique({ where: { id: ids.feeB1 } });
    expect(b?.paidAmount).toBe(100001); // only its own payment
    // Sibling B has no messages about A's fees and vice versa (spot check).
    const aMsgs = await prisma.chatMessage.findMany({
      where: { room: { studentId: ids.stA, kind: 'system_payment' as never } },
    });
    expect(aMsgs.every((m) => !m.content?.includes(ids.feeB1))).toBe(true);
  });
});

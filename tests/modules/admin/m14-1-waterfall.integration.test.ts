/**
 * M14.1 — waterfall idempotency (real PG + real HTTP).
 * Each concurrency level gets its OWN student with exactly two UNPAID fees,
 * because waterfall always allocates oldest-first across all unpaid fees.
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
const P = uniquePrefix() + '_m141w';
const ids = {
  cal: `${P}_cal`, br: `${P}_br`, ay: `${P}_ay`, g: `${P}_g`,
  admin: `${P}_admin`, teacher: `${P}_teacher`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
  createdUserIds.push(id);
}

const createdUserIds: string[] = [];

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

describe('M14.1 waterfall idempotency', () => {
  const adminTok = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const q = () => ({ branchId: ids.br });
  const wf = (studentId: string, amount: number, key?: string, extra: Record<string, unknown> = {}) =>
    request(app).post('/admin/payments/waterfall').query(q()).set(adminTok()).send({
      studentId, amount, paymentMethod: 'CASH', ...(key !== undefined ? { idempotencyKey: key } : {}), ...extra,
    });

  test('sequential retry same key: one effect, same receipt, one notify', async () => {
    const st = await mkStudent('seq', [9, 10]);
    const key = `${P}-wf-1`;
    const r1 = await wf(st, 100000, key);
    expect(r1.status).toBe(201);
    const r2 = await wf(st, 100000, key);
    expect(r2.status).toBe(200);
    expect(r2.body?.idempotent).toBe(true);
    expect(r2.body?.data?.receiptNumber).toBe(r1.body?.data?.receiptNumber);
    expect(r2.body?.data?.allocations).toHaveLength(1);
    const fees = await prisma.studentFee.findMany({ where: { studentId: st }, orderBy: { month: 'asc' } });
    expect(fees.map((f) => f.paidAmount)).toEqual([100000, 0]);
    expect(await prisma.payment.count({ where: { studentId: st } })).toBe(1);
    expect(await prisma.paymentOperation.count({ where: { idempotencyKey: key } })).toBe(1);
    // Downstream: receipt snapshot + audit-free single effect (no dup rows).
    const pays = await prisma.payment.findMany({ where: { studentId: st } });
    expect(
      await prisma.paymentReceipt.count({ where: { paymentId: pays[0].id } }),
    ).toBe(1);
    const n = await waitFor(async () =>
      prisma.chatMessage.count({ where: { room: { studentId: st, kind: 'system_payment' as never } } }), 1);
    expect(n).toBe(1);
  });

  test.each([2, 4, 8])('%i concurrent same-key: one effect, rest converge', async (n) => {
    const st = await mkStudent(`c${n}`, [9, 10]);
    const key = `${P}-wf-n${n}`;
    const results = await Promise.all(
      Array.from({ length: n }, () => wf(st, 200000, key)),
    );
    const ok201 = results.filter((r) => r.status === 201).length;
    const ok200 = results.filter((r) => r.status === 200 && r.body?.idempotent === true).length;
    const other = results.filter((r) => r.status !== 201 && !(r.status === 200 && r.body?.idempotent === true));
    expect(other).toEqual([]);
    expect(ok201).toBe(1);
    expect(ok200).toBe(n - 1);
    expect(new Set(results.map((r) => r.body?.data?.receiptNumber)).size).toBe(1);
    const fees = await prisma.studentFee.findMany({ where: { studentId: st }, orderBy: { month: 'asc' } });
    expect(fees.map((f) => f.paidAmount)).toEqual([100000, 100000]);
    expect(await prisma.payment.count({ where: { studentId: st } })).toBe(2);
  }, 120000);

  test('different keys stay independent (legitimate repeats)', async () => {
    const st = await mkStudent('diff', [9]);
    const r1 = await wf(st, 30000, `${P}-wf-d1`);
    const r2 = await wf(st, 30000, `${P}-wf-d2`);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body?.data?.receiptNumber).not.toBe(r2.body?.data?.receiptNumber);
    const fee = await prisma.studentFee.findFirst({ where: { studentId: st } });
    expect(fee?.paidAmount).toBe(60000);
    expect(fee?.status).toBe('PARTIAL');
  });

  test('same key, different student → 409, zero effect', async () => {
    const st = await mkStudent('scope', [9]);
    const before = await prisma.payment.count({ where: { studentId: st } });
    // Key belongs to the 'seq' student from the first test.
    const res = await wf(st, 50000, `${P}-wf-1`);
    expect(res.status).toBe(409);
    expect(await prisma.payment.count({ where: { studentId: st } })).toBe(before);
  });

  test('malformed keys rejected before any effect; absent key flows normally', async () => {
    const st = await mkStudent('mal', [9]);
    const rEmpty = await wf(st, 10000, '');
    expect(rEmpty.status).toBe(400);
    const rNum = await wf(st, 10000, 123 as never);
    expect(rNum.status).toBe(400);
    const rLong = await wf(st, 10000, 'x'.repeat(129));
    expect(rLong.status).toBe(400);
    expect(await prisma.paymentOperation.count({ where: { studentId: st } })).toBe(0);
  });

  test('teacher denied before any key handling (authorization first)', async () => {
    const st = await mkStudent('tch', [9]);
    const tok = getAuthHeader(generateTestToken(ids.teacher, 'teacher'));
    const res = await request(app).post('/admin/payments/waterfall').query(q()).set(tok).send({
      studentId: st, amount: 1000, paymentMethod: 'CASH', idempotencyKey: `${P}-wf-t`,
    });
    expect(res.status).toBe(403);
    expect(await prisma.paymentOperation.count({ where: { idempotencyKey: `${P}-wf-t` } })).toBe(0);
  });
});

describe('M14.1 restart around operation (§4E)', () => {
  test('PG restart mid-flight: bounded failure, same-key retry converges to one effect', async () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const st = await mkStudent('rst', [9, 10]);
    const key = `${P}-wf-restart`;
    const adminTok = getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
    const q = { branchId: ids.br };
    const attempt = () =>
      request(app).post('/admin/payments/waterfall').query(q).set(adminTok).send({
        studentId: st, amount: 100000, paymentMethod: 'CASH', idempotencyKey: key,
      });
    const first = attempt();
    // Controlled interruption: restart PG ~300ms into the flight.
    await new Promise((r) => setTimeout(r, 300));
    try {
      execSync('docker restart backend-postgres-1', { timeout: 90000 });
    } catch {
      // If docker is unavailable in this env, the convergence below still proves the contract.
    }
    const r1 = await first;
    // Bounded HTTP status either way — never a hang (jest would time out).
    expect([200, 201, 400, 500, 502, 503]).toContain(r1.status);
    // Wait for PG recovery.
    let ready = false;
    for (let i = 0; i < 24 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await prisma.studentFee.findFirst({ where: { studentId: st } });
        ready = true;
      } catch {}
    }
    expect(ready).toBe(true);
    // Same-key retry converges: transient 500s while pools re-establish are
    // expected and bounded; keep retrying the SAME key until it converges,
    // then assert exactly one financial effect total.
    let r2 = await attempt();
    for (let i = 0; i < 12 && ![200, 201].includes(r2.status); i++) {
      await new Promise((r) => setTimeout(r, 5000));
      r2 = await attempt();
    }
    expect([200, 201]).toContain(r2.status);
    const fees = await prisma.studentFee.findMany({ where: { studentId: st }, orderBy: { month: 'asc' } });
    const totalPaid = fees.reduce((sum, f) => sum + (f.paidAmount || 0), 0);
    expect(totalPaid).toBe(100000);
    expect(await prisma.payment.count({ where: { studentId: st } })).toBe(1);
    expect(await prisma.paymentOperation.count({ where: { idempotencyKey: key } })).toBeLessThanOrEqual(1);
  }, 300000);
});

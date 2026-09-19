/**
 * M9 §11 — family payment notification carries BOTH the combined family
 * total AND the student's own share, per affected student, without
 * changing accounting (real PG + real HTTP).
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
const P = uniquePrefix();
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  admin: `${P}_admin`,
  uA: `${P}_uA`,
  uB: `${P}_uB`,
  uC: `${P}_uC`,
  stA: `${P}_stA`,
  stB: `${P}_stB`,
  stC: `${P}_stC`,
  fam: `${P}_fam`,
  feeA: `${P}_feeA`,
  feeB: `${P}_feeB`,
  feeC: `${P}_feeC`,
};

async function user(id: string, role: string) {
  await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
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
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'Class 1', section: 'A', displayOrder: 1 } });
  await user(ids.admin, 'super_admin');
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  for (const [u, s] of [[ids.uA, ids.stA], [ids.uB, ids.stB], [ids.uC, ids.stC]] as const) {
    await user(u, 'student');
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await prisma.family.create({ data: { id: ids.fam, name: `${P} Family`, fatherName: 'M9Father' } });
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: ids.fam } });
  await prisma.studentFee.create({
    data: { id: ids.feeA, academicYearId: ids.ay, studentId: ids.stA, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
  await prisma.studentFee.create({
    data: { id: ids.feeB, academicYearId: ids.ay, studentId: ids.stB, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
  await prisma.studentFee.create({
    data: { id: ids.feeC, academicYearId: ids.ay, studentId: ids.stC, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.familyPayment.deleteMany({ where: { familyId: ids.fam } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: { in: [ids.feeA, ids.feeB, ids.feeC] } } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.updateMany({ where: { id: { in: [ids.stA, ids.stB] } }, data: { familyId: null } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB, ids.stC] } } }).catch(() => undefined);
  await prisma.family.deleteMany({ where: { id: ids.fam } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.uA, ids.uB, ids.uC] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M9 family total + own share per student', () => {
  test('unequal combined payment: each student message has family total and own share; outsider silent', async () => {
    const token = getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
    const res = await request(app)
      .post('/admin/family-payments')
      .query({ branchId: ids.br })
      .set(token)
      .send({
        familyId: ids.fam,
        academicYearId: ids.ay,
        payments: [
          { studentFeeId: ids.feeA, amount: 60000, paymentMethod: 'CASH' },
          { studentFeeId: ids.feeB, amount: 40000, paymentMethod: 'CASH' },
        ],
      });
    expect(res.status).toBe(201);

    // Family total 100000 paise = Rs 1,000; shares Rs 600 / Rs 400.
    const total = 'Rs 1,000';
    for (const [st, share] of [[ids.stA, 'Rs 600'], [ids.stB, 'Rs 400']] as const) {
      const n = await waitFor(async () =>
        prisma.chatMessage.count({
          where: {
            room: { studentId: st, kind: 'system_payment' as never },
            content: { contains: total },
          },
        }), 1);
      expect(n).toBeGreaterThanOrEqual(1);
      const msgs = await prisma.chatMessage.findMany({
        where: { room: { studentId: st, kind: 'system_payment' as never }, content: { contains: total } },
        orderBy: { createdAt: 'asc' },
      });
      expect(msgs[0].content).toContain(share);
      expect(msgs[0].content).toContain('M9Father Family');
    }

    // Accounting untouched in shape: per-student paid amounts updated separately.
    const feeA = await prisma.studentFee.findUnique({ where: { id: ids.feeA } });
    const feeB = await prisma.studentFee.findUnique({ where: { id: ids.feeB } });
    expect(feeA?.paidAmount).toBe(60000);
    expect(feeB?.paidAmount).toBe(40000);

    // Non-member student C: no payment, no message.
    expect(await prisma.payment.count({ where: { studentId: ids.stC } })).toBe(0);
    expect(
      await prisma.chatMessage.count({ where: { room: { studentId: ids.stC, kind: 'system_payment' as never } } }),
    ).toBe(0);
  });
});

/**
 * M10 §5 — marks/results HTTP E2E (real PG + real HTTP).
 * Enter marks → per-student system_result messages with subject/marks/max;
 * replay converges; edit appends (documented semantics); report publish
 * notifies; sibling isolation holds.
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
const P = uniquePrefix() + '_m10mr';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  subj: `${P}_subj`,
  admin: `${P}_admin`,
  uA: `${P}_uA`,
  uB: `${P}_uB`,
  stA: `${P}_stA`,
  stB: `${P}_stB`,
  sess: `${P}_sess`,
  etype: `${P}_etype`,
  exam: `${P}_exam`,
  eclass: `${P}_eclass`,
  ecs: `${P}_ecs`,
};

async function resultCount(st: string) {
  return prisma.chatMessage.count({ where: { room: { studentId: st, kind: 'system_result' as never } } });
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
  await prisma.subject.create({ data: { id: ids.subj, academicYearId: ids.ay, name: 'Mathematics', code: `${P}M` } });
  await prisma.user.create({ data: { id: ids.admin, name: ids.admin, passwordHash: 'x', role: 'super_admin' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.admin, role: 'branch_admin', isActive: true } });
  for (const [u, s] of [[ids.uA, ids.stA], [ids.uB, ids.stB]] as const) {
    await prisma.user.create({ data: { id: u, name: u, passwordHash: 'x', role: 'student' } });
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await prisma.examSession.create({
    data: { id: ids.sess, name: 'Term 1', academicYearId: ids.ay, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') },
  });
  await prisma.examType.create({ data: { id: ids.etype, name: 'Quiz', examSessionId: ids.sess } });
  await prisma.exam.create({ data: { id: ids.exam, examSessionId: ids.sess, examTypeId: ids.etype, name: 'Weekly Quiz', status: 'DRAFT', startDate: new Date('2026-09-10') } });
  await prisma.examClass.create({ data: { id: ids.eclass, examId: ids.exam, classId: ids.g } });
  await prisma.examClassSubject.create({
    data: { id: ids.ecs, examClassId: ids.eclass, subjectId: ids.subj, totalMarks: 30 },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.marksEntry.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.reportCard.deleteMany({ where: { studentId: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.examClassSubject.deleteMany({ where: { id: ids.ecs } }).catch(() => undefined);
  await prisma.examClass.deleteMany({ where: { id: ids.eclass } }).catch(() => undefined);
  await prisma.exam.deleteMany({ where: { id: ids.exam } }).catch(() => undefined);
  await prisma.examType.deleteMany({ where: { id: ids.etype } }).catch(() => undefined);
  await prisma.examSession.deleteMany({ where: { id: ids.sess } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.uA, ids.uB] } } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.subject.deleteMany({ where: { id: ids.subj } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M10 marks/results E2E', () => {
  const token = () => getAuthHeader(generateTestToken(ids.admin, 'super_admin'));
  const scope = () => ({ branchId: ids.br, academicYearId: ids.ay });

  test('enter marks → per-student messages with subject/marks/max; replay converges', async () => {
    const res = await request(app)
      .post(`/admin/result/structure/subjects/${ids.ecs}/marks`)
      .query(scope())
      .set(token())
      .send({ entries: [{ studentId: ids.stA, marksObtained: 25 }, { studentId: ids.stB, isAbsent: true }] });
    expect(res.status).toBe(200);

    // Notify is post-commit fire-and-forget: poll for delivery.
    await waitFor(() => resultCount(ids.stA), 1);
    await waitFor(() => resultCount(ids.stB), 1);
    const aMsgs = await prisma.chatMessage.findMany({
      where: { room: { studentId: ids.stA, kind: 'system_result' as never } },
      orderBy: { createdAt: 'asc' },
    });
    expect(aMsgs).toHaveLength(1);
    expect(aMsgs[0].content).toContain('25');
    expect(aMsgs[0].content).toContain('30');
    expect(aMsgs[0].content).toContain('Mathematics');
    expect(aMsgs[0].content).toContain('Weekly Quiz');

    const bMsgs = await prisma.chatMessage.findMany({
      where: { room: { studentId: ids.stB, kind: 'system_result' as never } },
    });
    expect(bMsgs).toHaveLength(1);
    expect(bMsgs[0].content).toMatch(/absent/i);

    // Replay identical event → no new messages (dedupe).
    const res2 = await request(app)
      .post(`/admin/result/structure/subjects/${ids.ecs}/marks`)
      .query(scope())
      .set(token())
      .send({ entries: [{ studentId: ids.stA, marksObtained: 25 }, { studentId: ids.stB, isAbsent: true }] });
    expect(res2.status).toBe(200);
    expect(await resultCount(ids.stA)).toBe(1);
    expect(await resultCount(ids.stB)).toBe(1);
  });

  test('edit to new marks appends (history preserved, documented semantics)', async () => {
    const res = await request(app)
      .post(`/admin/result/structure/subjects/${ids.ecs}/marks`)
      .query(scope())
      .set(token())
      .send({ entries: [{ studentId: ids.stA, marksObtained: 28 }] });
    expect(res.status).toBe(200);
    await waitFor(() => resultCount(ids.stA), 2);
    const msgs = await prisma.chatMessage.findMany({
      where: { room: { studentId: ids.stA, kind: 'system_result' as never } },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain('25');
    expect(msgs[1].content).toContain('28');
  });

  test('report publish notifies with session/grade/percentage', async () => {
    const card = await prisma.reportCard.create({
      data: {
        id: `${P}_rcA`,
        studentId: ids.stA,
        examSessionId: ids.sess,
        overallPercentage: 84.5,
        overallGrade: 'A',
        status: 'DRAFT',
      },
    });
    const res = await request(app)
      .post(`/admin/result/report-cards/${card.id}/publish`)
      .query(scope())
      .set(token())
      .send({});
    expect(res.status).toBe(200);
    await waitFor(async () =>
      prisma.chatMessage.count({
        where: { room: { studentId: ids.stA, kind: 'system_result' as never }, content: { contains: 'report card' } },
      }), 1);
    const msgs = await prisma.chatMessage.findMany({
      where: { room: { studentId: ids.stA, kind: 'system_result' as never }, content: { contains: 'report card' } },
    });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain('Term 1');
    expect(last.content).toContain('A');
    expect(last.content).toContain('84.5');
  });
});

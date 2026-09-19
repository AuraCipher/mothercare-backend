/**
 * M7 — messaging correctness, recipient integrity & isolation (real PostgreSQL).
 *
 * Covers: parent/student recipient correctness, tenant (branch) isolation,
 * classroom isolation, DM creation policy + races, message dedupe races,
 * outbox duplicate races, waterfall/allocate payment notify gaps, template
 * rendering, history authorization, bulk boundedness.
 *
 * Convention: every recipient assertion compares production-computed IDs
 * against independently-known fixture IDs (never against the function
 * under test). Prefix P isolates all rows for cleanup.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoomMessage, listRoomMessages } = require('../../../src/modules/chat/services/chat-message.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureDirectMessageRoom } = require('../../../src/modules/chat/services/chat-dm.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listRoomsForUser } = require('../../../src/modules/chat/services/chat-access.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureChatRoomAccess } = require('../../../src/modules/chat/services/chat-room-access.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  queueAttendanceStatusNotification,
  notifyPaymentRecorded,
} = require('../../../src/modules/chat/services/system-notification.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  renderSystemNotificationTemplate,
  shouldNotifyStudentAttendance,
} = require('../../../src/modules/chat/templates/system-notification-templates');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');

let prisma: PrismaClient;
const P = uniquePrefix();

const ids = {
  cal: `${P}_cal`,
  branchA: `${P}_branchA`,
  branchB: `${P}_branchB`,
  ayA: `${P}_ayA`,
  ayB: `${P}_ayB`,
  groupA1: `${P}_gA1`,
  groupA2: `${P}_gA2`,
  groupB1: `${P}_gB1`,
  subj: `${P}_subj`,
  adminA: `${P}_u_adminA`,
  teacherA1: `${P}_u_tA1`,
  teacherA2: `${P}_u_tA2`,
  teacherB: `${P}_u_tB`,
  parentA1: `${P}_u_pA1`,
  parentA1m: `${P}_u_pA1m`,
  parentA2: `${P}_u_pA2`,
  parentB: `${P}_u_pB`,
  studentU_A1: `${P}_u_sA1`,
  studentU_A2: `${P}_u_sA2`,
  studentU_B1: `${P}_u_sB1`,
  studentA1: `${P}_stA1`,
  studentA2: `${P}_stA2`,
  studentB1: `${P}_stB1`,
};

async function user(id: string, role: string, name: string) {
  await prisma.user.create({ data: { id, name, passwordHash: 'x', role: role as never } });
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
  for (const [bid, code] of [[ids.branchA, `${P}BRA`], [ids.branchB, `${P}BRB`]] as const) {
    await prisma.branch.create({ data: { id: bid, name: `${bid} name`, code } });
  }
  await prisma.academicYear.create({ data: { id: ids.ayA, branchId: ids.branchA, calendarId: ids.cal } });
  await prisma.academicYear.create({ data: { id: ids.ayB, branchId: ids.branchB, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.groupA1, academicYearId: ids.ayA, name: 'Class 1', section: 'A', displayOrder: 1 } });
  await prisma.group.create({ data: { id: ids.groupA2, academicYearId: ids.ayA, name: 'Class 1', section: 'B', displayOrder: 2 } });
  await prisma.group.create({ data: { id: ids.groupB1, academicYearId: ids.ayB, name: 'Class 1', section: 'A', displayOrder: 1 } });
  await prisma.subject.create({ data: { id: ids.subj, academicYearId: ids.ayA, name: 'Math', code: `${P}MTH` } });

  await user(ids.adminA, 'super_admin', 'M7 Admin A');
  await prisma.branchMember.create({ data: { branchId: ids.branchA, userId: ids.adminA, role: 'branch_admin', isActive: true } });
  await user(ids.teacherA1, 'teacher', 'M7 Teacher A1');
  await user(ids.teacherA2, 'teacher', 'M7 Teacher A2');
  await user(ids.teacherB, 'teacher', 'M7 Teacher B');
  await prisma.branchMember.create({ data: { branchId: ids.branchA, userId: ids.teacherA1, role: 'teacher', isActive: true } });
  await prisma.branchMember.create({ data: { branchId: ids.branchA, userId: ids.teacherA2, role: 'teacher', isActive: true } });
  await prisma.branchMember.create({ data: { branchId: ids.branchB, userId: ids.teacherB, role: 'teacher', isActive: true } });
  await prisma.teacherAssignment.create({ data: { academicYearId: ids.ayA, teacherId: ids.teacherA1, groupId: ids.groupA1, subjectId: ids.subj, isClassTeacher: true } });
  await prisma.teacherAssignment.create({ data: { academicYearId: ids.ayA, teacherId: ids.teacherA2, groupId: ids.groupA2, subjectId: ids.subj, isClassTeacher: true } });

  for (const [uid, nm] of [[ids.parentA1, 'M7 Father A1'], [ids.parentA1m, 'M7 Mother A1'], [ids.parentA2, 'M7 Father A2'], [ids.parentB, 'M7 Father B']] as const) {
    await user(uid, 'parent', nm);
  }
  const profA1 = await prisma.parentProfile.create({ data: { userId: ids.parentA1, relation: 'Father' } });
  const profA1m = await prisma.parentProfile.create({ data: { userId: ids.parentA1m, relation: 'Mother' } });
  const profA2 = await prisma.parentProfile.create({ data: { userId: ids.parentA2, relation: 'Father' } });
  const profB = await prisma.parentProfile.create({ data: { userId: ids.parentB, relation: 'Father' } });

  await user(ids.studentU_A1, 'student', 'M7 Student A1');
  await user(ids.studentU_A2, 'student', 'M7 Student A2');
  await user(ids.studentU_B1, 'student', 'M7 Student B1');
  await prisma.student.create({ data: { id: ids.studentA1, academicYearId: ids.ayA, groupId: ids.groupA1, name: 'M7 Student A1', userId: ids.studentU_A1, status: 'ACTIVE', isActive: true } });
  await prisma.student.create({ data: { id: ids.studentA2, academicYearId: ids.ayA, groupId: ids.groupA1, name: 'M7 Student A2', userId: ids.studentU_A2, status: 'ACTIVE', isActive: true } });
  await prisma.student.create({ data: { id: ids.studentB1, academicYearId: ids.ayB, groupId: ids.groupB1, name: 'M7 Student B1', userId: ids.studentU_B1, status: 'ACTIVE', isActive: true } });
  await prisma.studentParent.create({ data: { studentId: ids.studentA1, parentId: profA1.id, relation: 'Father', isPrimary: true } });
  await prisma.studentParent.create({ data: { studentId: ids.studentA1, parentId: profA1m.id, relation: 'Mother', isPrimary: false } });
  await prisma.studentParent.create({ data: { studentId: ids.studentA2, parentId: profA2.id, relation: 'Father', isPrimary: true } });
  await prisma.studentParent.create({ data: { studentId: ids.studentB1, parentId: profB.id, relation: 'Father', isPrimary: true } });

  // Student DM flags: class-role assignment with DM rights for sU_A1.
  const community = await prisma.chatCommunity.create({ data: { academicYearId: ids.ayA, groupId: ids.groupA1 } });
  const roleDef = await prisma.classRoleDefinition.create({
    data: { communityId: community.id, name: 'Monitor', canPostInGroups: false, canReceiveDms: true, canInitiateDms: true },
  });
  await prisma.classRoleAssignment.create({
    data: { communityId: community.id, roleDefinitionId: roleDef.id, studentId: ids.studentA1, userId: ids.studentU_A1, publicDisplayName: 'Monitor A1' },
  });
  await prisma.classRoleAssignment.create({
    data: { communityId: community.id, roleDefinitionId: roleDef.id, studentId: ids.studentA2, userId: ids.studentU_A2, publicDisplayName: 'Monitor A2' },
  });

  // One UNPAID fee for waterfall/allocate tests.
  await prisma.studentFee.create({
    data: { id: `${P}_fee1`, academicYearId: ids.ayA, studentId: ids.studentA1, month: 9, year: 2026, totalAmount: 100000, netAmount: 100000, status: 'UNPAID' },
  });
}, 120000);

afterAll(async () => {
  // Scoped cleanup (children first).
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: { in: [ids.ayA, ids.ayB] } } } }).catch(() => undefined);
  await prisma.chatDmThread.deleteMany({ where: { academicYearId: { in: [ids.ayA, ids.ayB] } } }).catch(() => undefined);
  await prisma.attendanceNotification.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2, ids.studentB1] } } }).catch(() => undefined);
  await prisma.paymentNotification.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2, ids.studentB1] } } }).catch(() => undefined);
  await prisma.payment.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2] } } }).catch(() => undefined);
  await prisma.attendance.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2] } } }).catch(() => undefined);
  await prisma.studentFee.deleteMany({ where: { id: `${P}_fee1` } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: { in: [ids.ayA, ids.ayB] } } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: { in: [ids.ayA, ids.ayB] } } }).catch(() => undefined);
  await prisma.classRoleAssignment.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2] } } }).catch(() => undefined);
  await prisma.classRoleDefinition.deleteMany({ where: { community: { academicYearId: ids.ayA } } }).catch(() => undefined);
  await prisma.chatCommunity.deleteMany({ where: { academicYearId: ids.ayA } }).catch(() => undefined);
  await prisma.studentParent.deleteMany({ where: { studentId: { in: [ids.studentA1, ids.studentA2, ids.studentB1] } } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.studentA1, ids.studentA2, ids.studentB1] } } }).catch(() => undefined);
  await prisma.parentProfile.deleteMany({ where: { userId: { in: [ids.parentA1, ids.parentA1m, ids.parentA2, ids.parentB] } } }).catch(() => undefined);
  await prisma.teacherAssignment.deleteMany({ where: { academicYearId: ids.ayA } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: { in: [ids.branchA, ids.branchB] } } }).catch(() => undefined);
  await prisma.user.deleteMany({
    where: { id: { in: [ids.adminA, ids.teacherA1, ids.teacherA2, ids.teacherB, ids.parentA1, ids.parentA1m, ids.parentA2, ids.parentB, ids.studentU_A1, ids.studentU_A2, ids.studentU_B1] } },
  }).catch(() => undefined);
  await prisma.subject.deleteMany({ where: { id: ids.subj } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: { in: [ids.groupA1, ids.groupA2, ids.groupB1] } } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: { in: [ids.ayA, ids.ayB] } } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: { in: [ids.branchA, ids.branchB] } } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

async function systemRoom(kind: string, studentId: string, ay: string) {
  return prisma.chatRoom.findFirst({ where: { studentId, kind: kind as never, academicYearId: ay } });
}

async function roomMessages(roomId: string) {
  return prisma.chatMessage.findMany({ where: { roomId, isDeleted: false }, orderBy: { createdAt: 'asc' } });
}

describe('M7 recipient correctness — attendance', () => {
  test('absent notifies the STUDENT login only; both parents excluded from system room', async () => {
    await queueAttendanceStatusNotification({ studentId: ids.studentA1, date: '2026-09-10', status: 'absent', note: 'sick' });
    const room = await systemRoom('system_attendance', ids.studentA1, ids.ayA);
    expect(room).toBeTruthy();
    const msgs = await roomMessages(room!.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderId).toBeNull();
    expect(msgs[0].content).toMatch(/absent/);
    // Recipient set = exactly { student login }.
    const members = await prisma.chatRoomMember.findMany({ where: { roomId: room!.id, leftAt: null } });
    expect(members.map((m) => m.userId).sort()).toEqual([ids.studentU_A1]);
    // Outbox marked sent with linkage.
    const outbox = await prisma.attendanceNotification.findFirst({
      where: { studentId: ids.studentA1, date: new Date('2026-09-10'), status: 'absent' },
    });
    expect(outbox?.sent).toBe(true);
    expect(outbox?.chatMessageId).toBe(msgs[0].id);
  });

  test('present never notifies (service gate + HTTP batch gate)', async () => {
    const r = await queueAttendanceStatusNotification({ studentId: ids.studentA1, date: '2026-09-11', status: 'present' });
    expect(r).toBeNull();
    expect(shouldNotifyStudentAttendance('present')).toBe(false);
    const token = getAuthHeader(generateTestToken(ids.adminA, 'super_admin'));
    const res = await request(app)
      .post('/admin/attendance/batch')
      .query({ branchId: ids.branchA, academicYearId: ids.ayA })
      .set(token)
      .send({ date: '2026-09-11', groupId: ids.groupA1, records: [{ studentId: ids.studentA1, status: 'present' }] });
    expect(res.status).toBe(200);
    const rows = await prisma.attendanceNotification.findMany({ where: { studentId: ids.studentA1, date: new Date('2026-09-11') } });
    expect(rows).toHaveLength(0);
  });

  test('HTTP batch absent notifies exactly the absent student (sibling isolation)', async () => {
    const token = getAuthHeader(generateTestToken(ids.adminA, 'super_admin'));
    const res = await request(app)
      .post('/admin/attendance/batch')
      .query({ branchId: ids.branchA, academicYearId: ids.ayA })
      .set(token)
      .send({ date: '2026-09-12', groupId: ids.groupA1, records: [{ studentId: ids.studentA1, status: 'absent' }] });
    expect(res.status).toBe(200);
    const n = await waitFor(async () =>
      prisma.chatMessage.count({
        where: { room: { studentId: ids.studentA1, kind: 'system_attendance' as never }, content: { contains: 'absent' } },
      }), 1);
    expect(n).toBeGreaterThanOrEqual(1);
    // Student A2 (same class, no event) has no attendance room/message.
    const other = await prisma.chatMessage.count({
      where: { room: { studentId: ids.studentA2, kind: 'system_attendance' as never } },
    });
    expect(other).toBe(0);
  });
});

describe('M7 recipient correctness — payments (waterfall/allocate gap)', () => {
  test('waterfall payment notifies the student feed (one message per created payment)', async () => {
    const token = getAuthHeader(generateTestToken(ids.adminA, 'super_admin'));
    const res = await request(app)
      .post('/admin/payments/waterfall')
      .query({ branchId: ids.branchA })
      .set(token)
      .send({ studentId: ids.studentA1, amount: 60000, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    const payments = await prisma.payment.findMany({ where: { studentId: ids.studentA1, revertedAt: null }, orderBy: { createdAt: 'asc' } });
    expect(payments.length).toBeGreaterThanOrEqual(1);
    for (const p of payments) {
      const n = await waitFor(async () =>
        prisma.chatMessage.count({
          where: { room: { studentId: ids.studentA1, kind: 'system_payment' as never }, content: { contains: p.receiptNumber } },
        }), 1);
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  test('payment replay converges: same paymentId twice → one message', async () => {    const pid = `${P}_pay_replay`;
    await prisma.payment.create({
      data: { id: pid, studentFeeId: `${P}_fee1`, studentId: ids.studentA1, amount: 1000, paymentMethod: 'CASH', receiptNumber: `${P}-RCP-1`, recordedById: ids.adminA },
    });
    const input = { studentId: ids.studentA1, paymentId: pid, amountPaise: 1000, receiptNumber: `${P}-RCP-1`, paymentMethod: 'CASH', month: 9, year: 2026, balanceDuePaise: 99000, feeStatus: 'PARTIAL' };
    await notifyPaymentRecorded(input);
    await notifyPaymentRecorded(input);
    const room = await systemRoom('system_payment', ids.studentA1, ids.ayA);
    const msgs = await prisma.chatMessage.findMany({
      where: { roomId: room!.id, content: { contains: `${P}-RCP-1` } },
    });
    expect(msgs).toHaveLength(1);
  });

  test('revert is never swallowed as a duplicate of the recorded event (separate namespace)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyPaymentReverted } = require('../../../src/modules/chat/services/system-notification.service');
    const pid = `${P}_pay_revert`;
    await prisma.payment.create({
      data: { id: pid, studentFeeId: `${P}_fee1`, studentId: ids.studentA1, amount: 2000, paymentMethod: 'CASH', receiptNumber: `${P}-RCP-2`, recordedById: ids.adminA },
    });
    const base = { studentId: ids.studentA1, paymentId: pid, amountPaise: 2000, receiptNumber: `${P}-RCP-2` };
    await notifyPaymentRecorded({ ...base, paymentMethod: 'CASH', month: 9, year: 2026, balanceDuePaise: 98000, feeStatus: 'PARTIAL' });
    await notifyPaymentReverted({ ...base, balanceDuePaise: 100000 });
    await notifyPaymentReverted({ ...base, balanceDuePaise: 100000 }); // replay converges
    const room = await systemRoom('system_payment', ids.studentA1, ids.ayA);
    const msgs = await prisma.chatMessage.findMany({
      where: { roomId: room!.id, content: { contains: `${P}-RCP-2` } },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);
    const dedupes = msgs.map((m) => (m.metadata as { dedupeId?: string })?.dedupeId).sort();
    expect(dedupes).toEqual([`payment:${pid}`, `payment_reverted:${pid}`]);
  });
});

describe('M7 DMs — policy + uniqueness races', () => {
  test('student may DM own class teacher; not an unrelated teacher', async () => {
    const room = await ensureDirectMessageRoom({ academicYearId: ids.ayA, branchId: ids.branchA, userId: ids.studentU_A1, participantUserId: ids.teacherA1 });
    expect(room.kind).toBe('direct_message');
    await expect(
      ensureDirectMessageRoom({ academicYearId: ids.ayA, branchId: ids.branchA, userId: ids.studentU_A1, participantUserId: ids.teacherA2 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('teacher may DM parent of own student; not of another class', async () => {
    const room = await ensureDirectMessageRoom({ academicYearId: ids.ayA, branchId: ids.branchA, userId: ids.teacherA1, participantUserId: ids.parentA1 });
    expect(room.kind).toBe('direct_message');
    await expect(
      ensureDirectMessageRoom({ academicYearId: ids.ayA, branchId: ids.branchA, userId: ids.teacherA2, participantUserId: ids.parentA1 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('simultaneous initiation from both sides converges to ONE room, no orphans', async () => {
    // Student (allowed initiator: own class teacher) + teacher (allowed:
    // teaches the student's group, student canReceive) race each other.
    const base = { academicYearId: ids.ayA, branchId: ids.branchA };
    const [r1, r2] = await Promise.all([
      ensureDirectMessageRoom({ ...base, userId: ids.studentU_A2, participantUserId: ids.teacherA1 }),
      ensureDirectMessageRoom({ ...base, userId: ids.teacherA1, participantUserId: ids.studentU_A2 }),
    ]);
    expect(r1.id).toBe(r2.id);
    const threads = await prisma.chatDmThread.count({
      where: { academicYearId: ids.ayA, roomId: r1.id },
    });
    expect(threads).toBe(1);
    // No orphaned rooms for this pair.
    const pairRooms = await prisma.chatRoom.findMany({
      where: {
        academicYearId: ids.ayA,
        kind: 'direct_message' as never,
        dmThread: { participantAId: { in: [ids.studentU_A2, ids.teacherA1] }, participantBId: { in: [ids.studentU_A2, ids.teacherA1] } },
      },
      select: { id: true },
    });
    expect(pairRooms.map((r) => r.id)).toEqual([r1.id]);
  });
});

describe('M7 isolation — branch + classroom', () => {
  test('cross-branch teacher cannot access branch-A rooms; no membership is healed in', async () => {
    const schoolRoom = await prisma.chatRoom.findFirst({
      where: { branchId: ids.branchA, kind: 'school_announcement' as never, academicYearId: ids.ayA },
    });
    expect(schoolRoom).toBeTruthy();
    await expect(ensureChatRoomAccess(schoolRoom!.id, ids.teacherB)).rejects.toMatchObject({ status: 403 });
    const leaked = await prisma.chatRoomMember.findFirst({ where: { roomId: schoolRoom!.id, userId: ids.teacherB, leftAt: null } });
    expect(leaked).toBeNull();
    const sysRoom = await systemRoom('system_attendance', ids.studentA1, ids.ayA);
    await expect(ensureChatRoomAccess(sysRoom!.id, ids.teacherB)).rejects.toMatchObject({ status: 403 });
    const rooms = await listRoomsForUser(ids.teacherB, ids.ayA);
    expect(rooms.map((r: { id: string }) => r.id)).not.toContain(schoolRoom!.id);
  });

  test('parent of another class cannot read the room; history requires membership', async () => {
    const room = await systemRoom('system_attendance', ids.studentA1, ids.ayA);
    await expect(listRoomMessages(room!.id, ids.parentA2, {})).rejects.toMatchObject({ status: 403 });
    await expect(listRoomMessages(room!.id, ids.parentB, {})).rejects.toMatchObject({ status: 403 });
  });

  test('classroom isolation: groupA2 teacher has no access to groupA1 class room', async () => {
    const classRoom = await prisma.chatRoom.findFirst({
      where: { classGroupId: ids.groupA1, kind: 'class_announcement' as never, academicYearId: ids.ayA },
    });
    expect(classRoom).toBeTruthy();
    await expect(ensureChatRoomAccess(classRoom!.id, ids.teacherA2)).rejects.toMatchObject({ status: 403 });
    const leaked = await prisma.chatRoomMember.findFirst({ where: { roomId: classRoom!.id, userId: ids.teacherA2, leftAt: null } });
    expect(leaked).toBeNull();
    // Own class teacher keeps moderator access.
    await ensureChatRoomAccess(classRoom!.id, ids.teacherA1);
    const mod = await prisma.chatRoomMember.findFirst({ where: { roomId: classRoom!.id, userId: ids.teacherA1, leftAt: null } });
    expect(mod?.canPost).toBe(true);
  });
});

describe('M7 posting permissions', () => {
  test('parent post rejected; student post rejected; class teacher post accepted', async () => {
    const classRoom = await prisma.chatRoom.findFirst({
      where: { classGroupId: ids.groupA1, kind: 'class_announcement' as never, academicYearId: ids.ayA },
    });
    const good = await createRoomMessage({ roomId: classRoom!.id, senderId: ids.teacherA1, type: 'text', content: 'M7 class notice' });
    expect(good.message.content).toBe('M7 class notice');
    await expect(createRoomMessage({ roomId: classRoom!.id, senderId: ids.parentA1, type: 'text', content: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(createRoomMessage({ roomId: classRoom!.id, senderId: ids.studentU_A1, type: 'text', content: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  test('send dedupe: same clientMessageId twice → duplicate:true, one row', async () => {
    const classRoom = await prisma.chatRoom.findFirst({
      where: { classGroupId: ids.groupA1, kind: 'class_announcement' as never, academicYearId: ids.ayA },
    });
    const key = `m7key-${P}-001`;
    const first = await createRoomMessage({ roomId: classRoom!.id, senderId: ids.teacherA1, type: 'text', content: 'dedupe probe', clientMessageId: key });
    const second = await createRoomMessage({ roomId: classRoom!.id, senderId: ids.teacherA1, type: 'text', content: 'dedupe probe', clientMessageId: key });
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    const rows = await prisma.chatMessage.count({ where: { roomId: classRoom!.id, dedupeKey: key } });
    expect(rows).toBe(1);
  });
});

describe('M7 outbox race — concurrent identical events converge', () => {
  test('10 concurrent identical attendance events → exactly 1 message', async () => {
    const date = '2026-09-13';
    await Promise.all(
      Array.from({ length: 10 }, () => queueAttendanceStatusNotification({ studentId: ids.studentA2, date, status: 'late' })),
    );
    const room = await systemRoom('system_attendance', ids.studentA2, ids.ayA);
    const msgs = await roomMessages(room!.id);
    expect(msgs).toHaveLength(1);
  }, 30000);
});

describe('M7 deactivation — suspended users lose chat access', () => {
  test('suspended teacher cannot read or post, even with prior membership', async () => {
    const classRoom = await prisma.chatRoom.findFirst({
      where: { classGroupId: ids.groupA1, kind: 'class_announcement' as never, academicYearId: ids.ayA },
    });
    await prisma.user.update({ where: { id: ids.teacherA1 }, data: { status: 'suspended' } });
    try {
      await expect(listRoomMessages(classRoom!.id, ids.teacherA1, {})).rejects.toMatchObject({ status: 403 });
      await expect(
        createRoomMessage({ roomId: classRoom!.id, senderId: ids.teacherA1, type: 'text', content: 'suspended post' }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.user.update({ where: { id: ids.teacherA1 }, data: { status: 'active' } });
    }
  });
});

describe('M7 academic-year transition — old rooms keep history, new AY bootstraps separately', () => {
  test('new AY creates distinct singletons; old room history remains readable', async () => {
    const ayA2 = `${P}_ayA2`;
    const cal2 = `${P}_cal2`;
    await prisma.academicCalendar.create({ data: { id: cal2, label: `${P}-cal2`, startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
    await prisma.academicYear.create({ data: { id: ayA2, branchId: ids.branchA, calendarId: cal2 } });
    try {
      const oldRoom = await systemRoom('system_attendance', ids.studentA1, ids.ayA);
      expect(oldRoom).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ensureStudentChatBootstrap } = require('../../../src/modules/chat/services/chat-community.bootstrap');
      await ensureStudentChatBootstrap({
        userId: ids.studentU_A1, studentId: ids.studentA1, groupId: ids.groupA1,
        groupLabel: 'Class 1 · A', academicYearId: ayA2, branchId: ids.branchA, studentName: 'M7 Student A1',
      });
      const newRoom = await prisma.chatRoom.findFirst({
        where: { studentId: ids.studentA1, kind: 'system_attendance' as never, academicYearId: ayA2 },
      });
      expect(newRoom).toBeTruthy();
      expect(newRoom!.id).not.toBe(oldRoom!.id);
      // Old-class history preserved and still readable by the student.
      const hist = await listRoomMessages(oldRoom!.id, ids.studentU_A1, { limit: 5 });
      expect(hist.length).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ayA2 } } }).catch(() => undefined);
      await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ayA2 } } }).catch(() => undefined);
      await prisma.chatRoom.deleteMany({ where: { academicYearId: ayA2 } }).catch(() => undefined);
      await prisma.chatCommunity.deleteMany({ where: { academicYearId: ayA2 } }).catch(() => undefined);
      await prisma.academicYear.deleteMany({ where: { id: ayA2 } }).catch(() => undefined);
      await prisma.academicCalendar.deleteMany({ where: { id: cal2 } }).catch(() => undefined);
    }
  });
});

describe('M7 templates', () => {
  test('unicode + apostrophes render; missing vars become empty, never leak', async () => {
    const { renderSystemNotificationTemplate: render } = { renderSystemNotificationTemplate };
    const out = render('attendance.absent', { date: 'Mon Ahmed’s day — احمد', status: 'absent', noteSuffix: '' });
    expect(out.body).toContain('Ahmed’s day — احمد');
    const missing = render('payment.received', { amount: 'Rs 1,000', monthLabel: 'Sep 2026', receiptNumber: 'R1', balanceDue: 'Rs 0', methodSuffix: '' });
    expect(missing.body).not.toContain('{');
    expect(missing.body).not.toContain('undefined');
  });
});

describe('M7 bulk — bounded recipient expansion', () => {
  test('50 attendance notifies: 50 messages, bounded wall-clock, no cross-talk', async () => {
    const t0 = Date.now();
    // Unique (student, date, status) per notify — each is a distinct logical event.
    for (let i = 0; i < 50; i++) {
      const d = new Date(2026, 7, 1 + i); // Aug 1 + i days, all within AY + past
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const st = i % 2 === 0 ? ids.studentA1 : ids.studentA2;
      await queueAttendanceStatusNotification({ studentId: st, date: day, status: i % 3 === 0 ? 'late' : 'leave' });
    }
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(120000);
    const a1 = await prisma.chatMessage.count({ where: { room: { studentId: ids.studentA1, kind: 'system_attendance' as never } } });
    const a2 = await prisma.chatMessage.count({ where: { room: { studentId: ids.studentA2, kind: 'system_attendance' as never } } });
    expect(a1 + a2).toBeGreaterThanOrEqual(50);
    // Branch-B student untouched.
    const b = await prisma.chatMessage.count({ where: { room: { studentId: ids.studentB1, kind: 'system_attendance' as never } } });
    expect(b).toBe(0);
  }, 180000);
});

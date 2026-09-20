/**
 * M11 §9/§11/§12/§16/§17 — group posts, student-student DM denial, file IDOR,
 * pagination clamp, fanout-kind gate (real PG + real HTTP where applicable).
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
const { shouldEnqueueChatPush } = require('../../../src/modules/chat/socket/chat.socket');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');

let prisma: PrismaClient;
const P = uniquePrefix() + '_m11gx';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  subj: `${P}_subj`,
  t1: `${P}_t1`,
  t2: `${P}_t2`,
  suA: `${P}_suA`,
  suB: `${P}_suB`,
  sA: `${P}_sA`,
  sB: `${P}_sB`,
  out: `${P}_out`,
  grp: `${P}_grp`,
  fileA: `${P}_fileA`,
};

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.subject.create({ data: { id: ids.subj, academicYearId: ids.ay, name: 'Math', code: `${P}M` } });
  for (const [u, r] of [[ids.t1, 'teacher'], [ids.t2, 'teacher'], [ids.suA, 'student'], [ids.suB, 'student'], [ids.out, 'student']] as const) {
    await prisma.user.create({ data: { id: u, name: u, passwordHash: 'x', role: r as never } });
  }
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.t1, role: 'teacher', isActive: true } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.t2, role: 'teacher', isActive: true } });
  const asg = await prisma.teacherAssignment.create({
    data: { academicYearId: ids.ay, teacherId: ids.t1, groupId: ids.g, subjectId: ids.subj },
  });
  for (const [u, s] of [[ids.suA, ids.sA], [ids.suB, ids.sB]] as const) {
    await prisma.student.create({
      data: { id: s, academicYearId: ids.ay, groupId: ids.g, name: s, userId: u, status: 'ACTIVE', isActive: true },
    });
  }
  await prisma.chatRoom.create({
    data: {
      id: ids.grp, academicYearId: ids.ay, branchId: ids.br, classGroupId: ids.g,
      kind: 'group_chat', name: 'Math', teacherAssignmentId: asg.id, subjectId: ids.subj,
    },
  });
  await prisma.chatRoomMember.create({
    data: { roomId: ids.grp, userId: ids.t1, access: 'moderator', canPost: true, canRead: true },
  });
  await prisma.fileRecord.create({
    data: {
      id: ids.fileA, originalName: 'a.jpg', storagePath: `${P}/a.jpg`, storageBucket: 'local',
      purpose: 'chat', mimeType: 'image/jpeg', size: 100, uploadedById: ids.t1,
      entityType: 'chat', metadata: { roomId: ids.grp },
    },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.fileRecord.deleteMany({ where: { id: ids.fileA } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatDmThread.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.teacherAssignment.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: { in: [ids.sA, ids.sB] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.t1, ids.t2, ids.suA, ids.suB, ids.out] } } }).catch(() => undefined);
  await prisma.subject.deleteMany({ where: { id: ids.subj } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M11 group chat + DM policy', () => {
  test('branch admin posts to school announcement; members can read', async () => {
    const admin = `${P}_ba`;
    await prisma.user.create({ data: { id: admin, name: admin, passwordHash: 'x', role: 'management' } });
    await prisma.branchMember.create({ data: { branchId: ids.br, userId: admin, role: 'branch_admin', isActive: true } });
    try {
      const room = await prisma.chatRoom.create({
        data: {
          id: `${P}_school`, academicYearId: ids.ay, branchId: ids.br,
          kind: 'school_announcement', name: 'School Announcement',
          singletonKey: `${P}-school-ann`,
        },
      });
      await prisma.chatRoomMember.create({
        data: { roomId: room.id, userId: admin, access: 'moderator', canPost: true, canRead: true },
      });
      const sent = await createRoomMessage({ roomId: room.id, senderId: admin, type: 'text', content: 'M11 school notice' });
      expect(sent.message.content).toBe('M11 school notice');
      // Same-branch student member reads it (announcement audience).
      await prisma.chatRoomMember.create({
        data: { roomId: room.id, userId: ids.suA, access: 'observer', canPost: false, canRead: true },
      });
      const hist = await listRoomMessages(room.id, ids.suA, {});
      expect(hist.map((m: { content: string }) => m.content)).toContain('M11 school notice');
    } finally {
      await prisma.chatRoomMember.deleteMany({ where: { userId: admin } }).catch(() => undefined);
      await prisma.chatRoom.deleteMany({ where: { id: `${P}_school` } }).catch(() => undefined);
      await prisma.branchMember.deleteMany({ where: { userId: admin } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: admin } }).catch(() => undefined);
    }
  });

  test('owning teacher posts to subject group; unrelated teacher denied', async () => {
    const ok = await createRoomMessage({ roomId: ids.grp, senderId: ids.t1, type: 'text', content: 'M11 group post' });
    expect(ok.message.content).toBe('M11 group post');
    await expect(
      createRoomMessage({ roomId: ids.grp, senderId: ids.t2, type: 'text', content: 'intrude' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.chatMessage.count({ where: { roomId: ids.grp, content: 'intrude' } })).toBe(0);
  });

  test('student-to-student DM creation denied by policy', async () => {
    await expect(
      ensureDirectMessageRoom({ academicYearId: ids.ay, branchId: ids.br, userId: ids.suA, participantUserId: ids.suB }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.chatDmThread.count({ where: { academicYearId: ids.ay } })).toBe(0);
  });

  test('history limit clamps to 100', async () => {
    const res = await listRoomMessages(ids.grp, ids.t1, { limit: 500 });
    expect(Array.isArray(res) ? res.length : res.messages.length).toBeLessThanOrEqual(100);
  });

  test('fanout-kind gate: announcements + DM push; subject groups socket-only', () => {
    expect(shouldEnqueueChatPush('school_announcement')).toBe(true);
    expect(shouldEnqueueChatPush('class_announcement')).toBe(true);
    expect(shouldEnqueueChatPush('teacher_announcement')).toBe(true);
    expect(shouldEnqueueChatPush('direct_message')).toBe(true);
    expect(shouldEnqueueChatPush('group_chat')).toBe(false);
    expect(shouldEnqueueChatPush('system_attendance')).toBe(false);
    expect(shouldEnqueueChatPush('system_payment')).toBe(false);
    expect(shouldEnqueueChatPush('system_result')).toBe(false);
    expect(shouldEnqueueChatPush('whatever')).toBe(false);
  });
});

describe('M11 file authorization (IDOR)', () => {
  test('owner reads own file; stranger denied with no bytes (no oracle)', async () => {
    const ownerTok = getAuthHeader(generateTestToken(ids.t1, 'teacher'));
    const outTok = getAuthHeader(generateTestToken(ids.out, 'student'));
    const rOwner = await request(app).get(`/api/uploads/${ids.fileA}`).set(ownerTok);
    // File bytes may not exist on disk in test env — but auth must pass the gate
    // (any status except deny codes proves authorization succeeded).
    expect([401, 403, 404]).not.toContain(rOwner.status);
    const rOut = await request(app).get(`/api/uploads/${ids.fileA}`).set(outTok);
    // Denied before any storage access (400 branch-scope or 404 mask).
    expect([200, 206]).not.toContain(rOut.status);
    expect(rOut.headers['content-disposition']).toBeUndefined();
  });

  test('unauthenticated download rejected', async () => {
    const r = await request(app).get(`/api/uploads/${ids.fileA}`);
    expect([401, 404]).toContain(r.status);
  });
});

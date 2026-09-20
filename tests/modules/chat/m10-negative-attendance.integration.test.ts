/**
 * M10 §7/§8 — teacher attendance rules + removed-member denial (real PG).
 * absent/late/leave notify; present never does; a removed member (leftAt)
 * loses access even with a prior row.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyTeacherAttendanceStatus } = require('../../../src/modules/chat/services/system-notification.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listRoomMessages } = require('../../../src/modules/chat/services/chat-message.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureDirectMessageRoom } = require('../../../src/modules/chat/services/chat-dm.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');

let prisma: PrismaClient;
const P = uniquePrefix() + '_m10na';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  subj: `${P}_subj`,
  t: `${P}_t`,
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
  await prisma.user.create({ data: { id: ids.t, name: 'T', passwordHash: 'x', role: 'teacher' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.t, role: 'teacher', isActive: true } });
  await prisma.teacherAssignment.create({
    data: { academicYearId: ids.ay, teacherId: ids.t, groupId: ids.g, subjectId: ids.subj },
  });
  await prisma.user.create({ data: { id: `${P}_admin`, name: 'A', passwordHash: 'x', role: 'super_admin' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: `${P}_admin`, role: 'branch_admin', isActive: true } });
  // Student with NO login (no userId): notify path cannot bootstrap, but the
  // attendance write itself must still succeed (failure isolation).
  await prisma.student.create({
    data: { id: `${P}_s`, academicYearId: ids.ay, groupId: ids.g, name: 'NoLogin', status: 'ACTIVE', isActive: true },
  });
}, 120000);

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.teacherAssignment.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.attendance.deleteMany({ where: { studentId: `${P}_s` } }).catch(() => undefined);
  await prisma.attendanceNotification.deleteMany({ where: { studentId: `${P}_s` } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: `${P}_s` } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.t, `${P}_admin`] } } }).catch(() => undefined);
  await prisma.subject.deleteMany({ where: { id: ids.subj } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

async function teacherRoom() {
  return prisma.chatRoom.findFirst({
    where: { academicYearId: ids.ay, kind: 'system_teacher_attendance' as never },
  });
}

describe('M10 teacher attendance rules + removed member', () => {
  test('absent/late/leave notify; present never does', async () => {
    const base = { teacherUserId: ids.t, academicYearId: ids.ay, branchId: ids.br, date: '2026-09-10' };
    await notifyTeacherAttendanceStatus({ ...base, status: 'absent' });
    await notifyTeacherAttendanceStatus({ ...base, date: '2026-09-11', status: 'late' });
    await notifyTeacherAttendanceStatus({ ...base, date: '2026-09-12', status: 'leave' });
    await notifyTeacherAttendanceStatus({ ...base, date: '2026-09-13', status: 'present' });
    const room = await teacherRoom();
    expect(room).toBeTruthy();
    const msgs = await prisma.chatMessage.findMany({ where: { roomId: room!.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.content)).toEqual([
      expect.stringMatching(/absent/i),
      expect.stringMatching(/late/i),
      expect.stringMatching(/leave/i),
    ]);
  });

  test('removed room member (leftAt set) is denied history', async () => {
    const room = await prisma.chatRoom.create({
      data: { id: `${P}_dm`, academicYearId: ids.ay, branchId: ids.br, kind: 'direct_message', name: 'DM' },
    });
    await prisma.chatRoomMember.create({
      data: { roomId: room.id, userId: ids.t, access: 'member', canPost: true, canRead: true, leftAt: new Date() },
    });
    await expect(listRoomMessages(room.id, ids.t, {})).rejects.toMatchObject({ status: 403 });
    await prisma.chatRoomMember.deleteMany({ where: { roomId: room.id } });
    await prisma.chatRoom.deleteMany({ where: { id: room.id } });
  });

  test('DM helper rejects unknown room access path (sanity: no bypass)', async () => {
    // ensureDirectMessageRoom with identical ids is rejected before any write.
    await expect(
      ensureDirectMessageRoom({ academicYearId: ids.ay, branchId: ids.br, userId: ids.t, participantUserId: ids.t }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('attendance write survives notify-path failure (no-login student)', async () => {
    const token = getAuthHeader(generateTestToken(`${P}_admin`, 'super_admin'));
    const res = await request(app)
      .post('/admin/attendance/batch')
      .query({ branchId: ids.br, academicYearId: ids.ay })
      .set(token)
      .send({ date: '2026-09-14', groupId: ids.g, records: [{ studentId: `${P}_s`, status: 'absent' }] });
    expect(res.status).toBe(200);
    // Business write committed even though no feed could be built.
    const row = await prisma.attendance.findFirst({ where: { studentId: `${P}_s` } });
    expect(row?.status).toBe('absent');
    expect(await prisma.attendanceNotification.count({ where: { studentId: `${P}_s` } })).toBe(0);
  });
});

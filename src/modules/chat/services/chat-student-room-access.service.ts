import { prisma } from '../../../lib/prisma';
import { ensureStudentChatBootstrap } from './chat-community.bootstrap';

/** Ensure per-student system rooms (attendance/payment) exist and the student is a member. */
export async function ensureStudentSystemRoomAccess(roomId: string, userId: string) {
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      kind: true,
      studentId: true,
      academicYearId: true,
      branchId: true,
    },
  });
  if (!room) return;
  if (room.kind !== 'system_attendance' && room.kind !== 'system_payment') return;
  if (!room.studentId || !room.branchId) {
    throw { status: 403, message: 'Not a member of this room' };
  }

  const student = await prisma.student.findFirst({
    where: {
      id: room.studentId,
      userId,
      academicYearId: room.academicYearId,
    },
    select: {
      id: true,
      name: true,
      groupId: true,
      group: { select: { id: true, name: true, section: true } },
    },
  });
  if (!student?.groupId) {
    throw { status: 403, message: 'Not a member of this room' };
  }

  const groupLabel = student.group
    ? `${student.group.name}${student.group.section ? ` · ${student.group.section}` : ''}`
    : 'Class';

  await ensureStudentChatBootstrap({
    userId,
    studentId: student.id,
    groupId: student.groupId,
    groupLabel,
    academicYearId: room.academicYearId,
    branchId: room.branchId,
    studentName: student.name,
  });
}

import type { ChatRoomKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';
import { ensureStudentChatBootstrap } from './chat-community.bootstrap';
import { ensureStudentSystemRoomAccess } from './chat-student-room-access.service';
import {
  syncSchoolAnnouncementMembers,
  syncTeacherAnnouncementMembers,
} from './chat-branch-settings.service';
import { isBranchChatAdmin } from './chat-permissions.service';

type RoomAccessContext = {
  id: string;
  kind: ChatRoomKind;
  branchId: string | null;
  academicYearId: string;
  classGroupId: string | null;
  studentId: string | null;
  teacherAssignmentId: string | null;
  isActive: boolean;
};

async function hasActiveMembership(roomId: string, userId: string): Promise<boolean> {
  const member = await prisma.chatRoomMember.findFirst({
    where: { roomId, userId, leftAt: null, canRead: true },
    include: { room: { select: { isActive: true } } },
  });
  return !!member?.room.isActive;
}

async function loadRoom(roomId: string): Promise<RoomAccessContext | null> {
  return prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      kind: true,
      branchId: true,
      academicYearId: true,
      classGroupId: true,
      studentId: true,
      teacherAssignmentId: true,
      isActive: true,
    },
  });
}

async function ensureStaffRoomAccess(userId: string, room: RoomAccessContext) {
  if (!room.branchId) return;

  if (room.kind === 'school_announcement') {
    await syncSchoolAnnouncementMembers(room.branchId, room.academicYearId);
    await ensureRoomMembership(room.id, userId, { access: 'moderator', canPost: true });
    return;
  }

  if (room.kind === 'teacher_announcement') {
    await syncTeacherAnnouncementMembers(room.branchId, room.academicYearId);
    await ensureRoomMembership(room.id, userId, { access: 'moderator', canPost: true });
    return;
  }

  if (room.kind === 'class_announcement' || room.kind === 'group_chat') {
    await ensureRoomMembership(room.id, userId, { access: 'moderator', canPost: true });
    return;
  }

  if (room.kind === 'direct_message') {
    await ensureRoomMembership(room.id, userId, { access: 'member', canPost: true });
  }
}

async function teacherTiedToBranch(userId: string, branchId: string, academicYearId: string): Promise<boolean> {
  const [member, assignment] = await Promise.all([
    prisma.branchMember.findFirst({
      where: { branchId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.teacherAssignment.findFirst({
      where: { teacherId: userId, academicYearId },
      select: { id: true },
    }),
  ]);
  return !!member || !!assignment;
}

async function ensureTeacherRoomAccess(userId: string, room: RoomAccessContext) {
  if (!room.branchId) return;

  // M7: heal only touches rooms the teacher is legitimately tied to. Any
  // active teacher login could previously read ANY branch's school/class
  // announcement rooms (and any teacher's system rooms) by presenting a
  // roomId — cross-branch/cross-class read leak. Ties are branch membership
  // or a teaching assignment; class rooms additionally require an assignment
  // in that exact group; teacher system rooms require owner identity.
  if (room.kind === 'school_announcement') {
    if (!(await teacherTiedToBranch(userId, room.branchId, room.academicYearId))) return;
    await syncSchoolAnnouncementMembers(room.branchId, room.academicYearId);
    await ensureRoomMembership(room.id, userId, { access: 'observer', canPost: false });
    return;
  }

  if (room.kind === 'teacher_announcement') {
    if (!(await teacherTiedToBranch(userId, room.branchId, room.academicYearId))) return;
    await syncTeacherAnnouncementMembers(room.branchId, room.academicYearId);
    return;
  }

  if (room.kind === 'class_announcement' && room.classGroupId) {
    const assignment = await prisma.teacherAssignment.findFirst({
      where: {
        groupId: room.classGroupId,
        academicYearId: room.academicYearId,
        teacherId: userId,
      },
      select: { id: true, isClassTeacher: true },
    });
    if (!assignment) return;
    await ensureRoomMembership(room.id, userId, {
      access: assignment.isClassTeacher ? 'moderator' : 'observer',
      canPost: assignment.isClassTeacher,
    });
    return;
  }

  if (room.kind === 'group_chat' && room.teacherAssignmentId) {
    const assignment = await prisma.teacherAssignment.findUnique({
      where: { id: room.teacherAssignmentId },
      select: { teacherId: true },
    });
    if (assignment?.teacherId === userId) {
      await ensureRoomMembership(room.id, userId, {
        access: 'moderator',
        canPost: true,
        displayTitle: 'Teacher',
      });
    }
    return;
  }

  if (room.kind === 'system_teacher_attendance' || room.kind === 'system_teacher_payroll') {
    // Singleton key: ay:{ay}:teacher_user:{uid}:{attendance|payroll} — owner only.
    const full = await prisma.chatRoom.findUnique({
      where: { id: room.id },
      select: { singletonKey: true },
    });
    const owner = full?.singletonKey?.match(/:teacher_user:([^:]+):/)?.[1];
    if (owner && owner === userId) {
      await ensureRoomMembership(room.id, userId, { access: 'observer', canPost: false });
    }
  }
}

async function ensureStudentPortalRoomAccess(userId: string, room: RoomAccessContext) {
  if (!room.branchId) return;

  const student = await prisma.student.findFirst({
    where: { userId, academicYearId: room.academicYearId },
    select: {
      id: true,
      name: true,
      groupId: true,
      group: { select: { id: true, name: true, section: true } },
    },
  });
  if (!student?.groupId) return;

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

/**
 * Heal chat room membership before strict access checks.
 * Landing bootstrap may not have run (cache, push deep-link, new rooms), so room
 * open paths must lazily add legitimate memberships.
 */
export async function ensureChatRoomAccess(roomId: string, userId: string) {
  await ensureStudentSystemRoomAccess(roomId, userId);
  if (await hasActiveMembership(roomId, userId)) return;

  const room = await loadRoom(roomId);
  if (!room?.isActive) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'active') return;

  if (room.branchId && (await isBranchChatAdmin(userId, room.branchId))) {
    await ensureStaffRoomAccess(userId, room);
  } else if (user.role === 'teacher') {
    await ensureTeacherRoomAccess(userId, room);
  } else if (user.role === 'student' || user.role === 'parent') {
    await ensureStudentPortalRoomAccess(userId, room);
  }

  // M7: heal paths above only ADD legitimate memberships — they never grant.
  // Deny here so unauthorized callers (cross-branch/cross-class teachers,
  // strangers presenting a roomId) get a deterministic 403 instead of
  // falling through to callers that don't re-assert.
  if (!(await hasActiveMembership(roomId, userId))) {
    throw { status: 403, message: 'Access denied' };
  }
}

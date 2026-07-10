import { prisma } from '../../../lib/prisma';
import type { ChatRoom, ChatRoomMember, ChatRoomKind } from '@prisma/client';
import { teacherAppChatAllowsPost } from './teacher-app-chat-permissions.service';
import { canUserSendInDirectMessage } from './chat-dm-policy.service';

const BRANCH_CHAT_ADMIN_ROLES = new Set(['branch_admin', 'sub_admin']);
const STAFF_ROLES = new Set(['teacher', 'management', 'branch_admin', 'sub_admin', 'super_admin', 'staff']);

export async function getOrCreateBranchChatSettings(branchId: string) {
  return prisma.branchChatSettings.upsert({
    where: { branchId },
    create: { branchId },
    update: {},
  });
}

/** Branch admin / sub_admin membership, or super_admin with active branch membership. */
export async function isBranchChatAdmin(userId: string, branchId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'active') return false;
  if (user.role === 'super_admin') {
    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      select: { isActive: true },
    });
    return !!membership?.isActive;
  }

  const membership = await prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId, userId } },
    select: { role: true, isActive: true },
  });
  return !!membership?.isActive && BRANCH_CHAT_ADMIN_ROLES.has(membership.role);
}

async function canPostSchoolAnnouncement(
  userId: string,
  branchId: string,
  settings: { schoolAnnouncementPosterUserIds: string[] },
): Promise<boolean> {
  if (await isBranchChatAdmin(userId, branchId)) return true;
  return settings.schoolAnnouncementPosterUserIds.includes(userId);
}

async function canPostTeacherAnnouncement(
  userId: string,
  branchId: string,
  settings: {
    teacherAnnouncementPosterUserIds: string[];
    allowAllTeachersTeacherAnnouncement: boolean;
  },
): Promise<boolean> {
  if (await isBranchChatAdmin(userId, branchId)) return true;
  if (settings.allowAllTeachersTeacherAnnouncement) {
    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      select: { role: true, isActive: true },
    });
    if (membership?.isActive && membership.role === 'teacher') return true;
  }
  return settings.teacherAnnouncementPosterUserIds.includes(userId);
}

async function canPostClassAnnouncement(
  userId: string,
  room: Pick<ChatRoom, 'id' | 'branchId' | 'classGroupId' | 'academicYearId'>,
): Promise<boolean> {
  if (room.branchId && (await isBranchChatAdmin(userId, room.branchId))) return true;
  if (!room.classGroupId) return false;
  const classTeacher = await prisma.teacherAssignment.findFirst({
    where: {
      groupId: room.classGroupId,
      academicYearId: room.academicYearId,
      teacherId: userId,
      isClassTeacher: true,
    },
    select: { id: true },
  });
  return !!classTeacher;
}

async function canPostGroupChat(
  userId: string,
  room: Pick<ChatRoom, 'id' | 'branchId' | 'academicYearId'>,
): Promise<boolean> {
  if (room.branchId && (await isBranchChatAdmin(userId, room.branchId))) return true;
  const full = await prisma.chatRoom.findUnique({
    where: { id: room.id },
    select: { teacherAssignmentId: true, communityId: true },
  });
  if (full?.teacherAssignmentId) {
    const assignment = await prisma.teacherAssignment.findUnique({
      where: { id: full.teacherAssignmentId },
      select: { teacherId: true },
    });
    if (assignment?.teacherId === userId) return true;
  }
  if (full?.communityId) {
    const rolePost = await prisma.classRoleAssignment.findFirst({
      where: {
        communityId: full.communityId,
        removedAt: null,
        isMessagingRestricted: false,
        userId,
        roleDefinition: { isActive: true, canPostInGroups: true },
      },
      select: { id: true },
    });
    if (rolePost) return true;
  }
  return false;
}

async function applyTeacherAppPostGate(
  userId: string,
  branchId: string | null | undefined,
  roomKind: ChatRoomKind,
  roomAllowed: boolean,
): Promise<boolean> {
  if (!roomAllowed) return false;
  return teacherAppChatAllowsPost(userId, branchId, roomKind);
}

/** Central posting decision per room kind. */
export async function resolveCanPost(
  userId: string,
  room: Pick<ChatRoom, 'id' | 'kind' | 'branchId' | 'classGroupId' | 'academicYearId' | 'onlyStaffCanPost'>,
  member: Pick<ChatRoomMember, 'canPost' | 'access' | 'isMuted' | 'isPostingRestricted' | 'canRead'>,
): Promise<boolean> {
  if (!member.canRead || member.isMuted || member.isPostingRestricted) return false;

  if (room.kind === 'school_announcement') {
    if (!room.branchId) return false;
    const settings = await getOrCreateBranchChatSettings(room.branchId);
    const roomAllowed = await canPostSchoolAnnouncement(userId, room.branchId, settings);
    return applyTeacherAppPostGate(userId, room.branchId, room.kind, roomAllowed);
  }

  if (room.kind === 'teacher_announcement') {
    if (!room.branchId) return false;
    const settings = await getOrCreateBranchChatSettings(room.branchId);
    const roomAllowed = await canPostTeacherAnnouncement(userId, room.branchId, settings);
    return applyTeacherAppPostGate(userId, room.branchId, room.kind, roomAllowed);
  }

  if (room.kind === 'class_announcement') {
    const roomAllowed = await canPostClassAnnouncement(userId, room);
    return applyTeacherAppPostGate(userId, room.branchId, room.kind, roomAllowed);
  }

  if (room.kind === 'group_chat') {
    const roomAllowed = await canPostGroupChat(userId, room);
    return applyTeacherAppPostGate(userId, room.branchId, room.kind, roomAllowed);
  }

  if (room.kind === 'direct_message') {
    const roomAllowed = await canUserSendInDirectMessage(
      userId,
      room.branchId,
      room.academicYearId,
    );
    if (!roomAllowed) return false;
    return applyTeacherAppPostGate(userId, room.branchId, room.kind, true);
  }

  if (!member.canPost && member.access === 'observer') return false;
  if (room.onlyStaffCanPost) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !STAFF_ROLES.has(user.role)) return false;
  }
  return member.canPost;
}

export async function resolveCanPostByRoomId(userId: string, roomId: string): Promise<boolean> {
  const member = await prisma.chatRoomMember.findFirst({
    where: { roomId, userId, leftAt: null, canRead: true },
    include: { room: true },
  });
  if (!member || !member.room.isActive) return false;
  return resolveCanPost(userId, member.room, member);
}

export function isSchoolAnnouncementKind(kind: ChatRoomKind): boolean {
  return kind === 'school_announcement';
}

import { prisma } from '../../../lib/prisma';
import type { ChatRoom, ChatRoomMember, ChatRoomKind } from '@prisma/client';

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

/** Central posting decision — Phase 1 implements school_announcement; other kinds use member flags. */
export async function resolveCanPost(
  userId: string,
  room: Pick<ChatRoom, 'id' | 'kind' | 'branchId' | 'onlyStaffCanPost'>,
  member: Pick<ChatRoomMember, 'canPost' | 'access' | 'isMuted' | 'isPostingRestricted' | 'canRead'>,
): Promise<boolean> {
  if (!member.canRead || member.isMuted || member.isPostingRestricted) return false;

  if (room.kind === 'school_announcement') {
    if (!room.branchId) return false;
    const settings = await getOrCreateBranchChatSettings(room.branchId);
    return canPostSchoolAnnouncement(userId, room.branchId, settings);
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

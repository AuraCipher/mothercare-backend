import { prisma } from '../../../lib/prisma';
import type { ChatMemberAccess, ChatRoomKind } from '@prisma/client';

export async function assertRoomMember(roomId: string, userId: string) {
  const member = await prisma.chatRoomMember.findFirst({
    where: { roomId, userId, leftAt: null, canRead: true },
    include: { room: { select: { isActive: true, academicYearId: true } } },
  });
  if (!member || !member.room.isActive) {
    throw { status: 403, message: 'Not a member of this room' };
  }
  return member;
}

export async function assertCanPost(roomId: string, userId: string) {
  const member = await assertRoomMember(roomId, userId);
  if (member.isPostingRestricted || member.isMuted) {
    throw { status: 403, message: 'Posting is restricted in this room' };
  }
  if (!member.canPost && member.access === 'observer') {
    throw { status: 403, message: 'Read-only access in this room' };
  }
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
  if (room?.onlyStaffCanPost) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const staffRoles = new Set(['teacher', 'management', 'branch_admin', 'sub_admin', 'super_admin', 'staff']);
    if (!user || !staffRoles.has(user.role)) {
      throw { status: 403, message: 'Only staff can post in this room' };
    }
  }
  return member;
}

export async function ensureRoomMembership(
  roomId: string,
  userId: string,
  opts: {
    access?: ChatMemberAccess;
    canPost?: boolean;
    displayTitle?: string;
  } = {},
) {
  await prisma.chatRoomMember.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: {
      roomId,
      userId,
      access: opts.access ?? 'member',
      canPost: opts.canPost ?? false,
      canRead: true,
      displayTitle: opts.displayTitle,
    },
    update: {
      leftAt: null,
      canRead: true,
      ...(opts.access ? { access: opts.access } : {}),
      ...(opts.canPost !== undefined ? { canPost: opts.canPost } : {}),
      ...(opts.displayTitle ? { displayTitle: opts.displayTitle } : {}),
    },
  });
}

export async function listUserRoomIds(userId: string, academicYearId: string): Promise<string[]> {
  const rows = await prisma.chatRoomMember.findMany({
    where: {
      userId,
      leftAt: null,
      canRead: true,
      room: { academicYearId, isActive: true },
    },
    select: { roomId: true },
  });
  return rows.map((r) => r.roomId);
}

export type RoomSummary = {
  id: string;
  kind: ChatRoomKind;
  name: string;
  description: string | null;
  communityId: string | null;
  classGroupId: string | null;
  onlyStaffCanPost: boolean;
  studentsCanPost: boolean;
  canPost: boolean;
  lastMessageAt: string | null;
  unreadCount: number;
};

export async function listRoomsForUser(userId: string, academicYearId: string): Promise<RoomSummary[]> {
  const memberships = await prisma.chatRoomMember.findMany({
    where: {
      userId,
      leftAt: null,
      canRead: true,
      room: { academicYearId, isActive: true },
    },
    include: {
      room: {
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          },
        },
      },
    },
    orderBy: { room: { updatedAt: 'desc' } },
  });

  const summaries: RoomSummary[] = [];
  for (const m of memberships) {
    const readState = await prisma.chatMessageReadState.findUnique({
      where: { roomId_userId: { roomId: m.roomId, userId } },
    });
    const unreadCount = readState?.lastReadMessageId
      ? await prisma.chatMessage.count({
          where: {
            roomId: m.roomId,
            isDeleted: false,
            createdAt: { gt: readState.lastReadAt },
          },
        })
      : await prisma.chatMessage.count({
          where: { roomId: m.roomId, isDeleted: false },
        });

    summaries.push({
      id: m.room.id,
      kind: m.room.kind,
      name: m.room.name,
      description: m.room.description,
      communityId: m.room.communityId,
      classGroupId: m.room.classGroupId,
      onlyStaffCanPost: m.room.onlyStaffCanPost,
      studentsCanPost: m.room.studentsCanPost,
      canPost: m.canPost && !m.isMuted && !m.isPostingRestricted,
      lastMessageAt: m.room.messages[0]?.createdAt?.toISOString() ?? null,
      unreadCount,
    });
  }

  return summaries;
}

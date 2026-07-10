import { prisma } from '../../../lib/prisma';
import type { ChatMemberAccess, ChatRoomKind } from '@prisma/client';
import { resolveCanPost } from './chat-permissions.service';

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
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    throw { status: 404, message: 'Room not found' };
  }
  const allowed = await resolveCanPost(userId, room, member);
  if (!allowed) {
    throw { status: 403, message: 'Posting is not allowed in this room' };
  }
  return member;
}

export async function ensureRoomMembership(
  roomId: string,
  userId: string,
  opts: {
    access?: ChatMemberAccess;
    canPost?: boolean;
    displayTitle?: string | null;
    classRoleAssignmentId?: string | null;
    isPostingRestricted?: boolean;
  } = {},
) {
  const update: Record<string, unknown> = {
    leftAt: null,
    canRead: true,
  };
  if (opts.access) update.access = opts.access;
  if (opts.canPost !== undefined) update.canPost = opts.canPost;
  if (opts.displayTitle !== undefined) update.displayTitle = opts.displayTitle;
  if (opts.classRoleAssignmentId !== undefined) {
    update.classRoleAssignmentId = opts.classRoleAssignmentId;
  }
  if (opts.isPostingRestricted !== undefined) {
    update.isPostingRestricted = opts.isPostingRestricted;
  }

  await prisma.chatRoomMember.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: {
      roomId,
      userId,
      access: opts.access ?? 'member',
      canPost: opts.canPost ?? false,
      canRead: true,
      displayTitle: opts.displayTitle ?? undefined,
      classRoleAssignmentId: opts.classRoleAssignmentId ?? undefined,
      isPostingRestricted: opts.isPostingRestricted ?? false,
    },
    update,
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
      canPost: await resolveCanPost(userId, m.room, m),
      lastMessageAt: m.room.messages[0]?.createdAt?.toISOString() ?? null,
      unreadCount,
    });
  }

  return summaries;
}

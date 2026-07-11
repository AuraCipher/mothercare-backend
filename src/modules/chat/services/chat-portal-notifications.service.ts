import type { ChatRoomKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { markRoomRead } from './chat-message.service';

export interface PortalNotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

function deriveTitle(msg: {
  title: string | null;
  content: string | null;
  type: string;
  room: { name: string; kind: ChatRoomKind };
}) {
  if (msg.title?.trim()) return msg.title.trim();
  const text = msg.content?.trim();
  if (text) {
    const line = text.split('\n')[0].trim();
    if (line) return line.length > 100 ? `${line.slice(0, 97)}...` : line;
  }
  if (msg.type === 'image') return 'Photo';
  if (msg.type === 'video') return 'Video';
  if (msg.type === 'voice_note' || msg.type === 'audio') return 'Voice message';
  return msg.room.name;
}

function typeFromRoomKind(kind: ChatRoomKind): string {
  if (kind === 'school_announcement' || kind === 'class_announcement' || kind === 'teacher_announcement') {
    return 'announcement';
  }
  if (kind === 'system_attendance') return 'attendance';
  if (kind === 'system_payment') return 'payment';
  if (kind === 'system_result') return 'results';
  if (kind === 'system_teacher_attendance') return 'attendance';
  if (kind === 'system_teacher_payroll') return 'payroll';
  return 'message';
}

export async function listChatPortalNotifications(input: {
  userId: string;
  academicYearId: string;
  roomKinds: ChatRoomKind[];
  classGroupIds?: string[];
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ items: PortalNotificationItem[]; unreadCount: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  const memberships = await prisma.chatRoomMember.findMany({
    where: {
      userId: input.userId,
      leftAt: null,
      canRead: true,
      room: {
        academicYearId: input.academicYearId,
        isActive: true,
        kind: { in: input.roomKinds },
        ...(input.classGroupIds?.length
          ? {
              OR: [{ classGroupId: null }, { classGroupId: { in: input.classGroupIds } }],
            }
          : {}),
      },
    },
    select: { roomId: true },
  });

  const roomIds = memberships.map((m) => m.roomId);
  if (!roomIds.length) {
    return { items: [], unreadCount: 0 };
  }

  const [messages, readStates] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { roomId: { in: roomIds }, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        room: { select: { id: true, kind: true, name: true } },
        sender: { select: { name: true } },
      },
    }),
    prisma.chatMessageReadState.findMany({
      where: { userId: input.userId, roomId: { in: roomIds } },
    }),
  ]);

  const readMap = new Map(readStates.map((row) => [row.roomId, row]));

  const items = messages.map((msg) => {
    const read = readMap.get(msg.roomId);
    const isRead = read ? msg.createdAt <= read.lastReadAt : false;
    return {
      id: `chat:${msg.id}`,
      title: deriveTitle(msg),
      body: msg.content?.trim() || `${msg.sender?.name || 'School'} sent an update`,
      type: typeFromRoomKind(msg.room.kind),
      data: {
        roomId: msg.roomId,
        messageId: msg.id,
        roomKind: msg.room.kind,
      },
      isRead,
      readAt: isRead ? read?.lastReadAt ?? null : null,
      createdAt: msg.createdAt,
    };
  });

  const unreadCounts = await Promise.all(
    roomIds.map(async (roomId) => {
      const read = readMap.get(roomId);
      return prisma.chatMessage.count({
        where: {
          roomId,
          isDeleted: false,
          ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
        },
      });
    }),
  );
  const unreadCount = unreadCounts.reduce((sum, count) => sum + count, 0);

  const filtered = input.unreadOnly ? items.filter((item) => !item.isRead) : items;
  return { items: filtered, unreadCount };
}

export async function markChatPortalNotificationRead(userId: string, notificationId: string) {
  if (!notificationId.startsWith('chat:')) {
    return null;
  }
  const messageId = notificationId.slice('chat:'.length);
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, roomId: true },
  });
  if (!message) {
    throw { status: 404, message: 'Notification not found' };
  }
  await markRoomRead(message.roomId, userId, message.id);
  return { id: notificationId, isRead: true, readAt: new Date() };
}

export async function markAllChatPortalNotificationsRead(input: {
  userId: string;
  academicYearId: string;
  roomKinds: ChatRoomKind[];
  classGroupIds?: string[];
}) {
  const memberships = await prisma.chatRoomMember.findMany({
    where: {
      userId: input.userId,
      leftAt: null,
      canRead: true,
      room: {
        academicYearId: input.academicYearId,
        isActive: true,
        kind: { in: input.roomKinds },
        ...(input.classGroupIds?.length
          ? {
              OR: [{ classGroupId: null }, { classGroupId: { in: input.classGroupIds } }],
            }
          : {}),
      },
    },
    select: { roomId: true },
  });

  let updated = 0;
  for (const membership of memberships) {
    const latest = await prisma.chatMessage.findFirst({
      where: { roomId: membership.roomId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latest) continue;
    await markRoomRead(membership.roomId, input.userId, latest.id);
    updated += 1;
  }

  return { updated };
}

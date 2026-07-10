import type { TeacherContext } from './teacher-context.service';
import {
  listChatPortalNotifications,
  markAllChatPortalNotificationsRead,
  markChatPortalNotificationRead,
} from '../../chat/services/chat-portal-notifications.service';
import { prisma } from '../../../lib/prisma';

const TEACHER_NOTIFICATION_ROOM_KINDS = [
  'school_announcement',
  'teacher_announcement',
  'class_announcement',
] as const;

export async function listTeacherNotifications(
  ctx: TeacherContext,
  opts?: { limit?: number; unreadOnly?: boolean },
) {
  const chatFeed = await listChatPortalNotifications({
    userId: ctx.userId,
    academicYearId: ctx.academicYearId,
    roomKinds: [...TEACHER_NOTIFICATION_ROOM_KINDS],
    classGroupIds: ctx.assignmentGroupIds,
    limit: opts?.limit,
    unreadOnly: opts?.unreadOnly,
  });

  if (chatFeed.items.length > 0 || chatFeed.unreadCount > 0) {
    return {
      items: chatFeed.items.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        type: item.type,
        data: item.data,
        isRead: item.isRead,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
      unreadCount: chatFeed.unreadCount,
    };
  }

  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const [legacyItems, legacyUnread] = await Promise.all([
    prisma.notificationRecipient.findMany({
      where: {
        userId: ctx.userId,
        ...(opts?.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notificationRecipient.count({
      where: { userId: ctx.userId, isRead: false },
    }),
  ]);

  return {
    items: legacyItems.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      data: n.data,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    unreadCount: legacyUnread,
  };
}

export async function markTeacherNotificationRead(ctx: TeacherContext, notificationId: string) {
  const chatMarked = await markChatPortalNotificationRead(ctx.userId, notificationId);
  if (chatMarked) return chatMarked;

  const existing = await prisma.notificationRecipient.findFirst({
    where: { id: notificationId, userId: ctx.userId },
  });
  if (!existing) {
    throw { status: 404, message: 'Notification not found' };
  }
  if (existing.isRead) {
    return { id: existing.id, isRead: true };
  }
  return prisma.notificationRecipient.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
    select: { id: true, isRead: true, readAt: true },
  });
}

export async function markAllTeacherNotificationsRead(ctx: TeacherContext) {
  const chatResult = await markAllChatPortalNotificationsRead({
    userId: ctx.userId,
    academicYearId: ctx.academicYearId,
    roomKinds: [...TEACHER_NOTIFICATION_ROOM_KINDS],
    classGroupIds: ctx.assignmentGroupIds,
  });

  const legacyResult = await prisma.notificationRecipient.updateMany({
    where: { userId: ctx.userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return { updated: chatResult.updated + legacyResult.count };
}

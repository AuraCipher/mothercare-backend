import { prisma } from '../../../lib/prisma';

export async function listTeacherNotifications(
  userId: string,
  opts?: { limit?: number; unreadOnly?: boolean },
) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);

  const [items, unreadCount] = await Promise.all([
    prisma.notificationRecipient.findMany({
      where: {
        userId,
        ...(opts?.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notificationRecipient.count({
      where: { userId, isRead: false },
    }),
  ]);

  return {
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      data: n.data,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    unreadCount,
  };
}

export async function markTeacherNotificationRead(userId: string, notificationId: string) {
  const existing = await prisma.notificationRecipient.findFirst({
    where: { id: notificationId, userId },
  });
  if (!existing) {
    throw { status: 404, message: 'Notification not found' };
  }
  if (existing.isRead) {
    return { id: existing.id, isRead: true };
  }
  const updated = await prisma.notificationRecipient.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
    select: { id: true, isRead: true, readAt: true },
  });
  return updated;
}

export async function markAllTeacherNotificationsRead(userId: string) {
  const result = await prisma.notificationRecipient.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

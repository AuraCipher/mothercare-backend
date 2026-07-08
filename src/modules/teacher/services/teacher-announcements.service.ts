import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from './teacher-context.service';

export async function listTeacherAnnouncements(ctx: TeacherContext) {
  const rows = await prisma.announcement.findMany({
    where: { academicYearId: ctx.academicYearId },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      mediaUrl: true,
      isPinned: true,
      createdAt: true,
      senderId: true,
    },
  });

  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const senders =
    senderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, name: true, role: true },
        })
      : [];
  const senderMap = new Map(senders.map((s) => [s.id, s]));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    mediaUrl: row.mediaUrl,
    isPinned: row.isPinned,
    createdAt: row.createdAt,
    scope: 'school' as const,
    sender: senderMap.get(row.senderId) || { id: row.senderId, name: 'Administration', role: 'management' },
  }));
}

import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

function formatGroupLabel(group: { name: string; section: string | null }) {
  return group.section ? `${group.name} — ${group.section}` : group.name;
}

/** School-wide + class-targeted announcements for the student's group (read-only). */
export async function listStudentAnnouncements(ctx: StudentContext) {
  const groupFilter =
    ctx.groupId != null
      ? [{ groupId: null }, { groupId: ctx.groupId }]
      : [{ groupId: null }];

  const rows = await prisma.announcement.findMany({
    where: {
      academicYearId: ctx.academicYearId,
      OR: groupFilter,
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      mediaUrl: true,
      isPinned: true,
      createdAt: true,
      senderId: true,
      groupId: true,
      group: { select: { id: true, name: true, section: true } },
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
    scope: row.groupId ? ('class' as const) : ('school' as const),
    group: row.group
      ? { id: row.group.id, label: formatGroupLabel(row.group) }
      : null,
    sender: senderMap.get(row.senderId) || {
      id: row.senderId,
      name: 'Administration',
      role: 'management',
    },
  }));
}

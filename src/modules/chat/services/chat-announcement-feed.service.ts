import type { ChatRoomKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma';

export type AnnouncementScope = 'school' | 'class' | 'teachers';

export interface AnnouncementFeedRow {
  id: string;
  title: string;
  content: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  isPinned: boolean;
  createdAt: Date;
  scope: AnnouncementScope;
  group: { id: string; label: string } | null;
  sender: { id: string; name: string; role: string };
}

function formatGroupLabel(group: { name: string; section: string | null }) {
  return group.section ? `${group.name} — ${group.section}` : group.name;
}

function deriveTitle(msg: { title: string | null; content: string | null; type: string }) {
  if (msg.title?.trim()) return msg.title.trim();
  const text = msg.content?.trim();
  if (text) {
    const line = text.split('\n')[0].trim();
    if (line) return line.length > 100 ? `${line.slice(0, 97)}...` : line;
  }
  if (msg.type === 'image') return 'Photo';
  if (msg.type === 'video') return 'Video';
  if (msg.type === 'voice_note' || msg.type === 'audio') return 'Voice message';
  return 'Announcement';
}

function scopeFromRoomKind(kind: ChatRoomKind): AnnouncementScope {
  if (kind === 'school_announcement') return 'school';
  if (kind === 'teacher_announcement') return 'teachers';
  return 'class';
}

async function findAnnouncementRooms(input: {
  academicYearId: string;
  branchId: string;
  kinds: ChatRoomKind[];
  classGroupIds?: string[];
}) {
  const or: object[] = [];

  if (input.kinds.includes('school_announcement')) {
    or.push({
      kind: 'school_announcement',
      singletonKey: `ay:${input.academicYearId}:branch:${input.branchId}:school_announcement`,
    });
  }

  if (input.kinds.includes('teacher_announcement')) {
    or.push({
      kind: 'teacher_announcement',
      singletonKey: `ay:${input.academicYearId}:branch:${input.branchId}:teacher_announcement`,
    });
  }

  if (input.kinds.includes('class_announcement') && input.classGroupIds?.length) {
    for (const groupId of input.classGroupIds) {
      or.push({
        kind: 'class_announcement',
        singletonKey: `ay:${input.academicYearId}:group:${groupId}:class_announcement`,
      });
    }
  }

  if (!or.length) return [];

  return prisma.chatRoom.findMany({
    where: {
      academicYearId: input.academicYearId,
      isActive: true,
      OR: or,
    },
    select: {
      id: true,
      kind: true,
      classGroupId: true,
      classGroup: { select: { id: true, name: true, section: true } },
    },
  });
}

/** Portal announcement feed — reads live chat messages from announcement rooms. */
export async function listChatAnnouncementFeed(input: {
  academicYearId: string;
  branchId: string;
  roomKinds: ChatRoomKind[];
  classGroupIds?: string[];
  limit?: number;
}): Promise<AnnouncementFeedRow[]> {
  const rooms = await findAnnouncementRooms({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    kinds: input.roomKinds,
    classGroupIds: input.classGroupIds,
  });
  if (!rooms.length) return [];

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId: { in: rooms.map((room) => room.id) },
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(input.limit ?? 200, 500),
    include: {
      sender: { select: { id: true, name: true, role: true } },
      mediaFile: { select: { publicUrl: true, mimeType: true } },
      announcement: { select: { isPinned: true } },
    },
  });

  const rows = messages.map((msg) => {
    const room = roomById.get(msg.roomId)!;
    const scope = scopeFromRoomKind(room.kind);
    return {
      id: msg.id,
      title: deriveTitle(msg),
      content: msg.content,
      mediaUrl: msg.mediaFile?.publicUrl ?? null,
      mediaMimeType: msg.mediaFile?.mimeType ?? null,
      isPinned: msg.announcement?.isPinned ?? false,
      createdAt: msg.createdAt,
      scope,
      group:
        scope === 'class' && room.classGroup
          ? { id: room.classGroup.id, label: formatGroupLabel(room.classGroup) }
          : null,
      sender: msg.sender ?? { id: '', name: 'Administration', role: 'management' },
    };
  });

  return rows.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

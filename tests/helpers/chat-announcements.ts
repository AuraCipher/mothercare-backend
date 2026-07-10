import { prismaMock } from '../mocks/prisma';

type MockAnnouncementItem = {
  id: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  createdAt?: Date;
  scope?: 'school' | 'class' | 'teachers';
  group?: { id: string; name: string; section: string | null } | null;
  sender?: { id: string; name: string; role: string };
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  isPinned?: boolean;
};

function roomKindForScope(scope: MockAnnouncementItem['scope']) {
  if (scope === 'teachers') return 'teacher_announcement';
  if (scope === 'class') return 'class_announcement';
  return 'school_announcement';
}

/** Mock chat-backed portal announcement feed for integration tests. */
export function mockChatAnnouncementFeed(items: MockAnnouncementItem[] = []) {
  if (!items.length) {
    (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.chatMessage.findMany as jest.Mock).mockResolvedValue([]);
    return;
  }

  const rooms = items.map((item, index) => {
    const scope = item.scope ?? 'school';
    const kind = roomKindForScope(scope);
    const roomId = `room-${index + 1}`;
    return {
      id: roomId,
      kind,
      classGroupId: scope === 'class' ? item.group?.id ?? 'g1' : null,
      classGroup: scope === 'class' ? item.group ?? { id: 'g1', name: 'Class 5', section: 'A' } : null,
    };
  });

  const messages = items.map((item, index) => ({
    id: item.id,
    roomId: rooms[index].id,
    title: item.title ?? null,
    content: item.content ?? null,
    type: item.type ?? 'text',
    createdAt: item.createdAt ?? new Date('2026-01-01'),
    sender: item.sender ?? { id: 'admin-1', name: 'Principal', role: 'management' },
    mediaFile:
      item.mediaUrl != null
        ? { publicUrl: item.mediaUrl, mimeType: item.mediaMimeType ?? 'application/octet-stream' }
        : null,
    announcement: item.isPinned ? { isPinned: true } : null,
  }));

  (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue(rooms);
  (prismaMock.chatMessage.findMany as jest.Mock).mockResolvedValue(messages);
}

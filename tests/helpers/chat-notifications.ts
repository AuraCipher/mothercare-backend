import { prismaMock } from '../mocks/prisma';

export function mockChatPortalNotifications(
  items: Array<{
    id: string;
    title: string;
    body: string;
    type?: string;
    isRead?: boolean;
    createdAt?: Date;
    roomId?: string;
  }> = [],
) {
  (prismaMock.chatRoomMember.findMany as jest.Mock).mockResolvedValue(
    items.length
      ? [{ roomId: 'room-1' }]
      : [],
  );
  (prismaMock.chatMessage.findMany as jest.Mock).mockResolvedValue(
    items.map((item) => ({
      id: item.id.replace(/^chat:/, ''),
      roomId: item.roomId ?? 'room-1',
      title: item.title,
      content: item.body,
      type: 'text',
      createdAt: item.createdAt ?? new Date(),
      sender: { name: 'Principal' },
      room: { id: item.roomId ?? 'room-1', kind: 'school_announcement', name: 'School Announcement' },
    })),
  );
  (prismaMock.chatMessageReadState.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.chatMessage.count as jest.Mock).mockResolvedValue(
    items.filter((item) => !item.isRead).length,
  );
}

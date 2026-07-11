import { prisma } from '../../../src/lib/prisma';
import { filterLandingDirectMessageRooms } from '../../../src/modules/chat/services/chat-landing-dm.service';
import type { RoomSummary } from '../../../src/modules/chat/services/chat-access.service';

jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    chatDmThread: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const baseRoom = (overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  id: 'room-1',
  kind: 'direct_message',
  name: 'CEO',
  description: null,
  communityId: null,
  classGroupId: null,
  onlyStaffCanPost: false,
  studentsCanPost: true,
  canPost: true,
  lastMessageAt: null,
  unreadCount: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chat-landing-dm.service', () => {
  test('filterLandingDirectMessageRooms removes CEO and self DM threads', async () => {
    const rooms: RoomSummary[] = [
      baseRoom({ id: 'dm-ceo', name: 'CEO' }),
      baseRoom({ id: 'dm-peer', name: 'Ms. Sarah' }),
      baseRoom({ id: 'ann-1', kind: 'school_announcement', name: 'School Announcement' }),
    ];

    (mockPrisma.chatDmThread.findMany as jest.Mock).mockResolvedValue([
      { roomId: 'dm-ceo', participantAId: 'admin-u1', participantBId: 'ceo-u1' },
      { roomId: 'dm-peer', participantAId: 'admin-u1', participantBId: 'teacher-u1' },
    ]);
    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'ceo-u1', role: 'super_admin' },
      { id: 'teacher-u1', role: 'teacher' },
    ]);

    const filtered = await filterLandingDirectMessageRooms('admin-u1', 'ay-1', rooms);

    expect(filtered.map((r) => r.id)).toEqual(['dm-peer', 'ann-1']);
  });

  test('filterLandingDirectMessageRooms keeps non-DM rooms untouched', async () => {
    const rooms: RoomSummary[] = [
      baseRoom({ id: 'ann-1', kind: 'school_announcement', name: 'School Announcement' }),
    ];

    const filtered = await filterLandingDirectMessageRooms('admin-u1', 'ay-1', rooms);

    expect(filtered).toEqual(rooms);
    expect(mockPrisma.chatDmThread.findMany).not.toHaveBeenCalled();
  });
});

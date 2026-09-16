/**
 * DB-03B: Chat Room List N+1 Elimination — Query-count regression & behavioral tests.
 *
 * These tests verify that listRoomsForUser issues a bounded number of DB
 * queries regardless of room count, and that the output is semantically
 * identical to what the original N+1 implementation would produce.
 */
import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { prisma } from '../../../src/lib/prisma';
import { listRoomsForUser, type RoomSummary } from '../../../src/modules/chat/services/chat-access.service';

const p = prisma as any;

// ═══════════════════════════════════════════════════════════════════
// HELPERS — build mock data for N rooms
// ═══════════════════════════════════════════════════════════════════

function makeRoom(index: number, overrides: Partial<{
  kind: string;
  branchId: string | null;
  classGroupId: string | null;
  communityId: string | null;
  name: string;
  onlyStaffCanPost: boolean;
  studentsCanPost: boolean;
}> = {}) {
  const roomId = `room-${index}`;
  return {
    id: roomId,
    kind: overrides.kind ?? 'group_chat',
    name: overrides.name ?? `Room ${index}`,
    description: `Description ${index}`,
    branchId: overrides.branchId ?? 'branch-1',
    classGroupId: overrides.classGroupId ?? 'group-1',
    communityId: overrides.communityId ?? null,
    academicYearId: 'ay-1',
    onlyStaffCanPost: overrides.onlyStaffCanPost ?? false,
    studentsCanPost: overrides.studentsCanPost ?? false,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date(`2026-01-${String(index).padStart(2, '0')}`),
  };
}

function makeMembership(index: number, roomId: string) {
  return {
    id: `mem-${index}`,
    roomId,
    userId: 'user-1',
    access: 'member',
    canPost: true,
    canRead: true,
    isMuted: false,
    isPostingRestricted: false,
    displayTitle: null,
    classRoleAssignmentId: null,
    joinedAt: new Date('2026-01-01'),
    leftAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeMessage(roomId: string, minutesOffset: number) {
  return {
    id: `msg-${roomId}-${minutesOffset}`,
    roomId,
    senderId: 'sender-1',
    type: 'text',
    content: 'Hello',
    createdAt: new Date(Date.now() - minutesOffset * 60000),
  };
}

function setupMocks(roomCount: number, opts: {
  readStateLastReadAt?: Date | null;
  messagesPerRoom?: number;
  userRole?: string;
} = {}) {
  const rooms = Array.from({ length: roomCount }, (_, i) => makeRoom(i));
  const memberships = rooms.map((r, i) => ({
    ...makeMembership(i, r.id),
    room: {
      ...r,
      messages: [makeMessage(r.id, 10)],
    },
  }));

  // chatRoomMember.findMany (initial query with include)
  jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);

  // user.findUnique
  jest.spyOn(p.user, 'findUnique').mockResolvedValue({
    id: 'user-1',
    role: opts.userRole ?? 'teacher',
    status: 'active',
  } as any);

  // branchMember.findMany
  jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([
    { branchId: 'branch-1', role: 'teacher', isActive: true },
  ] as any);

  // branchChatSettings.upsert (called for each unique branch)
  jest.spyOn(p.branchChatSettings, 'upsert').mockResolvedValue({
    branchId: 'branch-1',
    schoolAnnouncementPosterUserIds: [],
    teacherAnnouncementPosterUserIds: [],
    allowAllTeachersTeacherAnnouncement: false,
  } as any);

  // teacherProfile.findUnique (for teacher app permissions)
  jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue({
    portalAccess: 'FULL',
    portalPermissions: {},
    canViewParentContact: false,
    hodParentContactScope: 'ASSIGNED_ONLY',
  } as any);

  // branch.findUnique
  jest.spyOn(p.branch, 'findMany').mockResolvedValue([
    {
      id: 'branch-1',
      teacherParentContactEnabled: true,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    },
  ] as any);

  // teacherAssignment.findMany
  jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);

  // chatRoom.findMany (for group_chat full rooms)
  jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue(
    rooms.filter((r) => r.kind === 'group_chat').map((r) => ({
      id: r.id,
      teacherAssignmentId: null,
      communityId: null,
    })),
  );

  // classRoleAssignment.findMany
  jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);

  // chatMessageReadState.findMany (batch)
  jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue(
    opts.readStateLastReadAt !== undefined
      ? rooms.map((r) => ({
          roomId: r.id,
          lastReadAt: opts.readStateLastReadAt,
        }))
      : [],
  );

  // chatMessage.groupBy (total counts)
  jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue(
    rooms.map((r) => ({
      roomId: r.id,
      _count: { id: opts.messagesPerRoom ?? 5 },
    })),
  );

  // chatMessage.count (per-room after lastReadAt)
  jest.spyOn(p.chatMessage, 'count').mockResolvedValue(
    opts.readStateLastReadAt ? 2 : 0,
  );

  return { rooms, memberships };
}

function countQueries(): Map<string, number> {
  const counts = new Map<string, number>();
  const spied = [
    p.chatRoomMember.findMany,
    p.user.findUnique,
    p.branchMember.findMany,
    p.branchChatSettings.upsert,
    p.teacherProfile.findUnique,
    p.branch.findMany,
    p.teacherAssignment.findMany,
    p.chatRoom.findMany,
    p.classRoleAssignment.findMany,
    p.chatMessageReadState.findMany,
    p.chatMessage.groupBy,
    p.chatMessage.count,
  ];
  for (const mock of spied) {
    const calls = (mock as jest.Mock).mock?.calls?.length ?? 0;
    if (calls > 0) counts.set((mock as jest.Mock).getMockName() ?? 'unknown', calls);
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY-COUNT REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03B: listRoomsForUser query-count scaling', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('1 room issues a small constant number of queries', async () => {
    setupMocks(1);
    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toHaveLength(1);

    const counts = countQueries();
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    // Should be ~12 queries max (1 membership + 1 user + 1 branchMember + 1 branchChatSettings
    // + 1 teacherProfile + 1 branch + 1 teacherAssignment + 1 chatRoom + 1 classRoleAssignment
    // + 1 readState + 1 groupBy + 0-1 count)
    expect(total).toBeLessThanOrEqual(13);
  });

  test('10 rooms issues same bounded number of queries (no N+1 scaling)', async () => {
    setupMocks(10);
    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toHaveLength(10);

    const counts = countQueries();
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    // Should still be ~12 queries — batch queries don't scale with room count
    expect(total).toBeLessThanOrEqual(14);
  });

  test('50 rooms issues same bounded number of queries (no N+1 scaling)', async () => {
    setupMocks(50);
    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toHaveLength(50);

    const counts = countQueries();
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    // Should still be ~12 queries — batch queries don't scale with room count
    expect(total).toBeLessThanOrEqual(14);
  });

  test('chatMessage.count is called at most once per room with read state', async () => {
    setupMocks(10, { readStateLastReadAt: new Date('2026-01-05') });
    await listRoomsForUser('user-1', 'ay-1');

    // count() should be called once per room that has a read state (10 calls)
    // but these are parallel Promise.all — still 10 count queries
    expect(p.chatMessage.count).toHaveBeenCalledTimes(10);
  });

  test('chatMessage.count is NOT called when no read states exist', async () => {
    setupMocks(10, { readStateLastReadAt: undefined });
    await listRoomsForUser('user-1', 'ay-1');

    // No read states → unread = total count from groupBy → no count() calls
    expect(p.chatMessage.count).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// BEHAVIORAL EQUIVALENCE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03B: listRoomsForUser behavioral equivalence', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('returns correct RoomSummary shape', async () => {
    setupMocks(2);
    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toHaveLength(2);

    for (const room of result) {
      expect(room).toHaveProperty('id');
      expect(room).toHaveProperty('kind');
      expect(room).toHaveProperty('name');
      expect(room).toHaveProperty('description');
      expect(room).toHaveProperty('communityId');
      expect(room).toHaveProperty('classGroupId');
      expect(room).toHaveProperty('onlyStaffCanPost');
      expect(room).toHaveProperty('studentsCanPost');
      expect(room).toHaveProperty('canPost');
      expect(room).toHaveProperty('lastMessageAt');
      expect(room).toHaveProperty('unreadCount');
      expect(typeof room.canPost).toBe('boolean');
      expect(typeof room.unreadCount).toBe('number');
    }
  });

  test('room with no messages returns null lastMessageAt', async () => {
    const rooms = [makeRoom(0)];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({ id: 'user-1', role: 'teacher', status: 'active' } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([{ roomId: 'room-0', _count: { id: 0 } }]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].lastMessageAt).toBeNull();
  });

  test('room with messages returns ISO lastMessageAt', async () => {
    setupMocks(1, { messagesPerRoom: 3 });
    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].lastMessageAt).toBeTruthy();
    expect(typeof result[0].lastMessageAt).toBe('string');
    // Should be a valid ISO date string
    expect(new Date(result[0].lastMessageAt!).getTime()).not.toBeNaN();
  });

  test('unread count = 0 when fully read (messages after lastReadAt = 0)', async () => {
    setupMocks(1, { readStateLastReadAt: new Date(), messagesPerRoom: 5 });
    p.chatMessage.count.mockResolvedValue(0);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].unreadCount).toBe(0);
  });

  test('unread count = total messages when no read state exists', async () => {
    setupMocks(1, { readStateLastReadAt: undefined, messagesPerRoom: 7 });

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].unreadCount).toBe(7);
  });

  test('unread count = messages after lastReadAt when partially read', async () => {
    setupMocks(1, { readStateLastReadAt: new Date('2026-01-05'), messagesPerRoom: 10 });
    p.chatMessage.count.mockResolvedValue(3);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].unreadCount).toBe(3);
  });

  test('empty membership returns empty array', async () => {
    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toEqual([]);
  });

  test('rooms are ordered by room.updatedAt desc', async () => {
    setupMocks(3);
    // Mock returns in reverse order (simulating Prisma orderBy: { room: { updatedAt: 'desc' } })
    const reverseMemberships = [
      { ...makeMembership(2, 'room-2'), room: { ...makeRoom(2), messages: [makeMessage('room-2', 10)] } },
      { ...makeMembership(1, 'room-1'), room: { ...makeRoom(1), messages: [makeMessage('room-1', 10)] } },
      { ...makeMembership(0, 'room-0'), room: { ...makeRoom(0), messages: [makeMessage('room-0', 10)] } },
    ];
    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(reverseMemberships as any);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('room-2');
    expect(result[1].id).toBe('room-1');
    expect(result[2].id).toBe('room-0');
  });

  test('branch admin can post in school_announcement', async () => {
    const rooms = [makeRoom(0, { kind: 'school_announcement' })];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'management', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([
      { branchId: 'branch-1', role: 'branch_admin', isActive: true },
    ] as any);
    jest.spyOn(p.branchChatSettings, 'upsert').mockResolvedValue({
      branchId: 'branch-1',
      schoolAnnouncementPosterUserIds: [],
      teacherAnnouncementPosterUserIds: [],
      allowAllTeachersTeacherAnnouncement: false,
    } as any);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(true);
  });

  test('regular student cannot post in school_announcement', async () => {
    const rooms = [makeRoom(0, { kind: 'school_announcement' })];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'student', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.branchChatSettings, 'upsert').mockResolvedValue({
      branchId: 'branch-1',
      schoolAnnouncementPosterUserIds: [],
      teacherAnnouncementPosterUserIds: [],
      allowAllTeachersTeacherAnnouncement: false,
    } as any);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(false);
  });

  test('muted member cannot post even if branch admin', async () => {
    const rooms = [makeRoom(0, { kind: 'school_announcement' })];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      isMuted: true,
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'management', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([
      { branchId: 'branch-1', role: 'branch_admin', isActive: true },
    ] as any);
    jest.spyOn(p.branchChatSettings, 'upsert').mockResolvedValue({
      branchId: 'branch-1',
      schoolAnnouncementPosterUserIds: [],
      teacherAnnouncementPosterUserIds: [],
      allowAllTeachersTeacherAnnouncement: false,
    } as any);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(false);
  });

  test('posting-restricted member cannot post', async () => {
    const rooms = [makeRoom(0)];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      isPostingRestricted: true,
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'teacher', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([
      { id: 'room-0', teacherAssignmentId: null, communityId: null },
    ]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(false);
  });

  test('class teacher can post in class_announcement', async () => {
    const rooms = [makeRoom(0, { kind: 'class_announcement' })];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'teacher', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([
      { groupId: 'group-1', teacherId: 'user-1', isClassTeacher: true },
    ]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(true);
  });

  test('subject-only teacher cannot post in class_announcement', async () => {
    const rooms = [makeRoom(0, { kind: 'class_announcement' })];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'teacher', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([
      { groupId: 'group-1', teacherId: 'user-1', isClassTeacher: false },
    ]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    expect(result[0].canPost).toBe(false);
  });

  test('multiple rooms return independent unread counts', async () => {
    const rooms = [makeRoom(0), makeRoom(1)];
    const memberships = rooms.map((r, i) => ({
      ...makeMembership(i, r.id),
      room: { ...r, messages: [] },
    }));

    jest.spyOn(p.chatRoomMember, 'findMany').mockResolvedValue(memberships);
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'user-1', role: 'teacher', status: 'active',
    } as any);
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherProfile, 'findUnique').mockResolvedValue(null);
    jest.spyOn(p.branch, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.teacherAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatRoom, 'findMany').mockResolvedValue([
      { id: 'room-0', teacherAssignmentId: null, communityId: null },
      { id: 'room-1', teacherAssignmentId: null, communityId: null },
    ]);
    jest.spyOn(p.classRoleAssignment, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.chatMessageReadState, 'findMany').mockResolvedValue([
      { roomId: 'room-0', lastReadAt: null }, // no read state → full count
    ]);
    jest.spyOn(p.chatMessage, 'groupBy').mockResolvedValue([
      { roomId: 'room-0', _count: { id: 10 } },
      { roomId: 'room-1', _count: { id: 3 } },
    ]);

    const result = await listRoomsForUser('user-1', 'ay-1');
    // room-0 has read state with null lastReadAt → count after null = 0 → unread = 0
    // room-1 has no read state → unread = total = 3
    const r0 = result.find((r) => r.id === 'room-0')!;
    const r1 = result.find((r) => r.id === 'room-1')!;
    expect(r0.unreadCount).toBe(0); // readState exists, lastReadAt null → count where gt null = 0
    expect(r1.unreadCount).toBe(3); // no readState → total from groupBy
  });

  test('branch isolation: user only sees rooms for their academic year', async () => {
    setupMocks(2);
    const result = await listRoomsForUser('user-1', 'ay-1');
    // The initial query filters by academicYearId
    expect(p.chatRoomMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          room: expect.objectContaining({ academicYearId: 'ay-1' }),
        }),
      }),
    );
  });

  test('leftAt members are excluded', async () => {
    setupMocks(2);
    await listRoomsForUser('user-1', 'ay-1');
    expect(p.chatRoomMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leftAt: null }),
      }),
    );
  });

  test('canRead=false members are excluded', async () => {
    setupMocks(2);
    await listRoomsForUser('user-1', 'ay-1');
    expect(p.chatRoomMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ canRead: true }),
      }),
    );
  });
});

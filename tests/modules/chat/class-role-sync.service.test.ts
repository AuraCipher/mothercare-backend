/**
 * Class role membership sync — group_chat room members after assign/revoke.
 */
import { prismaMock } from '../../mocks/prisma';
import { syncClassRoleMemberships } from '../../../src/modules/chat/services/class-role-sync.service';

const COMMUNITY_ID = 'comm-1';

describe('class-role-sync.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('syncClassRoleMemberships updates group_chat members for role holders', async () => {
    (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue({
      id: COMMUNITY_ID,
      groupId: 'g1',
      academicYearId: 'ay1',
      isActive: true,
    });
    (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue([{ id: 'math-room' }]);
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { userId: 'stu-user-1' },
      { userId: 'stu-user-2' },
    ]);
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'asgn-1',
        userId: 'stu-user-1',
        publicDisplayName: 'CR — Ahmed',
        isMessagingRestricted: false,
        roleDefinition: { canPostInGroups: true },
      },
    ]);
    (prismaMock as any).$executeRawUnsafe.mockResolvedValue(2);

    await syncClassRoleMemberships(COMMUNITY_ID);

    expect((prismaMock as any).$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const rawSql = (prismaMock as any).$executeRawUnsafe.mock.calls[0][0];
    expect(rawSql).toContain('chat_room_members');
    expect(rawSql).toContain('ON CONFLICT');
    expect(rawSql).toContain('gen_random_uuid()');
  });

  test('syncClassRoleMemberships no-ops when community inactive', async () => {
    (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue({
      id: COMMUNITY_ID,
      isActive: false,
    });

    await syncClassRoleMemberships(COMMUNITY_ID);
    expect(prismaMock.chatRoom.findMany).not.toHaveBeenCalled();
  });

  test('chunks large inputs across multiple $executeRawUnsafe calls', async () => {
    const ROOM_COUNT = 2;
    const STUDENT_COUNT = 150; // 2 × 150 = 300 rows > CHUNK_SIZE (200)

    (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue({
      id: COMMUNITY_ID,
      groupId: 'g1',
      academicYearId: 'ay1',
      isActive: true,
    });
    (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: ROOM_COUNT }, (_, i) => ({ id: `room-${i}` })),
    );
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: STUDENT_COUNT }, (_, i) => ({ userId: `user-${i}` })),
    );
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock as any).$executeRawUnsafe.mockResolvedValue(undefined);

    await syncClassRoleMemberships(COMMUNITY_ID);

    const totalRows = ROOM_COUNT * STUDENT_COUNT; // 300
    const expectedChunks = Math.ceil(totalRows / 200); // 2
    expect((prismaMock as any).$executeRawUnsafe).toHaveBeenCalledTimes(expectedChunks);

    // Verify each chunk's SQL is valid
    for (const call of (prismaMock as any).$executeRawUnsafe.mock.calls) {
      const sql = call[0] as string;
      expect(sql).toContain('INSERT INTO chat_room_members');
      expect(sql).toContain('ON CONFLICT');
    }
  });

  test('preserves ON CONFLICT semantics across chunks (no duplicate rows)', async () => {
    (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue({
      id: COMMUNITY_ID,
      groupId: 'g1',
      academicYearId: 'ay1',
      isActive: true,
    });
    (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue([{ id: 'r1' }]);
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock as any).$executeRawUnsafe.mockResolvedValue(undefined);

    await syncClassRoleMemberships(COMMUNITY_ID);

    // Both chunks (here just1) must contain ON CONFLICT
    const calls = (prismaMock as any).$executeRawUnsafe.mock.calls;
    for (const call of calls) {
      expect(call[0]).toContain('ON CONFLICT ("roomId", "userId")');
      expect(call[0]).toContain('DO UPDATE SET');
    }
  });
});

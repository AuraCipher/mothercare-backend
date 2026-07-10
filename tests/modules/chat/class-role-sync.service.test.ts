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
    (prismaMock.chatRoomMember.upsert as jest.Mock).mockResolvedValue({});

    await syncClassRoleMemberships(COMMUNITY_ID);

    expect(prismaMock.chatRoomMember.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.chatRoomMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId_userId: { roomId: 'math-room', userId: 'stu-user-1' } },
        create: expect.objectContaining({
          canPost: true,
          classRoleAssignmentId: 'asgn-1',
          displayTitle: 'CR — Ahmed',
        }),
      }),
    );
    expect(prismaMock.chatRoomMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId_userId: { roomId: 'math-room', userId: 'stu-user-2' } },
        create: expect.objectContaining({
          canPost: false,
          classRoleAssignmentId: undefined,
        }),
      }),
    );
  });

  test('syncClassRoleMemberships no-ops when community inactive', async () => {
    (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue({
      id: COMMUNITY_ID,
      isActive: false,
    });

    await syncClassRoleMemberships(COMMUNITY_ID);
    expect(prismaMock.chatRoom.findMany).not.toHaveBeenCalled();
  });
});

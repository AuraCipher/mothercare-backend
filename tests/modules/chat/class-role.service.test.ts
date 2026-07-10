/**
 * Class role service — CRUD, assign/remove, validation.
 */
import { prismaMock } from '../../mocks/prisma';
import {
  assignClassRole,
  createClassRoleDefinition,
  deleteClassRoleDefinition,
  listClassRoleDefinitions,
  removeClassRoleAssignment,
  updateClassRoleDefinition,
} from '../../../src/modules/chat/services/class-role.service';

jest.mock('../../../src/modules/chat/services/class-role-sync.service', () => ({
  syncClassRoleMemberships: jest.fn(),
}));

import { syncClassRoleMemberships } from '../../../src/modules/chat/services/class-role-sync.service';

const COMMUNITY_ID = 'comm-1';
const ROLE_ID = 'role-1';
const STUDENT_ID = 'stu-1';
const USER_ID = 'user-stu-1';

const mockCommunity = {
  id: COMMUNITY_ID,
  groupId: 'g1',
  academicYearId: 'ay1',
  isActive: true,
  group: { id: 'g1', name: 'Class 5', section: 'A' },
  academicYear: { id: 'ay1', branchId: 'b1', status: 'ACTIVE' },
};

function mockCommunityLookup() {
  (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue(mockCommunity);
}

describe('class-role.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCommunityLookup();
  });

  test('listClassRoleDefinitions returns active roles with assignments', async () => {
    (prismaMock.classRoleDefinition.findMany as jest.Mock).mockResolvedValue([
      {
        id: ROLE_ID,
        communityId: COMMUNITY_ID,
        name: 'Class Representative',
        description: null,
        canPostInGroups: true,
        canReceiveDms: true,
        canInitiateDms: false,
        isActive: true,
        assignments: [
          {
            id: 'asgn-1',
            communityId: COMMUNITY_ID,
            roleDefinitionId: ROLE_ID,
            studentId: STUDENT_ID,
            userId: USER_ID,
            publicDisplayName: 'CR — Ahmed',
            isMessagingRestricted: false,
            assignedAt: new Date('2026-01-01'),
            student: { id: STUDENT_ID, name: 'Ahmed', rollNumber: '1' },
          },
        ],
      },
    ]);

    const data = await listClassRoleDefinitions(COMMUNITY_ID);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Class Representative');
    expect(data[0].assignments[0].student.name).toBe('Ahmed');
  });

  test('createClassRoleDefinition validates name', async () => {
    await expect(
      createClassRoleDefinition({
        communityId: COMMUNITY_ID,
        name: '   ',
        createdById: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('createClassRoleDefinition creates role', async () => {
    (prismaMock.classRoleDefinition.create as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      communityId: COMMUNITY_ID,
      name: 'GR',
      description: null,
      canPostInGroups: true,
      canReceiveDms: true,
      canInitiateDms: false,
      isActive: true,
      assignments: [],
    });

    const data = await createClassRoleDefinition({
      communityId: COMMUNITY_ID,
      name: 'GR',
      canPostInGroups: true,
      createdById: 'teacher-1',
    });

    expect(data.name).toBe('GR');
    expect(prismaMock.classRoleDefinition.create).toHaveBeenCalled();
  });

  test('updateClassRoleDefinition syncs when canPostInGroups changes', async () => {
    (prismaMock.classRoleDefinition.findFirst as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      canPostInGroups: false,
    });
    (prismaMock.classRoleDefinition.update as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      communityId: COMMUNITY_ID,
      name: 'GR',
      description: null,
      canPostInGroups: true,
      canReceiveDms: true,
      canInitiateDms: false,
      isActive: true,
      assignments: [],
    });

    await updateClassRoleDefinition({
      communityId: COMMUNITY_ID,
      roleDefinitionId: ROLE_ID,
      canPostInGroups: true,
    });

    expect(syncClassRoleMemberships).toHaveBeenCalledWith(COMMUNITY_ID);
  });

  test('deleteClassRoleDefinition soft-deletes and syncs', async () => {
    (prismaMock.classRoleDefinition.findFirst as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      isActive: true,
    });
    (prismaMock.classRoleDefinition.update as jest.Mock).mockResolvedValue({});

    await deleteClassRoleDefinition({
      communityId: COMMUNITY_ID,
      roleDefinitionId: ROLE_ID,
    });

    expect(prismaMock.classRoleDefinition.update).toHaveBeenCalledWith({
      where: { id: ROLE_ID },
      data: { isActive: false },
    });
    expect(syncClassRoleMemberships).toHaveBeenCalledWith(COMMUNITY_ID);
  });

  test('assignClassRole rejects student outside class', async () => {
    (prismaMock.classRoleDefinition.findFirst as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      name: 'CR',
      isActive: true,
    });
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      assignClassRole({
        communityId: COMMUNITY_ID,
        roleDefinitionId: ROLE_ID,
        studentId: STUDENT_ID,
        assignedById: 'teacher-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: /not enrolled/i });
  });

  test('assignClassRole upserts assignment and syncs memberships', async () => {
    (prismaMock.classRoleDefinition.findFirst as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      name: 'CR',
      isActive: true,
    });
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({
      id: STUDENT_ID,
      name: 'Ahmed',
      rollNumber: '1',
      userId: USER_ID,
    });
    (prismaMock.classRoleAssignment.upsert as jest.Mock).mockResolvedValue({
      id: 'asgn-1',
      communityId: COMMUNITY_ID,
      roleDefinitionId: ROLE_ID,
      studentId: STUDENT_ID,
      userId: USER_ID,
      publicDisplayName: 'CR — Ahmed',
      isMessagingRestricted: false,
      assignedAt: new Date('2026-01-01'),
      student: { id: STUDENT_ID, name: 'Ahmed', rollNumber: '1' },
    });

    const data = await assignClassRole({
      communityId: COMMUNITY_ID,
      roleDefinitionId: ROLE_ID,
      studentId: STUDENT_ID,
      assignedById: 'teacher-1',
    });

    expect(data.userId).toBe(USER_ID);
    expect(syncClassRoleMemberships).toHaveBeenCalledWith(COMMUNITY_ID);
  });

  test('removeClassRoleAssignment soft-removes and syncs', async () => {
    (prismaMock.classRoleAssignment.findFirst as jest.Mock).mockResolvedValue({
      id: 'asgn-1',
      communityId: COMMUNITY_ID,
    });
    (prismaMock.classRoleAssignment.update as jest.Mock).mockResolvedValue({});

    await removeClassRoleAssignment({
      communityId: COMMUNITY_ID,
      assignmentId: 'asgn-1',
      removedById: 'teacher-1',
    });

    expect(prismaMock.classRoleAssignment.update).toHaveBeenCalled();
    expect(syncClassRoleMemberships).toHaveBeenCalledWith(COMMUNITY_ID);
  });
});

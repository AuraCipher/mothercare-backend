/**
 * Class role CRUD — teacher + admin HTTP routes.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  TEST_AY_ID,
  TEST_BRANCH_ID,
  mockActiveAcademicYear,
  scopeQuery,
} from '../../helpers/integration';

jest.mock('../../../src/modules/chat/services/class-role-sync.service', () => ({
  syncClassRoleMemberships: jest.fn(),
}));

const adminToken = getAuthHeader(
  generateTestToken('admin-1', 'management', {
    name: 'Demo Principal',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const COMMUNITY_ID = 'comm-1';
const GROUP_ID = 'g1';

const mockCommunity = {
  id: COMMUNITY_ID,
  groupId: GROUP_ID,
  academicYearId: TEST_AY_ID,
  isActive: true,
  group: { id: GROUP_ID, name: 'Playgroup', section: 'A' },
  academicYear: { id: TEST_AY_ID, branchId: TEST_BRANCH_ID, status: 'ACTIVE' },
};

const mockTeacherUser = {
  id: 'teacher-u1',
  name: 'Ms. Sarah',
  email: 'sarah@school.com',
  username: 'sarah',
  role: 'teacher',
  status: 'active',
  profilePhotoId: null,
};

const mockTeacherProfile = {
  id: 'tp-1',
  userId: 'teacher-u1',
  employeeId: 'TCH-001',
  portalAccess: 'FULL',
  canViewParentContact: false,
  hodParentContactScope: 'ASSIGNED_ONLY',
};

const mockBranchMember = {
  id: 'bm-t1',
  branchId: TEST_BRANCH_ID,
  userId: 'teacher-u1',
  role: 'teacher',
  isActive: true,
};

function mockCommunityHappyPath() {
  mockActiveAcademicYear();
  (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue(mockCommunity);
}

function mockTeacherScopeHappyPath(isClassTeacher = true) {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'asgn-1',
      academicYearId: TEST_AY_ID,
      groupId: GROUP_ID,
      subjectId: 'sub1',
      isClassTeacher,
      role: 'primary',
      group: { id: GROUP_ID, name: 'Playgroup', section: 'A' },
      subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
    },
  ]);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.chatCommunity.findUnique as jest.Mock).mockResolvedValue(mockCommunity);
}

describe('Class roles — teacher routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/communities/:id/roles 403 when not class teacher', async () => {
    mockTeacherScopeHappyPath(false);
    const res = await request(app)
      .get(`/teacher/communities/${COMMUNITY_ID}/roles`)
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/class teacher/i);
  });

  test('GET /teacher/communities/:id/roles returns role list', async () => {
    mockTeacherScopeHappyPath(true);
    (prismaMock.classRoleDefinition.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'role-1',
        communityId: COMMUNITY_ID,
        name: 'CR',
        description: null,
        canPostInGroups: true,
        canReceiveDms: true,
        canInitiateDms: false,
        isActive: true,
        assignments: [],
      },
    ]);

    const res = await request(app)
      .get(`/teacher/communities/${COMMUNITY_ID}/roles`)
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('CR');
  });

  test('POST /teacher/communities/:id/roles creates role', async () => {
    mockTeacherScopeHappyPath(true);
    (prismaMock.classRoleDefinition.create as jest.Mock).mockResolvedValue({
      id: 'role-1',
      communityId: COMMUNITY_ID,
      name: 'GR',
      description: null,
      canPostInGroups: true,
      canReceiveDms: true,
      canInitiateDms: false,
      isActive: true,
      assignments: [],
    });

    const res = await request(app)
      .post(`/teacher/communities/${COMMUNITY_ID}/roles`)
      .query(scopeQuery)
      .set(teacherToken)
      .send({ name: 'GR', canPostInGroups: true });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('GR');
  });
});

describe('Class roles — admin routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /admin/communities/:id/roles returns roles', async () => {
    mockCommunityHappyPath();
    (prismaMock.classRoleDefinition.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'role-1',
        communityId: COMMUNITY_ID,
        name: 'Diary Monitor',
        description: null,
        canPostInGroups: false,
        canReceiveDms: true,
        canInitiateDms: false,
        isActive: true,
        assignments: [],
      },
    ]);

    const res = await request(app)
      .get(`/admin/communities/${COMMUNITY_ID}/roles`)
      .query(scopeQuery)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Diary Monitor');
  });

  test('POST /admin/communities/:id/roles/:roleId/assign requires studentId', async () => {
    mockCommunityHappyPath();
    const res = await request(app)
      .post(`/admin/communities/${COMMUNITY_ID}/roles/role-1/assign`)
      .query(scopeQuery)
      .set(adminToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/studentId/i);
  });
});

describe('Class roles — posting permissions', () => {
  beforeEach(() => jest.clearAllMocks());

  test('CR holder can post in group_chat but not class_announcement', async () => {
    const { resolveCanPost } = await import(
      '../../../src/modules/chat/services/chat-permissions.service'
    );

    const groupRoom = {
      id: 'math-room',
      kind: 'group_chat' as const,
      branchId: TEST_BRANCH_ID,
      classGroupId: GROUP_ID,
      academicYearId: TEST_AY_ID,
      onlyStaffCanPost: false,
    };
    const classRoom = {
      id: 'class-room',
      kind: 'class_announcement' as const,
      branchId: TEST_BRANCH_ID,
      classGroupId: GROUP_ID,
      academicYearId: TEST_AY_ID,
      onlyStaffCanPost: false,
    };
    const member = {
      canPost: false,
      access: 'member' as const,
      isMuted: false,
      isPostingRestricted: false,
      canRead: true,
    };

    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      teacherAssignmentId: 'asgn-math',
      communityId: COMMUNITY_ID,
    });
    (prismaMock.teacherAssignment.findUnique as jest.Mock).mockResolvedValue({
      teacherId: 'other-teacher',
    });
    (prismaMock.classRoleAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'asgn-cr' });

    const canPostGroup = await resolveCanPost('stu-user-1', groupRoom, member);
    expect(canPostGroup).toBe(true);

    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue(null);
    const canPostClass = await resolveCanPost('stu-user-1', classRoom, member);
    expect(canPostClass).toBe(false);
  });
});

/**
 * Admin Routes Integration Tests
 *
 * Tests admin CRD endpoints (Users, Groups, Students, Communities, Stats)
 * using supertest against the real Express app with mocked Prisma.
 *
 * All admin routes require auth + roleMiddleware(['super_admin', 'management']).
 */

// IMPORTANT: Mock bcryptjs BEFORE any source imports so that jest.mock('bcryptjs')
// is hoisted and registered before the admin routes load bcryptjs via dynamic import.
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import {
  createMockUser,
  createMockGroup,
  createMockStudent,
  createMockCommunity,
} from '../../helpers/factories';
import type {
  MockUser,
  MockGroup,
  MockStudent,
  MockCommunity,
} from '../../helpers/factories';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

// ─── Shared auth tokens ─────────────────────────────────────

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const parentToken = getAuthHeader(generateTestToken('parent-1', 'parent'));

// ─── Auth enforcement ───────────────────────────────────────

describe('Admin routes — auth enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /admin/users returns 401 without token', async () => {
    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('GET /admin/users returns 403 with non-admin token (parent)', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set(parentToken);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Access denied');
  });

  test('GET /admin/groups returns 401 without token', async () => {
    const res = await request(app).get('/admin/groups');
    expect(res.status).toBe(401);
  });

  test('GET /admin/groups returns 403 with non-admin token', async () => {
    const res = await request(app)
      .get('/admin/groups')
      .set(parentToken);
    expect(res.status).toBe(403);
  });

  test('POST /admin/communities returns 401 without token', async () => {
    const res = await request(app).post('/admin/communities').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });

  test('DELETE /admin/stats (non-existent path) returns 403 (auth fires before route)', async () => {
    // This verifies the middleware runs before route handlers
    const res = await request(app)
      .delete('/admin/stats')
      .set(parentToken);
    expect(res.status).toBe(403);
  });
});

// ─── USERS ───────────────────────────────────────────────────

describe('Admin — Users', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  describe('GET /admin/users', () => {
    test('returns list of users', async () => {
      const users = [
        { ...mockUser, role: 'super_admin' },
        createMockUser({ role: 'teacher' }),
        createMockUser({ role: 'parent' }),
      ];
      prismaMock.user.findMany.mockResolvedValue(users as any);

      const res = await request(app)
        .get('/admin/users')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
    });

    test('filters by role', async () => {
      const teachers = [createMockUser({ role: 'teacher' })];
      prismaMock.user.findMany.mockResolvedValue(teachers as any);

      const res = await request(app)
        .get('/admin/users?role=teacher')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].role).toBe('teacher');
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'teacher' }),
        }),
      );
    });

    test('filters by status', async () => {
      const inactiveUsers = [createMockUser({ status: 'inactive' })];
      prismaMock.user.findMany.mockResolvedValue(inactiveUsers as any);

      const res = await request(app)
        .get('/admin/users?status=inactive')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'inactive' }),
        }),
      );
    });

    test('searches by name/username/email/phone', async () => {
      prismaMock.user.findMany.mockResolvedValue([mockUser] as any);

      const res = await request(app)
        .get('/admin/users?search=test')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.objectContaining({ contains: 'test' }) }),
            ]),
          }),
        }),
      );
    });

    test('returns empty array when no users match', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/users?search=zzzznomatch')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /admin/users/:id', () => {
    test('returns user when found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);

      const res = await request(app)
        .get(`/admin/users/${mockUser.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockUser.id);
      expect(res.body.data.name).toBe(mockUser.name);
      // Note: mocked Prisma returns whatever we mock regardless of select,
      // so we verify the id/name match rather than passwordHash being absent.
    });

    test('returns 404 when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/users/non-existent-id')
        .set(adminToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('User not found');
    });
  });

  describe('POST /admin/users', () => {
    test('creates a user with valid data', async () => {
      prismaMock.user.create.mockResolvedValue(mockUser as any);

      const res = await request(app)
        .post('/admin/users')
        .set(adminToken)
        .send({
          name: 'New User',
          username: 'newuser',
          password: 'securePassword123',
          role: 'teacher',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockUser.id);
      expect(res.body.data.name).toBe(mockUser.name);
      expect(res.body.data.role).toBe(mockUser.role);
      // passwordHash should not be included in response
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    test('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/admin/users')
        .set(adminToken)
        .send({ username: 'newuser', password: 'securePassword123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('required');
    });

    test('returns 400 when username is missing', async () => {
      const res = await request(app)
        .post('/admin/users')
        .set(adminToken)
        .send({ name: 'New User', password: 'securePassword123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('required');
    });

    test('returns 400 when password is missing', async () => {
      const res = await request(app)
        .post('/admin/users')
        .set(adminToken)
        .send({ name: 'New User', username: 'newuser' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('required');
    });
  });

  describe('DELETE /admin/users/:id', () => {
    test('soft-deletes a user (sets status to inactive)', async () => {
      const deactivatedUser = { ...mockUser, status: 'inactive' };
      prismaMock.user.update.mockResolvedValue(deactivatedUser as any);

      const res = await request(app)
        .delete(`/admin/users/${mockUser.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User deactivated');
      expect(res.body.data.id).toBe(mockUser.id);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: { status: 'inactive' },
        }),
      );
    });
  });
});

// ─── GROUPS ──────────────────────────────────────────────────

describe('Admin — Groups', () => {
  let mockGroup: MockGroup;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGroup = createMockGroup();
  });

  describe('GET /admin/groups', () => {
    test('returns list of groups with _count and community', async () => {
      const groups = [
        {
          ...mockGroup,
          _count: { members: 5, students: 15 },
          community: { name: 'Test Community' },
        },
        {
          ...createMockGroup(),
          _count: { members: 3, students: 10 },
          community: { name: 'Another Community' },
        },
      ];
      prismaMock.group.findMany.mockResolvedValue(groups as any);

      const res = await request(app)
        .get('/admin/groups')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]._count).toBeDefined();
      expect(res.body.data[0]._count.members).toBe(5);
      expect(res.body.data[0].community).toBeDefined();
      expect(res.body.data[0].community.name).toBe('Test Community');
    });

    test('filters by communityId', async () => {
      prismaMock.group.findMany.mockResolvedValue([{ ...mockGroup, _count: { members: 0, students: 0 }, community: { name: 'Test' } }] as any);

      const res = await request(app)
        .get(`/admin/groups?communityId=${mockGroup.communityId}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ communityId: mockGroup.communityId }),
        }),
      );
    });

    test('filters by section', async () => {
      prismaMock.group.findMany.mockResolvedValue([] as any);

      const res = await request(app)
        .get('/admin/groups?section=A')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ section: 'A' }),
        }),
      );
    });
  });

  describe('GET /admin/groups/:id', () => {
    test('returns group with members, students, and community when found', async () => {
      const groupDetail = {
        ...mockGroup,
        members: [
          {
            id: 'gm-1',
            user: { id: 'u-1', name: 'Member One', role: 'teacher' },
          },
        ],
        students: [
          { id: 's-1', name: 'Student One', groupId: mockGroup.id, isActive: true },
        ],
        community: { name: 'Test Community' },
      };
      prismaMock.group.findUnique.mockResolvedValue(groupDetail as any);

      const res = await request(app)
        .get(`/admin/groups/${mockGroup.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockGroup.id);
      expect(res.body.data.members).toBeDefined();
      expect(res.body.data.members).toHaveLength(1);
      expect(res.body.data.community).toBeDefined();
    });

    test('returns 404 when group not found', async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/groups/non-existent-id')
        .set(adminToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Group not found');
    });
  });

  describe('POST /admin/groups', () => {
    test('creates a group', async () => {
      prismaMock.group.create.mockResolvedValue(mockGroup as any);

      const res = await request(app)
        .post('/admin/groups')
        .set(adminToken)
        .send({
          communityId: mockGroup.communityId,
          name: 'Class 1',
          section: 'A',
          displayOrder: 1,
          capacity: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockGroup.id);
      expect(res.body.data.name).toBe(mockGroup.name);
    });

    test('creates a group with defaults when optional fields omitted', async () => {
      prismaMock.group.create.mockResolvedValue({ ...mockGroup, displayOrder: 1, capacity: 30 } as any);

      const res = await request(app)
        .post('/admin/groups')
        .set(adminToken)
        .send({ communityId: mockGroup.communityId, name: 'Minimal Group' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE /admin/groups/:id', () => {
    test('soft-deletes a group (sets isActive false)', async () => {
      prismaMock.group.update.mockResolvedValue({ ...mockGroup, isActive: false } as any);

      const res = await request(app)
        .delete(`/admin/groups/${mockGroup.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Group deactivated');
      expect(prismaMock.group.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockGroup.id },
          data: { isActive: false },
        }),
      );
    });
  });
});

// ─── STUDENTS ────────────────────────────────────────────────

describe('Admin — Students', () => {
  let mockStudent: MockStudent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStudent = createMockStudent();
  });

  describe('GET /admin/students', () => {
    test('returns list of students with group info', async () => {
      const students = [
        {
          ...mockStudent,
          group: { name: 'Class 1', section: 'A' },
        },
        {
          ...createMockStudent({ isActive: true }),
          group: { name: 'Class 2', section: 'B' },
        },
      ];
      prismaMock.student.findMany.mockResolvedValue(students as any);

      const res = await request(app)
        .get('/admin/students')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].group).toBeDefined();
      expect(res.body.data[0].group.name).toBe('Class 1');
    });

    test('filters by groupId', async () => {
      prismaMock.student.findMany.mockResolvedValue([] as any);

      await request(app)
        .get(`/admin/students?groupId=${mockStudent.groupId}`)
        .set(adminToken);

      expect(prismaMock.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ groupId: mockStudent.groupId }),
        }),
      );
    });

    test('filters by isActive', async () => {
      prismaMock.student.findMany.mockResolvedValue([] as any);

      await request(app)
        .get('/admin/students?isActive=true')
        .set(adminToken);

      expect(prismaMock.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    test('filters by isActive=false', async () => {
      prismaMock.student.findMany.mockResolvedValue([] as any);

      await request(app)
        .get('/admin/students?isActive=false')
        .set(adminToken);

      expect(prismaMock.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('GET /admin/students/:id', () => {
    test('returns student with group and parents when found', async () => {
      const studentDetail = {
        ...mockStudent,
        group: { id: mockStudent.groupId, name: 'Class 1', section: 'A' },
        parents: [
          {
            id: 'sp-1',
            parent: {
              id: 'p-1',
              user: { id: 'u-1', name: 'Parent One', role: 'parent' },
            },
          },
        ],
      };
      prismaMock.student.findUnique.mockResolvedValue(studentDetail as any);

      const res = await request(app)
        .get(`/admin/students/${mockStudent.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockStudent.id);
      expect(res.body.data.group).toBeDefined();
      expect(res.body.data.parents).toBeDefined();
    });

    test('returns 404 when student not found', async () => {
      prismaMock.student.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/students/non-existent-id')
        .set(adminToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Student not found');
    });
  });

  describe('POST /admin/students', () => {
    test('creates a student', async () => {
      prismaMock.student.create.mockResolvedValue(mockStudent as any);

      const res = await request(app)
        .post('/admin/students')
        .set(adminToken)
        .send({
          name: 'New Student',
          gender: 'male',
          groupId: mockStudent.groupId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockStudent.id);
      expect(res.body.data.name).toBe(mockStudent.name);
    });

    test('creates a student with dateOfBirth', async () => {
      const studentWithDob = createMockStudent({ dateOfBirth: new Date('2015-06-01') });
      prismaMock.student.create.mockResolvedValue(studentWithDob as any);

      const res = await request(app)
        .post('/admin/students')
        .set(adminToken)
        .send({
          name: 'Young Student',
          gender: 'female',
          dateOfBirth: '2015-06-01',
          groupId: mockStudent.groupId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE /admin/students/:id', () => {
    test('soft-deletes a student (sets isActive false)', async () => {
      const deactivated = { ...mockStudent, isActive: false };
      prismaMock.student.update.mockResolvedValue(deactivated as any);

      const res = await request(app)
        .delete(`/admin/students/${mockStudent.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Student deactivated');
      expect(res.body.data.id).toBe(mockStudent.id);
      expect(prismaMock.student.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockStudent.id },
          data: { isActive: false },
        }),
      );
    });
  });
});

// ─── COMMUNITIES ─────────────────────────────────────────────

describe('Admin — Communities', () => {
  let mockCommunity: MockCommunity;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCommunity = createMockCommunity();
  });

  describe('GET /admin/communities', () => {
    test('returns list of communities with _count', async () => {
      const communities = [
        { ...mockCommunity, _count: { members: 10, groups: 3 } },
        {
          ...createMockCommunity({ name: 'Second Community' }),
          _count: { members: 5, groups: 1 },
        },
      ];
      prismaMock.community.findMany.mockResolvedValue(communities as any);

      const res = await request(app)
        .get('/admin/communities')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]._count.members).toBe(10);
      expect(res.body.data[1]._count.groups).toBe(1);
    });
  });

  describe('GET /admin/communities/:id', () => {
    test('returns community with members, groups, and announcements when found', async () => {
      const communityDetail = {
        ...mockCommunity,
        members: [
          {
            id: 'cm-1',
            user: { id: 'u-1', name: 'Member One', role: 'teacher' },
          },
        ],
        groups: [
          { id: 'g-1', name: 'Group 1', communityId: mockCommunity.id },
        ],
        announcements: [
          {
            id: 'a-1',
            title: 'Announcement 1',
            createdAt: new Date(),
          },
        ],
      };
      prismaMock.community.findUnique.mockResolvedValue(communityDetail as any);

      const res = await request(app)
        .get(`/admin/communities/${mockCommunity.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockCommunity.id);
      expect(res.body.data.members).toHaveLength(1);
      expect(res.body.data.groups).toHaveLength(1);
      expect(res.body.data.announcements).toHaveLength(1);
    });

    test('returns 404 when community not found', async () => {
      prismaMock.community.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/communities/non-existent-id')
        .set(adminToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Community not found');
    });
  });

  describe('POST /admin/communities', () => {
    test('creates a community', async () => {
      prismaMock.community.create.mockResolvedValue(mockCommunity as any);

      const res = await request(app)
        .post('/admin/communities')
        .set(adminToken)
        .send({
          name: 'New Community',
          description: 'A brand new community',
          academicYear: '2025-2026',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockCommunity.id);
      expect(res.body.data.name).toBe(mockCommunity.name);
    });

    test('creates a community with default academic year when omitted', async () => {
      prismaMock.community.create.mockResolvedValue(mockCommunity as any);

      const res = await request(app)
        .post('/admin/communities')
        .set(adminToken)
        .send({ name: 'Minimal Community' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.community.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Minimal Community',
            academicYear: '2025-2026',
          }),
        }),
      );
    });
  });

  describe('DELETE /admin/communities/:id', () => {
    test('hard-deletes a community', async () => {
      prismaMock.community.delete.mockResolvedValue(mockCommunity as any);

      const res = await request(app)
        .delete(`/admin/communities/${mockCommunity.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Community deleted');
      expect(prismaMock.community.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCommunity.id },
        }),
      );
    });
  });
});

// ─── STATS ───────────────────────────────────────────────────

describe('Admin — Stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /admin/stats returns aggregated counts and role breakdown', async () => {
    // Mock all 5 count calls
    prismaMock.user.count.mockResolvedValue(100);
    prismaMock.group.count.mockResolvedValue(10);
    prismaMock.student.count.mockResolvedValue(500);
    prismaMock.community.count.mockResolvedValue(5);
    prismaMock.apiKey.count.mockResolvedValue(3);

    // Mock user groupBy for role breakdown
    // Prisma groupBy returns _count as an object: { role: 1 }, not a plain number
    (prismaMock.user.groupBy as jest.Mock).mockResolvedValue([
      { role: 'super_admin', _count: { role: 1 } },
      { role: 'management', _count: { role: 2 } },
      { role: 'teacher', _count: { role: 20 } },
      { role: 'parent', _count: { role: 77 } },
    ]);

    const res = await request(app)
      .get('/admin/stats')
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totalUsers: 100,
      totalGroups: 10,
      totalStudents: 500,
      totalCommunities: 5,
      activeApiKeys: 3,
      byRole: {
        super_admin: { role: 1 },
        management: { role: 2 },
        teacher: { role: 20 },
        parent: { role: 77 },
      },
    });
  });

  test('GET /admin/stats with empty data returns zeros', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.group.count.mockResolvedValue(0);
    prismaMock.student.count.mockResolvedValue(0);
    prismaMock.community.count.mockResolvedValue(0);
    prismaMock.apiKey.count.mockResolvedValue(0);
    (prismaMock.user.groupBy as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get('/admin/stats')
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.byRole).toEqual({});
  });
});

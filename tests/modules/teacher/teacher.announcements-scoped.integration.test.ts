/**
 * Teacher portal — announcements scoped to school-wide + assigned groups (read-only).
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

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const mockTeacherUser = {
  id: 'teacher-u1',
  name: 'Ms. Sarah',
  role: 'teacher',
  status: 'active',
  profilePhotoId: null,
};

const mockBranchMember = {
  id: 'bm-t1',
  branchId: TEST_BRANCH_ID,
  userId: 'teacher-u1',
  role: 'teacher',
  isActive: true,
};

const mockAssignments = [
  {
    id: 'asgn-1',
    academicYearId: TEST_AY_ID,
    groupId: 'g1',
    subjectId: 'sub1',
    isClassTeacher: true,
    role: 'primary',
    group: { id: 'g1', name: 'Class 5', section: 'A' },
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
  },
];

function mockTeacherBase() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'tp-1',
    portalAccess: 'FULL',
    portalPermissions: null,
    canViewParentContact: false,
    hodParentContactScope: 'ASSIGNED_ONLY',
  });
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Teacher portal — scoped announcements', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/announcements queries school-wide and assigned groups only', async () => {
    mockTeacherBase();
    (prismaMock.announcement.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'ann-school',
        title: 'School holiday',
        content: 'Monday off',
        mediaUrl: null,
        isPinned: true,
        createdAt: new Date('2026-01-05'),
        senderId: 'admin-1',
        groupId: null,
        group: null,
      },
      {
        id: 'ann-class',
        title: 'Class 5 trip',
        content: 'Bring permission slip',
        mediaUrl: null,
        isPinned: false,
        createdAt: new Date('2026-01-06'),
        senderId: 'admin-1',
        groupId: 'g1',
        group: { id: 'g1', name: 'Class 5', section: 'A' },
      },
    ]);
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'admin-1', name: 'Principal', role: 'management' },
    ]);

    const res = await request(app)
      .get('/teacher/announcements')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(prismaMock.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicYearId: TEST_AY_ID,
          OR: [{ groupId: null }, { groupId: { in: ['g1'] } }],
        },
      }),
    );
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].scope).toBe('school');
    expect(res.body.data[1].scope).toBe('class');
    expect(res.body.data[1].group.label).toBe('Class 5 — A');
  });

  test('GET /teacher/announcements has no write routes', async () => {
    mockTeacherBase();
    const postRes = await request(app)
      .post('/teacher/announcements')
      .set(teacherToken)
      .query(scopeQuery)
      .send({ title: 'Hack' });
    expect(postRes.status).toBe(404);
  });
});

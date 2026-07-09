/**
 * Student portal — bootstrap, announcements, read-only guard.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { TEST_AY_ID, TEST_BRANCH_ID, mockActiveAcademicYear, scopeQuery } from '../../helpers/integration';

const studentToken = getAuthHeader(
  generateTestToken('student-u1', 'student', {
    name: 'Ali Student',
    branchIds: [],
  }),
);

const mockStudentUser = {
  id: 'student-u1',
  name: 'Ali Student',
  email: null,
  username: 'ali.s',
  role: 'student',
  status: 'active',
  profilePhotoId: null,
};

const mockStudentRecord = {
  id: 'stu-1',
  name: 'Ali Student',
  rollNumber: '12',
  userId: 'student-u1',
  academicYearId: TEST_AY_ID,
  isActive: true,
  status: 'ACTIVE',
  credentialTag: 'CRED_NONE',
  group: { id: 'g1', name: 'Class 5', section: 'A' },
  academicYear: {
    id: TEST_AY_ID,
    branchId: TEST_BRANCH_ID,
    status: 'ACTIVE',
    calendar: { label: '2025-2026' },
    branch: { id: TEST_BRANCH_ID, name: 'Test Branch', code: 'TST' },
  },
};

function mockStudentBase() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockStudentUser);
  (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(mockStudentRecord);
  (prismaMock.canteenAccount.findFirst as jest.Mock).mockResolvedValue(null);
}

describe('Student portal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /student/bootstrap returns student context', async () => {
    mockStudentBase();
    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.student.id).toBe('stu-1');
    expect(res.body.data.branch.id).toBe(TEST_BRANCH_ID);
    expect(res.body.data.features.showCanteen).toBe(false);
  });

  it('GET /student/announcements returns school-wide and class scoped', async () => {
    mockStudentBase();
    (prismaMock.announcement.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'a1',
        title: 'Holiday',
        content: 'Monday off',
        mediaUrl: null,
        isPinned: false,
        createdAt: new Date('2026-01-01'),
        senderId: 'admin-1',
        groupId: null,
        group: null,
      },
    ]);
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'admin-1', name: 'Admin', role: 'management' },
    ]);

    const res = await request(app)
      .get('/student/announcements')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].scope).toBe('school');
  });

  it('POST /student/profile returns 405 read-only', async () => {
    mockStudentBase();
    const res = await request(app)
      .post('/student/profile')
      .set(studentToken)
      .query(scopeQuery)
      .send({ name: 'Hack' });

    expect(res.status).toBe(405);
  });

  it('rejects non-student role', async () => {
    const teacherToken = getAuthHeader(
      generateTestToken('teacher-u1', 'teacher', { branchIds: [TEST_BRANCH_ID] }),
    );
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockStudentUser,
      id: 'teacher-u1',
      role: 'teacher',
    });

    const res = await request(app)
      .get('/student/bootstrap')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(403);
  });
});

/**
 * Teacher portal API — Phase 0 integration tests.
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

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));

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

function mockTeacherHappyPath() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
}

describe('Teacher portal — Phase 0', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/bootstrap 401 without token', async () => {
    const res = await request(app).get('/teacher/bootstrap').query(scopeQuery);
    expect(res.status).toBe(401);
  });

  test('GET /teacher/bootstrap 403 for management role', async () => {
    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(adminToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/teacher portal/i);
  });

  test('GET /teacher/bootstrap 400 without academicYearId', async () => {
    mockTeacherHappyPath();
    const res = await request(app)
      .get('/teacher/bootstrap')
      .query({ branchId: TEST_BRANCH_ID })
      .set(teacherToken);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/academicYearId/i);
  });

  test('GET /teacher/bootstrap 403 when user inactive', async () => {
    mockActiveAcademicYear();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockTeacherUser,
      status: 'inactive',
    });
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);

    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not active/i);
  });

  test('GET /teacher/bootstrap 403 when branch mismatch in JWT', async () => {
    mockTeacherHappyPath();
    const wrongBranchToken = getAuthHeader(
      generateTestToken('teacher-u1', 'teacher', { branchIds: ['other-branch'] }),
    );
    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(wrongBranchToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/branch/i);
  });

  test('GET /teacher/bootstrap 200 with assignments', async () => {
    mockTeacherHappyPath();
    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.name).toBe('Ms. Sarah');
    expect(res.body.data.teacherProfile.employeeId).toBe('TCH-001');
    expect(res.body.data.academicYear.status).toBe('ACTIVE');
    expect(res.body.data.portal.canWrite).toBe(true);
    expect(res.body.data.assignments).toHaveLength(1);
    expect(res.body.data.assignments[0].group.name).toBe('Class 5');
  });

  test('GET /teacher/bootstrap read-only when AY archived', async () => {
    mockActiveAcademicYear({ status: 'ARCHIVED' });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.data.portal.isReadOnly).toBe(true);
    expect(res.body.data.portal.canWrite).toBe(false);
  });

  test('GET /admin/students still 403 for teacher token', async () => {
    const res = await request(app)
      .get('/admin/students')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
  });
});

describe('Teacher portal — Phase B', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockPhaseB() {
    mockTeacherHappyPath();
    (prismaMock.timetable.findFirst as jest.Mock).mockResolvedValue({
      id: 'tt1',
      name: 'Regular Timetable',
      dayConfigs: [{ dayOfWeek: 1 }, { dayOfWeek: 2 }],
    });
    (prismaMock.timetableEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({
      id: 'g1',
      name: 'Class 5',
      section: 'A',
    });
  }

  test('GET /teacher/timetable 200', async () => {
    mockPhaseB();
    const res = await request(app)
      .get('/teacher/timetable')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timetableName).toBe('Regular Timetable');
  });

  test('GET /teacher/classes/:groupId/students 403 for unassigned group', async () => {
    mockTeacherHappyPath();
    const res = await request(app)
      .get('/teacher/classes/other-group/students')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
  });

  test('GET /teacher/classes/:groupId/students 200 for assigned group', async () => {
    mockPhaseB();
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { id: 's1', name: 'Ali', rollNumber: '1', admissionNumber: 'ADM-1', gender: 'male' },
    ]);
    const res = await request(app)
      .get('/teacher/classes/g1/students')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data.students).toHaveLength(1);
    expect(res.body.data.isClassTeacher).toBe(true);
  });

  test('POST /teacher/attendance/batch 403 when AY archived', async () => {
    mockActiveAcademicYear({ status: 'ARCHIVED' });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        groupId: 'g1',
        date: '2026-01-15',
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/read-only/i);
  });

  test('POST /teacher/attendance/batch 200 when AY active', async () => {
    mockPhaseB();
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }]);
    (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        groupId: 'g1',
        date: '2026-01-15',
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(1);
  });
});

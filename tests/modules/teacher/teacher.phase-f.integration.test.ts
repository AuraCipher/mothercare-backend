/**
 * Teacher portal — Phase F integration tests (profile self-edit, class attendance summary).
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

const mockTeacherProfileRow = {
  id: 'tp-1',
  employeeId: 'EMP-001',
  qualification: 'B.Ed',
  specialization: 'Math',
  phone: '03001111111',
  emergencyContact: '03002222222',
  address: 'Campus Road',
  joiningDate: new Date('2020-01-01'),
  portalAccess: 'FULL',
  canViewParentContact: false,
  hodParentContactScope: 'ASSIGNED_ONLY',
  portalPermissions: null,
  user: {
    id: 'teacher-u1',
    name: 'Ms. Sarah',
    email: 'sarah@school.test',
    username: 'sarah',
    profilePhotoId: null,
  },
};

function mockTeacherBase() {
  mockActiveAcademicYear({
    branch: {
      id: TEST_BRANCH_ID,
      name: 'Test Branch',
      code: 'TST',
      teacherParentContactEnabled: false,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    },
  });
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfileRow);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Teacher portal — Phase F', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PUT /teacher/profile updates contact fields', async () => {
    mockTeacherBase();
    (prismaMock.teacherProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(mockTeacherProfileRow)
      .mockResolvedValueOnce(mockTeacherProfileRow);
    (prismaMock.teacherProfile.update as jest.Mock).mockResolvedValue({
      ...mockTeacherProfileRow,
      phone: '03009999999',
      emergencyContact: '03008888888',
      address: 'New address',
    });

    const res = await request(app)
      .put('/teacher/profile')
      .set(teacherToken)
      .query(scopeQuery)
      .send({
        phone: '03009999999',
        emergencyContact: '03008888888',
        address: 'New address',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.phone).toBe('03009999999');
    expect(res.body.data.address).toBe('New address');
  });

  test('PUT /teacher/profile 403 when academic year read-only', async () => {
    mockActiveAcademicYear({ status: 'ARCHIVED' });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfileRow);
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .put('/teacher/profile')
      .set(teacherToken)
      .query(scopeQuery)
      .send({ phone: '03009999999' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/read-only/i);
  });

  test('GET /teacher/classes/:groupId/students includes attendance summary', async () => {
    mockTeacherBase();
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({
      id: 'g1',
      name: 'Class 5',
      section: 'A',
    });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        name: 'Ali',
        rollNumber: '1',
        admissionNumber: null,
        gender: 'male',
        attendances: [{ status: 'present' }],
      },
      {
        id: 's2',
        name: 'Sara',
        rollNumber: '2',
        admissionNumber: null,
        gender: 'female',
        attendances: [{ status: 'absent' }],
      },
    ]);
    (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([
      { status: 'present' },
      { status: 'present' },
      { status: 'absent' },
    ]);

    const res = await request(app)
      .get('/teacher/classes/g1/students')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.attendanceSummary).toMatchObject({
      studentCount: 2,
      markedToday: 2,
      presentToday: 1,
      absentToday: 1,
    });
    expect(res.body.data.students[0].todayAttendance).toBe('present');
    expect(res.body.data.students[1].todayAttendance).toBe('absent');
    expect(res.body.data.attendanceSummary.attendanceRate30d).toBe(67);
  });
});

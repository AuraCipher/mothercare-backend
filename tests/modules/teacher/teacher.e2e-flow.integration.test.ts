/**
 * Teacher portal — E2E API flow: login → bootstrap → attendance → marks.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';
import {
  TEST_AY_ID,
  TEST_BRANCH_ID,
  mockActiveAcademicYear,
  scopeQuery,
} from '../../helpers/integration';

const mockTeacherUser = createMockUser({
  id: 'teacher-u1',
  username: 'sarah.teacher',
  name: 'Ms. Sarah',
  role: 'teacher',
});

const mockTeacherProfile = {
  id: 'tp-1',
  userId: 'teacher-u1',
  employeeId: 'TCH-001',
  portalAccess: 'FULL',
  portalPermissions: null,
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

const mockEcsRow = {
  id: 'ecs1',
  totalMarks: 100,
  passingMarks: 40,
  isActive: true,
  subjectId: 'sub1',
  subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
  examClass: {
    classId: 'g1',
    class: { id: 'g1', name: 'Class 5', section: 'A' },
    exam: {
      id: 'exam1',
      name: 'Mid Term',
      status: 'DRAFT',
      teacherMarksEntry: true,
      startDate: new Date('2026-01-01'),
      endDate: null,
      examSessionId: 'sess1',
      examSession: { id: 'sess1', name: 'Term 1' },
      examType: { name: 'Written' },
    },
  },
  _count: { marksEntries: 0 },
};

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mockTeacherPortalReady() {
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
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
    id: mockTeacherUser.id,
    name: mockTeacherUser.name,
    email: mockTeacherUser.email,
    username: mockTeacherUser.username,
    role: 'teacher',
    status: 'active',
    profilePhotoId: null,
  });
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Teacher portal — E2E API flow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('login → bootstrap → mark attendance → enter marks', async () => {
    (prismaMock.user.findFirst as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'tp-1' })
      .mockResolvedValue(mockTeacherProfile);
    (prismaMock.branchMember.findFirst as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([
      { branchId: TEST_BRANCH_ID },
    ]);
    (prismaMock.user.update as jest.Mock).mockResolvedValue(mockTeacherUser);

    const loginRes = await request(app).post('/auth/login').send({
      identifier: 'sarah.teacher',
      password: 'password123',
      rememberMe: false,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    const auth = { Authorization: `Bearer ${loginRes.body.token}` };

    mockTeacherPortalReady();

    const bootstrapRes = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(auth);
    expect(bootstrapRes.status).toBe(200);
    expect(bootstrapRes.body.data.assignments).toHaveLength(1);
    expect(bootstrapRes.body.data.portal.canWrite).toBe(true);

    const today = todayDateString();
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({ id: 'g1' });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        name: 'Ali',
        rollNumber: '1',
        admissionNumber: 'ADM-1',
        attendances: [],
      },
    ]);

    const attendanceGet = await request(app)
      .get('/teacher/attendance')
      .query({ ...scopeQuery, groupId: 'g1', date: today })
      .set(auth);
    expect(attendanceGet.status).toBe(200);
    expect(attendanceGet.body.data.records).toHaveLength(1);

    (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
    const attendancePost = await request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(auth)
      .send({
        groupId: 'g1',
        date: today,
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(attendancePost.status).toBe(200);
    expect(attendancePost.body.data.saved).toBe(1);

    (prismaMock.examClassSubject.findMany as jest.Mock).mockResolvedValue([mockEcsRow]);
    (prismaMock.reportCard.count as jest.Mock).mockResolvedValue(0);

    const marksList = await request(app)
      .get('/teacher/marks/subjects')
      .query(scopeQuery)
      .set(auth);
    expect(marksList.status).toBe(200);
    expect(marksList.body.data[0].canWrite).toBe(true);

    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(mockEcsRow);
    (prismaMock.examClassSubject.findUnique as jest.Mock).mockResolvedValue({
      ...mockEcsRow,
      examClass: {
        ...mockEcsRow.examClass,
        exam: {
          id: 'exam1',
          name: 'Mid Term',
          status: 'DRAFT',
          teacherMarksEntry: true,
        },
      },
    });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        name: 'Ali',
        rollNumber: '1',
        admissionNumber: 'ADM-1',
        examMarks: [],
      },
    ]);

    const marksGrid = await request(app)
      .get('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(auth);
    expect(marksGrid.status).toBe(200);
    expect(marksGrid.body.data.canWrite).toBe(true);

    (prismaMock.marksEntry.upsert as jest.Mock).mockResolvedValue({});
    (prismaMock.examClassSubject.update as jest.Mock).mockResolvedValue(mockEcsRow);
    const marksPost = await request(app)
      .post('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(auth)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 88, isAbsent: false }],
      });
    expect(marksPost.status).toBe(200);
    expect(marksPost.body.success).toBe(true);
  });
});

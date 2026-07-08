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

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mockTeacherHappyPath() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
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
      {
        id: 's1',
        name: 'Ali',
        rollNumber: '1',
        admissionNumber: 'ADM-1',
        gender: 'male',
        attendances: [],
      },
    ]);
    (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([]);
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
        date: todayDateString(),
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/read-only/i);
  });

  test('POST /teacher/attendance/batch 400 when date is not today', async () => {
    mockPhaseB();
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }]);

    const res = await request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        groupId: 'g1',
        date: '2020-01-15',
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/today/i);
  });

  test('POST /teacher/attendance/batch 400 on Sunday', async () => {
    mockPhaseB();
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }]);

    const sunday = new Date();
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;

    const res = await request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        groupId: 'g1',
        date: sundayStr,
        records: [{ studentId: 's1', status: 'present' }],
      });

    if (sundayStr === new Date().toISOString().slice(0, 10)) {
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sunday/i);
    } else {
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/today/i);
    }
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
        date: todayDateString(),
        records: [{ studentId: 's1', status: 'present' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(1);
  });
});

describe('Teacher portal — Phase C (marks)', () => {
  beforeEach(() => jest.clearAllMocks());

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
    _count: { marksEntries: 2 },
  };

  const mockActiveEcsRow = {
    ...mockEcsRow,
    examClass: {
      ...mockEcsRow.examClass,
      exam: {
        ...mockEcsRow.examClass.exam,
        status: 'ACTIVE',
        teacherMarksEntry: false,
      },
    },
  };

  function mockPhaseC() {
    mockTeacherHappyPath();
    (prismaMock.examClassSubject.findMany as jest.Mock).mockResolvedValue([mockEcsRow]);
    (prismaMock.reportCard.count as jest.Mock).mockResolvedValue(0);
  }

  test('GET /teacher/marks/subjects 200', async () => {
    mockPhaseC();
    const res = await request(app)
      .get('/teacher/marks/subjects')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject.name).toBe('Mathematics');
    expect(res.body.data[0].canWrite).toBe(true);
  });

  test('GET /teacher/marks/grid/:id 403 for unassigned subject', async () => {
    mockTeacherHappyPath();
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue({
      ...mockEcsRow,
      subjectId: 'other-sub',
      subject: { id: 'other-sub', name: 'Science', code: 'SCI' },
    });

    const res = await request(app)
      .get('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
  });

  test('GET /teacher/marks/grid/:id 200 for assigned subject', async () => {
    mockPhaseC();
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(mockEcsRow);
    (prismaMock.examClassSubject.findUnique as jest.Mock).mockResolvedValue({
      ...mockEcsRow,
      examClass: {
        ...mockEcsRow.examClass,
        class: mockEcsRow.examClass.class,
        exam: { id: 'exam1', name: 'Mid Term', status: 'DRAFT', teacherMarksEntry: true },
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

    const res = await request(app)
      .get('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data.students).toHaveLength(1);
    expect(res.body.data.canWrite).toBe(true);
  });

  test('POST /teacher/marks/grid/:id 403 when AY archived', async () => {
    mockActiveAcademicYear({ status: 'ARCHIVED' });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .post('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 80, isAbsent: false }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/read-only/i);
  });

  test('GET /teacher/marks/subjects marks Active exams as not editable', async () => {
    mockPhaseC();
    (prismaMock.examClassSubject.findMany as jest.Mock).mockResolvedValue([mockActiveEcsRow]);

    const res = await request(app)
      .get('/teacher/marks/subjects')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data[0].canWrite).toBe(false);
    expect(res.body.data[0].restrictReason).toBe('EXAM_ACTIVE');
  });

  test('POST /teacher/marks/grid/:id 403 when exam is Active', async () => {
    mockPhaseC();
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(mockActiveEcsRow);

    const res = await request(app)
      .post('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 80, isAbsent: false }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/active/i);
  });

  test('POST /teacher/marks/grid/:id 403 when report cards published', async () => {
    mockPhaseC();
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(mockEcsRow);
    (prismaMock.reportCard.count as jest.Mock).mockResolvedValue(3);

    const res = await request(app)
      .post('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 80, isAbsent: false }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('POST /teacher/marks/grid/:id 403 when admin disabled teacher entry', async () => {
    mockPhaseC();
    const restrictedRow = {
      ...mockEcsRow,
      examClass: {
        ...mockEcsRow.examClass,
        exam: { ...mockEcsRow.examClass.exam, teacherMarksEntry: false },
      },
    };
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(restrictedRow);
    (prismaMock.reportCard.count as jest.Mock).mockResolvedValue(0);

    const res = await request(app)
      .post('/teacher/marks/grid/ecs1')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 80, isAbsent: false }],
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/disabled/i);
  });
});

describe('Teacher portal — Phase D', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/announcements 200 with school-wide items', async () => {
    mockTeacherHappyPath();
    (prismaMock.announcement.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'ann-1',
        title: 'Parent meeting',
        content: 'Saturday 10am',
        mediaUrl: null,
        isPinned: true,
        createdAt: new Date('2026-01-10'),
        senderId: 'admin-1',
        groupId: null,
        group: null,
      },
    ]);
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'admin-1', name: 'Principal', role: 'management' },
    ]);

    const res = await request(app)
      .get('/teacher/announcements')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('Parent meeting');
    expect(res.body.data[0].scope).toBe('school');
  });

  test('GET /teacher/bootstrap frozen portal returns empty assignments', async () => {
    mockActiveAcademicYear();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...mockTeacherProfile,
      portalAccess: 'FROZEN',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .get('/teacher/bootstrap')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(200);
    expect(res.body.data.portal.isFrozen).toBe(true);
    expect(res.body.data.portal.canWrite).toBe(false);
    expect(res.body.data.assignments).toHaveLength(0);
  });

  test('GET /teacher/timetable 403 when portal frozen', async () => {
    mockActiveAcademicYear();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...mockTeacherProfile,
      portalAccess: 'FROZEN',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

    const res = await request(app)
      .get('/teacher/timetable')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/frozen/i);
  });

  test('GET /teacher/bootstrap read-only when portal READ_ONLY', async () => {
    mockActiveAcademicYear();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...mockTeacherProfile,
      portalAccess: 'READ_ONLY',
    });
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
});

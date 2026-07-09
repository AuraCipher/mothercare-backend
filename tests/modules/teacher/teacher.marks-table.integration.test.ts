/**
 * Teacher portal — marks results table (read-only, filtered).
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

const mockMarksEntry = {
  id: 'me-1',
  marksObtained: 85,
  isAbsent: false,
  student: { id: 's1', name: 'Ali', rollNumber: '1' },
  examClassSubject: {
    id: 'ecs1',
    totalMarks: 100,
    passingMarks: 40,
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
    examClass: {
      class: { id: 'g1', name: 'Class 5', section: 'A' },
      exam: {
        id: 'exam1',
        name: 'Mid Term',
        examType: { id: 'et1', name: 'Written' },
        examSession: { id: 'sess1', name: 'Term 1' },
      },
    },
  },
};

describe('Teacher portal — marks results table', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/marks/table returns rows and filter options', async () => {
    mockTeacherBase();
    (prismaMock.marksEntry.findMany as jest.Mock).mockResolvedValue([mockMarksEntry]);

    const res = await request(app)
      .get('/teacher/marks/table')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].studentName).toBe('Ali');
    expect(res.body.data.rows[0].passed).toBe(true);
    expect(res.body.data.filters.sessions[0].name).toBe('Term 1');
    expect(res.body.data.filters.students[0].name).toBe('Ali');
  });

  test('GET /teacher/marks/table filters by studentId', async () => {
    mockTeacherBase();
    (prismaMock.marksEntry.findMany as jest.Mock).mockResolvedValue([
      mockMarksEntry,
      {
        ...mockMarksEntry,
        id: 'me-2',
        student: { id: 's2', name: 'Sara', rollNumber: '2' },
      },
    ]);

    const res = await request(app)
      .get('/teacher/marks/table')
      .set(teacherToken)
      .query({ ...scopeQuery, studentId: 's2' });

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].studentName).toBe('Sara');
  });
});

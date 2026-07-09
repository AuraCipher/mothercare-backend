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

function mockTeacherContext() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'teacher-u1',
    name: 'Ms. Sarah',
    username: 'sarah',
    role: 'teacher',
    status: 'active',
    profilePhotoId: null,
  });
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'tp-1',
    userId: 'teacher-u1',
    portalAccess: 'FULL',
    canViewParentContact: false,
    hodParentContactScope: 'ASSIGNED_ONLY',
  });
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
    id: 'bm-1',
    branchId: TEST_BRANCH_ID,
    userId: 'teacher-u1',
    role: 'teacher',
    isActive: true,
  });
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'a1',
      academicYearId: TEST_AY_ID,
      groupId: 'g1',
      subjectId: 'sub1',
      isClassTeacher: true,
      role: 'primary',
      group: { id: 'g1', name: 'Class 5', section: 'A' },
      subject: { id: 'sub1', name: 'Math', code: 'MATH' },
    },
  ]);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Teacher portal — cross-tenant security integration', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects mismatched branchId/academicYearId combinations', async () => {
    mockTeacherContext();
    const res = await request(app)
      .get('/teacher/bootstrap')
      .set(teacherToken)
      .query({ academicYearId: TEST_AY_ID, branchId: 'other-branch' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/branch/i);
  });

  test('blocks class-students access when groupId is outside teacher assignments', async () => {
    mockTeacherContext();
    const res = await request(app)
      .get('/teacher/classes/foreign-group/students')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(403);
  });

  test('blocks marks grid writes when examClassSubject belongs to unassigned subject', async () => {
    mockTeacherContext();
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue({
      id: 'ecs-1',
      subjectId: 'other-subject',
      examClass: {
        classId: 'g1',
        exam: {
          id: 'exam-1',
          name: 'Mid',
          status: 'DRAFT',
          teacherMarksEntry: true,
          examType: { name: 'Written' },
          examSession: { id: 'sess', name: 'Term 1' },
        },
        class: { id: 'g1', name: 'Class 5', section: 'A' },
      },
      subject: { id: 'other-subject', name: 'Science', code: 'SCI' },
      totalMarks: 100,
      passingMarks: 40,
      isActive: true,
    });

    const res = await request(app)
      .post('/teacher/marks/grid/ecs-1')
      .set(teacherToken)
      .query(scopeQuery)
      .send({
        totalMarks: 100,
        entries: [{ studentId: 's1', marksObtained: 88, isAbsent: false }],
      });

    expect(res.status).toBe(403);
  });
});

/**
 * Student portal — security integration (scope spoofing, isolation, announcements scope).
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { TEST_AY_ID, TEST_BRANCH_ID, scopeQuery } from '../../helpers/integration';
import {
  STUDENT_GROUP_ID,
  mockStudentPortalReady,
  mockStudentReadRoutes,
  mockStudentUser,
  studentToken,
} from './student.helpers';

describe('Student portal — security', () => {
  beforeEach(() => jest.clearAllMocks());

  test('403 when academicYearId does not match student enrollment', async () => {
    mockStudentPortalReady();
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query({ ...scopeQuery, academicYearId: 'other-ay-id' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not enrolled/i);
  });

  test('400 when branchId does not match academic year branch', async () => {
    mockStudentPortalReady();

    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query({ academicYearId: TEST_AY_ID, branchId: 'wrong-branch' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/i);
  });

  test('403 when user account is inactive', async () => {
    mockStudentPortalReady();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockStudentUser,
      status: 'inactive',
    });

    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not active/i);
  });

  test('403 when DB role changed from student to teacher', async () => {
    mockStudentPortalReady();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockStudentUser,
      role: 'teacher',
    });

    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(403);
  });

  test('GET /student/announcements scopes to school-wide and student class only', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    (prismaMock.announcement.findMany as jest.Mock).mockResolvedValue([]);

    await request(app)
      .get('/student/announcements')
      .set(studentToken)
      .query(scopeQuery);

    expect(prismaMock.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicYearId: TEST_AY_ID,
          OR: [{ groupId: null }, { groupId: STUDENT_GROUP_ID }],
        },
      }),
    );
  });

  test('GET /student/results/table returns empty when no published report cards', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    (prismaMock.reportCard.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get('/student/results/table')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(0);
    expect(prismaMock.marksEntry.findMany).not.toHaveBeenCalled();
  });

  test('studentFee query always uses ctx.studentId not query param', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();

    await request(app)
      .get('/student/fees')
      .set(studentToken)
      .query({ ...scopeQuery, studentId: 'other-student-id' });

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: 'stu-1' }),
      }),
    );
    expect(prismaMock.studentFee.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: 'other-student-id' }),
      }),
    );
  });

  test('enrollment resolved by userId from JWT not client-supplied student id', async () => {
    mockStudentPortalReady();

    await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query({ ...scopeQuery, studentId: 'hijacked-id' });

    expect(prismaMock.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'student-u1' }),
      }),
    );
  });
});

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { scopeQuery } from '../../helpers/integration';
import {
  mockStudentPortalReady,
  mockStudentReadRoutes,
  studentToken,
} from './student.helpers';

describe('Student portal — cross-tenant security integration', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects branch override that does not match enrollment academic year branch', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .get('/student/profile')
      .set(studentToken)
      .query({ ...scopeQuery, branchId: 'other-branch' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/i);
  });

  test('ignores client supplied studentId on fees endpoint', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();

    await request(app)
      .get('/student/fees')
      .set(studentToken)
      .query({ ...scopeQuery, studentId: 'foreign-student-id' });

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: 'stu-1' }),
      }),
    );
  });

  test('returns 403 when requesting non-enrolled academic year on timetable', async () => {
    mockStudentPortalReady();
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .get('/student/timetable')
      .set(studentToken)
      .query({ ...scopeQuery, academicYearId: 'unknown-ay' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not enrolled/i);
  });
});

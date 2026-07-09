/**
 * Student portal — integration tests (auth, routes, read-only).
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { TEST_AY_ID, TEST_BRANCH_ID, scopeQuery } from '../../helpers/integration';
import {
  adminToken,
  mockStudentPortalReady,
  mockStudentReadRoutes,
  mockStudentRecord,
  mockStudentUser,
  studentToken,
  teacherToken,
} from './student.helpers';

describe('Student portal — integration', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /student/bootstrap 401 without token', async () => {
    const res = await request(app).get('/student/bootstrap').query(scopeQuery);
    expect(res.status).toBe(401);
  });

  test('GET /student/bootstrap 403 for teacher role', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockStudentUser,
      id: 'teacher-u1',
      role: 'teacher',
    });
    const res = await request(app)
      .get('/student/bootstrap')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/student portal/i);
  });

  test('GET /student/bootstrap 403 for management role', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockStudentUser,
      id: 'admin-1',
      role: 'management',
    });
    const res = await request(app)
      .get('/student/bootstrap')
      .query(scopeQuery)
      .set(adminToken);
    expect(res.status).toBe(403);
  });

  test('GET /student/bootstrap returns student context and feature flags', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.student.id).toBe(mockStudentRecord.id);
    expect(res.body.data.branch.id).toBe(TEST_BRANCH_ID);
    expect(res.body.data.features.showCanteen).toBe(false);
  });

  test('GET /student/bootstrap showCanteen when account has activity', async () => {
    mockStudentPortalReady({ showCanteen: true });
    const res = await request(app)
      .get('/student/bootstrap')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.features.showCanteen).toBe(true);
  });

  test('GET /student/profile returns read-only profile', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/profile')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Ali Student');
    expect(res.body.data.group.label).toBe('Class 5 — A');
    expect(prismaMock.student.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: mockStudentRecord.id } }),
    );
  });

  test('GET /student/fees scopes to enrolled student', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/fees')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.months).toHaveLength(1);
    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: mockStudentRecord.id, academicYearId: TEST_AY_ID },
      }),
    );
  });

  test('GET /student/attendance returns summary', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/attendance')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBe(2);
    expect(res.body.data.summary.present).toBe(1);
    expect(prismaMock.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: mockStudentRecord.id }),
      }),
    );
  });

  test('GET /student/results/table returns published marks only', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/results/table')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].subjectName).toBe('Mathematics');
    expect(prismaMock.reportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: mockStudentRecord.id, status: 'PUBLISHED' },
      }),
    );
    expect(prismaMock.marksEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: mockStudentRecord.id }),
      }),
    );
  });

  test('GET /student/timetable returns class schedule', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/timetable')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.slots).toHaveLength(1);
    expect(res.body.data.slots[0].subject.name).toBe('Mathematics');
  });

  test('GET /student/datesheets returns active datesheets', async () => {
    mockStudentPortalReady();
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/datesheets')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Mid Term Datesheet');
    expect(prismaMock.timetable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { academicYearId: TEST_AY_ID, type: 'datesheet', isActive: true },
      }),
    );
  });

  test('GET /student/canteen returns account when present', async () => {
    mockStudentPortalReady({ showCanteen: true });
    mockStudentReadRoutes();
    const res = await request(app)
      .get('/student/canteen')
      .set(studentToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.runningBalance).toBe(150);
  });

  test('POST /student/fees returns 405 read-only', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .post('/student/fees')
      .set(studentToken)
      .query(scopeQuery)
      .send({ amount: 100 });
    expect(res.status).toBe(405);
  });

  test('PATCH /student/announcements returns 405 read-only', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .patch('/student/announcements/ann-1')
      .set(studentToken)
      .query(scopeQuery)
      .send({ title: 'Hack' });
    expect(res.status).toBe(405);
  });

  test('GET /admin/students 403 for student token', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockStudentUser);
    const res = await request(app)
      .get('/admin/students')
      .set(studentToken)
      .query(scopeQuery);
    expect(res.status).toBe(403);
  });
});

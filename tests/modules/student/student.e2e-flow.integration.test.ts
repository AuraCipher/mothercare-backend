/**
 * Student portal — E2E API flow: login → bootstrap → fees → attendance → results → timetable → announcements.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';
import { scopeQuery } from '../../helpers/integration';
import {
  STUDENT_RECORD_ID,
  STUDENT_USER_ID,
  mockStudentPortalReady,
  mockStudentReadRoutes,
  mockStudentRecord,
} from './student.helpers';

const mockLoginUser = {
  ...createMockUser({ username: 'ali.student', name: 'Ali Student' }),
  id: STUDENT_USER_ID,
  role: 'student' as const,
};

describe('Student portal — E2E API flow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('login → bootstrap → fees → attendance → results → timetable → datesheets → announcements → profile', async () => {
    (prismaMock.user.findFirst as jest.Mock).mockResolvedValue(mockLoginUser);
    (prismaMock.student.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: STUDENT_RECORD_ID })
      .mockResolvedValue(mockStudentRecord);
    (prismaMock.user.update as jest.Mock).mockResolvedValue(mockLoginUser);
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([]);

    const loginRes = await request(app).post('/auth/login').send({
      identifier: 'ali.student',
      password: 'password123',
      rememberMe: false,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.role).toBe('student');
    const auth = { Authorization: `Bearer ${loginRes.body.token}` };

    mockStudentPortalReady();
    mockStudentReadRoutes();

    const bootstrapRes = await request(app)
      .get('/student/bootstrap')
      .query(scopeQuery)
      .set(auth);
    expect(bootstrapRes.status).toBe(200);
    expect(bootstrapRes.body.data.student.rollNumber).toBe('12');

    const feesRes = await request(app).get('/student/fees').query(scopeQuery).set(auth);
    expect(feesRes.status).toBe(200);
    expect(feesRes.body.data.summary.unpaidCount).toBe(1);

    const attendanceRes = await request(app)
      .get('/student/attendance')
      .query(scopeQuery)
      .set(auth);
    expect(attendanceRes.status).toBe(200);
    expect(attendanceRes.body.data.summary.absent).toBe(1);

    const resultsRes = await request(app)
      .get('/student/results/table')
      .query(scopeQuery)
      .set(auth);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.data.rows[0].marksObtained).toBe(88);

    const timetableRes = await request(app)
      .get('/student/timetable')
      .query(scopeQuery)
      .set(auth);
    expect(timetableRes.status).toBe(200);
    expect(timetableRes.body.data.timetableName).toBe('Regular Timetable');

    const datesheetsRes = await request(app)
      .get('/student/datesheets')
      .query(scopeQuery)
      .set(auth);
    expect(datesheetsRes.status).toBe(200);
    expect(datesheetsRes.body.data[0].entries).toHaveLength(1);

    const announcementsRes = await request(app)
      .get('/student/announcements')
      .query(scopeQuery)
      .set(auth);
    expect(announcementsRes.status).toBe(200);
    expect(announcementsRes.body.data[0].scope).toBe('school');

    const profileRes = await request(app)
      .get('/student/profile')
      .query(scopeQuery)
      .set(auth);
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.data.rollNumber).toBe('12');

    const writeRes = await request(app)
      .put('/student/profile')
      .query(scopeQuery)
      .set(auth)
      .send({ name: 'Hacked' });
    expect(writeRes.status).toBe(405);
  });
});

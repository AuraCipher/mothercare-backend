/**
 * Student portal — route matrix (all read endpoints return 200 when enrolled).
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { scopeQuery } from '../../helpers/integration';
import {
  mockStudentPortalReady,
  mockStudentReadRoutes,
  mockStudentUser,
  studentToken,
} from './student.helpers';

type ReadRoute =
  | 'bootstrap'
  | 'profile'
  | 'fees'
  | 'attendance'
  | 'results'
  | 'timetable'
  | 'datesheets'
  | 'announcements'
  | 'canteen';

const READ_ROUTES: ReadRoute[] = [
  'bootstrap',
  'profile',
  'fees',
  'attendance',
  'results',
  'timetable',
  'datesheets',
  'announcements',
  'canteen',
];

function callReadRoute(route: ReadRoute) {
  switch (route) {
    case 'bootstrap':
      return request(app).get('/student/bootstrap').query(scopeQuery).set(studentToken);
    case 'profile':
      return request(app).get('/student/profile').query(scopeQuery).set(studentToken);
    case 'fees':
      return request(app).get('/student/fees').query(scopeQuery).set(studentToken);
    case 'attendance':
      return request(app).get('/student/attendance').query(scopeQuery).set(studentToken);
    case 'results':
      return request(app).get('/student/results/table').query(scopeQuery).set(studentToken);
    case 'timetable':
      return request(app).get('/student/timetable').query(scopeQuery).set(studentToken);
    case 'datesheets':
      return request(app).get('/student/datesheets').query(scopeQuery).set(studentToken);
    case 'announcements':
      return request(app).get('/student/announcements').query(scopeQuery).set(studentToken);
    case 'canteen':
      return request(app).get('/student/canteen').query(scopeQuery).set(studentToken);
    default:
      throw new Error(`Unknown route ${route}`);
  }
}

describe('Student portal — route matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStudentPortalReady({ showCanteen: true });
    mockStudentReadRoutes();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockStudentUser);
  });

  test.each(READ_ROUTES)('GET /student/%s returns 200 for enrolled student', async (route) => {
    const res = await callReadRoute(route);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test.each(['post', 'put', 'patch', 'delete'] as const)(
    '%s /student/fees returns 405',
    async (method) => {
      const res = await request(app)[method]('/student/fees')
        .query(scopeQuery)
        .set(studentToken)
        .send({ amount: 1 });
      expect(res.status).toBe(405);
    },
  );
});

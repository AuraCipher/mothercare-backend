/**
 * Auth Middleware Tests
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../mocks/prisma';
import request from 'supertest';
import app from '../../src/app';
import { generateTestToken, getAuthHeader } from '../helpers/auth';
import { mockActiveAcademicYear, scopeQuery } from '../helpers/integration';

jest.mock('../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({
      isRestricted: false,
      isFullAdmin: false,
      permissions: [{ module: 'ATTENDANCE', actions: ['read', 'write'] }],
    }),
  },
}));

describe('Auth enforcement — Attendance routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveAcademicYear();
  });

  test('GET /admin/attendance returns 401 without token', async () => {
    const res = await request(app).get('/admin/attendance?date=2026-06-24');
    expect(res.status).toBe(401);
  });

  test('GET /admin/attendance returns 403 for teacher role', async () => {
    const token = getAuthHeader(generateTestToken('t1', 'teacher'));
    const res = await request(app).get('/admin/attendance').query({ ...scopeQuery, date: '2026-06-24' }).set(token);
    expect(res.status).toBe(403);
  });

  test('GET /admin/attendance allows management role', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    (prismaMock.academicYear.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) => {
      return Promise.resolve({ id, branchId: 'b1' } as any);
    });
    const token = getAuthHeader(generateTestToken('m1', 'management'));
    const res = await request(app).get('/admin/attendance').query({ ...scopeQuery, date: '2026-06-24' }).set(token);
    expect(res.status).toBe(200);
  });

  test('POST /admin/attendance/batch returns 401 without token', async () => {
    const res = await request(app).post('/admin/attendance/batch').send({ date: '2026-06-24', groupId: 'g1', records: [] });
    expect(res.status).toBe(401);
  });

  test('GET /admin/attendance/teachers returns 401 without token', async () => {
    const res = await request(app).get('/admin/attendance/teachers?date=2026-06-24');
    expect(res.status).toBe(401);
  });

  test('PUT /admin/students/:id/status returns 401 without token', async () => {
    const res = await request(app).put('/admin/students/s1/status').send({ status: 'ACTIVE' });
    expect(res.status).toBe(401);
  });

  test('DELETE /admin/students/:id returns 401 without token', async () => {
    const res = await request(app).delete('/admin/students/s1');
    expect(res.status).toBe(401);
  });
});

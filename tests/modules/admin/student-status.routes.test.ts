/**
 * Student Status Management Tests
 *
 * Tests PUT /students/:id/status, GET /students/:id/status-logs, DELETE /students/:id
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));

describe('PUT /admin/students/:id/status — Update student status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('changes status and logs it via transaction', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', isActive: true } as any);
    (prismaMock.$transaction as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 'log1' }]);
    const res = await request(app).put('/admin/students/s1/status').set(adminToken).send({ status: 'SUSPENDED' });
    expect(res.status).toBe(200);
  });

  test('returns 400 for invalid status', async () => {
    const res = await request(app).put('/admin/students/s1/status').set(adminToken).send({ status: 'INVALID' });
    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown student', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null);
    const res = await request(app).put('/admin/students/s1/status').set(adminToken).send({ status: 'SUSPENDED' });
    expect(res.status).toBe(404);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).put('/admin/students/s1/status').send({ status: 'SUSPENDED' });
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/students/:id/status-logs — Status history', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns logs in descending order', async () => {
    prismaMock.studentStatusLog.findMany.mockResolvedValue([
      { id: 'log2', previousStatus: 'SUSPENDED', newStatus: 'ACTIVE', reason: null, createdAt: new Date(), changedById: null, studentId: 's1' },
      { id: 'log1', previousStatus: 'ACTIVE', newStatus: 'SUSPENDED', reason: 'Test', createdAt: new Date(), changedById: null, studentId: 's1' },
    ] as any);
    const res = await request(app).get('/admin/students/s1/status-logs').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('returns empty array when no logs exist', async () => {
    prismaMock.studentStatusLog.findMany.mockResolvedValue([]);
    const res = await request(app).get('/admin/students/s1/status-logs').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('includes changedBy name', async () => {
    prismaMock.studentStatusLog.findMany.mockResolvedValue([
      { id: 'log1', previousStatus: 'ACTIVE', newStatus: 'SUSPENDED', reason: null, createdAt: new Date(), changedById: null, changedBy: { id: 'u1', name: 'Admin' }, studentId: 's1' },
    ] as any);
    const res = await request(app).get('/admin/students/s1/status-logs').set(adminToken);
    expect(res.body.data[0].changedBy.name).toBe('Admin');
  });
});

describe('DELETE /admin/students/:id — Delete student', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes student and cascades related records', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's1', name: 'Test Student' } as any);
    (prismaMock.attendance.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });
    (prismaMock.credentialSend.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prismaMock.studentStatusLog.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prismaMock.student.delete as jest.Mock).mockResolvedValue({ id: 's1', name: 'Test Student' });
    const res = await request(app).delete('/admin/students/s1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 for unknown student', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/admin/students/s1').set(adminToken);
    expect(res.status).toBe(404);
  });
});

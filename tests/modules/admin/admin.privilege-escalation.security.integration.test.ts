import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { scopeQuery } from '../../helpers/integration';

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    branchIds: [scopeQuery.branchId],
  }),
);

const studentToken = getAuthHeader(
  generateTestToken('student-u1', 'student', {
    branchIds: [],
  }),
);

const adminToken = getAuthHeader(
  generateTestToken('admin-u1', 'super_admin', {
    branchIds: [scopeQuery.branchId],
  }),
);

describe('Admin API — privilege escalation security integration', () => {
  test('teacher cannot read staff admin endpoint', async () => {
    const res = await request(app)
      .get('/admin/staff')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(403);
  });

  test('student cannot hit admin-sensitive credential endpoint', async () => {
    const res = await request(app)
      .post('/admin/staff/some-user-id/set-password')
      .query(scopeQuery)
      .set(studentToken)
      .send({ newPassword: 'TempPass@123', adminPassword: 'Admin@123' });

    expect(res.status).toBe(403);
  });

  test('super admin reaches protected endpoint while non-admin roles are blocked', async () => {
    const adminRes = await request(app)
      .get('/admin/staff')
      .query(scopeQuery)
      .set(adminToken);

    expect(adminRes.status).not.toBe(401);
    expect(adminRes.status).not.toBe(403);
  });
});

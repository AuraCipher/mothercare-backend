import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';

describe('Auth lifecycle — e2e flow integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([]);
  });

  test('login -> me -> refresh keeps identity and returns rotated token', async () => {
    const user = createMockUser({
      id: 'mgmt-u1',
      role: 'management',
      username: 'ops_manager',
      name: 'Ops Manager',
      status: 'active',
    });

    (prismaMock.user.findFirst as jest.Mock).mockResolvedValue(user);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      managementPerms: ['students.read'],
      gender: null,
      dateOfBirth: null,
      address: null,
      profilePhoto: null,
      profilePhotoId: null,
      lastLoginAt: null,
      lastSeen: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      schoolId: null,
    } as any);
    (prismaMock.user.update as jest.Mock).mockResolvedValue(user);
    (prismaMock.branchMember.findMany as jest.Mock)
      .mockResolvedValueOnce([{ branchId: 'b1' }])
      .mockResolvedValueOnce([{ branchId: 'b1' }])
      .mockResolvedValueOnce([{ branchId: 'b1' }, { branchId: 'b2' }]);

    const loginRes = await request(app).post('/auth/login').send({
      identifier: 'ops_manager',
      password: 'password123',
      rememberMe: false,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.token).toBeDefined();

    const meRes = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.id).toBe('mgmt-u1');
    expect(meRes.body.user.branchIds).toEqual(['b1']);

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.token).toBeDefined();
    expect(refreshRes.body.token).not.toEqual(loginRes.body.token);
    expect(refreshRes.body.user.branchIds).toEqual(['b1', 'b2']);
  });

  test('student login denied when no active enrollment exists', async () => {
    const student = createMockUser({
      id: 'stu-u1',
      role: 'student' as any,
      username: 'student.noactive',
      status: 'active',
    });

    (prismaMock.user.findFirst as jest.Mock).mockResolvedValue(student);
    (prismaMock.student.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const res = await request(app).post('/auth/login').send({
      identifier: 'student.noactive',
      password: 'password123',
      rememberMe: false,
    });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not enrolled/i);
  });
});

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';
import { generateTestToken } from '../../helpers/auth';

describe('Auth security integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([]);
  });

  test('refresh rejects inactive account even with valid JWT', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'teacher-u1',
      role: 'teacher',
      status: 'inactive',
    } as any);

    const token = generateTestToken('teacher-u1', 'teacher', { branchIds: ['b1'] });
    const res = await request(app)
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/inactive/i);
  });

  test('refresh rejects teacher token when teacher profile is missing', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'teacher-u1',
      role: 'teacher',
      name: 'Teacher A',
      username: 'teacherA',
      email: null,
      phone: null,
      status: 'active',
      schoolId: null,
    } as any);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(null);

    const token = generateTestToken('teacher-u1', 'teacher', { branchIds: ['b1'] });
    const res = await request(app)
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/teacher profile/i);
  });

  test('teacher login rejects user without active teacher branch membership', async () => {
    const user = createMockUser({
      id: 'teacher-u2',
      role: 'teacher',
      username: 'teacher_nomember',
      status: 'active',
    });
    (prismaMock.user.findFirst as jest.Mock).mockResolvedValue(user);
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'tp-2',
      userId: 'teacher-u2',
    } as any);
    (prismaMock.branchMember.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post('/auth/login').send({
      identifier: 'teacher_nomember',
      password: 'password123',
      rememberMe: false,
    });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/membership/i);
  });

  test('logout clears remember-me token state and token cookie', async () => {
    const user = createMockUser({
      id: 'admin-u1',
      role: 'super_admin',
      status: 'active',
    });
    (prismaMock.user.update as jest.Mock).mockResolvedValue(user);

    const token = generateTestToken('admin-u1', 'super_admin');
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-u1' },
      data: { rememberMeToken: null, rememberMeExpiry: null },
    });
    const setCookie = String(res.headers['set-cookie'] || '');
    expect(setCookie).toMatch(/token=;/i);
  });
});

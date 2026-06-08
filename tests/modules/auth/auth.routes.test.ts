/**
 * Auth Routes Integration Tests
 *
 * Tests the auth HTTP endpoints (login, me, logout, unimplemented)
 * using supertest against the real Express app with mocked Prisma.
 */

// IMPORTANT: prisma mock must be imported first so that jest.mock('@prisma/client')
// is hoisted and registered before any source module loads @prisma/client.
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';
import type { MockUser } from '../../helpers/factories';
import {
  generateTestToken,
  generateExpiredToken,
  generateTokenWithWrongSecret,
  getAuthHeader,
} from '../../helpers/auth';

// ─── POST /auth/login ──────────────────────────────────────

describe('POST /auth/login', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
    prismaMock.branchMember.findMany.mockResolvedValue([]);
  });

  test('returns 200 with token for valid credentials', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/auth/login')
      .send({
        identifier: mockUser.username,
        password: 'password123',
        rememberMe: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.id).toBe(mockUser.id);
    expect(res.body.user.name).toBe(mockUser.name);
    expect(res.body.rememberMeToken).toBeNull();
  });

  test('returns 422 when identifier is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'password123' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toBeDefined();
    expect(
      res.body.errors.some((e: any) => e.field === 'identifier'),
    ).toBe(true);
  });

  test('returns 422 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'testuser' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation failed');
    expect(
      res.body.errors.some((e: any) => e.field === 'password'),
    ).toBe(true);
  });

  test('returns 401 for wrong password', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/auth/login')
      .send({
        identifier: mockUser.username,
        password: 'wrong-password',
        rememberMe: false,
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid credentials');
  });
});

// ─── GET /auth/me ───────────────────────────────────────────

describe('GET /auth/me', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  test('returns 200 with user data for valid JWT', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: mockUser.id,
      name: mockUser.name,
      username: mockUser.username,
      email: mockUser.email,
      phone: mockUser.phone,
      role: mockUser.role,
      gender: mockUser.gender,
      dateOfBirth: mockUser.dateOfBirth,
      address: mockUser.address,
      profilePhoto: mockUser.profilePhoto,
      status: mockUser.status,
      managementPerms: mockUser.managementPerms,
      lastLoginAt: mockUser.lastLoginAt,
      lastSeen: mockUser.lastSeen,
      createdAt: mockUser.createdAt,
      updatedAt: mockUser.updatedAt,
    } as any);

    const token = generateTestToken(mockUser.id, 'super_admin', {
      name: mockUser.name,
    });
    const res = await request(app)
      .get('/auth/me')
      .set(getAuthHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.id).toBe(mockUser.id);
    expect(res.body.user.name).toBe(mockUser.name);
    expect(res.body.user.role).toBe('super_admin');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('returns 401 for expired token', async () => {
    const token = generateExpiredToken(mockUser.id);
    const res = await request(app)
      .get('/auth/me')
      .set(getAuthHeader(token));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Token expired');
  });

  test('returns 401 for token signed with wrong secret', async () => {
    const token = generateTokenWithWrongSecret(mockUser.id);
    const res = await request(app)
      .get('/auth/me')
      .set(getAuthHeader(token));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /auth/logout ─────────────────────────────────────

describe('POST /auth/logout', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  test('returns 200 for authenticated request', async () => {
    prismaMock.user.update.mockResolvedValue(mockUser);

    const token = generateTestToken(mockUser.id);
    const res = await request(app)
      .post('/auth/logout')
      .set(getAuthHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Logged out successfully');
  });

  test('returns 401 without token', async () => {
    const res = await request(app).post('/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── Unimplemented endpoints ──────────────────────────────

describe('Unimplemented endpoints (501)', () => {
  test('POST /auth/forgot-password returns 501', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ phone: '+923001234567' });

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Not implemented');
  });

  test('POST /auth/verify-otp returns 501', async () => {
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ phone: '+923001234567', otp: '123456' });

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Not implemented');
  });

  test('POST /auth/reset-password returns 501', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({
        resetToken: 'valid-reset-token-12345',
        newPassword: 'NewPass123',
      });

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Not implemented');
  });
});

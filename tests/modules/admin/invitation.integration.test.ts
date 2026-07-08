/**
 * Admin Invitation Routes — Integration Tests
 *
 * Covers public token validation/complete and protected create/list endpoints.
 * Uses supertest against the real Express app with mocked Prisma.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import {
  generateTestToken,
  generateExpiredToken,
  generateTokenWithWrongSecret,
  getAuthHeader,
} from '../../helpers/auth';

// ─── Shared fixtures ────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const managementToken = getAuthHeader(generateTestToken('mgmt-1', 'management'));
const teacherToken = getAuthHeader(generateTestToken('teacher-1', 'teacher'));
const parentToken = getAuthHeader(generateTestToken('parent-1', 'parent'));

const PENDING_TOKEN = 'tok-pending-abc123';
const EXPIRED_TOKEN = 'tok-expired-def456';
const USED_TOKEN = 'tok-used-ghi789';
const INVALID_TOKEN = 'tok-does-not-exist';

function makeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    email: 'branch.admin@school.test',
    name: null,
    phone: null,
    branchId: 'branch-1',
    token: PENDING_TOKEN,
    usedAt: null,
    expiresAt: FUTURE,
    createdAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
    createdById: 'admin-1',
    updatedById: null,
    ...overrides,
  };
}

function mockPendingInvitation(token = PENDING_TOKEN, email = 'branch.admin@school.test') {
  prismaMock.adminInvitation.findUnique.mockResolvedValue(
    makeInvitation({ token, email }) as any,
  );
  prismaMock.branch.findUnique.mockResolvedValue({
    id: 'branch-1',
    name: 'Main Campus',
    code: 'MAIN',
  } as any);
}

function mockCompleteTransaction(userOverrides: Record<string, unknown> = {}) {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.user.create.mockResolvedValue({
    id: 'user-new-1',
    name: 'Branch Admin',
    username: 'branchadmin',
    email: 'branch.admin@school.test',
    role: 'management',
    ...userOverrides,
  } as any);
  prismaMock.adminInvitation.update.mockResolvedValue({} as any);
  prismaMock.branchMember.create.mockResolvedValue({} as any);
}

const completePayload = {
  name: 'Branch Admin',
  username: 'branchadmin',
  password: 'securepass',
  phone: '03001234567',
};

// ═══════════════════════════════════════════════════════════════════
// GET /admin/invitations/:token  (public)
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/invitations/:token', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does not require authentication', async () => {
    mockPendingInvitation();
    const res = await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test.each([
    ['nonexistent-token'],
    ['bad-token-1'],
    ['bad-token-2'],
    ['xxxxxxxx'],
    ['12345'],
    ['null'],
    ['undefined'],
  ])('returns 404 for invalid token %s', async (token) => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/admin/invitations/${token}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid invitation token/i);
  });

  test.each([
    ['pending', PENDING_TOKEN, null, FUTURE, 200],
    ['expired', EXPIRED_TOKEN, null, PAST, 400],
    ['used', USED_TOKEN, new Date('2026-06-01'), FUTURE, 400],
  ] as const)(
    'token state %s returns expected HTTP status',
    async (_label, token, usedAt, expiresAt, expectedStatus) => {
      prismaMock.adminInvitation.findUnique.mockResolvedValue(
        makeInvitation({ token, usedAt, expiresAt }) as any,
      );
      if (expectedStatus === 200) {
        prismaMock.branch.findUnique.mockResolvedValue({
          id: 'branch-1', name: 'Main Campus', code: 'MAIN',
        } as any);
      }
      const res = await request(app).get(`/admin/invitations/${token}`);
      expect(res.status).toBe(expectedStatus);
    },
  );

  test.each([
    ['Main Campus', 'MAIN'],
    ['North Branch', 'NORTH'],
    ['South Branch', 'SOUTH'],
    ['East Wing', 'EAST'],
    ['West Campus', 'WEST'],
  ])('returns branch name %s and code %s', async (branchName, branchCode) => {
    mockPendingInvitation();
    prismaMock.branch.findUnique.mockResolvedValue({
      id: 'branch-1', name: branchName, code: branchCode,
    } as any);
    const res = await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.branchName).toBe(branchName);
    expect(res.body.data.branchCode).toBe(branchCode);
  });

  test.each([
    ['admin1@school.test'],
    ['admin2@school.test'],
    ['new.admin@campus.edu'],
    ['invite.user@example.com'],
  ])('returns invitation email %s', async (email) => {
    mockPendingInvitation(PENDING_TOKEN, email);
    const res = await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
  });

  test('returns branchId in response data', async () => {
    mockPendingInvitation();
    const res = await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(res.body.data.branchId).toBe('branch-1');
  });

  test('queries adminInvitation by token', async () => {
    mockPendingInvitation();
    await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(prismaMock.adminInvitation.findUnique).toHaveBeenCalledWith({
      where: { token: PENDING_TOKEN },
    });
  });

  test('queries branch for invitation branchId', async () => {
    mockPendingInvitation();
    await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(prismaMock.branch.findUnique).toHaveBeenCalledWith({
      where: { id: 'branch-1' },
      select: { name: true, code: true },
    });
  });

  test.each([
    ['html=1', '1', 'text/html'],
    ['html=true ignored', 'true', 'application/json'],
    ['no html param', undefined, 'application/json'],
  ])('query %s sets content type', async (_label, htmlVal, expectedType) => {
    mockPendingInvitation();
    const req = request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    if (htmlVal !== undefined) req.query({ html: htmlVal });
    const res = await req;
    if (expectedType === 'text/html') {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/register-admin/);
    } else {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  test('expired token message mentions expired', async () => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(
      makeInvitation({ token: EXPIRED_TOKEN, expiresAt: PAST }) as any,
    );
    const res = await request(app).get(`/admin/invitations/${EXPIRED_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  test('used token message mentions already been used', async () => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(
      makeInvitation({ token: USED_TOKEN, usedAt: new Date() }) as any,
    );
    const res = await request(app).get(`/admin/invitations/${USED_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });

  test('falls back to Unknown branch name when branch missing', async () => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(makeInvitation() as any);
    prismaMock.branch.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/admin/invitations/${PENDING_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.branchName).toBe('Unknown');
    expect(res.body.data.branchCode).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /admin/invitations/:token/complete  (public)
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/invitations/:token/complete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingInvitation();
    mockCompleteTransaction();
  });

  test.each([
    [{ username: 'u', password: 'pass123' }, 'name'],
    [{ name: 'Admin', password: 'pass123' }, 'username'],
    [{ name: 'Admin', username: 'u' }, 'password'],
    [{ password: 'pass123' }, 'name and username'],
    [{ username: 'u' }, 'name and password'],
    [{ name: 'Admin' }, 'username and password'],
    [{}, 'all required fields'],
    [{ name: '', username: 'u', password: 'pass123' }, 'empty name'],
  ])(
    'returns 400 when missing %s (%s)',
    async (body, _label) => {
      const res = await request(app)
        .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/name, username, and password are required/i);
    },
  );

  test.each([
    ['pending', PENDING_TOKEN, null, FUTURE, 201],
    ['expired', EXPIRED_TOKEN, null, PAST, 400],
    ['used', USED_TOKEN, new Date(), FUTURE, 400],
  ] as const)(
    'complete with %s token returns expected status',
    async (_label, token, usedAt, expiresAt, expectedStatus) => {
      prismaMock.adminInvitation.findUnique.mockResolvedValue(
        makeInvitation({ token, usedAt, expiresAt }) as any,
      );
      const res = await request(app)
        .post(`/admin/invitations/${token}/complete`)
        .send(completePayload);
      expect(res.status).toBe(expectedStatus);
    },
  );

  test.each([
    ['tok-missing-1'],
    ['tok-missing-2'],
    ['not-found'],
    ['invalid-complete'],
    ['deadbeef'],
  ])('returns 404 when token %s not found', async (token) => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/invitations/${token}/complete`)
      .send(completePayload);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/invalid invitation token/i);
  });

  test.each([
    ['1'],
    ['12'],
    ['12345'],
    ['short'],
  ])('returns 400 when password too short: "%s"', async (password) => {
    const res = await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send({ ...completePayload, password });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 6 characters/i);
  });

  test('returns 400 when password is empty string (route validation)', async () => {
    const res = await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send({ ...completePayload, password: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name, username, and password are required/i);
  });

  test('returns 201 with registered user on success', async () => {
    const res = await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/registered successfully/i);
    expect(res.body.data.id).toBe('user-new-1');
    expect(res.body.data.username).toBe('branchadmin');
    expect(res.body.data.role).toBe('management');
  });

  test('creates user with invitation email', async () => {
    await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'branch.admin@school.test',
          role: 'management',
          status: 'active',
        }),
      }),
    );
  });

  test('marks invitation as used in transaction', async () => {
    await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(prismaMock.adminInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({
          name: 'Branch Admin',
          phone: '03001234567',
          usedAt: expect.any(Date),
        }),
      }),
    );
  });

  test('creates branch_admin membership', async () => {
    await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(prismaMock.branchMember.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-new-1',
        branchId: 'branch-1',
        role: 'branch_admin',
      },
    });
  });

  test('does not require authentication', async () => {
    const res = await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(res.status).toBe(201);
  });

  test.each([
    [undefined, null],
    ['03009998877', '03009998877'],
    ['', null],
  ])('phone %s stored as %s', async (phone, expected) => {
    const body = { ...completePayload, phone };
    if (phone === undefined) delete (body as any).phone;
    await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(body);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: expected }),
      }),
    );
  });

  test.each([
    ['admin_one'],
    ['admin.two'],
    ['admin_3'],
    ['branch-admin-2026'],
  ])('accepts username %s', async (username) => {
    const res = await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send({ ...completePayload, username });
    expect(res.status).toBe(201);
  });

  test('hashes password via bcrypt', async () => {
    const bcrypt = require('bcryptjs');
    await request(app)
      .post(`/admin/invitations/${PENDING_TOKEN}/complete`)
      .send(completePayload);
    expect(bcrypt.hash).toHaveBeenCalledWith('securepass', 12);
  });

  test('expired token on complete returns expired message', async () => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(
      makeInvitation({ token: EXPIRED_TOKEN, expiresAt: PAST }) as any,
    );
    const res = await request(app)
      .post(`/admin/invitations/${EXPIRED_TOKEN}/complete`)
      .send(completePayload);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  test('used token on complete returns already used message', async () => {
    prismaMock.adminInvitation.findUnique.mockResolvedValue(
      makeInvitation({ token: USED_TOKEN, usedAt: new Date() }) as any,
    );
    const res = await request(app)
      .post(`/admin/invitations/${USED_TOKEN}/complete`)
      .send(completePayload);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /admin/invitations  (protected — super_admin)
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/invitations', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without token', async () => {
    const res = await request(app)
      .post('/admin/invitations')
      .send({ email: 'new@test.com', branchId: 'branch-1' });
    expect(res.status).toBe(401);
  });

  test('returns 401 with expired token', async () => {
    const res = await request(app)
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${generateExpiredToken('admin-1', 'super_admin')}`)
      .send({ email: 'new@test.com', branchId: 'branch-1' });
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong secret token', async () => {
    const res = await request(app)
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${generateTokenWithWrongSecret('admin-1', 'super_admin')}`)
      .send({ email: 'new@test.com', branchId: 'branch-1' });
    expect(res.status).toBe(401);
  });

  test('returns 401 with malformed authorization header', async () => {
    const res = await request(app)
      .post('/admin/invitations')
      .set('Authorization', 'NotBearer token')
      .send({ email: 'new@test.com', branchId: 'branch-1' });
    expect(res.status).toBe(401);
  });

  test.each([
    ['management', managementToken],
    ['teacher', teacherToken],
    ['parent', parentToken],
    ['management-alt', getAuthHeader(generateTestToken('m2', 'management'))],
  ])('returns 403 for role %s', async (_label, token) => {
    const res = await request(app)
      .post('/admin/invitations')
      .set(token)
      .send({ email: 'new@test.com', branchId: 'branch-1' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
  });

  test.each([
    [{ branchId: 'branch-1' }, 'email'],
    [{ email: 'new@test.com' }, 'branchId'],
    [{}, 'email and branchId'],
    [{ email: '', branchId: 'branch-1' }, 'empty email'],
    [{ email: 'new@test.com', branchId: '' }, 'empty branchId'],
    [{ email: null, branchId: 'branch-1' }, 'null email'],
  ])('returns 400 when missing %s', async (body, _label) => {
    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email and branchid are required/i);
  });

  test('creates new invitation and returns 201', async () => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminInvitation.create.mockResolvedValue({
      id: 'inv-new',
      email: 'new.admin@test.com',
      branchId: 'branch-1',
      token: 'generated-token-hex',
      expiresAt: FUTURE,
    } as any);

    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'new.admin@test.com', branchId: 'branch-1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.link).toMatch(/register-admin\?token=/);
    expect(res.body.data.message).toMatch(/created successfully/i);
  });

  test('returns existing pending invitation link when duplicate email', async () => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue({
      token: 'existing-token',
      expiresAt: FUTURE,
    } as any);

    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'pending@test.com', branchId: 'branch-1' });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe('existing-token');
    expect(res.body.data.message).toMatch(/pending invitation already exists/i);
    expect(prismaMock.adminInvitation.create).not.toHaveBeenCalled();
  });

  test('returns 409 when user with email already exists', async () => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' } as any);

    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'taken@test.com', branchId: 'branch-1' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/user with this email already exists/i);
  });

  test('passes createdById from authenticated user', async () => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminInvitation.create.mockResolvedValue({} as any);

    await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'creator@test.com', branchId: 'branch-1' });

    expect(prismaMock.adminInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'creator@test.com',
          branchId: 'branch-1',
          createdById: 'admin-1',
        }),
      }),
    );
  });

  test.each([
    ['admin.a@school.test'],
    ['admin.b@school.test'],
    ['invite@campus.edu'],
    ['new.branch@example.org'],
    ['super.invite@test.io'],
  ])('creates invitation for email %s', async (email) => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminInvitation.create.mockResolvedValue({
      email, branchId: 'branch-1', token: `tok-${email}`, expiresAt: FUTURE,
    } as any);

    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email, branchId: 'branch-1' });

    expect(res.status).toBe(201);
    expect(prismaMock.adminInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email }) }),
    );
  });

  test.each([
    ['branch-1'],
    ['branch-2'],
    ['branch-north'],
  ])('creates invitation for branchId %s', async (branchId) => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminInvitation.create.mockResolvedValue({
      email: 'b@test.com', branchId, token: 'tok', expiresAt: FUTURE,
    } as any);

    const res = await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'b@test.com', branchId });

    expect(res.status).toBe(201);
    expect(prismaMock.adminInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ branchId }) }),
    );
  });

  test('checks for pending invitation before creating', async () => {
    prismaMock.adminInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminInvitation.create.mockResolvedValue({} as any);

    await request(app)
      .post('/admin/invitations')
      .set(adminToken)
      .send({ email: 'check@test.com', branchId: 'branch-1' });

    expect(prismaMock.adminInvitation.findFirst).toHaveBeenCalledWith({
      where: { email: 'check@test.com', usedAt: null, expiresAt: { gt: expect.any(Date) } },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /admin/invitations  (protected — super_admin)
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/invitations', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without token', async () => {
    const res = await request(app).get('/admin/invitations');
    expect(res.status).toBe(401);
  });

  test('returns 401 with expired token', async () => {
    const res = await request(app)
      .get('/admin/invitations')
      .set('Authorization', `Bearer ${generateExpiredToken('admin-1', 'super_admin')}`);
    expect(res.status).toBe(401);
  });

  test.each([
    ['management', managementToken],
    ['teacher', teacherToken],
    ['parent', parentToken],
    ['teacher-alt', getAuthHeader(generateTestToken('t2', 'teacher'))],
  ])('returns 403 for role %s', async (_label, token) => {
    const res = await request(app).get('/admin/invitations').set(token);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
  });

  test('returns 200 with pending invitations and admins', async () => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-p1',
        email: 'pending@test.com',
        token: 'tok-p',
        expiresAt: FUTURE,
        usedAt: null,
        branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
        createdAt: new Date(),
      },
    ] as any);
    prismaMock.branchMember.findMany.mockResolvedValue([
      {
        id: 'bm-1',
        createdAt: new Date(),
        user: {
          id: 'u-1', name: 'Existing Admin', email: 'admin@test.com',
          phone: '0300', role: 'management', status: 'active', createdAt: new Date(),
        },
        branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
      },
    ] as any);

    const res = await request(app).get('/admin/invitations').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pendingInvitations).toHaveLength(1);
    expect(res.body.data.admins).toHaveLength(1);
    expect(res.body.data.admins[0].name).toBe('Existing Admin');
    expect(res.body.data.admins[0].branchName).toBe('Main');
  });

  test('returns 200 with empty lists', async () => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([]);
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    const res = await request(app).get('/admin/invitations').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.pendingInvitations).toEqual([]);
    expect(res.body.data.admins).toEqual([]);
  });

  test('queries pending invitations with correct filter', async () => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([]);
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    await request(app).get('/admin/invitations').set(adminToken);

    expect(prismaMock.adminInvitation.findMany).toHaveBeenCalledWith({
      where: { usedAt: null, expiresAt: { gt: expect.any(Date) } },
      orderBy: { createdAt: 'desc' },
      include: { branch: { select: { id: true, name: true, code: true } } },
    });
  });

  test('queries branch admins with branch_admin role', async () => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([]);
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    await request(app).get('/admin/invitations').set(adminToken);

    expect(prismaMock.branchMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'branch_admin' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  test.each([
    ['inv-1', 'a1@test.com'],
    ['inv-2', 'a2@test.com'],
    ['inv-3', 'a3@test.com'],
    ['inv-4', 'a4@test.com'],
    ['inv-5', 'a5@test.com'],
  ])('lists pending invitation %s with email %s', async (id, email) => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([
      { id, email, token: `tok-${id}`, expiresAt: FUTURE, usedAt: null, branch: { id: 'b1', name: 'B', code: 'B' }, createdAt: new Date() },
    ] as any);
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    const res = await request(app).get('/admin/invitations').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.pendingInvitations[0].email).toBe(email);
  });

  test.each([
    ['Admin One', 'admin1@test.com', 'BR1'],
    ['Admin Two', 'admin2@test.com', 'BR2'],
    ['Admin Three', 'admin3@test.com', 'BR3'],
    ['Admin Four', 'admin4@test.com', 'BR4'],
    ['Admin Five', 'admin5@test.com', 'BR5'],
  ])('lists admin %s (%s) at branch %s', async (name, email, branchCode) => {
    prismaMock.adminInvitation.findMany.mockResolvedValue([]);
    prismaMock.branchMember.findMany.mockResolvedValue([
      {
        id: `bm-${email}`,
        createdAt: new Date(),
        user: { id: `u-${email}`, name, email, phone: null, role: 'management', status: 'active', createdAt: new Date() },
        branch: { id: 'b1', name: 'Campus', code: branchCode },
      },
    ] as any);

    const res = await request(app).get('/admin/invitations').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.admins[0].name).toBe(name);
    expect(res.body.data.admins[0].email).toBe(email);
    expect(res.body.data.admins[0].branchCode).toBe(branchCode);
  });

  test('maps admin list fields correctly', async () => {
    const createdAt = new Date('2026-06-15');
    prismaMock.adminInvitation.findMany.mockResolvedValue([]);
    prismaMock.branchMember.findMany.mockResolvedValue([
      {
        id: 'bm-map',
        createdAt,
        user: {
          id: 'u-map', name: 'Mapped Admin', email: 'map@test.com',
          phone: '03001112233', role: 'management', status: 'active', createdAt,
        },
        branch: { id: 'branch-map', name: 'Mapped Branch', code: 'MAP' },
      },
    ] as any);

    const res = await request(app).get('/admin/invitations').set(adminToken);
    const admin = res.body.data.admins[0];
    expect(admin.userId).toBe('u-map');
    expect(admin.branchId).toBe('branch-map');
    expect(admin.branchName).toBe('Mapped Branch');
    expect(admin.status).toBe('active');
    expect(admin.createdAt).toBeDefined();
  });
});

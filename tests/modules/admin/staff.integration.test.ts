/**
 * Staff admin routes — integration tests (supertest + mocked staffService).
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/middleware/security/rateLimiter', () => ({
  passwordSetLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { prismaMock } from '../../mocks/prisma';

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({ isRestricted: false, isFullAdmin: true, permissions: [] }),
    listBranchStaff: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Fee Manager' }]),
    createStaff: jest.fn().mockResolvedValue({ id: 'u-new', name: 'New Staff' }),
    createWorker: jest.fn().mockResolvedValue({ id: 'w1', name: 'Worker' }),
    getStaffPermissions: jest.fn().mockResolvedValue([{ module: 'FEES', actions: ['read', 'write'] }]),
    setStaffPermissions: jest.fn().mockResolvedValue([{ module: 'FEES', actions: ['read'] }]),
    getStaffDetail: jest.fn().mockResolvedValue({ id: 'u1', name: 'Staff' }),
    updateStaffProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
    deactivateStaff: jest.fn().mockResolvedValue({ id: 'u1', status: 'inactive' }),
    reactivateStaff: jest.fn().mockResolvedValue({ id: 'u1', status: 'active' }),
    setPassword: jest.fn().mockResolvedValue({ message: 'Password updated' }),
    sendCredentials: jest.fn().mockResolvedValue({ sent: true }),
  },
}));

import request from 'supertest';
import app from '../../../src/app';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  adminAuth,
  branchQuery,
  mockActiveAcademicYear,
  scopeQuery,
  TEST_AY_ID,
  TEST_BRANCH_ID,
} from '../../helpers/integration';

const STAFF_USER_ID = 'u1';
const BASE = '/admin/staff';

const validPermissions = [{ module: 'FEES', actions: ['read', 'write'] }];
const validCreateStaffBody = {
  name: 'New Staff',
  username: 'newstaff',
  password: 'Pass123!',
  permissions: validPermissions,
};
const validWorkerBody = { name: 'Ground Worker', username: 'worker1', phone: '03001234567' };
const validSetPasswordBody = { newPassword: 'NewPass123!', adminPassword: 'AdminPass123!' };

type HttpMethod = 'get' | 'post' | 'put' | 'patch';

interface StaffEndpoint {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  successStatus: number;
}

const STAFF_ENDPOINTS: StaffEndpoint[] = [
  { label: 'GET list', method: 'get', path: BASE, successStatus: 200 },
  { label: 'POST create staff', method: 'post', path: BASE, body: validCreateStaffBody, successStatus: 201 },
  { label: 'POST create worker', method: 'post', path: `${BASE}/workers`, body: validWorkerBody, successStatus: 201 },
  { label: 'GET permissions', method: 'get', path: `${BASE}/${STAFF_USER_ID}/permissions`, successStatus: 200 },
  {
    label: 'PUT permissions',
    method: 'put',
    path: `${BASE}/${STAFF_USER_ID}/permissions`,
    body: { permissions: validPermissions },
    successStatus: 200,
  },
  { label: 'GET detail', method: 'get', path: `${BASE}/${STAFF_USER_ID}`, successStatus: 200 },
  { label: 'PATCH profile', method: 'patch', path: `${BASE}/${STAFF_USER_ID}`, body: { name: 'Updated' }, successStatus: 200 },
  { label: 'POST deactivate', method: 'post', path: `${BASE}/${STAFF_USER_ID}/deactivate`, successStatus: 200 },
  { label: 'POST reactivate', method: 'post', path: `${BASE}/${STAFF_USER_ID}/reactivate`, successStatus: 200 },
  {
    label: 'POST set-password',
    method: 'post',
    path: `${BASE}/${STAFF_USER_ID}/set-password`,
    body: validSetPasswordBody,
    successStatus: 200,
  },
  { label: 'POST send-credentials', method: 'post', path: `${BASE}/${STAFF_USER_ID}/send-credentials`, successStatus: 200 },
];

function send(
  ep: StaffEndpoint,
  opts: {
    auth?: { Authorization: string };
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  } = {},
) {
  const req = request(app)[ep.method](ep.path);
  if (opts.query) req.query(opts.query);
  if (opts.auth) req.set(opts.auth);
  const body = opts.body ?? ep.body;
  if (body && ep.method !== 'get') return req.send(body);
  return req;
}

function managementAuth(branchIds: string[] = [TEST_BRANCH_ID]) {
  return getAuthHeader(
    generateTestToken('mgmt-1', 'management', { branchIds } as Record<string, unknown>),
  );
}

function resetStaffMocks() {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: false,
    isFullAdmin: true,
    permissions: [],
  });
  (staffService.listBranchStaff as jest.Mock).mockResolvedValue([{ id: 'u1', name: 'Fee Manager' }]);
  (staffService.createStaff as jest.Mock).mockResolvedValue({ id: 'u-new', name: 'New Staff' });
  (staffService.createWorker as jest.Mock).mockResolvedValue({ id: 'w1', name: 'Worker' });
  (staffService.getStaffPermissions as jest.Mock).mockResolvedValue([{ module: 'FEES', actions: ['read', 'write'] }]);
  (staffService.setStaffPermissions as jest.Mock).mockResolvedValue([{ module: 'FEES', actions: ['read'] }]);
  (staffService.getStaffDetail as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Staff' });
  (staffService.updateStaffProfile as jest.Mock).mockResolvedValue({ id: 'u1' });
  (staffService.deactivateStaff as jest.Mock).mockResolvedValue({ id: 'u1', status: 'inactive' });
  (staffService.reactivateStaff as jest.Mock).mockResolvedValue({ id: 'u1', status: 'active' });
  (staffService.setPassword as jest.Mock).mockResolvedValue({ message: 'Password updated' });
  (staffService.sendCredentials as jest.Mock).mockResolvedValue({ sent: true });
}

describe('Staff admin integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStaffMocks();
    mockActiveAcademicYear();
  });

  // ─── 401 without auth ───────────────────────────────────────────────

  describe('401 — authentication required', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 400 scope / branch context ─────────────────────────────────────

  describe('400 — missing scope (no branchId or academic year)', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/academic year/i);
    });
  });

  describe('success — branchId resolved from academic year when omitted', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: adminAuth,
        query: { academicYearId: TEST_AY_ID },
      });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('404 — academic year not found', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: adminAuth,
        query: { branchId: TEST_BRANCH_ID, academicYearId: 'missing-ay' },
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/academic year not found/i);
    });
  });

  describe('400 — branchId does not match academic year', () => {
    beforeEach(() => {
      mockActiveAcademicYear({ branchId: 'other-branch' });
    });

    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong/i);
    });
  });

  // ─── 403 branch access (management JWT) ─────────────────────────────

  describe('403 — management user without branch access', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: managementAuth(['other-branch']),
        query: scopeQuery,
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/access denied/i);
    });
  });

  // ─── 403 restricted staff ───────────────────────────────────────────

  describe('403 — restricted staff cannot manage staff', () => {
    beforeEach(() => {
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [{ module: 'FEES', actions: ['read'] }],
      });
    });

    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: managementAuth(),
        query: scopeQuery,
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/full admin access/i);
    });
  });

  // ─── 400 validation — create staff ────────────────────────────────────

  describe('POST /admin/staff — validation', () => {
    const createEp = STAFF_ENDPOINTS.find((e) => e.label === 'POST create staff')!;

    test.each([
      ['missing name', { username: 'u1', permissions: validPermissions }],
      ['empty name', { name: '', username: 'u1', permissions: validPermissions }],
      ['whitespace name', { name: '   ', username: 'u1', permissions: validPermissions }],
      ['missing username', { name: 'Staff', permissions: validPermissions }],
      ['empty username', { name: 'Staff', username: '', permissions: validPermissions }],
      ['whitespace username', { name: 'Staff', username: '  ', permissions: validPermissions }],
      ['missing permissions', { name: 'Staff', username: 'u1' }],
      ['empty permissions array', { name: 'Staff', username: 'u1', permissions: [] }],
      ['null permissions', { name: 'Staff', username: 'u1', permissions: null }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(createEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 400 validation — worker ──────────────────────────────────────────

  describe('POST /admin/staff/workers — validation', () => {
    const workerEp = STAFF_ENDPOINTS.find((e) => e.label === 'POST create worker')!;

    test.each([
      ['missing name', { username: 'w1' }],
      ['empty name', { name: '' }],
      ['whitespace name', { name: '  \t  ' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(workerEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/i);
    });
  });

  // ─── 400 validation — permissions ─────────────────────────────────────

  describe('PUT /admin/staff/:userId/permissions — validation', () => {
    const permEp = STAFF_ENDPOINTS.find((e) => e.label === 'PUT permissions')!;

    test.each([
      ['missing permissions', {}],
      ['empty permissions', { permissions: [] }],
      ['null permissions', { permissions: null }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(permEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least one module/i);
    });
  });

  // ─── 400 validation — set-password ────────────────────────────────────

  describe('POST /admin/staff/:userId/set-password — validation', () => {
    const pwdEp = STAFF_ENDPOINTS.find((e) => e.label === 'POST set-password')!;

    test.each([
      ['missing newPassword', { adminPassword: 'Admin123!' }],
      ['missing adminPassword', { newPassword: 'New123!' }],
      ['empty newPassword', { newPassword: '', adminPassword: 'Admin123!' }],
      ['empty adminPassword', { newPassword: 'New123!', adminPassword: '' }],
      ['whitespace passwords', { newPassword: '  ', adminPassword: '  ' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(pwdEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/newPassword and adminPassword are required/i);
    });
  });

  // ─── 200/201 success paths ────────────────────────────────────────────

  describe('success — all endpoints', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('success — management user with branchIds', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: managementAuth(), query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /admin/staff — list filters', () => {
    test.each([
      ['no filters', {} as Record<string, string>],
      ['search by name', { search: 'Fee' }],
      ['search empty', { search: '' }],
      ['status active', { status: 'active' }],
      ['status inactive', { status: 'inactive' }],
      ['search + status', { search: 'Manager', status: 'active' }],
    ])('%s', async (_label, extraQuery) => {
      const res = await request(app)
        .get(BASE)
        .query({ ...scopeQuery, ...extraQuery })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(staffService.listBranchStaff).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        expect.objectContaining({
          search: extraQuery.search,
          status: extraQuery.status,
        }),
      );
    });
  });

  describe('POST /admin/staff — create with optional profile fields', () => {
    test.each([
      ['minimal', validCreateStaffBody],
      [
        'full profile',
        {
          ...validCreateStaffBody,
          email: 'staff@school.test',
          phone: '03001112222',
          employeeId: 'EMP-001',
          workRole: 'Accountant',
          qualification: 'B.Com',
          specialization: 'Finance',
          joiningDate: '2024-01-15',
          salary: 50000,
          emergencyContact: '03009998888',
          address: 'Block A',
          dateOfBirth: '1990-05-20',
          gender: 'male',
          bloodGroup: 'O+',
          fatherName: 'Father',
          cardId: 'CARD-1',
          severeDisease: 'None',
          experience: '5 years',
          bio: 'Experienced staff',
          profilePhotoId: 'photo-1',
        },
      ],
      ['salary as string', { ...validCreateStaffBody, salary: '45000' }],
      ['salary empty string', { ...validCreateStaffBody, salary: '' }],
    ])('201 — %s payload', async (_label, body) => {
      const res = await request(app).post(BASE).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(201);
      expect(staffService.createStaff).toHaveBeenCalled();
      expect(res.body.data.name).toBe('New Staff');
    });
  });

  describe('POST /admin/staff/workers — success variants', () => {
    test.each([
      ['name only', { name: 'Cleaner' }],
      ['with username', { name: 'Guard', username: 'guard1' }],
      ['with phone', { name: 'Driver', phone: '03007776666' }],
    ])('201 — %s', async (_label, body) => {
      const res = await request(app).post(`${BASE}/workers`).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(201);
      expect(staffService.createWorker).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        expect.objectContaining(body),
        'admin-1',
      );
    });
  });

  describe('staff detail and profile mutations', () => {
    test('GET detail returns staff record', async () => {
      const res = await request(app).get(`${BASE}/${STAFF_USER_ID}`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: 'u1', name: 'Staff' });
      expect(staffService.getStaffDetail).toHaveBeenCalledWith(TEST_BRANCH_ID, STAFF_USER_ID);
    });

    test.each([
      ['name', { name: 'Renamed' }],
      ['phone', { phone: '03001234567' }],
      ['workRole', { workRole: 'Clerk' }],
      ['salary', { salary: 60000 }],
      ['address', { address: 'New address' }],
    ])('PATCH updates %s', async (field, body) => {
      const res = await request(app).patch(`${BASE}/${STAFF_USER_ID}`).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(200);
      expect(staffService.updateStaffProfile).toHaveBeenCalledWith(TEST_BRANCH_ID, STAFF_USER_ID, body);
    });

    test('POST deactivate returns inactive status', async () => {
      const res = await request(app).post(`${BASE}/${STAFF_USER_ID}/deactivate`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('inactive');
    });

    test('POST reactivate returns active status', async () => {
      const res = await request(app).post(`${BASE}/${STAFF_USER_ID}/reactivate`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });
  });

  describe('permissions endpoints', () => {
    test('GET permissions returns module list', async () => {
      const res = await request(app)
        .get(`${BASE}/${STAFF_USER_ID}/permissions`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data[0].module).toBe('FEES');
    });

    test.each([
      ['FEES read', [{ module: 'FEES', actions: ['read'] }]],
      ['FEES read+write', [{ module: 'FEES', actions: ['read', 'write'] }]],
      ['multiple modules', [
        { module: 'FEES', actions: ['read'] },
        { module: 'STUDENTS', actions: ['read', 'write'] },
      ]],
    ])('PUT permissions — %s', async (_label, permissions) => {
      const res = await request(app)
        .put(`${BASE}/${STAFF_USER_ID}/permissions`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ permissions });
      expect(res.status).toBe(200);
      expect(staffService.setStaffPermissions).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        STAFF_USER_ID,
        permissions,
      );
    });
  });

  describe('credential operations', () => {
    test('set-password returns success message', async () => {
      const res = await request(app)
        .post(`${BASE}/${STAFF_USER_ID}/set-password`)
        .query(scopeQuery)
        .set(adminAuth)
        .send(validSetPasswordBody);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password updated');
      expect(staffService.setPassword).toHaveBeenCalled();
    });

    test('send-credentials returns sent flag', async () => {
      const res = await request(app)
        .post(`${BASE}/${STAFF_USER_ID}/send-credentials`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(true);
      expect(staffService.sendCredentials).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        STAFF_USER_ID,
        'admin-1',
        expect.any(String),
      );
    });
  });

  describe('super_admin bypasses resolveUserAccess restriction check', () => {
    beforeEach(() => {
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [],
      });
    });

    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s still succeeds', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
    });
  });

  describe('scope resolved via active academic year fallback', () => {
    test.each(STAFF_ENDPOINTS.map((ep) => [ep.label, ep]))('%s with branchId only', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(prismaMock.academicYear.findFirst).toHaveBeenCalled();
    });
  });
});

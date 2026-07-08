/**
 * Student admin routes — integration tests (supertest + mocked studentService + prismaMock).
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/middleware/security/rateLimiter', () => ({
  passwordSetLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../../src/modules/admin/services/student.service', () => ({
  studentService: {
    findAll: jest.fn().mockResolvedValue({
      data: [{ id: 's1', name: 'Ali Khan', rollNumber: '1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
    findById: jest.fn().mockResolvedValue({ id: 's1', name: 'Ali Khan', group: { id: 'g1', name: 'Class 1' } }),
    create: jest.fn().mockResolvedValue({ id: 's-new', name: 'New Student', groupId: 'g1' }),
    update: jest.fn().mockResolvedValue({ id: 's1', name: 'Updated Student' }),
    deactivate: jest.fn().mockResolvedValue({ id: 's1', isActive: false, status: 'WITHDRAWN' }),
    addEmergencyContact: jest.fn().mockResolvedValue({ id: 'ec1', name: 'Father', phone: '03001234567' }),
    deleteEmergencyContact: jest.fn().mockResolvedValue({ id: 'ec1' }),
    upsertHealthRecord: jest.fn().mockResolvedValue({ id: 'hr1', studentId: 's1', bloodGroup: 'B+' }),
    linkParent: jest.fn().mockResolvedValue({ studentId: 's1', parentId: 'p1', relation: 'Father' }),
    unlinkParent: jest.fn().mockResolvedValue({ studentId: 's1', parentId: 'p1' }),
    generateCredentials: jest.fn().mockResolvedValue({ username: 'ali123', password: 'TempPass1!' }),
    setPassword: jest.fn().mockResolvedValue({ message: 'Password updated successfully' }),
    sendCredentials: jest.fn().mockResolvedValue({ sent: true, status: 'sent', to: '030012****' }),
    sendAllCredentials: jest.fn().mockResolvedValue({ sent: 2, skipped: 0, failed: 0, results: [] }),
  },
}));

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({ isRestricted: false, isFullAdmin: true, permissions: [] }),
  },
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { studentService } from '../../../src/modules/admin/services/student.service';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  adminAuth,
  branchQuery,
  mockActiveAcademicYear,
  scopeQuery,
  TEST_AY_ID,
  TEST_BRANCH_ID,
  type HttpMethod,
} from '../../helpers/integration';

const STUDENT_ID = 's1';
const CONTACT_ID = 'ec1';
const PARENT_ID = 'p1';
const BASE = '/admin/students';

type RouteSpec = {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  needsScope?: boolean;
  successStatus?: number;
};

const ALL_ROUTES: RouteSpec[] = [
  { label: 'GET list', method: 'get', path: BASE, needsScope: true, successStatus: 200 },
  { label: 'GET detail', method: 'get', path: `${BASE}/${STUDENT_ID}`, successStatus: 200 },
  { label: 'POST create', method: 'post', path: BASE, body: { name: 'New Student', groupId: 'g1' }, successStatus: 201 },
  { label: 'PUT update', method: 'put', path: `${BASE}/${STUDENT_ID}`, body: { name: 'Updated' }, successStatus: 200 },
  { label: 'DELETE deactivate', method: 'delete', path: `${BASE}/${STUDENT_ID}`, successStatus: 200 },
  {
    label: 'POST emergency-contact',
    method: 'post',
    path: `${BASE}/${STUDENT_ID}/emergency-contact`,
    body: { name: 'Father', relationship: 'Father', phone: '03001234567' },
    successStatus: 201,
  },
  {
    label: 'PUT emergency-contact',
    method: 'put',
    path: `${BASE}/${STUDENT_ID}/emergency-contact/${CONTACT_ID}`,
    body: { name: 'Mother', phone: '03009876543' },
    successStatus: 200,
  },
  {
    label: 'DELETE emergency-contact',
    method: 'delete',
    path: `${BASE}/${STUDENT_ID}/emergency-contact/${CONTACT_ID}`,
    successStatus: 200,
  },
  {
    label: 'PUT health-record',
    method: 'put',
    path: `${BASE}/${STUDENT_ID}/health-record`,
    body: { bloodGroup: 'B+', allergies: 'None' },
    successStatus: 200,
  },
  {
    label: 'POST link parent',
    method: 'post',
    path: `${BASE}/${STUDENT_ID}/parents`,
    body: { parentUserId: PARENT_ID, relation: 'Father', isPrimary: true },
    successStatus: 201,
  },
  {
    label: 'PUT parent profile',
    method: 'put',
    path: `${BASE}/${STUDENT_ID}/parent`,
    body: { name: 'Parent Name', phone: '03001112222' },
    successStatus: 201,
  },
  { label: 'DELETE unlink parent', method: 'delete', path: `${BASE}/${STUDENT_ID}/parents/${PARENT_ID}`, successStatus: 200 },
  { label: 'PUT generate-credentials', method: 'put', path: `${BASE}/${STUDENT_ID}/generate-credentials`, successStatus: 200 },
  {
    label: 'PUT set-password',
    method: 'put',
    path: `${BASE}/${STUDENT_ID}/set-password`,
    body: { password: 'NewPass123!', adminPassword: 'AdminPass123!' },
    successStatus: 200,
  },
  { label: 'POST send-credentials', method: 'post', path: `${BASE}/${STUDENT_ID}/send-credentials`, successStatus: 200 },
  { label: 'POST send-to-new', method: 'post', path: `${BASE}/send-to-new`, needsScope: true, successStatus: 200 },
  {
    label: 'POST send-all-credentials',
    method: 'post',
    path: `${BASE}/send-all-credentials`,
    body: { studentIds: ['s1', 's2'] },
    successStatus: 200,
  },
  {
    label: 'PUT status',
    method: 'put',
    path: `${BASE}/${STUDENT_ID}/status`,
    body: { status: 'SUSPENDED', reason: 'Discipline' },
    successStatus: 200,
  },
  { label: 'GET status-logs', method: 'get', path: `${BASE}/${STUDENT_ID}/status-logs`, successStatus: 200 },
];

const SCOPE_ROUTES = ALL_ROUTES.filter((r) => r.needsScope);
const VALID_STATUSES = ['ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'SUSPENDED', 'EXPELED', 'DECEASED'];

function send(
  spec: Pick<RouteSpec, 'method' | 'path' | 'body'>,
  opts: {
    auth?: { Authorization: string };
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  } = {},
) {
  const req = request(app)[spec.method](spec.path);
  if (opts.query) req.query(opts.query);
  if (opts.auth) req.set(opts.auth);
  const body = opts.body ?? spec.body;
  if (body && spec.method !== 'get') return req.send(body);
  return req;
}

function managementAuthNoBranch() {
  return getAuthHeader(generateTestToken('mgmt-0', 'management', { branchIds: [] } as any));
}

function resetStudentMocks() {
  (studentService.findAll as jest.Mock).mockResolvedValue({
    data: [{ id: 's1', name: 'Ali Khan', rollNumber: '1' }],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  (studentService.findById as jest.Mock).mockResolvedValue({ id: 's1', name: 'Ali Khan' });
  (studentService.create as jest.Mock).mockResolvedValue({ id: 's-new', name: 'New Student', groupId: 'g1' });
  (studentService.update as jest.Mock).mockResolvedValue({ id: 's1', name: 'Updated Student' });
  (studentService.deactivate as jest.Mock).mockResolvedValue({ id: 's1', isActive: false, status: 'WITHDRAWN' });
  (studentService.addEmergencyContact as jest.Mock).mockResolvedValue({ id: 'ec1', name: 'Father' });
  (studentService.deleteEmergencyContact as jest.Mock).mockResolvedValue({ id: 'ec1' });
  (studentService.upsertHealthRecord as jest.Mock).mockResolvedValue({ id: 'hr1', bloodGroup: 'B+' });
  (studentService.linkParent as jest.Mock).mockResolvedValue({ studentId: 's1', parentId: 'p1' });
  (studentService.unlinkParent as jest.Mock).mockResolvedValue({ studentId: 's1', parentId: 'p1' });
  (studentService.generateCredentials as jest.Mock).mockResolvedValue({ username: 'ali123', password: 'TempPass1!' });
  (studentService.setPassword as jest.Mock).mockResolvedValue({ message: 'Password updated successfully' });
  (studentService.sendCredentials as jest.Mock).mockResolvedValue({ sent: true, status: 'sent' });
  (studentService.sendAllCredentials as jest.Mock).mockResolvedValue({ sent: 2, skipped: 0, failed: 0, results: [] });
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: false,
    isFullAdmin: true,
    permissions: [],
  });
}

function resetPrismaMocks() {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: STUDENT_ID, status: 'ACTIVE', isActive: true, name: 'Ali Khan' });
  (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
  (prismaMock.studentParent.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.user.create as jest.Mock).mockResolvedValue({ id: 'u-parent', name: 'Parent Name' });
  (prismaMock.parentProfile.create as jest.Mock).mockResolvedValue({ id: 'pp1', userId: 'u-parent' });
  (prismaMock.studentParent.create as jest.Mock).mockResolvedValue({ studentId: STUDENT_ID, parentId: 'pp1' });
  (prismaMock.parentProfile.update as jest.Mock).mockResolvedValue({ id: 'pp1', phone: '03001112222' });
  (prismaMock.emergencyContact.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID, name: 'Mother' });
  (prismaMock.$transaction as jest.Mock).mockResolvedValue([{ id: STUDENT_ID }, { id: 'log1' }]);
  (prismaMock.studentStatusLog.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Student admin integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStudentMocks();
    resetPrismaMocks();
    mockActiveAcademicYear();
  });

  // ─── 401 without auth ───────────────────────────────────────────────

  describe('401 — authentication required', () => {
    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 400 branchId required (staff permission middleware) ────────────

  describe('400 — branchId required (super_admin, no branchId in query)', () => {
    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  // ─── 400 scope — missing academic year ──────────────────────────────

  describe('400 — missing scope (no academic year)', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(SCOPE_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/academic year/i);
    });
  });

  describe('404 — academic year not found', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(SCOPE_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
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

    test.each(SCOPE_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong/i);
    });
  });

  // ─── 403 branch access (scope routes via resolveScopeContext) ──────

  describe('403 — management without branch access', () => {
    test('GET list returns 403 for management role without branchIds', async () => {
      const res = await send(
        { method: 'get', path: BASE },
        { auth: managementAuthNoBranch(), query: scopeQuery },
      );
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/access denied|branch/i);
    });
  });

  // ─── 403 restricted staff (staff permission middleware) ─────────────

  describe('403 — restricted staff without STUDENTS permission', () => {
    beforeEach(() => {
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [{ module: 'FEES', canRead: true, canCreate: false, canUpdate: false, canDelete: false }],
      });
    });

    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });
  });

  // ─── 400 validation ─────────────────────────────────────────────────

  describe('POST /admin/students — validation', () => {
    test.each([
      ['missing name', { groupId: 'g1' }],
      ['empty name', { name: '', groupId: 'g1' }],
      ['whitespace name', { name: '   ', groupId: 'g1' }],
      ['null name', { name: null, groupId: 'g1' }],
    ])('400 — %s', async (_label, body) => {
      (studentService.create as jest.Mock).mockRejectedValue({ status: 400, message: 'Student name is required' });
      const res = await request(app).post(BASE).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /admin/students/:id/set-password — validation', () => {
    const pwdEp = ALL_ROUTES.find((e) => e.label === 'PUT set-password')!;

    test.each([
      ['missing password', { adminPassword: 'Admin123!' }],
      ['missing adminPassword', { password: 'New123!' }],
      ['empty password', { password: '', adminPassword: 'Admin123!' }],
      ['empty adminPassword', { password: 'New123!', adminPassword: '' }],
      ['both missing', {}],
    ])('400 — %s', async (_label, body) => {
      const res = await send(pwdEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password and adminPassword are required/i);
    });
  });

  describe('POST /admin/students/send-all-credentials — validation', () => {
    const sendAllEp = ALL_ROUTES.find((e) => e.label === 'POST send-all-credentials')!;

    test.each([
      ['missing studentIds', {}],
      ['empty array', { studentIds: [] }],
      ['null studentIds', { studentIds: null }],
      ['non-array studentIds', { studentIds: 's1' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(sendAllEp, { auth: adminAuth, query: scopeQuery, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/studentIds array is required/i);
    });
  });

  describe('PUT /admin/students/:id/status — validation', () => {
    const statusEp = ALL_ROUTES.find((e) => e.label === 'PUT status')!;

    test('400 — missing status', async () => {
      const res = await send(statusEp, { auth: adminAuth, query: scopeQuery, body: { reason: 'test' } });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/status is required/i);
    });

    test.each([
      ['INVALID'],
      ['active'],
      ['PENDING'],
      ['DROPPED'],
    ])('400 — invalid status %s', async (status) => {
      const res = await send(statusEp, { auth: adminAuth, query: scopeQuery, body: { status } });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid status/i);
    });

    test('404 — student not found', async () => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await send(statusEp, { auth: adminAuth, query: scopeQuery, body: { status: 'SUSPENDED' } });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/student not found/i);
    });
  });

  describe('PUT /admin/students/:id/parent — validation', () => {
    const parentEp = ALL_ROUTES.find((e) => e.label === 'PUT parent profile')!;

    test('400 — name required when creating new parent', async () => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: STUDENT_ID });
      (prismaMock.studentParent.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await send(parentEp, { auth: adminAuth, query: scopeQuery, body: { phone: '03001112222' } });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/parent name is required/i);
    });

    test('404 — student not found', async () => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await send(parentEp, { auth: adminAuth, query: scopeQuery, body: { name: 'Parent' } });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/student not found/i);
    });
  });

  // ─── 200/201 success — all endpoints ────────────────────────────────

  describe('success — all endpoints (super_admin)', () => {
    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('success — branchId resolved from academic year when omitted on scope routes', () => {
    test.each(SCOPE_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: adminAuth,
        query: { academicYearId: TEST_AY_ID, branchId: TEST_BRANCH_ID },
      });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('success — scope via active academic year fallback (branchId only)', () => {
    test.each(SCOPE_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(prismaMock.academicYear.findFirst).toHaveBeenCalled();
    });
  });

  // ─── GET list filters ───────────────────────────────────────────────

  describe('GET /admin/students — list filters and pagination', () => {
    test.each([
      ['no filters', {}],
      ['search by name', { search: 'Ali' }],
      ['search empty', { search: '' }],
      ['groupId filter', { groupId: 'g1' }],
      ['rollNumber filter', { rollNumber: '1' }],
      ['page and limit', { page: '2', limit: '10' }],
      ['all filters', { search: 'Khan', groupId: 'g1', rollNumber: '1', page: '1', limit: '5' }],
    ])('%s', async (_label, extraQuery) => {
      const res = await request(app)
        .get(BASE)
        .query({ ...scopeQuery, ...extraQuery })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      const q = extraQuery as Record<string, string | undefined>;
      expect(studentService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          academicYearId: TEST_AY_ID,
          branchId: TEST_BRANCH_ID,
          search: q.search,
          groupId: q.groupId,
          rollNumber: q.rollNumber,
        }),
      );
    });
  });

  // ─── CRUD detail paths ──────────────────────────────────────────────

  describe('student CRUD operations', () => {
    test('GET detail returns student record', async () => {
      const res = await request(app).get(`${BASE}/${STUDENT_ID}`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Ali Khan');
      expect(studentService.findById).toHaveBeenCalledWith(STUDENT_ID);
    });

    test.each([
      ['name', { name: 'Renamed' }],
      ['phone', { phone: '03001234567' }],
      ['groupId', { groupId: 'g2' }],
      ['bloodGroup', { bloodGroup: 'O+' }],
      ['address', { address: 'Block A' }],
    ])('PUT updates %s', async (field, body) => {
      const res = await request(app).put(`${BASE}/${STUDENT_ID}`).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(200);
      expect(studentService.update).toHaveBeenCalledWith(STUDENT_ID, expect.objectContaining(body));
    });

    test('POST create with minimal payload', async () => {
      const res = await request(app)
        .post(BASE)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ name: 'New Student', groupId: 'g1' });
      expect(res.status).toBe(201);
      expect(studentService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Student', groupId: 'g1', createdById: 'admin-1' }),
      );
    });

    test.each([
      ['full profile', {
        name: 'Full Student',
        groupId: 'g1',
        gender: 'male',
        dateOfBirth: '2015-05-20',
        religion: 'Islam',
        nationality: 'Pakistani',
        address: 'Street 1',
        city: 'Lahore',
        phone: '03001234567',
        bloodGroup: 'A+',
        guardianName: 'Guardian',
        guardianRelation: 'Father',
      }],
      ['with academicYearId', { name: 'AY Student', groupId: 'g1', academicYearId: TEST_AY_ID }],
      ['manual rollNumber', { name: 'Roll Student', groupId: 'g1', rollNumber: '99' }],
    ])('POST create — %s', async (_label, body) => {
      const res = await request(app).post(BASE).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(201);
      expect(studentService.create).toHaveBeenCalled();
    });

    test('DELETE deactivates student', async () => {
      const res = await request(app).delete(`${BASE}/${STUDENT_ID}`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Student deactivated');
      expect(studentService.deactivate).toHaveBeenCalledWith(STUDENT_ID);
    });
  });

  // ─── Emergency contacts ─────────────────────────────────────────────

  describe('emergency contact endpoints', () => {
    test('POST creates emergency contact', async () => {
      const res = await request(app)
        .post(`${BASE}/${STUDENT_ID}/emergency-contact`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ name: 'Father', relationship: 'Father', phone: '03001234567', priority: 1 });
      expect(res.status).toBe(201);
      expect(studentService.addEmergencyContact).toHaveBeenCalledWith(
        STUDENT_ID,
        expect.objectContaining({ name: 'Father', createdById: 'admin-1' }),
      );
    });

    test('PUT updates emergency contact via prisma', async () => {
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/emergency-contact/${CONTACT_ID}`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ name: 'Mother', phone: '03009876543' });
      expect(res.status).toBe(200);
      expect(prismaMock.emergencyContact.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CONTACT_ID } }),
      );
    });

    test('DELETE removes emergency contact', async () => {
      const res = await request(app)
        .delete(`${BASE}/${STUDENT_ID}/emergency-contact/${CONTACT_ID}`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(studentService.deleteEmergencyContact).toHaveBeenCalledWith(CONTACT_ID);
    });
  });

  // ─── Health record ──────────────────────────────────────────────────

  describe('PUT /admin/students/:id/health-record', () => {
    test.each([
      ['bloodGroup only', { bloodGroup: 'B+' }],
      ['chronic disease', { hasChronicDisease: true, diseaseDetails: 'Asthma' }],
      ['full record', {
        bloodGroup: 'O+',
        allergies: 'Peanuts',
        disability: 'None',
        medicalNotes: 'Healthy',
        doctorName: 'Dr. Ali',
        doctorPhone: '03001112222',
      }],
    ])('upserts — %s', async (_label, body) => {
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/health-record`)
        .query(scopeQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(200);
      expect(studentService.upsertHealthRecord).toHaveBeenCalledWith(
        STUDENT_ID,
        expect.objectContaining({ ...body, updatedById: 'admin-1' }),
      );
    });
  });

  // ─── Parent linking ─────────────────────────────────────────────────

  describe('parent endpoints', () => {
    test('POST link parent', async () => {
      const res = await request(app)
        .post(`${BASE}/${STUDENT_ID}/parents`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ parentUserId: PARENT_ID, relation: 'Father', isPrimary: true });
      expect(res.status).toBe(201);
      expect(studentService.linkParent).toHaveBeenCalledWith(
        STUDENT_ID,
        PARENT_ID,
        'Father',
        true,
        'admin-1',
      );
    });

    test('PUT creates new parent profile when no link exists', async () => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: STUDENT_ID });
      (prismaMock.studentParent.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/parent`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ name: 'New Parent', phone: '03001112222', relation: 'Guardian' });
      expect(res.status).toBe(201);
      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(prismaMock.parentProfile.create).toHaveBeenCalled();
      expect(prismaMock.studentParent.create).toHaveBeenCalled();
    });

    test('PUT updates existing parent profile', async () => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: STUDENT_ID });
      (prismaMock.studentParent.findFirst as jest.Mock).mockResolvedValue({ parentId: 'pp1' });
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/parent`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ name: 'Updated Parent', phone: '03009998888' });
      expect(res.status).toBe(200);
      expect(prismaMock.parentProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pp1' } }),
      );
    });

    test('DELETE unlinks parent', async () => {
      const res = await request(app)
        .delete(`${BASE}/${STUDENT_ID}/parents/${PARENT_ID}`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(studentService.unlinkParent).toHaveBeenCalledWith(STUDENT_ID, PARENT_ID);
    });
  });

  // ─── Credentials ────────────────────────────────────────────────────

  describe('credential endpoints', () => {
    test('PUT generate-credentials returns username and password', async () => {
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/generate-credentials`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe('ali123');
      expect(studentService.generateCredentials).toHaveBeenCalledWith(STUDENT_ID);
    });

    test('PUT set-password returns success message', async () => {
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/set-password`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ password: 'NewPass123!', adminPassword: 'AdminPass123!' });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password updated successfully');
      expect(studentService.setPassword).toHaveBeenCalledWith(
        STUDENT_ID,
        'NewPass123!',
        'admin-1',
        'AdminPass123!',
        expect.any(String),
      );
    });

    test('POST send-credentials returns sent flag', async () => {
      const res = await request(app)
        .post(`${BASE}/${STUDENT_ID}/send-credentials`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(true);
      expect(studentService.sendCredentials).toHaveBeenCalledWith(
        STUDENT_ID,
        'admin-1',
        expect.any(String),
      );
    });

    test('POST send-to-new with pending students', async () => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      const res = await request(app).post(`${BASE}/send-to-new`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(studentService.sendAllCredentials).toHaveBeenCalledWith(['s1', 's2'], 'admin-1', expect.any(String));
    });

    test('POST send-to-new when all already sent', async () => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
      const res = await request(app).post(`${BASE}/send-to-new`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(0);
      expect(res.body.data.message).toMatch(/already have credentials sent/i);
    });

    test('POST send-all-credentials with studentIds', async () => {
      const res = await request(app)
        .post(`${BASE}/send-all-credentials`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ studentIds: ['s1', 's2', 's3'] });
      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(2);
      expect(studentService.sendAllCredentials).toHaveBeenCalledWith(
        ['s1', 's2', 's3'],
        'admin-1',
        expect.any(String),
      );
    });
  });

  // ─── Status management ──────────────────────────────────────────────

  describe('PUT /admin/students/:id/status — valid status transitions', () => {
    test.each(VALID_STATUSES.map((status) => [status, status]))('%s', async (_label, status) => {
      (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({
        id: STUDENT_ID,
        status: 'ACTIVE',
        isActive: true,
      });
      const res = await request(app)
        .put(`${BASE}/${STUDENT_ID}/status`)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ status, reason: `Changed to ${status}` });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(new RegExp(status));
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });
  });

  describe('GET /admin/students/:id/status-logs', () => {
    test('returns logs in descending order', async () => {
      (prismaMock.studentStatusLog.findMany as jest.Mock).mockResolvedValue([
        { id: 'log2', previousStatus: 'SUSPENDED', newStatus: 'ACTIVE', changedBy: { id: 'u1', name: 'Admin' } },
        { id: 'log1', previousStatus: 'ACTIVE', newStatus: 'SUSPENDED', changedBy: null },
      ] as any);
      const res = await request(app).get(`${BASE}/${STUDENT_ID}/status-logs`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(prismaMock.studentStatusLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studentId: STUDENT_ID },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    test('returns empty array when no logs', async () => {
      (prismaMock.studentStatusLog.findMany as jest.Mock).mockResolvedValue([]);
      const res = await request(app).get(`${BASE}/${STUDENT_ID}/status-logs`).query(scopeQuery).set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ─── Permission matrix — restricted staff with STUDENTS access ──────

  describe('restricted staff with STUDENTS read+write can access', () => {
    beforeEach(() => {
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [{
          module: 'STUDENTS',
          canRead: true,
          canCreate: true,
          canUpdate: true,
          canDelete: true,
        }],
      });
    });

    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('super_admin passes staff permission even when resolveUserAccess is restricted', () => {
    beforeEach(() => {
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: true,
        permissions: [],
      });
    });

    test.each(ALL_ROUTES.map((ep) => [ep.label, ep]))('%s still succeeds', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(ep.successStatus);
    });
  });
});

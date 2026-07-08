/**
 * Expenses routes integration tests — supertest against Express app with mocked services.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/admin/services/expenses.service', () => ({
  expensesService: {
    getSummary: jest.fn().mockResolvedValue({ totalPaid: 0 }),
    listVouchers: jest.fn().mockResolvedValue([]),
    getVoucher: jest.fn().mockResolvedValue({ id: 'v1' }),
    voidPayment: jest.fn().mockResolvedValue({ id: 'v1', status: 'VOID' }),
    previewPayrollBulk: jest.fn().mockResolvedValue({ rows: [] }),
    recordPayrollBulk: jest.fn().mockResolvedValue({ created: 1 }),
    getPayeePayrollProfile: jest.fn().mockResolvedValue({ userId: 'u1' }),
    listPayroll: jest.fn().mockResolvedValue([]),
    recordPayrollPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    listPayrollHistory: jest.fn().mockResolvedValue([]),
    listCategories: jest.fn().mockResolvedValue([]),
    upsertCategory: jest.fn().mockResolvedValue({ id: 'c1', name: 'Electric' }),
    listUtilityProviders: jest.fn().mockResolvedValue([]),
    createUtilityProvider: jest.fn().mockResolvedValue({ id: 'pr1' }),
    duplicateLastUtilityBill: jest.fn().mockResolvedValue({ id: 'b1' }),
    updateUtilityProvider: jest.fn().mockResolvedValue({ id: 'pr1' }),
    listUtilityReminders: jest.fn().mockResolvedValue([]),
    exportPayrollCsv: jest.fn().mockResolvedValue('csv'),
    exportUtilitiesCsv: jest.fn().mockResolvedValue('csv'),
    exportOthersCsv: jest.fn().mockResolvedValue('csv'),
    listUtilities: jest.fn().mockResolvedValue([]),
    recordUtility: jest.fn().mockResolvedValue({ id: 'u1' }),
    listOthers: jest.fn().mockResolvedValue([]),
    recordOther: jest.fn().mockResolvedValue({ id: 'o1' }),
  },
}));

jest.mock('../../../src/modules/admin/services/payroll-calculation.service', () => ({
  listPayrollPayees: jest.fn().mockResolvedValue([{ userId: 'u1', name: 'Ali', payeeType: 'TEACHER', profileSalary: 50000 }]),
  computePayrollMonth: jest.fn().mockResolvedValue({ totalDue: 50000, totalPaid: 0, summary: { attendanceEarned: 50000, openingBalance: 0 } }),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import {
  adminAuth,
  branchQuery,
  scopeQuery,
  mockActiveAcademicYear,
  TEST_BRANCH_ID,
  TEST_AY_ID,
  type HttpMethod,
} from '../../helpers/integration';
import { expensesService } from '../../../src/modules/admin/services/expenses.service';
import { listPayrollPayees, computePayrollMonth } from '../../../src/modules/admin/services/payroll-calculation.service';

type RouteSpec = {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  needsScope?: boolean;
  needsBranchGet?: boolean;
  needsBranchWrite?: boolean;
  successStatus?: number;
};

const ALL_ROUTES: RouteSpec[] = [
  { label: 'GET summary', method: 'get', path: '/admin/expenses/summary', needsBranchGet: true, successStatus: 200 },
  { label: 'GET vouchers', method: 'get', path: '/admin/expenses/vouchers', needsBranchGet: true, successStatus: 200 },
  { label: 'GET voucher by id', method: 'get', path: '/admin/expenses/vouchers/v1', needsBranchGet: true, successStatus: 200 },
  { label: 'POST void voucher', method: 'post', path: '/admin/expenses/vouchers/v1/void', needsBranchWrite: true, body: { reason: 'mistake' }, successStatus: 200 },
  { label: 'GET payroll payees', method: 'get', path: '/admin/expenses/payroll/payees', needsBranchGet: true, successStatus: 200 },
  { label: 'GET payroll preview', method: 'get', path: '/admin/expenses/payroll/preview', needsScope: true, successStatus: 200 },
  { label: 'POST payroll bulk', method: 'post', path: '/admin/expenses/payroll/bulk', needsScope: true, body: { salaryMonth: '2026-07', paymentMethod: 'CASH', payments: [{ payeeUserId: 'u1', amount: 50000 }] }, successStatus: 201 },
  { label: 'GET payroll profile', method: 'get', path: '/admin/expenses/payroll/profile/u1', needsScope: true, successStatus: 200 },
  { label: 'GET payroll list', method: 'get', path: '/admin/expenses/payroll', needsScope: true, successStatus: 200 },
  { label: 'GET payroll payee', method: 'get', path: '/admin/expenses/payroll/payee/u1', needsScope: true, successStatus: 200 },
  { label: 'POST payroll payment', method: 'post', path: '/admin/expenses/payroll', needsScope: true, body: { payeeUserId: 'u1', salaryMonth: '2026-07', amount: 50000, paymentMethod: 'CASH' }, successStatus: 201 },
  { label: 'GET payroll history', method: 'get', path: '/admin/expenses/payroll/history/u1', needsBranchGet: true, successStatus: 200 },
  { label: 'GET utility categories', method: 'get', path: '/admin/expenses/utilities/categories', needsBranchGet: true, successStatus: 200 },
  { label: 'POST utility category', method: 'post', path: '/admin/expenses/utilities/categories', needsBranchWrite: true, body: { name: 'Electric' }, successStatus: 201 },
  { label: 'PATCH utility category', method: 'patch', path: '/admin/expenses/utilities/categories/cat1', needsBranchWrite: true, body: { name: 'Gas' }, successStatus: 200 },
  { label: 'GET utility providers', method: 'get', path: '/admin/expenses/utilities/providers', needsBranchGet: true, successStatus: 200 },
  { label: 'POST utility provider', method: 'post', path: '/admin/expenses/utilities/providers', needsBranchWrite: true, body: { categoryId: 'c1', name: 'K-Electric' }, successStatus: 201 },
  { label: 'POST duplicate utility bill', method: 'post', path: '/admin/expenses/utilities/duplicate-last', needsBranchWrite: true, body: { providerId: 'pr1' }, successStatus: 201 },
  { label: 'PATCH utility provider', method: 'patch', path: '/admin/expenses/utilities/providers/pr1', needsBranchWrite: true, body: { name: 'Updated' }, successStatus: 200 },
  { label: 'GET utility reminders', method: 'get', path: '/admin/expenses/utilities/reminders', needsBranchGet: true, successStatus: 200 },
  { label: 'GET export payroll', method: 'get', path: '/admin/expenses/export/payroll', needsScope: true, successStatus: 200 },
  { label: 'GET export utilities', method: 'get', path: '/admin/expenses/export/utilities', needsBranchGet: true, successStatus: 200 },
  { label: 'GET export others', method: 'get', path: '/admin/expenses/export/others', needsBranchGet: true, successStatus: 200 },
  { label: 'GET utilities', method: 'get', path: '/admin/expenses/utilities', needsBranchGet: true, successStatus: 200 },
  { label: 'POST utility payment', method: 'post', path: '/admin/expenses/utilities', needsBranchWrite: true, body: { categoryId: 'c1', providerName: 'K-Electric', amount: 5000, paymentMethod: 'CASH' }, successStatus: 201 },
  { label: 'GET other categories', method: 'get', path: '/admin/expenses/others/categories', needsBranchGet: true, successStatus: 200 },
  { label: 'POST other category', method: 'post', path: '/admin/expenses/others/categories', needsBranchWrite: true, body: { name: 'Maintenance' }, successStatus: 201 },
  { label: 'PATCH other category', method: 'patch', path: '/admin/expenses/others/categories/cat2', needsBranchWrite: true, body: { name: 'Repairs' }, successStatus: 200 },
  { label: 'GET others', method: 'get', path: '/admin/expenses/others', needsBranchGet: true, successStatus: 200 },
  { label: 'POST other payment', method: 'post', path: '/admin/expenses/others', needsBranchWrite: true, body: { categoryId: 'c2', payeeName: 'Vendor', amount: 2000, paymentMethod: 'CASH' }, successStatus: 201 },
];

const BRANCH_GET_ROUTES = ALL_ROUTES.filter((r) => r.needsBranchGet);
const BRANCH_WRITE_ROUTES = ALL_ROUTES.filter((r) => r.needsBranchWrite);
const SCOPE_ROUTES = ALL_ROUTES.filter((r) => r.needsScope);

function sendRequest(
  spec: Pick<RouteSpec, 'method' | 'path' | 'body' | 'query'>,
  opts?: { auth?: { Authorization: string }; query?: Record<string, string>; body?: Record<string, unknown> },
) {
  const query = opts?.query ?? spec.query;
  const body = opts?.body ?? spec.body;
  let req = request(app)[spec.method](spec.path);
  if (query) req = req.query(query);
  if (opts?.auth) req = req.set(opts.auth);
  if (body) req = req.send(body);
  return req;
}

describe('Expenses integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveAcademicYear();
    prismaMock.branchExpenseCategory.findFirst.mockResolvedValue({
      id: 'cat1',
      branchId: TEST_BRANCH_ID,
      kind: 'UTILITY',
      name: 'Electric',
    } as any);
    prismaMock.branchExpenseCategory.update.mockResolvedValue({
      id: 'cat1',
      name: 'Gas',
      isActive: true,
    } as any);
  });

  // ─── 1. Auth: 401 without token ─────────────────────────────────

  describe('auth — 401 without token', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec);
      expect(res.status).toBe(401);
    });
  });

  // ─── 2. branchId: 400 for GET resolveBranchId endpoints ───────────

  describe('branchId — 400 on GET without branchId', () => {
    test.each(BRANCH_GET_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  // ─── 2b. branchId: 400 for POST/PATCH resolveBranchId endpoints ───

  describe('branchId — 400 on write without branchId', () => {
    test.each(BRANCH_WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  // ─── 3. Success responses ───────────────────────────────────────

  describe('success — branch-scoped routes', () => {
    test.each(ALL_ROUTES.filter((r) => !r.needsScope).map((r) => [r.label, r] as const))(
      '%s',
      async (_label, spec) => {
        const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
        expect(res.status).toBe(spec.successStatus ?? 200);
        expect(res.body.success).toBe(true);
      },
    );
  });

  describe('success — scope-required routes', () => {
    beforeEach(() => mockActiveAcademicYear());

    test.each(SCOPE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: scopeQuery });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 4. Scope: 400 without academic year ────────────────────────

  describe('scope — 400 without academicYearId', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(SCOPE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/academic year/i);
    });
  });

  // ─── 5. POST body validation ─────────────────────────────────────

  describe('POST /admin/expenses/utilities/duplicate-last — validation', () => {
    test('400 without providerId', async () => {
      const res = await request(app)
        .post('/admin/expenses/utilities/duplicate-last')
        .query(branchQuery)
        .set(adminAuth)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/providerId is required/i);
    });

    test('201 with providerId', async () => {
      const res = await request(app)
        .post('/admin/expenses/utilities/duplicate-last')
        .query(branchQuery)
        .set(adminAuth)
        .send({ providerId: 'pr1', amount: 3000 });
      expect(res.status).toBe(201);
      expect(expensesService.duplicateLastUtilityBill).toHaveBeenCalled();
    });
  });

  describe('POST utilities/others categories — service validation', () => {
    test.each([
      ['utilities categories missing name', '/admin/expenses/utilities/categories', {}],
      ['utilities categories blank name', '/admin/expenses/utilities/categories', { name: '   ' }],
      ['others categories missing name', '/admin/expenses/others/categories', {}],
      ['others categories blank name', '/admin/expenses/others/categories', { name: '' }],
    ])('400 — %s', async (_label, path, body) => {
      (expensesService.upsertCategory as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'name is required',
      });
      const res = await request(app).post(path).query(branchQuery).set(adminAuth).send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST utility provider — service validation', () => {
    test.each([
      ['missing name', { categoryId: 'c1' }],
      ['missing categoryId', { name: 'Provider' }],
      ['empty body', {}],
    ])('400 — %s', async (_label, body) => {
      (expensesService.createUtilityProvider as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'name and categoryId are required',
      });
      const res = await request(app)
        .post('/admin/expenses/utilities/providers')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST payroll bulk — service validation', () => {
    beforeEach(() => mockActiveAcademicYear());

    test.each([
      ['missing salaryMonth', { paymentMethod: 'CASH', payments: [{ payeeUserId: 'u1', amount: 1 }] }],
      ['missing payments', { salaryMonth: '2026-07', paymentMethod: 'CASH' }],
      ['empty payments', { salaryMonth: '2026-07', paymentMethod: 'CASH', payments: [] }],
    ])('400 — %s', async (_label, body) => {
      (expensesService.recordPayrollBulk as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'salaryMonth and payments array are required',
      });
      const res = await request(app)
        .post('/admin/expenses/payroll/bulk')
        .query(scopeQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST payroll payment — service validation', () => {
    beforeEach(() => mockActiveAcademicYear());

    test.each([
      ['missing payeeUserId', { salaryMonth: '2026-07', amount: 50000, paymentMethod: 'CASH' }],
      ['missing salaryMonth', { payeeUserId: 'u1', amount: 50000, paymentMethod: 'CASH' }],
      ['zero amount', { payeeUserId: 'u1', salaryMonth: '2026-07', amount: 0, paymentMethod: 'CASH' }],
      ['missing amount', { payeeUserId: 'u1', salaryMonth: '2026-07', paymentMethod: 'CASH' }],
    ])('400 — %s', async (_label, body) => {
      (expensesService.recordPayrollPayment as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'payeeUserId, salaryMonth, and amount (>0) are required',
      });
      const res = await request(app)
        .post('/admin/expenses/payroll')
        .query(scopeQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST utility payment — service validation', () => {
    test.each([
      ['missing categoryId', { providerName: 'K-Electric', amount: 5000, paymentMethod: 'CASH' }],
      ['missing providerName', { categoryId: 'c1', amount: 5000, paymentMethod: 'CASH' }],
      ['zero amount', { categoryId: 'c1', providerName: 'K-Electric', amount: 0, paymentMethod: 'CASH' }],
      ['missing amount', { categoryId: 'c1', providerName: 'K-Electric', paymentMethod: 'CASH' }],
    ])('400 — %s', async (_label, body) => {
      (expensesService.recordUtility as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'categoryId, providerName, and amount (>0) are required',
      });
      const res = await request(app)
        .post('/admin/expenses/utilities')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST other payment — service validation', () => {
    test.each([
      ['missing categoryId', { payeeName: 'Vendor', amount: 2000, paymentMethod: 'CASH' }],
      ['missing payeeName', { categoryId: 'c2', amount: 2000, paymentMethod: 'CASH' }],
      ['zero amount', { categoryId: 'c2', payeeName: 'Vendor', amount: 0, paymentMethod: 'CASH' }],
      ['missing amount', { categoryId: 'c2', payeeName: 'Vendor', paymentMethod: 'CASH' }],
    ])('400 — %s', async (_label, body) => {
      (expensesService.recordOther as jest.Mock).mockRejectedValueOnce({
        status: 400,
        message: 'categoryId, payeeName, and amount (>0) are required',
      });
      const res = await request(app)
        .post('/admin/expenses/others')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH category not found ─────────────────────────────────────

  describe('PATCH expense categories — not found', () => {
    test.each([
      ['utility category', '/admin/expenses/utilities/categories/missing'],
      ['other category', '/admin/expenses/others/categories/missing'],
    ])('404 — %s', async (_label, path) => {
      prismaMock.branchExpenseCategory.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .patch(path)
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  // ─── Payroll payee 404 ────────────────────────────────────────────

  describe('GET /admin/expenses/payroll/payee/:userId', () => {
    beforeEach(() => mockActiveAcademicYear());

    test('404 when payee not in branch list', async () => {
      (listPayrollPayees as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/admin/expenses/payroll/payee/unknown')
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/payee not found/i);
    });

    test('200 returns computed payroll for known payee', async () => {
      const res = await request(app)
        .get('/admin/expenses/payroll/payee/u1')
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(computePayrollMonth).toHaveBeenCalled();
      expect(expensesService.listPayrollHistory).toHaveBeenCalled();
    });
  });

  // ─── Service delegation checks ────────────────────────────────────

  describe('service delegation — read endpoints', () => {
    test.each([
      ['summary', 'get', '/admin/expenses/summary', 'getSummary', branchQuery],
      ['vouchers', 'get', '/admin/expenses/vouchers', 'listVouchers', branchQuery],
      ['voucher detail', 'get', '/admin/expenses/vouchers/v1', 'getVoucher', branchQuery],
      ['payroll payees', 'get', '/admin/expenses/payroll/payees', null, branchQuery],
      ['utility categories', 'get', '/admin/expenses/utilities/categories', 'listCategories', branchQuery],
      ['utility providers', 'get', '/admin/expenses/utilities/providers', 'listUtilityProviders', branchQuery],
      ['utility reminders', 'get', '/admin/expenses/utilities/reminders', 'listUtilityReminders', branchQuery],
      ['utilities list', 'get', '/admin/expenses/utilities', 'listUtilities', branchQuery],
      ['others list', 'get', '/admin/expenses/others', 'listOthers', branchQuery],
      ['other categories', 'get', '/admin/expenses/others/categories', 'listCategories', branchQuery],
      ['payroll history', 'get', '/admin/expenses/payroll/history/u1', 'listPayrollHistory', branchQuery],
    ] as const)('%s delegates to service', async (_label, method, path, serviceKey, query) => {
      await request(app)[method](path).query(query).set(adminAuth);
      if (serviceKey) {
        expect((expensesService as any)[serviceKey]).toHaveBeenCalled();
      } else {
        expect(listPayrollPayees).toHaveBeenCalledWith(TEST_BRANCH_ID);
      }
    });
  });

  describe('service delegation — scope endpoints', () => {
    beforeEach(() => mockActiveAcademicYear());

    test.each([
      ['payroll preview', '/admin/expenses/payroll/preview', 'previewPayrollBulk'],
      ['payroll list', '/admin/expenses/payroll', 'listPayroll'],
      ['payroll profile', '/admin/expenses/payroll/profile/u1', 'getPayeePayrollProfile'],
      ['export payroll', '/admin/expenses/export/payroll', 'exportPayrollCsv'],
    ] as const)('%s', async (_label, path, serviceKey) => {
      await request(app).get(path).query(scopeQuery).set(adminAuth);
      expect((expensesService as any)[serviceKey]).toHaveBeenCalled();
    });
  });

  describe('service delegation — export endpoints', () => {
    test.each([
      ['export utilities', '/admin/expenses/export/utilities', 'exportUtilitiesCsv'],
      ['export others', '/admin/expenses/export/others', 'exportOthersCsv'],
    ] as const)('%s', async (_label, path, serviceKey) => {
      await request(app).get(path).query(branchQuery).set(adminAuth);
      expect((expensesService as any)[serviceKey]).toHaveBeenCalled();
    });
  });

  // ─── Query filter passthrough ─────────────────────────────────────

  describe('query filters — list endpoints', () => {
    test.each([
      ['vouchers from/to', '/admin/expenses/vouchers', { from: '2026-01-01', to: '2026-07-01', type: 'UTILITY', status: 'PAID' }],
      ['utilities from/to', '/admin/expenses/utilities', { from: '2026-01-01', to: '2026-07-01', categoryId: 'c1' }],
      ['others from/to', '/admin/expenses/others', { from: '2026-01-01', to: '2026-07-01', categoryId: 'c2' }],
      ['export utilities range', '/admin/expenses/export/utilities', { from: '2026-01-01', to: '2026-07-01' }],
      ['export others range', '/admin/expenses/export/others', { from: '2026-01-01', to: '2026-07-01' }],
      ['summary month', '/admin/expenses/summary', { month: '2026-07' }],
      ['payroll history month', '/admin/expenses/payroll/history/u1', { month: '2026-07' }],
    ] as const)('%s', async (_label, path, extraQuery) => {
      const res = await request(app)
        .get(path)
        .query({ ...branchQuery, ...extraQuery })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('scope query filters — payroll preview', () => {
    beforeEach(() => mockActiveAcademicYear());

    test.each([
      ['default month', {}],
      ['explicit month', { month: '2026-06' }],
      ['payeeType TEACHER', { payeeType: 'TEACHER' }],
      ['unpaidOnly', { unpaidOnly: 'true' }],
      ['missingAttendanceOnly', { missingAttendanceOnly: 'true' }],
    ])('preview %s', async (_label, extraQuery) => {
      const res = await request(app)
        .get('/admin/expenses/payroll/preview')
        .query({ ...scopeQuery, ...extraQuery })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(expensesService.previewPayrollBulk).toHaveBeenCalled();
    });
  });

  // ─── Void voucher & write success details ─────────────────────────

  describe('POST void voucher', () => {
    test('passes reason to service', async () => {
      await request(app)
        .post('/admin/expenses/vouchers/v1/void')
        .query(branchQuery)
        .set(adminAuth)
        .send({ reason: 'duplicate entry' });
      expect(expensesService.voidPayment).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        'v1',
        'admin-1',
        'duplicate entry',
      );
    });
  });

  describe('PATCH utility provider', () => {
    test('delegates update to service', async () => {
      const res = await request(app)
        .patch('/admin/expenses/utilities/providers/pr1')
        .query(branchQuery)
        .set(adminAuth)
        .send({ typicalAmount: 4500, isActive: false });
      expect(res.status).toBe(200);
      expect(expensesService.updateUtilityProvider).toHaveBeenCalledWith(
        TEST_BRANCH_ID,
        'pr1',
        expect.objectContaining({ typicalAmount: 4500, isActive: false }),
      );
    });
  });

  describe('PATCH categories success', () => {
    test.each([
      ['utility', '/admin/expenses/utilities/categories/cat1', 'UTILITY'],
      ['other', '/admin/expenses/others/categories/cat2', 'OTHER'],
    ])('%s category updates via prisma', async (_label, path, kind) => {
      const res = await request(app)
        .patch(path)
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'Renamed', isActive: false });
      expect(res.status).toBe(200);
      expect(prismaMock.branchExpenseCategory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ kind }) }),
      );
      expect(prismaMock.branchExpenseCategory.update).toHaveBeenCalled();
    });
  });

  describe('scope academic year mismatch', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({
        id: TEST_AY_ID,
        branchId: 'other-branch',
        status: 'ACTIVE',
      });
    });

    test.each(SCOPE_ROUTES.slice(0, 3).map((r) => [r.label, r] as const))(
      '400 branch mismatch — %s',
      async (_label, spec) => {
        const res = await sendRequest(spec, { auth: adminAuth, query: scopeQuery });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/does not belong/i);
      },
    );
  });
});

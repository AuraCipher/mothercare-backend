/**
 * Stationary routes — full integration matrix (auth, branchId, RBAC, validation, success).
 * Covers all 17 endpoints in stationary.routes.ts.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({
      isRestricted: false,
      isFullAdmin: true,
      permissions: [],
    }),
  },
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import {
  adminAuth,
  branchQuery,
  TEST_BRANCH_ID,
  type HttpMethod,
} from '../../helpers/integration';
import { generateTestToken, generateExpiredToken, getAuthHeader } from '../../helpers/auth';
import type { ResolvedModulePermission } from '../../../src/modules/admin/staff-permissions.constants';

const CAT_ID = 'cat-1';
const SUP_ID = 'sup-1';
const PROD_ID = 'prod-1';
const PAY_ID = 'pay-1';
const PURCHASE_ID = 'pur-1';
const OTHER_BRANCH = 'other-branch';

const wrongBranchAuth = getAuthHeader(
  generateTestToken('staff-2', 'management', { branchIds: ['branch-x'] } as any),
);
const expiredAuth = getAuthHeader(generateExpiredToken('admin-1', 'super_admin'));

function mockStaffAccess(permissions: ResolvedModulePermission[]) {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: true,
    isFullAdmin: false,
    permissions,
  });
}

function mockFullAdminAccess() {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: false,
    isFullAdmin: true,
    permissions: [],
  });
}

type RouteSpec = {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  needsBranchGet?: boolean;
  needsBranchWrite?: boolean;
  successStatus?: number;
  readAction?: boolean;
  writeAction?: boolean;
};

const ALL_ROUTES: RouteSpec[] = [
  { label: 'GET categories', method: 'get', path: '/admin/stationary/categories', needsBranchGet: true, readAction: true },
  { label: 'POST categories', method: 'post', path: '/admin/stationary/categories', needsBranchWrite: true, body: { name: 'Books' }, successStatus: 201, writeAction: true },
  { label: 'PATCH category', method: 'patch', path: `/admin/stationary/categories/${CAT_ID}`, needsBranchWrite: true, body: { name: 'Updated' }, writeAction: true },
  { label: 'GET suppliers', method: 'get', path: '/admin/stationary/suppliers', needsBranchGet: true, readAction: true },
  { label: 'GET supplier detail', method: 'get', path: `/admin/stationary/suppliers/${SUP_ID}`, needsBranchGet: true, readAction: true },
  { label: 'POST suppliers', method: 'post', path: '/admin/stationary/suppliers', needsBranchWrite: true, body: { name: 'ABC Supplies' }, successStatus: 201, writeAction: true },
  { label: 'PATCH supplier', method: 'patch', path: `/admin/stationary/suppliers/${SUP_ID}`, needsBranchWrite: true, body: { name: 'Updated Supplier' }, writeAction: true },
  { label: 'GET supplier payments', method: 'get', path: `/admin/stationary/suppliers/${SUP_ID}/payments`, needsBranchGet: true, readAction: true },
  { label: 'POST supplier payment', method: 'post', path: `/admin/stationary/suppliers/${SUP_ID}/payments`, needsBranchWrite: true, body: { amount: 1000, direction: 'WE_PAID_SUPPLIER' }, successStatus: 201, writeAction: true },
  { label: 'GET supplier restock purchases', method: 'get', path: `/admin/stationary/suppliers/${SUP_ID}/restock-purchases`, needsBranchGet: true, readAction: true },
  { label: 'GET products', method: 'get', path: '/admin/stationary/products', needsBranchGet: true, readAction: true },
  { label: 'POST products', method: 'post', path: '/admin/stationary/products', needsBranchWrite: true, body: { categoryId: CAT_ID, name: 'Notebook', unitPrice: 100 }, successStatus: 201, writeAction: true },
  { label: 'PATCH product', method: 'patch', path: `/admin/stationary/products/${PROD_ID}`, needsBranchWrite: true, body: { name: 'Updated Product' }, writeAction: true },
  { label: 'GET inventory', method: 'get', path: '/admin/stationary/inventory', needsBranchGet: true, readAction: true },
  { label: 'POST restock purchases', method: 'post', path: '/admin/stationary/restock-purchases', needsBranchWrite: true, body: { supplierId: SUP_ID, items: [{ productId: PROD_ID, quantity: 10, unitCost: 50 }] }, successStatus: 201, writeAction: true },
  { label: 'POST inventory adjust', method: 'post', path: '/admin/stationary/inventory/adjust', needsBranchWrite: true, body: { productId: PROD_ID, quantityUnits: 5 }, writeAction: true },
  { label: 'GET sales records', method: 'get', path: '/admin/stationary/sales-records', needsBranchGet: true, readAction: true },
];

const BRANCH_GET_ROUTES = ALL_ROUTES.filter((r) => r.needsBranchGet);
const BRANCH_WRITE_ROUTES = ALL_ROUTES.filter((r) => r.needsBranchWrite);
const READ_ROUTES = ALL_ROUTES.filter((r) => r.readAction);
const WRITE_ROUTES = ALL_ROUTES.filter((r) => r.writeAction);

function mockProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PROD_ID,
    branchId: TEST_BRANCH_ID,
    categoryId: CAT_ID,
    supplierId: SUP_ID,
    name: 'Notebook',
    unitPrice: 100,
    bundlePrice: null,
    unitsPerBundle: 10,
    stockBundles: 2,
    stockUnits: 5,
    lowStockThreshold: 10,
    isActive: true,
    category: { id: CAT_ID, name: 'Books' },
    supplier: { id: SUP_ID, name: 'Supplier' },
    ...overrides,
  };
}

function mockSupplier(overrides: Record<string, unknown> = {}) {
  return {
    id: SUP_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Supplier',
    contactNumber: null,
    note: null,
    isActive: true,
    balanceOwedToSupplier: 1000,
    balanceSupplierOwesUs: 200,
    ...overrides,
  };
}

function setupStationaryMocks() {
  prismaMock.stationaryCategory.findMany.mockResolvedValue([
    { id: CAT_ID, branchId: TEST_BRANCH_ID, name: 'Books', isActive: true },
  ] as any);
  prismaMock.stationaryCategory.findUnique.mockResolvedValue({
    id: CAT_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Books',
    isActive: true,
  } as any);
  prismaMock.stationaryCategory.create.mockResolvedValue({
    id: CAT_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Books',
  } as any);
  prismaMock.stationaryCategory.update.mockResolvedValue({
    id: CAT_ID,
    branchId: TEST_BRANCH_ID,
    name: 'Updated',
    isActive: true,
  } as any);

  prismaMock.stationarySupplier.findMany.mockResolvedValue([mockSupplier()] as any);
  prismaMock.stationarySupplier.findFirst.mockResolvedValue(mockSupplier() as any);
  prismaMock.stationarySupplier.findUnique.mockResolvedValue(mockSupplier() as any);
  prismaMock.stationarySupplier.create.mockResolvedValue(mockSupplier({ name: 'ABC Supplies' }) as any);
  prismaMock.stationarySupplier.update.mockResolvedValue(mockSupplier({ name: 'Updated Supplier' }) as any);

  prismaMock.stationarySupplierPayment.findMany.mockResolvedValue([
    { id: PAY_ID, amount: 500, direction: 'WE_PAID_SUPPLIER', createdBy: { name: 'Admin' } },
  ] as any);
  prismaMock.stationarySupplierPayment.create.mockResolvedValue({
    id: PAY_ID,
    amount: 1000,
    direction: 'WE_PAID_SUPPLIER',
    createdBy: { name: 'Admin' },
  } as any);

  prismaMock.stationaryRestockPurchase.findMany.mockResolvedValue([
    { id: PURCHASE_ID, totalCost: 500, items: [{ product: { name: 'Notebook' } }], createdBy: { name: 'Admin' } },
  ] as any);
  prismaMock.stationaryRestockPurchase.create.mockResolvedValue({ id: PURCHASE_ID, totalCost: 500 } as any);
  prismaMock.stationaryRestockPurchase.findUnique.mockResolvedValue({
    id: PURCHASE_ID,
    totalCost: 500,
    items: [{ product: { name: 'Notebook' } }],
    createdBy: { name: 'Admin' },
  } as any);

  prismaMock.stationaryPurchaseItem.create.mockResolvedValue({ id: 'pi-1' } as any);

  prismaMock.stationaryProduct.findMany.mockResolvedValue([mockProduct()] as any);
  prismaMock.stationaryProduct.findFirst.mockResolvedValue(mockProduct() as any);
  prismaMock.stationaryProduct.findUnique.mockResolvedValue(mockProduct() as any);
  prismaMock.stationaryProduct.create.mockResolvedValue(mockProduct() as any);
  prismaMock.stationaryProduct.update.mockResolvedValue(mockProduct({ name: 'Updated Product' }) as any);

  prismaMock.stationaryStockMovement.create.mockResolvedValue({ id: 'mov-1' } as any);

  prismaMock.studentStationaryRecord.findMany.mockResolvedValue([
    {
      id: 'rec-1',
      branchId: TEST_BRANCH_ID,
      student: { id: 's1', name: 'Ali', rollNumber: '101', group: { name: 'A', section: '1' } },
      studentFee: { id: 'sf-1', month: 7, year: 2026 },
      items: [],
    },
  ] as any);

  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
}

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

describe('Stationary full integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupStationaryMocks();
    mockFullAdminAccess();
  });

  // ─── 1. Auth matrix ─────────────────────────────────────────────

  describe('auth — 401 without token', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { query: branchQuery });
      expect(res.status).toBe(401);
    });
  });

  describe('auth — 401 with expired token', () => {
    test.each(ALL_ROUTES.slice(0, 5).map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: expiredAuth, query: branchQuery });
      expect(res.status).toBe(401);
    });
  });

  // ─── 2. branchId matrix ───────────────────────────────────────────

  describe('branchId — 400 on GET without branchId', () => {
    test.each(BRANCH_GET_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  describe('branchId — 400 on write without branchId', () => {
    test.each(BRANCH_WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  describe('branchId — accepts branchId in POST body', () => {
    test.each([
      ['POST categories', '/admin/stationary/categories', { branchId: TEST_BRANCH_ID, name: 'Pens' }],
      ['POST suppliers', '/admin/stationary/suppliers', { branchId: TEST_BRANCH_ID, name: 'Vendor' }],
      ['POST products', '/admin/stationary/products', { branchId: TEST_BRANCH_ID, categoryId: CAT_ID, name: 'Pen', unitPrice: 50 }],
    ] as const)('%s', async (_label, path, body) => {
      const res = await request(app).post(path).set(adminAuth).send(body);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('branch scope — 403 for wrong branch', () => {
    test.each(READ_ROUTES.slice(0, 4).map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: wrongBranchAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/access denied/i);
    });
  });

  // ─── 3. RBAC matrix ───────────────────────────────────────────────

  describe('RBAC — 403 without STATIONARY permission (read)', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'FEES', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test.each(READ_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no read permission for stationary/i);
    });
  });

  describe('RBAC — 403 without STATIONARY permission (write)', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'FEES', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test.each(WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no (create|update) permission for stationary/i);
    });
  });

  describe('RBAC — read-only staff can GET', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'STATIONARY', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(READ_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RBAC — read-only staff cannot write', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'STATIONARY', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no (create|update) permission for stationary/i);
    });
  });

  describe('RBAC — create staff can POST', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'STATIONARY', canCreate: true, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(
      BRANCH_WRITE_ROUTES.filter((r) => r.method === 'post').map((r) => [r.label, r] as const),
    )('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      const expectedStatus = spec.path.includes('/inventory/adjust') ? 200 : (spec.successStatus ?? 201);
      expect(res.status).toBe(expectedStatus);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RBAC — update staff can PATCH', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'STATIONARY', canCreate: false, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test.each(
      BRANCH_WRITE_ROUTES.filter((r) => r.method === 'patch').map((r) => [r.label, r] as const),
    )('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RBAC — resolveUserAccess consulted for stationary routes', () => {
    test.each(READ_ROUTES.slice(0, 4).map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(staffService.resolveUserAccess).toHaveBeenCalledWith(
        'admin-1',
        TEST_BRANCH_ID,
        'super_admin',
      );
    });
  });

  // ─── 4. Success matrix ────────────────────────────────────────────

  describe('success — all routes with branchId', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 5. Validation matrix ───────────────────────────────────────

  describe('POST /admin/stationary/categories — validation', () => {
    test.each([
      ['missing name', {}],
      ['blank name', { name: '   ' }],
      ['empty name', { name: '' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/stationary/categories')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/i);
    });
  });

  describe('POST /admin/stationary/suppliers — validation', () => {
    test.each([
      ['missing name', {}],
      ['blank name', { name: '  ' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/stationary/suppliers')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/i);
    });
  });

  describe('POST /admin/stationary/suppliers/:id/payments — validation', () => {
    test.each([
      ['zero amount', { amount: 0, direction: 'WE_PAID_SUPPLIER' }],
      ['negative amount', { amount: -100, direction: 'WE_PAID_SUPPLIER' }],
      ['missing direction', { amount: 500 }],
      ['invalid direction', { amount: 500, direction: 'INVALID' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post(`/admin/stationary/suppliers/${SUP_ID}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /admin/stationary/products — validation', () => {
    test.each([
      ['missing categoryId', { name: 'Pen', unitPrice: 50 }],
      ['missing name', { categoryId: CAT_ID, unitPrice: 50 }],
      ['blank name', { categoryId: CAT_ID, name: '  ', unitPrice: 50 }],
      ['zero unitPrice', { categoryId: CAT_ID, name: 'Pen', unitPrice: 0 }],
      ['negative unitPrice', { categoryId: CAT_ID, name: 'Pen', unitPrice: -10 }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/stationary/products')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/categoryId, name and unitPrice are required/i);
    });
  });

  describe('POST /admin/stationary/restock-purchases — validation', () => {
    test('400 without supplierId', async () => {
      const res = await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ items: [{ productId: PROD_ID, quantity: 1, unitCost: 10 }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/supplierId and items are required/i);
    });

    test('400 with empty items', async () => {
      const res = await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ supplierId: SUP_ID, items: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/supplierId and items are required/i);
    });

    test.each([
      ['missing productId', { productId: '', quantity: 1, unitCost: 10 }],
      ['zero quantity', { productId: PROD_ID, quantity: 0, unitCost: 10 }],
      ['fractional quantity', { productId: PROD_ID, quantity: 1.5, unitCost: 10 }],
      ['negative unitCost', { productId: PROD_ID, quantity: 1, unitCost: -1 }],
    ])('400 — invalid item: %s', async (_label, item) => {
      const res = await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ supplierId: SUP_ID, items: [item] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/productId, positive quantity and non-negative unitCost/i);
    });

    test('404 when supplier not in branch', async () => {
      prismaMock.stationarySupplier.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ supplierId: SUP_ID, items: [{ productId: PROD_ID, quantity: 1, unitCost: 10 }] });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/supplier not found/i);
    });

    test('404 when product not in branch', async () => {
      prismaMock.stationaryProduct.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ supplierId: SUP_ID, items: [{ productId: PROD_ID, quantity: 1, unitCost: 10 }] });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/product not found in branch/i);
    });
  });

  describe('POST /admin/stationary/inventory/adjust — validation', () => {
    test('400 without productId', async () => {
      const res = await request(app)
        .post('/admin/stationary/inventory/adjust')
        .query(branchQuery)
        .set(adminAuth)
        .send({ quantityUnits: 5 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/productId is required/i);
    });

    test('400 with zero deltas', async () => {
      const res = await request(app)
        .post('/admin/stationary/inventory/adjust')
        .query(branchQuery)
        .set(adminAuth)
        .send({ productId: PROD_ID, quantityBundles: 0, quantityUnits: 0 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/quantityBundles or quantityUnits is required/i);
    });

    test('400 insufficient stock on underflow', async () => {
      prismaMock.stationaryProduct.findUnique.mockResolvedValueOnce({
        ...mockProduct(),
        stockBundles: 0,
        stockUnits: 1,
      } as any);
      const res = await request(app)
        .post('/admin/stationary/inventory/adjust')
        .query(branchQuery)
        .set(adminAuth)
        .send({ productId: PROD_ID, quantityUnits: -5 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/insufficient stock/i);
    });

    test('404 when product not in branch', async () => {
      prismaMock.stationaryProduct.findUnique.mockResolvedValueOnce({
        ...mockProduct(),
        branchId: OTHER_BRANCH,
      } as any);
      const res = await request(app)
        .post('/admin/stationary/inventory/adjust')
        .query(branchQuery)
        .set(adminAuth)
        .send({ productId: PROD_ID, quantityUnits: 1 });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/product not found/i);
    });
  });

  // ─── 6. Not-found matrix ─────────────────────────────────────────

  describe('PATCH/PATCH entities — 404 not found', () => {
    test('PATCH category wrong branch', async () => {
      prismaMock.stationaryCategory.findUnique.mockResolvedValueOnce({
        id: CAT_ID,
        branchId: OTHER_BRANCH,
        name: 'Books',
      } as any);
      const res = await request(app)
        .patch(`/admin/stationary/categories/${CAT_ID}`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/category not found/i);
    });

    test('PATCH supplier wrong branch', async () => {
      prismaMock.stationarySupplier.findUnique.mockResolvedValueOnce({
        ...mockSupplier(),
        branchId: OTHER_BRANCH,
      } as any);
      const res = await request(app)
        .patch(`/admin/stationary/suppliers/${SUP_ID}`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/supplier not found/i);
    });

    test('PATCH product wrong branch', async () => {
      prismaMock.stationaryProduct.findUnique.mockResolvedValueOnce({
        ...mockProduct(),
        branchId: OTHER_BRANCH,
      } as any);
      const res = await request(app)
        .patch(`/admin/stationary/products/${PROD_ID}`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/product not found/i);
    });

    test('GET supplier detail not found', async () => {
      prismaMock.stationarySupplier.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .get(`/admin/stationary/suppliers/${SUP_ID}`)
        .query(branchQuery)
        .set(adminAuth);
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/supplier not found/i);
    });

    test('GET supplier payments not found', async () => {
      prismaMock.stationarySupplier.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .get(`/admin/stationary/suppliers/${SUP_ID}/payments`)
        .query(branchQuery)
        .set(adminAuth);
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/supplier not found/i);
    });

    test('POST supplier payment not found', async () => {
      prismaMock.stationarySupplier.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .post(`/admin/stationary/suppliers/${SUP_ID}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ amount: 500, direction: 'WE_PAID_SUPPLIER' });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/supplier not found/i);
    });
  });

  // ─── 7. Query filters & detail responses ────────────────────────

  describe('GET products — activeOnly filter', () => {
    test('defaults to activeOnly=true', async () => {
      await request(app)
        .get('/admin/stationary/products')
        .query(branchQuery)
        .set(adminAuth);
      expect(prismaMock.stationaryProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: TEST_BRANCH_ID, isActive: true }),
        }),
      );
    });

    test('activeOnly=false includes inactive', async () => {
      await request(app)
        .get('/admin/stationary/products')
        .query({ ...branchQuery, activeOnly: 'false' })
        .set(adminAuth);
      expect(prismaMock.stationaryProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { branchId: TEST_BRANCH_ID },
        }),
      );
    });
  });

  describe('GET supplier detail — detail=true', () => {
    test('returns stats, purchases, and payments', async () => {
      const res = await request(app)
        .get(`/admin/stationary/suppliers/${SUP_ID}`)
        .query({ ...branchQuery, detail: 'true' })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.purchases).toBeDefined();
      expect(res.body.data.payments).toBeDefined();
      expect(prismaMock.stationaryRestockPurchase.findMany).toHaveBeenCalled();
      expect(prismaMock.stationarySupplierPayment.findMany).toHaveBeenCalled();
    });
  });

  describe('GET sales-records — search filter', () => {
    test('passes search to prisma', async () => {
      await request(app)
        .get('/admin/stationary/sales-records')
        .query({ ...branchQuery, search: 'ali' })
        .set(adminAuth);
      expect(prismaMock.studentStationaryRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: TEST_BRANCH_ID,
            student: { name: { contains: 'ali', mode: 'insensitive' } },
          }),
        }),
      );
    });
  });

  // ─── 8. Prisma delegation ─────────────────────────────────────────

  describe('prisma delegation — read endpoints', () => {
    test.each([
      ['categories', '/admin/stationary/categories', 'stationaryCategory', 'findMany'],
      ['suppliers', '/admin/stationary/suppliers', 'stationarySupplier', 'findMany'],
      ['products', '/admin/stationary/products', 'stationaryProduct', 'findMany'],
      ['inventory', '/admin/stationary/inventory', 'stationaryProduct', 'findMany'],
      ['sales records', '/admin/stationary/sales-records', 'studentStationaryRecord', 'findMany'],
      ['supplier payments', `/admin/stationary/suppliers/${SUP_ID}/payments`, 'stationarySupplierPayment', 'findMany'],
      ['supplier restock', `/admin/stationary/suppliers/${SUP_ID}/restock-purchases`, 'stationaryRestockPurchase', 'findMany'],
    ] as const)('GET %s', async (_label, path, model, method) => {
      await request(app).get(path).query(branchQuery).set(adminAuth);
      expect((prismaMock as any)[model][method]).toHaveBeenCalled();
    });
  });

  describe('prisma delegation — write endpoints', () => {
    test('POST category creates row', async () => {
      await request(app)
        .post('/admin/stationary/categories')
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'Pens' });
      expect(prismaMock.stationaryCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ branchId: TEST_BRANCH_ID, name: 'Pens' }) }),
      );
    });

    test('POST supplier creates row', async () => {
      await request(app)
        .post('/admin/stationary/suppliers')
        .query(branchQuery)
        .set(adminAuth)
        .send({ name: 'Vendor', contactNumber: '0300', note: 'Main' });
      expect(prismaMock.stationarySupplier.create).toHaveBeenCalled();
    });

    test('POST product creates row', async () => {
      await request(app)
        .post('/admin/stationary/products')
        .query(branchQuery)
        .set(adminAuth)
        .send({ categoryId: CAT_ID, name: 'Eraser', unitPrice: 25, stockUnits: 50 });
      expect(prismaMock.stationaryProduct.create).toHaveBeenCalled();
    });
  });

  // ─── 9. Transaction side-effects ──────────────────────────────────

  describe('POST supplier payment — balance update', () => {
    test('WE_PAID_SUPPLIER reduces balance owed', async () => {
      await request(app)
        .post(`/admin/stationary/suppliers/${SUP_ID}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ amount: 500, direction: 'WE_PAID_SUPPLIER' });
      expect(prismaMock.stationarySupplierPayment.create).toHaveBeenCalled();
      expect(prismaMock.stationarySupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balanceOwedToSupplier: 500 }),
        }),
      );
    });

    test('SUPPLIER_PAID_US reduces they-owe-us balance', async () => {
      await request(app)
        .post(`/admin/stationary/suppliers/${SUP_ID}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send({ amount: 100, direction: 'SUPPLIER_PAID_US' });
      expect(prismaMock.stationarySupplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balanceSupplierOwesUs: 100 }),
        }),
      );
    });
  });

  describe('POST restock purchase — stock movement', () => {
    test('creates purchase items and stock movements', async () => {
      await request(app)
        .post('/admin/stationary/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send({ supplierId: SUP_ID, items: [{ productId: PROD_ID, quantity: 10, unitCost: 50 }] });
      expect(prismaMock.stationaryRestockPurchase.create).toHaveBeenCalled();
      expect(prismaMock.stationaryPurchaseItem.create).toHaveBeenCalled();
      expect(prismaMock.stationaryStockMovement.create).toHaveBeenCalled();
      expect(prismaMock.stationarySupplier.update).toHaveBeenCalled();
    });
  });

  describe('POST inventory adjust — stock movement', () => {
    test('creates adjustment movement', async () => {
      await request(app)
        .post('/admin/stationary/inventory/adjust')
        .query(branchQuery)
        .set(adminAuth)
        .send({ productId: PROD_ID, quantityUnits: 3, note: 'Found extra' });
      expect(prismaMock.stationaryProduct.update).toHaveBeenCalled();
      expect(prismaMock.stationaryStockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'ADJUSTMENT',
            quantityUnits: 3,
            note: 'Found extra',
          }),
        }),
      );
    });
  });
});

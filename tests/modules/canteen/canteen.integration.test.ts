/**
 * Canteen routes integration tests — supertest against Express app with mocked Prisma.
 * Covers all ~27 /admin/canteen/* endpoints.
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

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import { TEST_BRANCH_ID } from '../../helpers/integration';

const branchId = TEST_BRANCH_ID;
const branchQuery = { branchId };

const adminAuth = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const staffAuth = getAuthHeader(
  generateTestToken('staff-1', 'management', { branchIds: [branchId] } as Record<string, unknown>),
);
const mgmtAdminAuth = getAuthHeader(
  generateTestToken('mgr-1', 'management', { branchIds: [branchId] } as Record<string, unknown>),
);
const teacherAuth = getAuthHeader(
  generateTestToken('teacher-1', 'teacher', { branchIds: [branchId] } as Record<string, unknown>),
);

const catId = 'cat1';
const supId = 'sup1';
const prodId = 'p1';
const acctId = 'a1';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

type RouteSpec = {
  label: string;
  method: HttpMethod;
  path: string;
  access: 'sales' | 'admin';
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  successStatus?: number;
};

const ALL_ROUTES: RouteSpec[] = [
  { label: 'GET products', method: 'get', path: '/admin/canteen/products', access: 'sales', successStatus: 200 },
  {
    label: 'GET credit-persons',
    method: 'get',
    path: '/admin/canteen/credit-persons',
    access: 'sales',
    query: { type: 'STUDENT' },
    successStatus: 200,
  },
  { label: 'GET credit-classes', method: 'get', path: '/admin/canteen/credit-classes', access: 'sales', successStatus: 200 },
  { label: 'GET accounts', method: 'get', path: '/admin/canteen/accounts', access: 'sales', successStatus: 200 },
  { label: 'GET account by id', method: 'get', path: `/admin/canteen/accounts/${acctId}`, access: 'sales', successStatus: 200 },
  {
    label: 'GET account detail',
    method: 'get',
    path: `/admin/canteen/accounts/${acctId}`,
    access: 'sales',
    query: { detail: 'true' },
    successStatus: 200,
  },
  {
    label: 'GET account payments',
    method: 'get',
    path: `/admin/canteen/accounts/${acctId}/payments`,
    access: 'sales',
    successStatus: 200,
  },
  {
    label: 'GET account sales',
    method: 'get',
    path: `/admin/canteen/accounts/${acctId}/sales`,
    access: 'sales',
    successStatus: 200,
  },
  {
    label: 'POST sales',
    method: 'post',
    path: '/admin/canteen/sales',
    access: 'sales',
    body: { paymentType: 'CASH', items: [{ productId: prodId, quantity: 1 }] },
    successStatus: 201,
  },
  { label: 'GET sales', method: 'get', path: '/admin/canteen/sales', access: 'sales', successStatus: 200 },
  {
    label: 'GET summary',
    method: 'get',
    path: '/admin/canteen/summary',
    access: 'sales',
    query: { date: '2026-07-05' },
    successStatus: 200,
  },
  { label: 'GET categories', method: 'get', path: '/admin/canteen/categories', access: 'admin', successStatus: 200 },
  {
    label: 'POST categories',
    method: 'post',
    path: '/admin/canteen/categories',
    access: 'admin',
    body: { name: 'Snacks' },
    successStatus: 201,
  },
  {
    label: 'PATCH categories',
    method: 'patch',
    path: `/admin/canteen/categories/${catId}`,
    access: 'admin',
    body: { name: 'Drinks' },
    successStatus: 200,
  },
  { label: 'GET suppliers', method: 'get', path: '/admin/canteen/suppliers', access: 'admin', successStatus: 200 },
  {
    label: 'GET supplier by id',
    method: 'get',
    path: `/admin/canteen/suppliers/${supId}`,
    access: 'admin',
    successStatus: 200,
  },
  {
    label: 'GET supplier detail',
    method: 'get',
    path: `/admin/canteen/suppliers/${supId}`,
    access: 'admin',
    query: { detail: 'true' },
    successStatus: 200,
  },
  {
    label: 'GET supplier restock-purchases',
    method: 'get',
    path: `/admin/canteen/suppliers/${supId}/restock-purchases`,
    access: 'admin',
    successStatus: 200,
  },
  {
    label: 'POST suppliers',
    method: 'post',
    path: '/admin/canteen/suppliers',
    access: 'admin',
    body: { name: 'Fresh Foods' },
    successStatus: 201,
  },
  {
    label: 'PATCH suppliers',
    method: 'patch',
    path: `/admin/canteen/suppliers/${supId}`,
    access: 'admin',
    body: { contactNumber: '03001234567' },
    successStatus: 200,
  },
  {
    label: 'GET supplier payments',
    method: 'get',
    path: `/admin/canteen/suppliers/${supId}/payments`,
    access: 'admin',
    successStatus: 200,
  },
  {
    label: 'POST supplier payments',
    method: 'post',
    path: `/admin/canteen/suppliers/${supId}/payments`,
    access: 'admin',
    body: { amount: 500, direction: 'WE_PAID_SUPPLIER' },
    successStatus: 201,
  },
  {
    label: 'POST products',
    method: 'post',
    path: '/admin/canteen/products',
    access: 'admin',
    body: { categoryId: catId, name: 'Chips', unitPrice: 50 },
    successStatus: 201,
  },
  {
    label: 'PATCH products',
    method: 'patch',
    path: `/admin/canteen/products/${prodId}`,
    access: 'admin',
    body: { unitPrice: 55 },
    successStatus: 200,
  },
  {
    label: 'DELETE products',
    method: 'delete',
    path: `/admin/canteen/products/${prodId}`,
    access: 'admin',
    successStatus: 200,
  },
  {
    label: 'POST restock-purchases',
    method: 'post',
    path: '/admin/canteen/restock-purchases',
    access: 'admin',
    body: { supplierId: supId, items: [{ productId: prodId, quantity: 5, unitCost: 40 }] },
    successStatus: 201,
  },
  {
    label: 'GET restock-purchases',
    method: 'get',
    path: '/admin/canteen/restock-purchases',
    access: 'admin',
    successStatus: 200,
  },
  {
    label: 'POST accounts',
    method: 'post',
    path: '/admin/canteen/accounts',
    access: 'admin',
    body: { personType: 'STUDENT', studentId: 's1' },
    successStatus: 201,
  },
  {
    label: 'POST account payments',
    method: 'post',
    path: `/admin/canteen/accounts/${acctId}/payments`,
    access: 'admin',
    body: { amountPaid: 100 },
    successStatus: 201,
  },
];

const SALES_ROUTES = ALL_ROUTES.filter((r) => r.access === 'sales');
const ADMIN_ROUTES = ALL_ROUTES.filter((r) => r.access === 'admin');

function sendRequest(
  spec: Pick<RouteSpec, 'method' | 'path' | 'body' | 'query'>,
  opts?: {
    auth?: { Authorization: string };
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  },
) {
  const query = { ...spec.query, ...opts?.query };
  const body = opts?.body ?? spec.body;
  let req = request(app)[spec.method](spec.path);
  if (Object.keys(query).length > 0) req = req.query(query);
  if (opts?.auth) req = req.set(opts.auth);
  if (body && spec.method !== 'get' && spec.method !== 'delete') req = req.send(body);
  return req;
}

function mockCanteenStaffMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-staff',
    branchId,
    userId: 'staff-1',
    role: 'canteen_staff',
    isActive: true,
  } as any);
}

function mockManagementAdminMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-mgmt',
    branchId,
    userId: 'mgr-1',
    role: 'management',
    isActive: true,
  } as any);
}

function mockTeacherMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-teacher',
    branchId,
    userId: 'teacher-1',
    role: 'teacher',
    isActive: true,
  } as any);
}

function mockInactiveMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-inactive',
    branchId,
    userId: 'staff-1',
    role: 'canteen_staff',
    isActive: false,
  } as any);
}

const sampleProduct = {
  id: prodId,
  branchId,
  name: 'Chips',
  unitPrice: 50,
  stockBoxes: 0,
  stockUnits: 20,
  unitsPerBox: 1,
  isActive: true,
  categoryId: catId,
};

function setupPrismaSuccessMocks() {
  const sampleProductP2 = { ...sampleProduct, id: 'p2', name: 'Juice' };

  prismaMock.canteenProductCategory.findMany.mockResolvedValue([
    { id: catId, name: 'Snacks', isActive: true },
  ] as any);
  (prismaMock.canteenProductCategory.findFirst as jest.Mock).mockImplementation(async (args: any) => {
    const where = args?.where;
    if (!where) return null;
    if (where.id === catId) {
      return { id: catId, branchId, name: 'Snacks', isActive: true } as any;
    }
    if (where.name) return null;
    return null;
  });
  prismaMock.canteenProductCategory.create.mockResolvedValue({
    id: catId,
    name: 'Snacks',
    isActive: true,
  } as any);
  prismaMock.canteenProductCategory.update.mockResolvedValue({
    id: catId,
    name: 'Drinks',
    isActive: true,
  } as any);

  prismaMock.canteenSupplier.findMany.mockResolvedValue([
    {
      id: supId,
      branchId,
      name: 'Fresh Foods',
      balanceOwedToSupplier: 0,
      balanceSupplierOwesUs: 0,
    },
  ] as any);
  (prismaMock.canteenSupplier.findFirst as jest.Mock).mockImplementation(async (args: any) => {
    const where = args?.where;
    if (!where) return null;
    if (where.id === supId) {
      return {
        id: supId,
        branchId,
        name: 'Fresh Foods',
        isActive: true,
        balanceOwedToSupplier: 0,
        balanceSupplierOwesUs: 0,
      } as any;
    }
    if (where.name) return null;
    return null;
  });
  prismaMock.canteenSupplier.create.mockResolvedValue({
    id: supId,
    name: 'Fresh Foods',
  } as any);
  prismaMock.canteenSupplier.update.mockResolvedValue({
    id: supId,
    name: 'Fresh Foods',
    contactNumber: '03001234567',
  } as any);
  (prismaMock.canteenRestockPurchase.groupBy as jest.Mock).mockResolvedValue([]);
  prismaMock.canteenSupplierPayment.findMany.mockResolvedValue([]);
  prismaMock.canteenSupplierPayment.create.mockResolvedValue({
    id: 'sp1',
    amount: 500,
    direction: 'WE_PAID_SUPPLIER',
  } as any);
  prismaMock.canteenRestockPurchase.findMany.mockResolvedValue([
    { id: 'rp1', supplierId: supId, totalCost: 200, items: [] },
  ] as any);
  prismaMock.canteenRestockPurchase.create.mockResolvedValue({
    id: 'rp1',
    supplierId: supId,
    totalCost: 200,
    items: [],
  } as any);

  (prismaMock.canteenProduct.findMany as jest.Mock).mockImplementation(async (args: any) => {
    const ids = args?.where?.id?.in as string[] | undefined;
    if (ids) {
      return ids.map((id) => (id === 'p2' ? sampleProductP2 : { ...sampleProduct, id })) as any;
    }
    return [sampleProduct] as any;
  });
  (prismaMock.canteenProduct.findFirst as jest.Mock).mockImplementation(async (args: any) => {
    const where = args?.where;
    if (!where) return null;
    if (where.id === prodId) return sampleProduct as any;
    if (where.id === 'p2') return sampleProductP2 as any;
    if (where.name && where.categoryId) return null;
    return null;
  });
  prismaMock.canteenProduct.create.mockResolvedValue({
    ...sampleProduct,
    category: { id: catId, name: 'Snacks' },
    supplier: null,
  } as any);
  prismaMock.canteenProduct.update.mockResolvedValue({
    ...sampleProduct,
    unitPrice: 55,
    category: { id: catId, name: 'Snacks' },
    supplier: null,
  } as any);

  prismaMock.canteenAccount.findMany.mockResolvedValue([
    { id: acctId, displayName: 'Ali', runningBalance: 0, isActive: true },
  ] as any);
  prismaMock.canteenAccount.findFirst.mockResolvedValue({
    id: acctId,
    branchId,
    displayName: 'Ali',
    runningBalance: 100,
    isActive: true,
    student: { id: 's1', name: 'Ali', rollNumber: '101' },
    user: null,
  } as any);
  prismaMock.canteenAccount.create.mockResolvedValue({
    id: acctId,
    displayName: 'Ali',
    runningBalance: 0,
  } as any);
  prismaMock.canteenAccount.update.mockResolvedValue({
    id: acctId,
    runningBalance: 0,
  } as any);
  prismaMock.canteenAccountPayment.findMany.mockResolvedValue([]);
  prismaMock.canteenAccountPayment.create.mockResolvedValue({
    id: 'ap1',
    amountPaid: 100,
  } as any);

  prismaMock.canteenSale.findMany.mockResolvedValue([
    {
      id: 'sale1',
      paymentType: 'CASH',
      totalAmount: 50,
      items: [{ productId: prodId, quantity: 1, unitPriceAtSale: 50, product: { name: 'Chips' } }],
    },
  ] as any);
  prismaMock.canteenSale.create.mockResolvedValue({
    id: 'sale1',
    paymentType: 'CASH',
    totalAmount: 50,
    items: [],
  } as any);

  prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', branchId, status: 'ACTIVE' } as any);
  prismaMock.student.findMany.mockResolvedValue([{ id: 's1', name: 'Ali', rollNumber: '101' }] as any);
  prismaMock.student.findFirst.mockResolvedValue({
    id: 's1',
    name: 'Ali',
    rollNumber: '101',
    phone: '0300',
    branchId,
    isActive: true,
    status: 'ACTIVE',
  } as any);
  prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Class 5', section: 'A' }] as any);
  prismaMock.branchMember.findMany.mockResolvedValue([]);
}

describe('Canteen integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
      isRestricted: false,
      isFullAdmin: true,
      permissions: [],
    });
    setupPrismaSuccessMocks();
  });

  // ─── 1. Auth: 401 without token ─────────────────────────────────

  describe('auth — 401 without token', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 2. branchId: 400 without branchId ──────────────────────────

  describe('branchId — 400 without branchId', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/branchId is required/i);
    });
  });

  // ─── 3. Wrong role: canteen_staff blocked from admin routes ─────

  describe('role — 403 canteen_staff on admin routes', () => {
    beforeEach(() => mockCanteenStaffMembership());

    test.each(ADMIN_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: staffAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/admin canteen access required/i);
    });
  });

  // ─── 4. Wrong role: teacher denied on all routes ────────────────

  describe('role — 403 teacher on all routes', () => {
    beforeEach(() => mockTeacherMembership());

    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: teacherAuth, query: branchQuery });
      expect(res.status).toBe(403);
    });
  });

  // ─── 5. Inactive member ───────────────────────────────────────────

  describe('role — 403 inactive branch member', () => {
    beforeEach(() => mockInactiveMembership());

    test.each([
      ['GET products', SALES_ROUTES[0]],
      ['GET categories', ADMIN_ROUTES[0]],
      ['POST sales', SALES_ROUTES.find((r) => r.label === 'POST sales')!],
    ] as const)('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: staffAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not an active member/i);
    });
  });

  // ─── 6. Wrong branch access ─────────────────────────────────────

  describe('role — 403 wrong branch in token', () => {
    const wrongBranchAuth = getAuthHeader(
      generateTestToken('staff-2', 'management', { branchIds: ['other-branch'] } as Record<string, unknown>),
    );

    test.each([
      ['GET products', SALES_ROUTES[0]],
      ['GET categories', ADMIN_ROUTES[0]],
      ['POST suppliers', ADMIN_ROUTES.find((r) => r.label === 'POST suppliers')!],
    ] as const)('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: wrongBranchAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/do not have access to this branch/i);
    });
  });

  // ─── 7. Success — super_admin on all routes ─────────────────────

  describe('success — super_admin all routes', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth, query: branchQuery });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 8. Success — canteen_staff on sales routes ─────────────────

  describe('success — canteen_staff sales routes', () => {
    beforeEach(() => mockCanteenStaffMembership());

    test.each(SALES_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: staffAuth, query: branchQuery });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 9. Success — management admin on admin routes ──────────────

  describe('success — management admin routes', () => {
    beforeEach(() => mockManagementAdminMembership());

    test.each(ADMIN_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: mgmtAdminAuth, query: branchQuery });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 10. POST body validation ─────────────────────────────────────

  describe('POST /admin/canteen/categories — validation', () => {
    test.each([
      ['missing name', {}],
      ['blank name', { name: '   ' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/categories')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/i);
    });
  });

  describe('POST /admin/canteen/suppliers — validation', () => {
    test.each([
      ['missing name', {}],
      ['blank name', { name: '' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/suppliers')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/i);
    });
  });

  describe('POST /admin/canteen/products — validation', () => {
    test.each([
      ['missing categoryId', { name: 'Chips', unitPrice: 50 }],
      ['missing name', { categoryId: catId, unitPrice: 50 }],
      ['missing unitPrice', { categoryId: catId, name: 'Chips' }],
      ['blank name', { categoryId: catId, name: '  ', unitPrice: 50 }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/products')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/required/i);
    });
  });

  describe('POST /admin/canteen/sales — validation', () => {
    beforeEach(() => mockCanteenStaffMembership());

    test.each([
      ['missing paymentType', { items: [{ productId: prodId, quantity: 1 }] }],
      ['invalid paymentType', { paymentType: 'CARD', items: [{ productId: prodId, quantity: 1 }] }],
      ['empty items', { paymentType: 'CASH', items: [] }],
      ['zero quantity', { paymentType: 'CASH', items: [{ productId: prodId, quantity: 0 }] }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/sales')
        .query(branchQuery)
        .set(staffAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /admin/canteen/restock-purchases — validation', () => {
    test.each([
      ['missing supplierId', { items: [{ productId: prodId, quantity: 5, unitCost: 40 }] }],
      ['missing items', { supplierId: supId }],
      ['empty items', { supplierId: supId, items: [] }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/restock-purchases')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/required/i);
    });
  });

  describe('POST /admin/canteen/accounts — validation', () => {
    test.each([
      ['missing personType', { studentId: 's1' }],
      ['invalid personType', { personType: 'INVALID', studentId: 's1' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post('/admin/canteen/accounts')
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/personType/i);
    });
  });

  describe('POST /admin/canteen/accounts/:id/payments — validation', () => {
    test.each([
      ['missing amountPaid', { note: 'partial' }],
      ['zero amountPaid', { amountPaid: 0 }],
      ['negative amountPaid', { amountPaid: -10 }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post(`/admin/canteen/accounts/${acctId}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/positive/i);
    });
  });

  describe('POST /admin/canteen/suppliers/:id/payments — validation', () => {
    test.each([
      ['missing amount', { direction: 'WE_PAID_SUPPLIER' }],
      ['zero amount', { amount: 0, direction: 'WE_PAID_SUPPLIER' }],
      ['invalid direction', { amount: 100, direction: 'INVALID' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post(`/admin/canteen/suppliers/${supId}/payments`)
        .query(branchQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/canteen/credit-persons — validation', () => {
    beforeEach(() => mockCanteenStaffMembership());

    test.each([
      ['missing type', {}],
      ['invalid type', { type: 'PARENT' }],
    ])('400 — %s', async (_label, query) => {
      const res = await request(app)
        .get('/admin/canteen/credit-persons')
        .query({ ...branchQuery, ...query })
        .set(staffAuth);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/type must be/i);
    });
  });

  // ─── 11. Products matrix (test.each) ────────────────────────────

  describe('products matrix', () => {
    test.each([
      ['list active only default', 'get', '/admin/canteen/products', undefined, 200],
      ['list include inactive', 'get', '/admin/canteen/products', { activeOnly: 'false' }, 200],
      ['create product', 'post', '/admin/canteen/products', undefined, 201],
      ['patch price', 'patch', `/admin/canteen/products/${prodId}`, undefined, 200],
      ['patch stock boxes', 'patch', `/admin/canteen/products/${prodId}`, undefined, 200],
      ['deactivate product', 'delete', `/admin/canteen/products/${prodId}`, undefined, 200],
      ['create with supplier', 'post', '/admin/canteen/products', undefined, 201],
      ['create with opening stock', 'post', '/admin/canteen/products', undefined, 201],
    ])('%s', async (_label, method, path, extraQuery, expectedStatus) => {
      const body =
        method === 'post'
          ? {
              categoryId: catId,
              name: 'Juice',
              unitPrice: 80,
              supplierId: _label.includes('supplier') ? supId : undefined,
              stockBoxes: _label.includes('stock') ? 2 : undefined,
              stockUnits: _label.includes('stock') ? 3 : undefined,
            }
          : method === 'patch'
            ? _label.includes('stock')
              ? { stockBoxes: 3, stockUnits: 0 }
              : { unitPrice: 60 }
            : undefined;

      let req = request(app)[method as HttpMethod](path).query({ ...branchQuery, ...extraQuery }).set(adminAuth);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(expectedStatus);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 12. Sales matrix (test.each) ───────────────────────────────

  describe('sales matrix', () => {
    beforeEach(() => mockCanteenStaffMembership());

    test.each([
      ['cash sale single item', { paymentType: 'CASH', items: [{ productId: prodId, quantity: 1 }] }, 201],
      ['cash sale multi qty', { paymentType: 'CASH', items: [{ productId: prodId, quantity: 3 }] }, 201],
      ['credit sale existing account', { paymentType: 'CREDIT', accountId: acctId, items: [{ productId: prodId, quantity: 1 }] }, 201],
      ['split payment cash+credit', { items: [{ productId: prodId, quantity: 2 }], cashAmount: 50, creditAmount: 50, accountId: acctId }, 201],
      ['list sales today', null, 200],
      ['list sales by date', null, 200],
      ['summary by date', null, 200],
      ['summary default date', null, 200],
    ])('%s', async (_label, body, expectedStatus) => {
      let req: request.Test;
      if (body) {
        req = request(app).post('/admin/canteen/sales').query(branchQuery).set(staffAuth).send(body);
      } else if (_label.includes('list sales by date')) {
        req = request(app).get('/admin/canteen/sales').query({ ...branchQuery, date: '2026-07-05' }).set(staffAuth);
      } else if (_label.includes('list sales')) {
        req = request(app).get('/admin/canteen/sales').query(branchQuery).set(staffAuth);
      } else if (_label.includes('summary by date')) {
        req = request(app).get('/admin/canteen/summary').query({ ...branchQuery, date: '2026-07-05' }).set(staffAuth);
      } else {
        req = request(app).get('/admin/canteen/summary').query(branchQuery).set(staffAuth);
      }
      const res = await req;
      expect(res.status).toBe(expectedStatus);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 13. Suppliers matrix (test.each) ───────────────────────────

  describe('suppliers matrix', () => {
    test.each([
      ['list suppliers', 'get', '/admin/canteen/suppliers', undefined, 200],
      ['get supplier', 'get', `/admin/canteen/suppliers/${supId}`, undefined, 200],
      ['get supplier detail', 'get', `/admin/canteen/suppliers/${supId}`, { detail: 'true' }, 200],
      ['list restock purchases', 'get', `/admin/canteen/suppliers/${supId}/restock-purchases`, undefined, 200],
      ['list payments', 'get', `/admin/canteen/suppliers/${supId}/payments`, undefined, 200],
      ['create supplier', 'post', '/admin/canteen/suppliers', undefined, 201],
      ['update supplier', 'patch', `/admin/canteen/suppliers/${supId}`, undefined, 200],
      ['log payment we paid', 'post', `/admin/canteen/suppliers/${supId}/payments`, undefined, 201],
    ])('%s', async (_label, method, path, extraQuery, expectedStatus) => {
      const body =
        method === 'post' && path.includes('/payments')
          ? { amount: 250, direction: 'WE_PAID_SUPPLIER', note: 'partial' }
          : method === 'post'
            ? { name: 'Beverage Co', contactNumber: '03009998877' }
            : method === 'patch'
              ? { note: 'Updated contact' }
              : undefined;

      let req = request(app)[method as HttpMethod](path).query({ ...branchQuery, ...extraQuery }).set(adminAuth);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(expectedStatus);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 14. Stock matrix (test.each) ───────────────────────────────

  describe('stock matrix', () => {
    test.each([
      ['restock purchase', { supplierId: supId, items: [{ productId: prodId, quantity: 10, unitCost: 35 }] }, 201],
      ['restock paid immediately', { supplierId: supId, items: [{ productId: prodId, quantity: 5, unitCost: 40 }], paidImmediately: true }, 201],
      ['restock multi items', { supplierId: supId, items: [{ productId: prodId, quantity: 3, unitCost: 40 }, { productId: 'p2', quantity: 2, unitCost: 30 }] }, 201],
      ['list restock purchases', undefined, 200],
      ['cash sale decrements stock', { paymentType: 'CASH', items: [{ productId: prodId, quantity: 2 }] }, 201],
      ['patch stock units', { stockUnits: 15 }, 200],
      ['patch stock boxes', { stockBoxes: 2, stockUnits: 0 }, 200],
      ['create product opening stock', { categoryId: catId, name: 'Biscuit', unitPrice: 30, stockBoxes: 1, stockUnits: 6, unitsPerBox: 12 }, 201],
    ] as const)('%s', async (_label, body, expectedStatus) => {
      mockCanteenStaffMembership();
      let req: request.Test;
      if (_label.includes('list restock')) {
        req = request(app).get('/admin/canteen/restock-purchases').query(branchQuery).set(adminAuth);
      } else if (_label.includes('cash sale')) {
        req = request(app).post('/admin/canteen/sales').query(branchQuery).set(staffAuth).send(body!);
      } else if (_label.includes('patch stock')) {
        req = request(app)
          .patch(`/admin/canteen/products/${prodId}`)
          .query(branchQuery)
          .set(adminAuth)
          .send(body!);
      } else if (_label.includes('create product')) {
        req = request(app).post('/admin/canteen/products').query(branchQuery).set(adminAuth).send(body!);
      } else {
        req = request(app).post('/admin/canteen/restock-purchases').query(branchQuery).set(adminAuth).send(body!);
      }
      const res = await req;
      expect(res.status).toBe(expectedStatus);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 15. Restricted management without canteen permission ───────

  describe('role — 403 restricted management without canteen read', () => {
    beforeEach(() => {
      mockManagementAdminMembership();
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [{ module: 'FEES', canRead: true, canUpdate: false, canDelete: false }],
      });
    });

    test.each([
      ['GET products', SALES_ROUTES[0]],
      ['GET categories', ADMIN_ROUTES[0]],
      ['POST sales', SALES_ROUTES.find((r) => r.label === 'POST sales')!],
    ] as const)('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: mgmtAdminAuth, query: branchQuery });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no canteen module access/i);
    });
  });

  // ─── 16. Restricted sales-only management ─────────────────────

  describe('success — restricted management with sales-only canteen', () => {
    beforeEach(() => {
      mockManagementAdminMembership();
      (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
        isRestricted: true,
        isFullAdmin: false,
        permissions: [{ module: 'CANTEEN', canRead: true, canUpdate: false, canDelete: false }],
      });
    });

    test('can list products', async () => {
      const res = await request(app)
        .get('/admin/canteen/products')
        .query(branchQuery)
        .set(mgmtAdminAuth);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('cannot list categories', async () => {
      const res = await request(app)
        .get('/admin/canteen/categories')
        .query(branchQuery)
        .set(mgmtAdminAuth);
      expect(res.status).toBe(403);
    });
  });
});

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const branchId = 'branch-1';
const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const staffToken = getAuthHeader(
  generateTestToken('staff-1', 'management', { branchIds: [branchId] } as any),
);

function mockCanteenStaffMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-1',
    branchId,
    userId: 'staff-1',
    role: 'canteen_staff',
    isActive: true,
  } as any);
}

function mockCanteenAdminMembership() {
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-2',
    branchId,
    userId: 'mgr-1',
    role: 'management',
    isActive: true,
  } as any);
}

describe('Canteen routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  test('GET /admin/canteen/products requires auth', async () => {
    const res = await request(app).get(`/admin/canteen/products?branchId=${branchId}`);
    expect(res.status).toBe(401);
  });

  test('GET /admin/canteen/products requires branchId', async () => {
    const res = await request(app).get('/admin/canteen/products').set(adminToken);
    expect(res.status).toBe(400);
  });

  test('canteen_staff can list products', async () => {
    mockCanteenStaffMembership();
    prismaMock.canteenProduct.findMany.mockResolvedValue([
      { id: 'p1', name: 'Chips', unitPrice: 50, stockQuantity: 10, isActive: true },
    ] as any);
    const res = await request(app)
      .get(`/admin/canteen/products?branchId=${branchId}`)
      .set(staffToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('canteen_staff cannot list categories', async () => {
    mockCanteenStaffMembership();
    const res = await request(app)
      .get(`/admin/canteen/categories?branchId=${branchId}`)
      .set(staffToken);
    expect(res.status).toBe(403);
  });

  test('admin can list categories', async () => {
    prismaMock.canteenProductCategory.findMany.mockResolvedValue([
      { id: 'c1', name: 'Snacks', isActive: true },
    ] as any);
    const res = await request(app)
      .get(`/admin/canteen/categories?branchId=${branchId}`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Snacks');
  });

  test('POST /admin/canteen/categories returns 409 for duplicate name', async () => {
    prismaMock.canteenProductCategory.findFirst.mockResolvedValue({
      id: 'c1',
      branchId,
      name: 'Snacks',
      isActive: true,
    } as any);

    const res = await request(app)
      .post(`/admin/canteen/categories?branchId=${branchId}`)
      .set(adminToken)
      .send({ name: 'Snacks' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  test('POST /admin/canteen/categories reactivates inactive category', async () => {
    prismaMock.canteenProductCategory.findFirst.mockResolvedValue({
      id: 'c1',
      branchId,
      name: 'Snacks',
      isActive: false,
    } as any);
    prismaMock.canteenProductCategory.update.mockResolvedValue({
      id: 'c1',
      name: 'Snacks',
      isActive: true,
    } as any);

    const res = await request(app)
      .post(`/admin/canteen/categories?branchId=${branchId}`)
      .set(adminToken)
      .send({ name: 'Snacks' });

    expect(res.status).toBe(201);
    expect(res.body.data.isActive).toBe(true);
    expect(prismaMock.canteenProductCategory.create).not.toHaveBeenCalled();
  });

  test('POST /admin/canteen/sales cash decrements stock', async () => {
    mockCanteenStaffMembership();
    prismaMock.canteenProduct.findMany.mockResolvedValue([
      {
        id: 'p1',
        branchId,
        name: 'Chips',
        unitPrice: { valueOf: () => 50 },
        stockQuantity: 10,
        isActive: true,
      },
    ] as any);
    prismaMock.canteenSale.create.mockResolvedValue({
      id: 's1',
      paymentType: 'CASH',
      totalAmount: 100,
      items: [],
    } as any);
    prismaMock.canteenProduct.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post(`/admin/canteen/sales?branchId=${branchId}`)
      .set(staffToken)
      .send({
        paymentType: 'CASH',
        items: [{ productId: 'p1', quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(prismaMock.canteenSale.create).toHaveBeenCalled();
    expect(prismaMock.canteenProduct.update).toHaveBeenCalled();
  });

  test('GET /admin/canteen/summary returns daily totals', async () => {
    mockCanteenStaffMembership();
    prismaMock.canteenSale.findMany.mockResolvedValue([
      {
        paymentType: 'CASH',
        totalAmount: 100,
        items: [
          {
            productId: 'p1',
            quantity: 2,
            unitPriceAtSale: 50,
            product: { name: 'Chips' },
          },
        ],
      },
    ] as any);

    const res = await request(app)
      .get(`/admin/canteen/summary?branchId=${branchId}&date=2026-07-05`)
      .set(staffToken);

    expect(res.status).toBe(200);
    expect(res.body.data.cashTotal).toBe(100);
    expect(res.body.data.itemsSoldBreakdown).toHaveLength(1);
  });
});

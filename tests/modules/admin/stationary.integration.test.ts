jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash'),
  compare: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { generateTestToken } from '../../helpers/auth';

const adminToken = 'Bearer ' + generateTestToken('admin-1', 'super_admin');
const branchId = 'branch-1';
const ayId = 'ay-1';

describe('Stationary integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.academicYear.findUnique.mockResolvedValue({ id: ayId, branchId } as any);
  });

  test('GET /admin/stationary/products returns branch products', async () => {
    prismaMock.stationaryProduct.findMany.mockResolvedValue([
      { id: 'p1', branchId, name: 'Notebook', unitPrice: 1000, stockBundles: 2, stockUnits: 5, category: { id: 'c1', name: 'Books' } },
    ] as any);

    const res = await request(app)
      .get(`/admin/stationary/products?branchId=${branchId}`)
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].name).toBe('Notebook');
  });

  test('POST /admin/stationary/inventory/adjust rejects underflow', async () => {
    prismaMock.stationaryProduct.findUnique.mockResolvedValue({
      id: 'p1',
      branchId,
      stockBundles: 0,
      stockUnits: 1,
    } as any);

    const res = await request(app)
      .post(`/admin/stationary/inventory/adjust?branchId=${branchId}`)
      .set('Authorization', adminToken)
      .send({ productId: 'p1', quantityUnits: -5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
  });

  test('POST /admin/fees/stationary/assign validates family linkage mismatch', async () => {
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf-1',
      studentId: 's-1',
      academicYearId: ayId,
      netAmount: 10000,
      paidAmount: 0,
      student: { id: 's-1', familyId: 'fam-other', academicYearId: ayId },
    } as any);
    prismaMock.academicYear.findUnique.mockResolvedValue({ id: ayId, branchId } as any);

    const res = await request(app)
      .post(`/admin/fees/stationary/assign?branchId=${branchId}&academicYearId=${ayId}`)
      .set('Authorization', adminToken)
      .send({
        studentId: 's-1',
        studentFeeId: 'sf-1',
        familyId: 'fam-expected',
        items: [{ productId: 'p-1', quantity: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to this family/i);
  });

  test('POST /admin/fees/stationary/assign creates fee extras and stock movement', async () => {
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf-1',
      studentId: 's-1',
      academicYearId: ayId,
      netAmount: 20000,
      paidAmount: 0,
      student: { id: 's-1', familyId: 'fam-1', academicYearId: ayId },
    } as any);
    prismaMock.academicYear.findUnique.mockResolvedValue({ id: ayId, branchId } as any);
    prismaMock.stationaryProduct.findMany.mockResolvedValue([
      {
        id: 'p-1',
        branchId,
        name: 'Pencil',
        unitPrice: 500,
        stockBundles: 0,
        stockUnits: 20,
        unitsPerBundle: null,
        category: { id: 'c-1', name: 'Tools' },
      },
    ] as any);
    prismaMock.studentStationaryRecord.create.mockResolvedValue({ id: 'rec-1' } as any);
    prismaMock.studentStationaryRecordItem.create.mockResolvedValue({ id: 'item-1' } as any);
    prismaMock.feeExtraItem.aggregate.mockResolvedValue({ _sum: { amount: 1000 } } as any);
    prismaMock.studentFee.update.mockResolvedValue({ id: 'sf-1', status: 'UNPAID' } as any);

    const res = await request(app)
      .post(`/admin/fees/stationary/assign?branchId=${branchId}&academicYearId=${ayId}`)
      .set('Authorization', adminToken)
      .send({
        studentId: 's-1',
        studentFeeId: 'sf-1',
        items: [{ productId: 'p-1', quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(prismaMock.feeExtraItem.create).toHaveBeenCalled();
    expect(prismaMock.stationaryStockMovement.create).toHaveBeenCalled();
    expect(prismaMock.stationaryProduct.update).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
  });
});

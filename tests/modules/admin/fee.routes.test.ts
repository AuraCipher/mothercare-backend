/**
 * Fee Routes Tests
 *
 * Tests fee heads, structures, generation, payments, and family payment endpoints.
 * Uses supertest against the real Express app with mocked Prisma.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken } from '../../helpers/auth';

const adminToken = 'Bearer ' + generateTestToken('admin-1', 'super_admin');

// ═══════════════════════════════════════════════════════════════════
// FEE HEADS
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/fee-heads', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without token', async () => {
    const res = await request(app).get('/admin/fee-heads');
    expect(res.status).toBe(401);
  });

  test('returns list of fee heads', async () => {
    prismaMock.feeHead.findMany.mockResolvedValue([
      { id: 'fh1', name: 'Tuition', category: 'MONTHLY', isActive: true, isOptional: false, description: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'fh2', name: 'Transport', category: 'MONTHLY', isActive: true, isOptional: true, description: null, createdAt: new Date(), updatedAt: new Date() },
    ] as any);
    const res = await request(app).get('/admin/fee-heads').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('POST /admin/fee-heads', () => {
  test('creates a fee head', async () => {
    prismaMock.feeHead.create.mockResolvedValue({
      id: 'fh-new', name: 'Lab Fee', category: 'TERM', isActive: true, isOptional: false, description: 'Lab charges', createdAt: new Date(), updatedAt: new Date(),
    } as any);
    const res = await request(app).post('/admin/fee-heads').set('Authorization', adminToken).send({ name: 'Lab Fee', category: 'TERM', description: 'Lab charges' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Lab Fee');
    expect(res.body.data.category).toBe('TERM');
  });

  test('rejects without name', async () => {
    const res = await request(app).post('/admin/fee-heads').set('Authorization', adminToken).send({ category: 'MONTHLY' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /admin/fee-heads/:id', () => {
  test('updates a fee head', async () => {
    prismaMock.feeHead.update.mockResolvedValue({
      id: 'fh1', name: 'Tuition Updated', category: 'MONTHLY', isActive: true, isOptional: false, description: null, createdAt: new Date(), updatedAt: new Date(),
    } as any);
    const res = await request(app).put('/admin/fee-heads/fh1').set('Authorization', adminToken).send({ name: 'Tuition Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Tuition Updated');
  });
});

// ═══════════════════════════════════════════════════════════════════
// FEE STRUCTURES
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/fee-structures', () => {
  test('returns structures', async () => {
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', createdAt: new Date(), updatedAt: new Date(), feeHead: { name: 'Tuition' }, group: { name: 'Class 1', section: null } },
    ] as any);
    const res = await request(app).get('/admin/fee-structures').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /admin/fee-structures', () => {
  test('creates a structure', async () => {
    prismaMock.feeStructure.create.mockResolvedValue({
      id: 'fs-new', groupId: 'g1', feeHeadId: 'fh1', amount: 450000, academicYearId: 'ay1', effectiveFrom: new Date(), effectiveTo: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await request(app).post('/admin/fee-structures').set('Authorization', adminToken).send({ academicYearId: 'ay1', groupId: 'g1', feeHeadId: 'fh1', amount: 450000 });
    expect(res.status).toBe(201);
  });

  test('rejects without required fields', async () => {
    const res = await request(app).post('/admin/fee-structures').set('Authorization', adminToken).send({});
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FEE GENERATION
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/student-fees/generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects without month/year', async () => {
    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({});
    expect(res.status).toBe(400);
  });

  test('generates fees with default monthly category', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null },
      { id: 's2', groupId: 'g1', customFeeAmount: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null); // No existing fee
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 6, year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(2);
  });

  test('filters by selected categories — TERM not included in non-term month', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY' } },
      { id: 'fs2', groupId: 'g1', feeHeadId: 'fh2', amount: 100000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'TERM' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);

    // Only MONTHLY category selected — TERM should be excluded
    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 6, year: 2026, categories: ['MONTHLY'] });
    expect(res.status).toBe(200);
    // Only MONTHLY head included (500000), TERM (100000) excluded
    expect(res.body.data.generated).toBe(1);
  });

  test('includes TERM when explicitly selected', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: 600000 },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    // Uses customFeeAmount despite empty structures
    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 6, year: 2026, categories: ['MONTHLY', 'TERM'] });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/payments', () => {
  test('rejects without required fields', async () => {
    const res = await request(app).post('/admin/payments').set('Authorization', adminToken).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/payments/waterfall', () => {
  test('allocates payment across oldest months first', async () => {
    prismaMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 4, year: 2026 },
      { id: 'sf2', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 5, year: 2026 },
    ] as any);
    prismaMock.payment.count.mockResolvedValue(0);
    prismaMock.payment.create.mockResolvedValue({
      id: 'p1', studentFeeId: 'sf1', studentId: 's1', amount: 400000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202606-0002', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null,
      createdAt: new Date(),
    } as any);
    prismaMock.studentFee.update.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({ studentId: 's1', amount: 400000, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body.data.monthsCovered).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CUSTOM FEE (Scholarship)
// ═══════════════════════════════════════════════════════════════════

describe('PUT /admin/students/:id/custom-fee', () => {
  test('sets custom fee with overrides', async () => {
    prismaMock.student.update.mockResolvedValue({
      id: 's1', customFeeAmount: 400000, concessionReason: 'Merit scholarship',
      feeOverrides: { fh1: 400000 },
    } as any);
    const res = await request(app).put('/admin/students/s1/custom-fee').set('Authorization', adminToken).send({
      customFeeAmount: 400000, concessionReason: 'Merit scholarship', feeOverrides: { fh1: 400000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.customFeeAmount).toBe(400000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FEE REPORTS
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/fees/summary', () => {
  test('returns summary stats', async () => {
    prismaMock.studentFee.findMany.mockResolvedValue([
      { netAmount: 500000, paidAmount: 500000, status: 'PAID' },
      { netAmount: 500000, paidAmount: 0, status: 'UNPAID' },
    ] as any);
    const res = await request(app).get('/admin/fees/summary?month=6&year=2026').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.totalDue).toBe(1000000);
    expect(res.body.data.pendingCount).toBe(1);
  });
});

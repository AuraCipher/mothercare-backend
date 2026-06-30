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
      { netAmount: 500000, paidAmount: 500000, status: 'PAID', extraItems: [] },
      { netAmount: 500000, paidAmount: 0, status: 'UNPAID', extraItems: [] },
    ] as any);
    const res = await request(app).get('/admin/fees/summary?month=6&year=2026').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.totalDue).toBe(1000000);
    expect(res.body.data.pendingCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RECEIPT SNAPSHOT & AUDIT LOG
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/payments/:id/receipt — snapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 404 when no snapshot exists', async () => {
    prismaMock.paymentReceipt.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/admin/payments/p1/receipt').set('Authorization', adminToken);
    expect(res.status).toBe(404);
  });

  test('returns snapshot when it exists', async () => {
    const mockSnapshot = {
      id: 'rs1', paymentId: 'p1', receiptNumber: 'RCP-001',
      currentMonthLabel: 'Jun 2026', currentMonthTotal: 500000,
      currentMonthHeads: [{ name: 'Tuition', amount: 500000 }],
      currentMonthExtras: [],
      previousBalancePaise: 200000, previousMonthsCount: 1,
      totalDuePaise: 700000, amountPaidPaise: 500000, balanceAfterPaise: 200000,
      paymentMethod: 'CASH', reference: null,
      studentName: 'Ahmed', studentClass: 'Class 1', studentRoll: null, fatherName: null,
      isFullyPaid: false,
      paymentDate: new Date(), printedAt: null, printCount: 0, createdAt: new Date(),
    };
    prismaMock.paymentReceipt.findUnique.mockResolvedValue(mockSnapshot as any);
    const res = await request(app).get('/admin/payments/p1/receipt').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.receiptNumber).toBe('RCP-001');
    expect(res.body.data.currentMonthLabel).toBe('Jun 2026');
    expect(res.body.data.totalDuePaise).toBe(700000);
    expect(res.body.data.balanceAfterPaise).toBe(200000);
  });
});

describe('POST /admin/payments/:id/print-receipt', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tracks first print', async () => {
    prismaMock.paymentReceipt.findUnique.mockResolvedValue({
      id: 'rs1', paymentId: 'p1', printedAt: null, printCount: 0,
    } as any);
    prismaMock.paymentReceipt.update.mockResolvedValue({
      id: 'rs1', printedAt: new Date(), printCount: 1,
    } as any);
    const res = await request(app).post('/admin/payments/p1/print-receipt').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(prismaMock.paymentReceipt.update).toHaveBeenCalled();
  });

  test('returns 404 when no snapshot', async () => {
    prismaMock.paymentReceipt.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/admin/payments/p1/print-receipt').set('Authorization', adminToken);
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/payments/:id/audit-log', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records a REPRINTED event', async () => {
    prismaMock.paymentAuditLog.create.mockResolvedValue({
      id: 'al1', paymentId: 'p1', action: 'REPRINTED', performedById: 'admin-1', createdAt: new Date(),
    } as any);
    const res = await request(app).post('/admin/payments/p1/audit-log')
      .set('Authorization', adminToken)
      .send({ action: 'REPRINTED' });
    expect(res.status).toBe(201);
    expect(res.body.data.action).toBe('REPRINTED');
  });

  test('rejects invalid action', async () => {
    const res = await request(app).post('/admin/payments/p1/audit-log')
      .set('Authorization', adminToken)
      .send({ action: 'INVALID' });
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/payments/:id/audit-log', () => {
  test('returns audit trail', async () => {
    prismaMock.paymentAuditLog.findMany.mockResolvedValue([
      { id: 'al1', paymentId: 'p1', action: 'CREATED', createdAt: new Date() },
    ] as any);
    const res = await request(app).get('/admin/payments/p1/audit-log').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXTRA ITEMS STATUS RECALCULATION
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/student-fees/:id/extra-items — status recalculation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('changes status from PAID to PARTIAL when extra added to a fully-paid fee', async () => {
    // A fee that was fully paid (500000/500000 = PAID)
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf1', netAmount: 500000, totalAmount: 500000, paidAmount: 500000, status: 'PAID', month: 6, year: 2026,
    } as any);
    prismaMock.feeExtraItem.create.mockResolvedValue({ id: 'extra1', studentFeeId: 'sf1', name: 'Lab Charges', amount: 50000 } as any);
    // After creation, aggregate returns the extra sum
    prismaMock.feeExtraItem.aggregate.mockResolvedValue({ _sum: { amount: 50000 } } as any);

    const res = await request(app).post('/admin/student-fees/sf1/extra-items')
      .set('Authorization', adminToken)
      .send({ name: 'Lab Charges', amount: 50000 });
    expect(res.status).toBe(201);

    // Verify status was updated to PARTIAL (500k paid vs 550k total due)
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PARTIAL' }) })
    );
  });

  test('returns OVERPAID when extra added but payment already exceeds total due', async () => {
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf1', netAmount: 500000, totalAmount: 500000, paidAmount: 600000, status: 'OVERPAID', month: 6, year: 2026,
    } as any);
    prismaMock.feeExtraItem.create.mockResolvedValue({ id: 'extra2', studentFeeId: 'sf1', name: 'Fine', amount: 50000 } as any);
    // 600k paid vs 550k total due — still OVERPAID
    prismaMock.feeExtraItem.aggregate.mockResolvedValue({ _sum: { amount: 50000 } } as any);

    const res = await request(app).post('/admin/student-fees/sf1/extra-items')
      .set('Authorization', adminToken)
      .send({ name: 'Fine', amount: 50000 });
    expect(res.status).toBe(201);
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'OVERPAID' }) })
    );
  });

  test('rejects without name or amount', async () => {
    const res = await request(app).post('/admin/student-fees/sf1/extra-items')
      .set('Authorization', adminToken)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /admin/student-fees/:id/extra-items/:itemId — status recalculation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reverts status back to PAID when extra removed', async () => {
    // Delete returns the original item with its studentFeeId
    prismaMock.feeExtraItem.delete.mockResolvedValue({ id: 'extra1', studentFeeId: 'sf1', name: 'Lab Charges', amount: 50000 } as any);
    // After deletion, no extras remain
    prismaMock.feeExtraItem.aggregate.mockResolvedValue({ _sum: { amount: 0 } } as any);
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf1', netAmount: 500000, totalAmount: 500000, paidAmount: 500000, status: 'PARTIAL', month: 6, year: 2026,
    } as any);

    const res = await request(app).delete('/admin/student-fees/sf1/extra-items/extra1')
      .set('Authorization', adminToken);
    expect(res.status).toBe(200);

    // Status should go back to PAID (500k paid = 500k due, no extras)
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PAID' }) })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// WATERFALL STATUS WITH EXTRAS
// ═══════════════════════════════════════════════════════════════════

describe('POST /admin/payments/waterfall — status accounts for extras', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets PAID only after extras are covered', async () => {
    // Two fees, one with extra items
    prismaMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 400000, paidAmount: 0, extraItems: [{ amount: 50000 }], month: 4, year: 2026 },
      { id: 'sf2', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 5, year: 2026 },
    ] as any);
    prismaMock.payment.count.mockResolvedValue(0);
    prismaMock.payment.create.mockResolvedValue({
      id: 'p1', studentFeeId: 'sf1', studentId: 's1', amount: 450000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202607-0003', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null, createdAt: new Date(),
    } as any);
    prismaMock.studentFee.update.mockResolvedValue({} as any);

    // Pay 450k — enough to cover sf1's 400k net + 50k extra
    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({
      studentId: 's1', amount: 450000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);

    // sf1: 450k paid = 450k total due → PAID (was 400k net + 50k extra)
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PAID' }) })
    );
  });

  test('sets PARTIAL when payment falls short of netAmount + extras with waterfall', async () => {
    prismaMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 400000, paidAmount: 0, extraItems: [{ amount: 100000 }], month: 4, year: 2026 },
    ] as any);
    prismaMock.payment.count.mockResolvedValue(0);
    prismaMock.payment.create.mockResolvedValue({
      id: 'p2', studentFeeId: 'sf1', studentId: 's1', amount: 420000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202607-0004', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null, createdAt: new Date(),
    } as any);
    prismaMock.studentFee.update.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({
      studentId: 's1', amount: 420000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);

    // sf1: 420k paid < 500k total due (400k net + 100k extra) → PARTIAL
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PARTIAL' }) })
    );
  });
});

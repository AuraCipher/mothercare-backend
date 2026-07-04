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

  test('filters by academicYearId query param', async () => {
    prismaMock.feeStructure.findMany.mockResolvedValue([] as any);
    await request(app).get('/admin/fee-structures?academicYearId=ay-old').set('Authorization', adminToken);
    expect(prismaMock.feeStructure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ academicYearId: 'ay-old' }),
    }));
  });
});

describe('POST /admin/fee-structures', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a structure when none exists', async () => {
    prismaMock.feeStructure.findMany.mockResolvedValue([]);
    prismaMock.feeStructure.create.mockResolvedValue({
      id: 'fs-new', groupId: 'g1', feeHeadId: 'fh1', amount: 450000, academicYearId: 'ay1', effectiveFrom: new Date(), effectiveTo: null, createdAt: new Date(), updatedAt: new Date(),
    } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    const res = await request(app).post('/admin/fee-structures').set('Authorization', adminToken).send({ academicYearId: 'ay1', groupId: 'g1', feeHeadId: 'fh1', amount: 450000 });
    expect(res.status).toBe(201);
    expect(prismaMock.feeStructure.updateMany).not.toHaveBeenCalled();
  });

  test('updates a structure and expires all active duplicates', async () => {
    const existing = {
      id: 'fs-old', groupId: 'g1', feeHeadId: 'fh1', amount: 400000, academicYearId: 'ay1',
      effectiveFrom: new Date(), effectiveTo: null, createdAt: new Date(), updatedAt: new Date(),
    };
    prismaMock.feeStructure.findMany.mockResolvedValue([existing] as any);
    prismaMock.feeStructure.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.feeStructure.create.mockResolvedValue({
      id: 'fs-new', groupId: 'g1', feeHeadId: 'fh1', amount: 450000, academicYearId: 'ay1',
      effectiveFrom: new Date(), effectiveTo: null, createdAt: new Date(), updatedAt: new Date(),
    } as any);
    prismaMock.feeChangeLog.create.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    const res = await request(app).post('/admin/fee-structures').set('Authorization', adminToken).send({ academicYearId: 'ay1', groupId: 'g1', feeHeadId: 'fh1', amount: 450000 });
    expect(res.status).toBe(200);
    expect(prismaMock.feeStructure.updateMany).toHaveBeenCalled();
    expect(prismaMock.feeChangeLog.create).toHaveBeenCalled();
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

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 6, year: 2026, categories: ['MONTHLY'] });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(1);
  });

  test('filters by selected groupIds', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g2', customFeeAmount: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g2', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', groupIds: ['g2'], headIds: ['fh1'],
    });
    expect(res.status).toBe(200);
    expect(prismaMock.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ groupId: { in: ['g2'] } }),
    }));
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

describe('GET /admin/fees/students-list', () => {
  beforeEach(() => jest.clearAllMocks());

  const studentWithFee = {
    id: 's1', name: 'Ahmed', rollNumber: '1', admissionNumber: 'A1', groupId: 'g1',
    customFeeAmount: null, concessionReason: null, feeOverrides: null,
    group: { name: 'Class 2', section: 'A', displayOrder: 2 },
    parents: [],
  };

  const studentWithoutFee = {
    id: 's2', name: 'Sara', rollNumber: '2', admissionNumber: 'A2', groupId: 'g2',
    customFeeAmount: 500000, concessionReason: null, feeOverrides: null,
    group: { name: 'Class 3', section: null, displayOrder: 3 },
    parents: [],
  };

  const feeRow = (student: any, fee: any) => ({
    id: fee.id,
    netAmount: fee.netAmount,
    paidAmount: fee.paidAmount ?? 0,
    status: fee.status,
    payments: fee.payments || [],
    extraItems: fee.extraItems || [],
    student,
  });

  const mockMonthlyList = (records: any[], total?: number) => {
    prismaMock.studentFee.count.mockResolvedValue(total ?? records.length);
    prismaMock.studentFee.findMany.mockResolvedValue(records);
  };

  test('monthly view only returns students with a generated fee for that month', async () => {
    mockMonthlyList([feeRow(studentWithFee, { id: 'sf1', netAmount: 500000, paidAmount: 0, status: 'UNPAID' })]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].student.id).toBe('s1');
    expect(res.body.data[0].fee.id).toBe('sf1');
    expect(res.body.pagination.limit).toBe(100);
  });

  test('monthly view excludes ungenerated students even when customFeeAmount is set', async () => {
    mockMonthlyList([]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('monthly view excludes students with feeOverrides but no generated record', async () => {
    mockMonthlyList([]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('full AY view still returns students without generated fees', async () => {
    prismaMock.student.count.mockResolvedValue(2);
    prismaMock.studentFee.findMany.mockResolvedValue([{ month: 6, year: 2026 }] as any);
    prismaMock.student.findMany.mockResolvedValue([
      { ...studentWithFee, studentFees: [{ id: 'sf1', netAmount: 500000, paidAmount: 0, status: 'UNPAID', payments: [], extraItems: [] }] },
      { ...studentWithoutFee, studentFees: [] },
    ] as any);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=full&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toBeDefined();
  });

  test('scopes students to academicYearId', async () => {
    mockMonthlyList([]);

    await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay-old')
      .set('Authorization', adminToken);

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        student: expect.objectContaining({ academicYearId: 'ay-old' }),
      }),
    }));
  });

  test('monthly view every returned row has a non-null fee object', async () => {
    mockMonthlyList([
      feeRow(studentWithFee, { id: 'sf1', netAmount: 500000, paidAmount: 0, status: 'UNPAID' }),
      feeRow({ ...studentWithFee, id: 's3', name: 'Bilal' }, { id: 'sf3', netAmount: 600000, paidAmount: 100000, status: 'PARTIAL' }),
    ]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const row of res.body.data) {
      expect(row.fee).not.toBeNull();
      expect(row.fee.id).toBeTruthy();
    }
  });

  test('monthly view uses generated fee netAmount even when customFeeAmount differs', async () => {
    mockMonthlyList([feeRow(
      { ...studentWithFee, customFeeAmount: 999999 },
      { id: 'sf1', netAmount: 500000, paidAmount: 0, status: 'UNPAID' },
    )]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].netAmount).toBe(500000);
    expect(res.body.data[0].fee.netAmount).toBe(500000);
  });

  test('monthly view excludes plain student with no fee and no overrides', async () => {
    mockMonthlyList([]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('monthly view scopes fee query to month, year, and academicYearId', async () => {
    mockMonthlyList([]);

    await request(app)
      .get('/admin/fees/students-list?month=7&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ month: 7, year: 2026, academicYearId: 'ay1' }),
    }));
  });

  test('monthly view with groupId filter still excludes ungenerated students in that group', async () => {
    mockMonthlyList([]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1&groupId=g2')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        student: expect.objectContaining({ groupId: 'g2' }),
      }),
    }));
  });

  test('monthly view includes PAID generated fees', async () => {
    mockMonthlyList([feeRow(studentWithFee, {
      id: 'sf1', netAmount: 500000, paidAmount: 500000, status: 'PAID',
      payments: [{ id: 'p1', amount: 500000 }],
    })]);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('PAID');
    expect(res.body.data[0].fee).not.toBeNull();
  });

  test('returns 400 when no academic year can be resolved', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly')
      .set('Authorization', adminToken);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/academic year/i);
  });

  test('filters by exact roll number', async () => {
    mockMonthlyList([]);

    await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1&roll=42')
      .set('Authorization', adminToken);

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        student: expect.objectContaining({ rollNumber: '42' }),
      }),
    }));
  });

  test('filters by fatherSearch on father name or phone', async () => {
    mockMonthlyList([]);

    await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1&fatherSearch=Ali')
      .set('Authorization', adminToken);

    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        student: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              parents: expect.objectContaining({ some: expect.any(Object) }),
            }),
          ]),
        }),
      }),
    }));
  });

  test('paginates monthly results with default limit 100', async () => {
    mockMonthlyList([], 250);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=monthly&academicYearId=ay1&page=2')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, limit: 100, total: 250, totalPages: 3 });
    expect(prismaMock.studentFee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 100,
      take: 100,
    }));
  });

  test('full AY marks estimated rows when missing generated months', async () => {
    prismaMock.student.count.mockResolvedValue(1);
    prismaMock.studentFee.findMany.mockResolvedValue([
      { month: 5, year: 2026 }, { month: 6, year: 2026 },
    ] as any);
    prismaMock.student.findMany.mockResolvedValue([{
      ...studentWithFee,
      customFeeAmount: 500000,
      studentFees: [{ id: 'sf1', netAmount: 500000, paidAmount: 0, status: 'UNPAID', payments: [], extraItems: [] }],
    }] as any);

    const res = await request(app)
      .get('/admin/fees/students-list?month=6&year=2026&period=full&academicYearId=ay1')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data[0]._isEstimated).toBe(true);
    expect(res.body.data[0]._missingMonths).toBe(1);
  });
});

describe('POST /admin/student-fees/generate — modes', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseMocks = () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
  };

  test('generate mode skips existing fees', async () => {
    baseMocks();
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf1', netAmount: 500000, paidAmount: 0, feeHeadBreakdown: [], extraItems: [],
    } as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'], mode: 'generate',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(0);
    expect(res.body.data.skipped).toBe(1);
    expect(prismaMock.studentFee.create).not.toHaveBeenCalled();
  });

  test('update mode updates existing fees when amount differs', async () => {
    baseMocks();
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf1', netAmount: 250000, paidAmount: 0, paidAt: null, feeHeadBreakdown: [], extraItems: [],
    } as any);
    prismaMock.studentFee.update.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'], mode: 'update',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(prismaMock.studentFee.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ netAmount: 500000, status: 'UNPAID' }),
    }));
  });

  test('update mode skips when no existing fee', async () => {
    baseMocks();
    prismaMock.studentFee.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'], mode: 'update',
    });

    expect(res.body.data.updated).toBe(0);
    expect(res.body.data.skipped).toBe(1);
  });

  test('regenerate mode deletes unpaid fees and recreates', async () => {
    baseMocks();
    prismaMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf-old', paidAmount: 0 },
    ] as any);
    prismaMock.studentFee.delete.mockResolvedValue({} as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'], mode: 'regenerate',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(1);
    expect(res.body.data.generated).toBe(1);
    expect(prismaMock.studentFee.delete).toHaveBeenCalled();
  });

  test('regenerate protects fees with payments', async () => {
    baseMocks();
    prismaMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf-paid', paidAmount: 100000 },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue({
      id: 'sf-paid', netAmount: 500000, paidAmount: 100000, feeHeadBreakdown: [], extraItems: [],
    } as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'], mode: 'regenerate',
    });

    expect(res.body.data.protected).toBe(1);
    expect(prismaMock.studentFee.delete).not.toHaveBeenCalled();
  });
});

describe('POST /admin/student-fees/generate — class selection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('only processes students in selected groupIds', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g2a', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g2a', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', groupIds: ['g2a'], headIds: ['fh1'],
    });

    expect(res.status).toBe(200);
    expect(prismaMock.student.findMany).toHaveBeenCalledWith({
      where: { academicYearId: 'ay1', isActive: true, status: 'ACTIVE', groupId: { in: ['g2a'] } },
      select: { id: true, groupId: true, customFeeAmount: true, feeOverrides: true },
    });
    expect(res.body.data.generated).toBe(1);
    expect(res.body.data.total).toBe(1);
  });

  test('single section under a class — other sections not included when omitted from groupIds', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g2a', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g2a', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
      { id: 'fs2', groupId: 'g2b', feeHeadId: 'fh1', amount: 600000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', groupIds: ['g2a'], headIds: ['fh1'],
    });

    expect(prismaMock.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ groupId: { in: ['g2a'] } }),
    }));
    expect(prismaMock.studentFee.create).toHaveBeenCalledTimes(1);
  });

  test('without groupIds processes all active students in academic year', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
      { id: 's2', groupId: 'g2', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
      { id: 'fs2', groupId: 'g2', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay1', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', headIds: ['fh1'],
    });

    expect(prismaMock.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { academicYearId: 'ay1', isActive: true, status: 'ACTIVE' },
    }));
    expect(res.body.data.generated).toBe(2);
    expect(res.body.data.total).toBe(2);
  });

  test('does not create fee when selected class has zero structure total', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g-empty', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', groupIds: ['g-empty'], headIds: ['fh1'],
    });

    expect(res.body.data.generated).toBe(0);
    expect(prismaMock.studentFee.create).not.toHaveBeenCalled();
  });

  test('empty groupIds array processes no students', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([] as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay1', groupIds: [], headIds: ['fh1'],
    });

    expect(prismaMock.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ groupId: { in: [] } }),
    }));
    expect(res.body.data.generated).toBe(0);
    expect(res.body.data.total).toBe(0);
  });

  test('uses explicit academicYearId over active year', async () => {
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay-old', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay-old', headIds: ['fh1'],
    });

    expect(prismaMock.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ academicYearId: 'ay-old' }),
    }));
    expect(prismaMock.feeStructure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ academicYearId: 'ay-old' }),
    }));
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
  beforeEach(() => jest.clearAllMocks());

  test('allocates payment across oldest months first', async () => {
    // Tx mock: the interactive transaction gets a tx client with fee+payment methods
    const txMock = {
      payment: { create: jest.fn(), aggregate: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    // generateReceiptNumber scans recent receipts for this month (findMany, not findFirst)
    prismaMock.payment.findMany.mockResolvedValue([]); // no prior receipts
    // Row-lock query runs first inside the tx, returning the ids to fetch
    txMock.$queryRaw.mockResolvedValue([{ id: 'sf1' }, { id: 'sf2' }] as any);
    // Inside the tx, fees are read fresh
    txMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 4, year: 2026 },
      { id: 'sf2', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 5, year: 2026 },
    ] as any);
    txMock.payment.create.mockResolvedValue({
      id: 'p1', studentFeeId: 'sf1', studentId: 's1', amount: 400000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202606-0002', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null,
      createdAt: new Date(),
    });
    txMock.studentFee.update.mockResolvedValue({} as any);
    // After tx: snapshot reads
    prismaMock.student.findUnique.mockResolvedValue({ name: 'Test', rollNumber: '1', group: { name: 'Class 1', section: null }, parents: [] } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([] as any); // previous balance query

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({ studentId: 's1', amount: 400000, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body.data.monthsCovered).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /admin/payments/allocate — partial head payments', () => {
  beforeEach(() => jest.clearAllMocks());

  const julFee = {
    id: 'sf-jul', studentId: 's1', month: 7, year: 2026,
    netAmount: 750000, paidAmount: 600000, status: 'PARTIAL',
    feeHeadBreakdown: [
      { feeHeadId: 'fh-monthly', name: 'MonthlyFee', amount: 500000, category: 'MONTHLY' },
      { feeHeadId: 'fh-paper', name: 'PaperFund', amount: 50000, category: 'MONTHLY' },
      { feeHeadId: 'fh-annual', name: 'Annual Fund', amount: 200000, category: 'ANNUAL' },
    ],
    extraItems: [],
  };

  test('rejects when selected head exceeds remaining due after prior allocation', async () => {
    const txMock = {
      payment: { create: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      paymentHeadAllocation: { findMany: jest.fn(), create: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.payment.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([{ id: 'sf-jul' }] as any);
    txMock.studentFee.findMany.mockResolvedValue([julFee] as any);
    txMock.paymentHeadAllocation.findMany.mockResolvedValue([
      { feeHeadId: 'fh-monthly', feeExtraItemId: null, amount: 500000 },
      { feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 50000 },
      { feeHeadId: 'fh-annual', feeExtraItemId: null, amount: 50000 },
    ] as any);

    const res = await request(app).post('/admin/payments/allocate').set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: 150000,
      paymentMethod: 'CASH',
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [{ feeHeadId: 'fh-monthly', headName: 'MonthlyFee', amountPaise: 150000 }],
        extras: [],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/MonthlyFee.*remaining due \(0\)/);
  });

  test('accepts payment on head with remaining due and snapshots correct totalDue', async () => {
    const txMock = {
      payment: { create: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      paymentHeadAllocation: { findMany: jest.fn(), create: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.payment.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([{ id: 'sf-jul' }] as any);
    txMock.studentFee.findMany.mockResolvedValue([julFee] as any);
    txMock.paymentHeadAllocation.findMany.mockResolvedValue([
      { feeHeadId: 'fh-monthly', feeExtraItemId: null, amount: 500000, paymentId: 'p-old' },
      { feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 50000, paymentId: 'p-old' },
      { feeHeadId: 'fh-annual', feeExtraItemId: null, amount: 50000, paymentId: 'p-old' },
    ] as any);
    txMock.payment.create.mockResolvedValue({
      id: 'p-new', studentFeeId: 'sf-jul', studentId: 's1', amount: 150000,
      paymentMethod: 'CASH', receiptNumber: 'RCP-202607-0002-1',
    } as any);
    txMock.paymentHeadAllocation.create.mockResolvedValue({} as any);
    txMock.studentFee.update.mockResolvedValue({} as any);

    prismaMock.student.findUnique.mockResolvedValue({
      name: 'Ahmed', rollNumber: '1', group: { name: 'Playgroup', section: null }, parents: [],
    } as any);
    prismaMock.studentFee.findMany
      .mockResolvedValueOnce([{ ...julFee, paidAmount: 750000, extraItems: [] }] as any)
      .mockResolvedValueOnce([] as any);
    prismaMock.paymentHeadAllocation.findMany.mockResolvedValue([
      { feeHeadId: 'fh-monthly', feeExtraItemId: null, amount: 500000, paymentId: 'p-old' },
      { feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 50000, paymentId: 'p-old' },
      { feeHeadId: 'fh-annual', feeExtraItemId: null, amount: 50000, paymentId: 'p-old' },
    ] as any);
    prismaMock.paymentReceipt.create.mockResolvedValue({} as any);
    prismaMock.paymentAuditLog.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/payments/allocate').set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: 150000,
      paymentMethod: 'CASH',
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [{ feeHeadId: 'fh-annual', headName: 'Annual Fund', amountPaise: 150000 }],
        extras: [],
      },
    });

    expect(res.status).toBe(201);
    expect(prismaMock.paymentReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalDuePaise: 150000,
        amountPaidPaise: 150000,
        balanceAfterPaise: 0,
        isFullyPaid: true,
      }),
    }));
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
// AY DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/students/:id/fee — academic year scope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 without resolvable academic year', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/admin/students/s1/fee').set('Authorization', adminToken);
    expect(res.status).toBe(400);
  });

  test('filters studentFees by academicYearId', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findUnique.mockResolvedValue({
      id: 's1', name: 'Ahmed',
      group: { name: 'Class 2', section: 'A', displayOrder: 2 },
      parents: [],
      studentFees: [{ id: 'sf1', month: 6, year: 2026, academicYearId: 'ay1', netAmount: 500000, paidAmount: 0, payments: [], extraItems: [] }],
    } as any);

    const res = await request(app).get('/admin/students/s1/fee?academicYearId=ay1').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(prismaMock.student.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        studentFees: expect.objectContaining({
          where: { academicYearId: 'ay1' },
        }),
      }),
    }));
    expect(res.body.data.studentFees).toHaveLength(1);
  });

  test('explicit academicYearId overrides active year lookup', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: 's1', studentFees: [], group: null, parents: [] } as any);
    await request(app).get('/admin/students/s1/fee?academicYearId=ay-old').set('Authorization', adminToken);
    expect(prismaMock.student.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        studentFees: expect.objectContaining({ where: { academicYearId: 'ay-old' } }),
      }),
    }));
  });
});

describe('POST /admin/student-fees/generate — AY unique key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('upserts by studentId + month + year + academicYearId', async () => {
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date(), effectiveTo: null, academicYearId: 'ay-old', feeHead: { category: 'MONTHLY', name: 'Tuition' } },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({} as any);

    await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({
      month: 6, year: 2026, academicYearId: 'ay-old', headIds: ['fh1'],
    });

    expect(prismaMock.studentFee.findUnique).toHaveBeenCalledWith({
      where: { studentId_month_year_academicYearId: { studentId: 's1', month: 6, year: 2026, academicYearId: 'ay-old' } },
      include: { extraItems: { select: { amount: true } } },
    });
  });
});

describe('GET /admin/families — AY scope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 without academic year in search mode', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/admin/families?search=Ali').set('Authorization', adminToken);
    expect(res.status).toBe(400);
  });

  test('list mode returns all active families', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1' } as any);
    prismaMock.family.findMany.mockResolvedValue([
      {
        id: 'fam1', name: 'Khan Family', fatherName: 'Ali Khan', phone: '0300', isActive: true,
        students: [],
        _count: { students: 2, payments: 1 },
        createdBy: null, updatedBy: null,
      },
    ] as any);

    const res = await request(app).get('/admin/families?academicYearId=ay1').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Khan Family');
    expect(res.body.data[0].studentCount).toBe(2);
  });

  test('scopes unpaid fees and students to academicYearId in search mode', async () => {
    prismaMock.family.findMany.mockResolvedValue([
      {
        id: 'fam1', name: 'Khan Family', fatherName: 'Ali Khan', phone: '0300', isActive: true,
        students: [
          { id: 's1', name: 'Ahmed', studentFees: [{ id: 'sf1', month: 6, year: 2026, netAmount: 500000, paidAmount: 0, extraItems: [] }], group: { name: 'Class 2' } },
          { id: 's2', name: 'Sara', studentFees: [], group: { name: 'Class 3' } },
        ],
        _count: { students: 2, payments: 0 },
        createdBy: null, updatedBy: null,
      },
    ] as any);

    const res = await request(app).get('/admin/families?search=Ali&academicYearId=ay1').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(prismaMock.family.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        students: expect.objectContaining({
          where: { academicYearId: 'ay1', isActive: true, status: 'ACTIVE' },
          select: expect.objectContaining({
            studentFees: expect.objectContaining({
              where: { academicYearId: 'ay1', status: { in: ['UNPAID', 'PARTIAL'] } },
            }),
          }),
        }),
      }),
    }));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].students).toHaveLength(1);
    expect(res.body.data[0].students[0].id).toBe('s1');
  });
});

describe('POST /admin/families — CRUD', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects without name', async () => {
    const res = await request(app).post('/admin/families').set('Authorization', adminToken).send({ studentIds: ['s1'] });
    expect(res.status).toBe(400);
  });

  test('creates family with students', async () => {
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        family: {
          create: jest.fn().mockResolvedValue({ id: 'fam-new', name: 'Ahmed Family' }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'fam-new', name: 'Ahmed Family', students: [{ id: 's1', name: 'Ahmed' }],
            createdBy: { id: 'admin-1', name: 'Admin' },
          }),
        },
        student: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        familyChangeLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });
    prismaMock.auditLog.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/families').set('Authorization', adminToken).send({
      name: 'Ahmed Family', studentIds: ['s1'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Ahmed Family');
  });
});

describe('POST /admin/family-payments/allocate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when student totals do not match family amount', async () => {
    prismaMock.family.findUnique.mockResolvedValue({
      id: 'fam1', isActive: true, students: [{ id: 's1' }],
    } as any);

    const res = await request(app).post('/admin/family-payments/allocate').set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      students: [{ studentId: 's1', amountPaidPaise: 50000, previousMonths: [{ studentFeeId: 'sf1', amountPaise: 50000 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/do not match family amount/i);
  });

  test('returns 400 when student is not in family', async () => {
    prismaMock.family.findUnique.mockResolvedValue({
      id: 'fam1', isActive: true, students: [{ id: 's1' }],
    } as any);

    const res = await request(app).post('/admin/family-payments/allocate').set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      students: [{ studentId: 's-other', amountPaidPaise: 100000, previousMonths: [{ studentFeeId: 'sf1', amountPaise: 100000 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not in this family/i);
  });
});

describe('GET /admin/family-payments/:id/receipt', () => {
  test('returns 404 when no snapshot', async () => {
    prismaMock.familyPaymentReceipt.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/admin/family-payments/fp1/receipt').set('Authorization', adminToken);
    expect(res.status).toBe(404);
  });

  test('returns family receipt snapshot', async () => {
    prismaMock.familyPaymentReceipt.findUnique.mockResolvedValue({
      id: 'fpr1',
      familyPaymentId: 'fp1',
      receiptNumber: 'FMP-202607-0001',
      templateType: 'FIRST',
      snapshot: { familyName: 'Khan Family', students: [] },
      totalDuePaise: 500000,
      amountPaidPaise: 500000,
      balanceAfterPaise: 0,
      printCount: 0,
    } as any);
    const res = await request(app).get('/admin/family-payments/fp1/receipt').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.templateType).toBe('FIRST');
  });
});

describe('POST /admin/family-payments — AY integrity', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 without academicYearId', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/admin/family-payments').set('Authorization', adminToken).send({
      familyId: 'fam1', payments: [{ studentFeeId: 'sf1', amount: 100000, paymentMethod: 'CASH' }],
    });
    expect(res.status).toBe(400);
  });

  test('rejects fees from a different academic year', async () => {
    const txMock = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      studentFee: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: { create: jest.fn() },
      familyPayment: { create: jest.fn() },
    };
    prismaMock.familyPayment.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const res = await request(app).post('/admin/family-payments').set('Authorization', adminToken).send({
      familyId: 'fam1', academicYearId: 'ay1',
      payments: [{ studentFeeId: 'sf-wrong', amount: 100000, paymentMethod: 'CASH' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/academic year/i);
  });

  test('status accounts for extra items when marking PAID', async () => {
    const fee = {
      id: 'sf1', studentId: 's1', academicYearId: 'ay1',
      netAmount: 400000, paidAmount: 0,
      extraItems: [{ amount: 50000 }],
    };
    const txMock = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      studentFee: {
        findMany: jest.fn().mockResolvedValue([fee]),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'p1', studentFeeId: 'sf1', studentId: 's1', amount: 450000, paymentMethod: 'CASH', receiptNumber: 'FMP-202607-0001-1', reference: null }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 450000 } }),
      },
      familyPayment: {
        create: jest.fn().mockResolvedValue({ id: 'fp1', receiptNumber: 'FMP-202607-0001', payments: [], family: { fatherName: 'Ali', phone: '0300' } }),
      },
    };
    prismaMock.familyPayment.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.studentFee.findUnique.mockResolvedValue({
      ...fee, month: 6, year: 2026, feeHeadBreakdown: [], extraItems: [{ name: 'Lab', amount: 50000 }],
      student: { name: 'Ahmed', rollNumber: '1', group: { name: 'Class 2', section: 'A' }, parents: [] },
    } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([]);
    prismaMock.paymentReceipt.create.mockResolvedValue({} as any);
    prismaMock.paymentAuditLog.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/family-payments').set('Authorization', adminToken).send({
      familyId: 'fam1', academicYearId: 'ay1',
      payments: [{ studentFeeId: 'sf1', amount: 450000, paymentMethod: 'CASH' }],
    });

    expect(res.status).toBe(201);
    expect(txMock.studentFee.update).toHaveBeenCalledWith({
      where: { id: 'sf1' },
      data: expect.objectContaining({ status: 'PAID', paidAmount: 450000 }),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// FEE REPORTS
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/fees/summary', () => {
  test('returns summary stats', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([
      { netAmount: 500000, paidAmount: 500000, status: 'PAID', extraItems: [] },
      { netAmount: 500000, paidAmount: 0, status: 'UNPAID', extraItems: [] },
    ] as any);
    const res = await request(app).get('/admin/fees/summary?month=6&year=2026&academicYearId=ay1').set('Authorization', adminToken);
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupTxMock() {
    const txMock = { payment: { create: jest.fn() }, studentFee: { update: jest.fn() } };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    return txMock;
  }

  test('sets PAID only after extras are covered', async () => {
    const txMock = {
      payment: { create: jest.fn(), aggregate: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.payment.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([{ id: 'sf1' }, { id: 'sf2' }] as any);
    txMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 400000, paidAmount: 0, extraItems: [{ amount: 50000 }], month: 4, year: 2026 },
      { id: 'sf2', studentId: 's1', netAmount: 300000, paidAmount: 0, extraItems: [], month: 5, year: 2026 },
    ] as any);
    txMock.payment.create.mockResolvedValue({
      id: 'p1', studentFeeId: 'sf1', studentId: 's1', amount: 450000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202607-0001', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null, createdAt: new Date(),
    });
    txMock.studentFee.update.mockResolvedValue({} as any);
    prismaMock.student.findUnique.mockResolvedValue({ name: 'Test', rollNumber: '1', group: { name: 'Class 1', section: null }, parents: [] } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([] as any);

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({
      studentId: 's1', amount: 450000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);

    // sf1: 450k paid = 450k total due → PAID (was 400k net + 50k extra)
    expect(txMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PAID' }) })
    );
  });

  test('sets PARTIAL when payment falls short of netAmount + extras with waterfall', async () => {
    const txMock = {
      payment: { create: jest.fn(), aggregate: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.payment.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([{ id: 'sf1' }] as any);
    txMock.studentFee.findMany.mockResolvedValue([
      { id: 'sf1', studentId: 's1', netAmount: 400000, paidAmount: 0, extraItems: [{ amount: 100000 }], month: 4, year: 2026 },
    ] as any);
    txMock.payment.create.mockResolvedValue({
      id: 'p2', studentFeeId: 'sf1', studentId: 's1', amount: 420000, paymentMethod: 'CASH',
      receiptNumber: 'RCP-202607-0002', reference: null, note: null, recordedById: 'admin-1',
      revertedAt: null, revertedById: null, revertReason: null, createdAt: new Date(),
    });
    txMock.studentFee.update.mockResolvedValue({} as any);
    prismaMock.student.findUnique.mockResolvedValue({ name: 'Test', rollNumber: '1', group: { name: 'Class 1', section: null }, parents: [] } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([] as any);

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({
      studentId: 's1', amount: 420000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);

    // sf1: 420k paid < 500k total due (400k net + 100k extra) → PARTIAL
    expect(txMock.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sf1' }, data: expect.objectContaining({ status: 'PARTIAL' }) })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// ISSUE 5: RECEIPT NUMBER RACE CONDITION
// ═══════════════════════════════════════════════════════════════════

describe('Issue 5: Atomic receipt number generation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects /payments with negative amount', async () => {
    const res = await request(app).post('/admin/payments').set('Authorization', adminToken).send({
      studentFeeId: 'sf1', amount: -5000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(400);
  });

  test('rejects /payments with zero amount', async () => {
    const res = await request(app).post('/admin/payments').set('Authorization', adminToken).send({
      studentFeeId: 'sf1', amount: 0, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ISSUE 6: WATERFALL CONCURRENCY + OVERPAID
// ═══════════════════════════════════════════════════════════════════

describe('Issue 6: Waterfall concurrency guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('waterfall validates fees inside transaction (concurrency guard)', async () => {
    const txMock = {
      payment: { create: jest.fn(), aggregate: jest.fn() },
      studentFee: { findMany: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    // Simulate: first tx reads fees, second tx should see them as already paid
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.payment.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([]); // lock query finds no unpaid rows (already paid by another tx)
    txMock.studentFee.findMany.mockResolvedValue([]); // no unpaid fees

    const res = await request(app).post('/admin/payments/waterfall').set('Authorization', adminToken).send({
      studentId: 's1', amount: 100000, paymentMethod: 'CASH',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('No unpaid fees');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ISSUE 8: ONE_TIME FEE GENERATION
// ═══════════════════════════════════════════════════════════════════

describe('Issue 8: ONE_TIME fee head tracking', () => {
  beforeEach(() => jest.clearAllMocks());

  test('generates ONE_TIME fee when head not in existing breakdown', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date('2025-08-01'), effectiveTo: null, academicYearId: 'ay1', feeHead: { name: 'Tuition', category: 'MONTHLY' } },
      { id: 'fs2', groupId: 'g1', feeHeadId: 'fh2', amount: 100000, effectiveFrom: new Date('2025-08-01'), effectiveTo: null, academicYearId: 'ay1', feeHead: { name: 'Admission Fee', category: 'ONE_TIME' } },
    ] as any);
    // Existing fees have breakdown WITHOUT "Admission Fee"
    prismaMock.studentFee.findMany.mockResolvedValue([
      { netAmount: 500000, feeHeadBreakdown: [{ name: 'Tuition', amount: 500000, category: 'MONTHLY' }] },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null); // no existing fee for this month
    prismaMock.studentFee.create.mockResolvedValue({ id: 'sf-new' } as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 9, year: 2026, categories: ['MONTHLY', 'ONE_TIME'] });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(1);
  });

  test('skips ONE_TIME fee when head already in existing breakdown, still generates MONTHLY', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's2', groupId: 'g1', customFeeAmount: null, feeOverrides: null },
    ] as any);
    prismaMock.feeStructure.findMany.mockResolvedValue([
      { id: 'fs1', groupId: 'g1', feeHeadId: 'fh1', amount: 500000, effectiveFrom: new Date('2025-08-01'), effectiveTo: null, academicYearId: 'ay1', feeHead: { name: 'Tuition', category: 'MONTHLY' } },
      { id: 'fs3', groupId: 'g1', feeHeadId: 'fh3', amount: 100000, effectiveFrom: new Date('2025-08-01'), effectiveTo: null, academicYearId: 'ay1', feeHead: { name: 'Admission Fee', category: 'ONE_TIME' } },
    ] as any);
    prismaMock.studentFee.findMany.mockResolvedValue([
      { feeHeadBreakdown: [{ name: 'Admission Fee', amount: 100000, category: 'ONE_TIME' }, { name: 'Tuition', amount: 500000, category: 'MONTHLY' }] },
    ] as any);
    prismaMock.studentFee.findUnique.mockResolvedValue(null);
    prismaMock.studentFee.create.mockResolvedValue({ id: 'sf-new' } as any);

    const res = await request(app).post('/admin/student-fees/generate').set('Authorization', adminToken).send({ month: 9, year: 2026, categories: ['MONTHLY', 'ONE_TIME'] });
    expect(res.status).toBe(200);
    // One fee generated (MONTHLY Tuition), ONE_TIME Admission Fee was skipped
    expect(res.body.data.generated).toBe(1);
    expect(res.body.data.skipped).toBe(0);
  });
});

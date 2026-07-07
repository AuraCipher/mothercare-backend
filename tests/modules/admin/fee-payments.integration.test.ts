/**
 * Fee payments integration tests — allocate, family allocate, receipts, duplicate heads.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken } from '../../helpers/auth';
import {
  mergeFeeHeadBreakdown,
  normalizeAllocateHeadsInput,
  buildReceiptHeadRowsFromAllocations,
  sumSelectedAllocationPaise,
} from '../../../src/modules/admin/services/fee-breakdown.utils';

const adminToken = 'Bearer ' + generateTestToken('admin-1', 'super_admin');
const allocateQuery = { branchId: 'b1' };

const DUP_BREAKDOWN = [
  { feeHeadId: 'fh-monthly', name: 'MonthlyFee', amount: 500000, category: 'MONTHLY' },
  { feeHeadId: 'fh-paper', name: 'PaperFund', amount: 50000, category: 'MONTHLY' },
  { feeHeadId: 'fh-paper', name: 'PaperFund', amount: 50000, category: 'MONTHLY' },
  { feeHeadId: 'fh-annual', name: 'Annual Fund', amount: 200000, category: 'ANNUAL' },
];

function mockActiveAy() {
  prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay1', status: 'ACTIVE' } as any);
}

function julFee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sf-jul',
    studentId: 's1',
    month: 7,
    year: 2026,
    netAmount: 800000,
    paidAmount: 0,
    status: 'UNPAID',
    feeHeadBreakdown: DUP_BREAKDOWN,
    extraItems: [],
    ...overrides,
  };
}

function setupAllocateTx(fee: ReturnType<typeof julFee>, priorAllocs: unknown[] = []) {
  const txMock = {
    payment: { create: jest.fn() },
    studentFee: { findMany: jest.fn(), update: jest.fn() },
    paymentHeadAllocation: { findMany: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
  prismaMock.payment.findMany.mockResolvedValue([]);
  txMock.$queryRaw.mockResolvedValue([{ id: fee.id }] as any);
  txMock.studentFee.findMany.mockResolvedValue([fee] as any);
  txMock.paymentHeadAllocation.findMany.mockResolvedValue(priorAllocs as any);
  txMock.payment.create.mockResolvedValue({
    id: 'p-new', studentFeeId: fee.id, studentId: fee.studentId, amount: 100000,
    paymentMethod: 'CASH', receiptNumber: 'RCP-202607-0099-1',
  } as any);
  txMock.paymentHeadAllocation.create.mockResolvedValue({} as any);
  txMock.studentFee.update.mockResolvedValue({} as any);
  prismaMock.student.findUnique.mockResolvedValue({
    name: 'Ahmed', rollNumber: '1', group: { name: 'Jr Montessori', section: '1' }, parents: [],
  } as any);
  prismaMock.studentFee.findMany
    .mockResolvedValueOnce([{ ...fee, paidAmount: fee.paidAmount + 100000, extraItems: [] }] as any)
    .mockResolvedValueOnce([] as any);
  prismaMock.paymentHeadAllocation.findMany.mockResolvedValue([]);
  prismaMock.paymentReceipt.create.mockResolvedValue({} as any);
  prismaMock.paymentAuditLog.create.mockResolvedValue({} as any);
  return txMock;
}

function setupFamilyAllocateTx(fees: ReturnType<typeof julFee>[]) {
  const txMock = {
    payment: { create: jest.fn() },
    studentFee: { findMany: jest.fn(), update: jest.fn() },
    paymentHeadAllocation: { findMany: jest.fn(), create: jest.fn() },
    familyPayment: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  prismaMock.familyPayment.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
  txMock.$queryRaw.mockResolvedValue(fees.map((f) => ({ id: f.id })) as any);
  txMock.studentFee.findMany.mockImplementation(async ({ where }: any) =>
    fees.filter((f) => (where.id?.in || []).includes(f.id)),
  );
  txMock.paymentHeadAllocation.findMany.mockResolvedValue([]);
  txMock.payment.create.mockImplementation(async ({ data }: any) => ({
    id: `p-${data.studentFeeId}`, studentFeeId: data.studentFeeId, studentId: data.studentId,
    amount: data.amount, paymentMethod: data.paymentMethod, receiptNumber: data.receiptNumber,
    reference: data.reference,
  }));
  txMock.paymentHeadAllocation.create.mockResolvedValue({});
  txMock.studentFee.update.mockResolvedValue({});
  txMock.familyPayment.create.mockResolvedValue({
    id: 'fp1', receiptNumber: 'FMP-202607-0001', totalAmount: 0, paymentMethod: 'CASH',
  });
  prismaMock.studentFee.findUnique.mockImplementation((async ({ where }: any) => {
    const f = fees.find((x) => x.id === where.id);
    if (!f) return null;
    return {
      ...f, month: f.month, year: f.year,
      student: { name: 'Student', rollNumber: '1', group: { name: 'G', section: '1' }, parents: [] },
    } as any;
  }) as any);
  prismaMock.studentFee.findMany.mockResolvedValue([]);
  prismaMock.paymentHeadAllocation.findMany.mockResolvedValue([]);
  prismaMock.paymentReceipt.create.mockResolvedValue({} as any);
  prismaMock.paymentAuditLog.create.mockResolvedValue({} as any);
  return txMock;
}

// ─── Pure logic regression (family + student parity) ─────────────────

describe('fee allocation math — family/student parity', () => {
  test.each([
    [50000, 50000, 100000],
    [50000, 50000, 50000, 150000],
  ])('duplicate head lines sum to %i', (...amounts) => {
    const expected = amounts.pop() as number;
    const heads = amounts.map((a) => ({ feeHeadId: 'fh-paper', amountPaise: a }));
    expect(sumSelectedAllocationPaise({ heads, previousMonths: [], extras: [] })).toBe(expected);
  });

  test.each([
    ['MonthlyFee', 1],
    ['PaperFund', 1],
    ['Annual Fund', 1],
  ])('merged breakdown has one %s row', (name, count) => {
    expect(mergeFeeHeadBreakdown(DUP_BREAKDOWN).filter((h) => h.name === name)).toHaveLength(count);
  });

  test('receipt from allocations has single PaperFund paid line', () => {
    const rows = buildReceiptHeadRowsFromAllocations(
      DUP_BREAKDOWN,
      [{ feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 90000, paymentId: 'pay1' }],
      'pay1',
    );
    expect(rows.filter((r) => r.name === 'PaperFund')).toHaveLength(1);
    expect(rows.find((r) => r.name === 'PaperFund')?.paidPaise).toBe(90000);
  });
});

// ─── POST /admin/payments/allocate validation matrix ─────────────────

describe('POST /admin/payments/allocate — validation matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['missing studentId', { amountPaidPaise: 1000, currentMonth: { studentFeeId: 'sf', heads: [{ amountPaise: 1000 }] } }],
    ['missing amount', { studentId: 's1', currentMonth: { studentFeeId: 'sf', heads: [{ amountPaise: 1000 }] } }],
    ['zero amount', { studentId: 's1', amountPaidPaise: 0, currentMonth: { studentFeeId: 'sf', heads: [{ amountPaise: 0 }] } }],
    ['no selection', { studentId: 's1', amountPaidPaise: 1000, previousMonths: [], currentMonth: { studentFeeId: 'sf', heads: [], extras: [] } }],
    ['missing studentFeeId for heads', { studentId: 's1', amountPaidPaise: 1000, currentMonth: { heads: [{ amountPaise: 1000 }] } }],
  ])('400 — %s', async (_label, body) => {
    const res = await request(app).post('/admin/payments/allocate').query(allocateQuery).set('Authorization', adminToken).send(body);
    expect(res.status).toBe(400);
  });

  test('401 without token', async () => {
    const res = await request(app).post('/admin/payments/allocate').send({ studentId: 's1', amountPaidPaise: 100 });
    expect(res.status).toBe(401);
  });

  test.each([
    [600000, 1000000, /does not match amount paid/],
    [1000000, 600000, /does not match amount paid/],
  ])('400 when selected %i !== paid %i', async (selected, paid, pattern) => {
    const res = await request(app).post('/admin/payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: paid,
      paymentMethod: 'CASH',
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [{ feeHeadId: 'fh-monthly', headName: 'MonthlyFee', amountPaise: selected }],
        extras: [],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
  });
});

// ─── POST /admin/payments/allocate — duplicate heads success ─────────

describe('POST /admin/payments/allocate — duplicate head receipts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts merged duplicate head payload and snapshot has one PaperFund row', async () => {
    const fee = julFee();
    setupAllocateTx(fee);
    const res = await request(app).post('/admin/payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [
          { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
          { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
        ],
        extras: [],
      },
    });
    expect(res.status).toBe(201);
    const heads = prismaMock.paymentReceipt.create.mock.calls[0][0].data.currentMonthHeads as any[];
    expect(heads.filter((h) => h.name === 'PaperFund')).toHaveLength(1);
  });

  test.each(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE'])('payment method %s', async (method) => {
    setupAllocateTx(julFee());
    const res = await request(app).post('/admin/payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: 100000,
      paymentMethod: method,
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [{ feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 100000 }],
        extras: [],
      },
    });
    expect(res.status).toBe(201);
  });
});

// ─── POST /admin/family-payments/allocate ────────────────────────────

describe('POST /admin/family-payments/allocate — validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['missing familyId', { amountPaidPaise: 1000, students: [{ studentId: 's1', amountPaidPaise: 1000 }] }],
    ['missing amount', { familyId: 'fam1', students: [{ studentId: 's1', amountPaidPaise: 1000 }] }],
    ['empty students', { familyId: 'fam1', amountPaidPaise: 1000, students: [] }],
  ])('400 — %s', async (_label, body) => {
    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send(body);
    expect(res.status).toBe(400);
  });

  test('400 when family total mismatch', async () => {
    prismaMock.family.findUnique.mockResolvedValue({ id: 'fam1', isActive: true, students: [{ id: 's1' }] } as any);
    mockActiveAy();
    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 200000,
      paymentMethod: 'CASH',
      students: [{ studentId: 's1', amountPaidPaise: 100000, previousMonths: [{ studentFeeId: 'sf1', amountPaise: 100000 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/do not match family amount/i);
  });

  test('merges duplicate head lines in student payload (201)', async () => {
    prismaMock.family.findUnique.mockResolvedValue({ id: 'fam1', isActive: true, students: [{ id: 's1' }] } as any);
    mockActiveAy();
    setupFamilyAllocateTx([julFee()]);
    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      students: [{
        studentId: 's1',
        amountPaidPaise: 100000,
        currentMonth: {
          studentFeeId: 'sf-jul',
          heads: [
            { feeHeadId: 'fh-paper', amountPaise: 50000 },
            { feeHeadId: 'fh-paper', amountPaise: 50000 },
          ],
          extras: [],
        },
      }],
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /admin/family-payments/allocate — duplicate heads success', () => {
  beforeEach(() => jest.clearAllMocks());

  test('two students with duplicate breakdown — per-student receipt rows merged', async () => {
    mockActiveAy();
    prismaMock.family.findUnique.mockResolvedValue({
      id: 'fam1', isActive: true, students: [{ id: 's1' }, { id: 's2' }],
    } as any);
    const fee1 = julFee({ id: 'sf-jul-1', studentId: 's1' });
    const fee2 = julFee({ id: 'sf-jul-2', studentId: 's2' });
    setupFamilyAllocateTx([fee1, fee2]);

    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 200000,
      paymentMethod: 'CASH',
      students: [
        {
          studentId: 's1',
          amountPaidPaise: 100000,
          currentMonth: {
            studentFeeId: 'sf-jul-1',
            heads: [{ feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 100000 }],
            extras: [],
          },
        },
        {
          studentId: 's2',
          amountPaidPaise: 100000,
          currentMonth: {
            studentFeeId: 'sf-jul-2',
            heads: [
              { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
              { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
            ],
            extras: [],
          },
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(prismaMock.paymentReceipt.create).toHaveBeenCalled();
    const calls = prismaMock.paymentReceipt.create.mock.calls;
    for (const call of calls) {
      const heads = call[0].data.currentMonthHeads as any[];
      const paper = heads.filter((h) => h.name === 'PaperFund');
      expect(paper.length).toBeLessThanOrEqual(1);
    }
  });

  test('404 inactive family', async () => {
    mockActiveAy();
    prismaMock.family.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam-missing',
      academicYearId: 'ay1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      students: [{ studentId: 's1', amountPaidPaise: 100000, previousMonths: [{ studentFeeId: 'sf1', amountPaise: 100000 }] }],
    });
    expect(res.status).toBe(404);
  });
});

// ─── normalizeAllocateHeadsInput edge cases (API-adjacent) ───────────

describe('normalizeAllocateHeadsInput — object-shaped heads from JSON', () => {
  test.each([
    [2, { '0': { feeHeadId: 'a', amountPaise: 100 }, '1': { feeHeadId: 'b', amountPaise: 200 } }],
    [1, { '0': { feeHeadId: 'a', amountPaise: 50 }, '1': { feeHeadId: 'a', amountPaise: 50 } }],
  ])('normalizes to %i rows', (len, obj) => {
    expect(normalizeAllocateHeadsInput(obj)).toHaveLength(len);
  });
});

// ─── Bulk parameterized receipt scenarios ──────────────────────────────

describe('receipt head rows — parameterized scenarios', () => {
  const scenarios = [
    { paid: 500000, head: 'fh-monthly', due: 500000 },
    { paid: 100000, head: 'fh-paper', due: 100000 },
    { paid: 150000, head: 'fh-annual', due: 200000 },
    { paid: 0, head: 'fh-annual', due: 200000 },
  ];

  test.each(scenarios)('head $head paid $paid', ({ paid, head, due }) => {
    const rows = buildReceiptHeadRowsFromAllocations(
      DUP_BREAKDOWN,
      paid > 0 ? [{ feeHeadId: head, feeExtraItemId: null, amount: paid, paymentId: 'p1' }] : [],
      'p1',
    );
    const row = rows.find((r) => r.name && mergeFeeHeadBreakdown(DUP_BREAKDOWN).find((h) => h.feeHeadId === head)?.name === r.name);
    if (paid > 0) {
      expect(row?.paidPaise).toBe(paid);
    }
    if (row) expect(row.dueBeforePaise).toBe(due);
  });
});

// ─── Multi-month / extra combinations (selection math) ───────────────

describe('sumSelectedAllocationPaise — multi-part payments', () => {
  test.each([
    [{ prev: [{ amountPaise: 100000 }], heads: [], extras: [], total: 100000 }],
    [{ prev: [], heads: [{ feeHeadId: 'a', amountPaise: 500000 }], extras: [], total: 500000 }],
    [{ prev: [], heads: [], extras: [{ amountPaise: 25000 }], total: 25000 }],
    [{ prev: [{ amountPaise: 50000 }], heads: [{ feeHeadId: 'a', amountPaise: 50000 }], extras: [{ amountPaise: 25000 }], total: 125000 }],
    [{ prev: [], heads: [{ feeHeadId: 'a', amountPaise: 25000 }, { feeHeadId: 'a', amountPaise: 25000 }], extras: [], total: 50000 }],
  ])('total %#', ({ prev, heads, extras, total }) => {
    expect(sumSelectedAllocationPaise({ previousMonths: prev, heads, extras })).toBe(total);
  });
});

// ─── Payment method + reference on allocate ──────────────────────────

describe('POST /admin/payments/allocate — optional fields', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts reference note on allocate', async () => {
    setupAllocateTx(julFee());
    const res = await request(app).post('/admin/payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      studentId: 's1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      reference: 'CHQ-123',
      note: 'Partial paper fund',
      currentMonth: {
        studentFeeId: 'sf-jul',
        heads: [{ feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 100000 }],
        extras: [],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.receiptNumber).toBeDefined();
  });
});

// ─── Family payment simple POST receipt heads merged ───────────────────

describe('POST /admin/family-payments — sticker receipt uses merged heads', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates payment and merged receipt heads when breakdown has duplicates', async () => {
    mockActiveAy();
    const fee = julFee({ netAmount: 800000, paidAmount: 0 });
    const txMock = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      studentFee: {
        findMany: jest.fn().mockResolvedValue([{ ...fee, academicYearId: 'ay1' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        create: jest.fn().mockResolvedValue({
          id: 'p1', studentFeeId: 'sf-jul', studentId: 's1', amount: 100000,
          paymentMethod: 'CASH', receiptNumber: 'FMP-202607-0001-1', reference: null,
        }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100000 } }),
      },
      familyPayment: {
        create: jest.fn().mockResolvedValue({ id: 'fp1', receiptNumber: 'FMP-202607-0001', payments: [], family: { fatherName: 'Ali', phone: '0300' } }),
      },
    };
    prismaMock.familyPayment.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.studentFee.findUnique.mockResolvedValue({
      ...fee, month: 7, year: 2026, academicYearId: 'ay1',
      student: { name: 'Ahmed', rollNumber: '1', group: { name: 'G', section: '1' }, parents: [] },
    } as any);
    prismaMock.studentFee.findMany.mockResolvedValue([]);
    prismaMock.paymentHeadAllocation.findMany.mockResolvedValue([]);
    prismaMock.paymentReceipt.create.mockResolvedValue({} as any);
    prismaMock.paymentAuditLog.create.mockResolvedValue({} as any);

    const res = await request(app).post('/admin/family-payments').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      payments: [{ studentFeeId: 'sf-jul', studentId: 's1', amount: 100000, paymentMethod: 'CASH' }],
    });
    expect(res.status).toBe(201);
    if (prismaMock.paymentReceipt.create.mock.calls.length > 0) {
      const heads = prismaMock.paymentReceipt.create.mock.calls[0][0].data.currentMonthHeads as any[];
      expect(heads.filter((h) => h.name === 'PaperFund').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('mergeFeeHeadBreakdown — amount preservation', () => {
  const duplicateCounts = [2, 3, 4, 5, 6, 7, 8];
  test.each(duplicateCounts)('%i duplicate Annual Fund rows merge to one', (n) => {
    const rows = Array.from({ length: n }, () => ({
      feeHeadId: 'fh-annual', name: 'Annual Fund', amount: 10000, category: 'ANNUAL',
    }));
    const merged = mergeFeeHeadBreakdown(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(10000 * n);
  });

  test.each([
    [500000, 50000, 50000, 600000],
  ])('multi-head totals %#', (monthly, paper1, paper2, total) => {
    const merged = mergeFeeHeadBreakdown([
      { feeHeadId: 'm', name: 'MonthlyFee', amount: monthly, category: 'MONTHLY' },
      { feeHeadId: 'p', name: 'PaperFund', amount: paper1, category: 'MONTHLY' },
      { feeHeadId: 'p', name: 'PaperFund', amount: paper2, category: 'MONTHLY' },
    ]);
    expect(merged.reduce((s, h) => s + h.amount, 0)).toBe(total);
  });
});

describe('buildReceiptHeadRowsFromAllocations — no duplicate paid lines', () => {
  test.each([2, 3, 4, 5, 6, 7, 8])('%i breakdown rows => 1 receipt line per head', (dupCount) => {
    const breakdown = Array.from({ length: dupCount }, () => ({
      feeHeadId: 'fh-x', name: 'Annual Fund', amount: 5000, category: 'ANNUAL',
    }));
    const rows = buildReceiptHeadRowsFromAllocations(
      breakdown,
      [{ feeHeadId: 'fh-x', feeExtraItemId: null, amount: 10000, paymentId: 'p1' }],
      'p1',
    );
    expect(rows.filter((r) => r.name === 'Annual Fund')).toHaveLength(1);
    expect(rows[0].paidPaise).toBe(10000);
  });
});

describe('POST /admin/family-payments/allocate — student not in family matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['s-other', 's2', 'outside'])('rejects student %s', async (badId) => {
    prismaMock.family.findUnique.mockResolvedValue({ id: 'fam1', isActive: true, students: [{ id: 's1' }] } as any);
    mockActiveAy();
    const res = await request(app).post('/admin/family-payments/allocate').query(allocateQuery).set('Authorization', adminToken).send({
      familyId: 'fam1',
      academicYearId: 'ay1',
      amountPaidPaise: 100000,
      paymentMethod: 'CASH',
      students: [{ studentId: badId, amountPaidPaise: 100000, previousMonths: [{ studentFeeId: 'sf1', amountPaise: 100000 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not in this family/i);
  });
});

describe('normalizeAllocateHeadsInput — family allocate payloads', () => {
  test.each([
    [100000, [{ feeHeadId: 'p', amountPaise: 50000 }, { feeHeadId: 'p', amountPaise: 50000 }]],
    [200000, [{ feeHeadId: 'p', amountPaise: 100000 }, { feeHeadId: 'p', amountPaise: 100000 }]],
    [150000, [{ headName: 'PaperFund', amountPaise: 75000 }, { headName: 'PaperFund', amountPaise: 75000 }]],
  ])('merged total %i', (expected, heads) => {
    expect(normalizeAllocateHeadsInput(heads).reduce((s, h) => s + h.amountPaise, 0)).toBe(expected);
  });
});

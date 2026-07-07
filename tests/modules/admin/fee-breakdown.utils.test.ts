import {
  mergeFeeHeadBreakdown,
  normalizeAllocateHeadsInput,
  buildReceiptHeadPaidRows,
  buildReceiptHeadRowsFromAllocations,
  stickerHeadRowsFromBreakdown,
  headRowAmountPaise,
  sumSelectedAllocationPaise,
} from '../../../src/modules/admin/services/fee-breakdown.utils';

const paperDup = [
  { feeHeadId: 'fh-monthly', name: 'MonthlyFee', amount: 500000, category: 'MONTHLY' },
  { feeHeadId: 'fh-paper', name: 'PaperFund', amount: 50000, category: 'MONTHLY' },
  { feeHeadId: 'fh-paper', name: 'PaperFund', amount: 50000, category: 'MONTHLY' },
  { feeHeadId: 'fh-annual', name: 'Annual Fund', amount: 200000, category: 'ANNUAL' },
];

describe('mergeFeeHeadBreakdown', () => {
  test.each([
    ['empty', [], 0],
    ['single row', [{ feeHeadId: 'a', name: 'A', amount: 100, category: 'MONTHLY' }], 1],
    ['duplicate feeHeadId', paperDup, 3],
    ['duplicate by name only', [
      { name: 'X', amount: 10, category: 'OTHER' },
      { name: 'X', amount: 20, category: 'OTHER' },
    ], 1],
  ])('%s', (_label, input, expectedLen) => {
    const merged = mergeFeeHeadBreakdown(input);
    expect(merged).toHaveLength(expectedLen);
  });

  test('sums duplicate PaperFund amounts', () => {
    const merged = mergeFeeHeadBreakdown(paperDup);
    expect(merged.find((h) => h.feeHeadId === 'fh-paper')?.amount).toBe(100000);
  });

  test('preserves separate heads', () => {
    const merged = mergeFeeHeadBreakdown(paperDup);
    expect(merged.find((h) => h.feeHeadId === 'fh-monthly')?.amount).toBe(500000);
    expect(merged.find((h) => h.feeHeadId === 'fh-annual')?.amount).toBe(200000);
  });

  test('ignores nullish rows', () => {
    expect(mergeFeeHeadBreakdown([null, undefined, { name: '', amount: 5, category: 'X' }])).toHaveLength(0);
  });

  test('handles non-array input', () => {
    expect(mergeFeeHeadBreakdown(null)).toEqual([]);
    expect(mergeFeeHeadBreakdown({ '0': { name: 'A', amount: 1, category: 'X' } })).toEqual([]);
  });
});

describe('normalizeAllocateHeadsInput', () => {
  test('merges duplicate head payload lines', () => {
    const merged = normalizeAllocateHeadsInput([
      { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
      { feeHeadId: 'fh-paper', headName: 'PaperFund', amountPaise: 50000 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].amountPaise).toBe(100000);
  });

  test.each([
    ['array', [{ feeHeadId: 'a', amountPaise: 100 }], 1],
    ['object numeric keys', { '0': { feeHeadId: 'a', amountPaise: 100 }, '1': { feeHeadId: 'b', amountPaise: 200 } }, 2],
    ['empty', [], 0],
    ['null', null, 0],
  ])('parses %s input', (_label, input, len) => {
    expect(normalizeAllocateHeadsInput(input)).toHaveLength(len);
  });

  test('merges by headName when feeHeadId missing', () => {
    const rows = normalizeAllocateHeadsInput([
      { headName: 'Lab', amountPaise: 100 },
      { headName: 'Lab', amountPaise: 50 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountPaise).toBe(150);
  });
});

describe('buildReceiptHeadPaidRows', () => {
  test('one row per merged head with correct paid', () => {
    const prior = new Map<string, number>();
    const paid = new Map([['h:fh-paper', 90000]]);
    const rows = buildReceiptHeadPaidRows(paperDup, prior, paid);
    const paper = rows.filter((r) => r.name === 'PaperFund');
    expect(paper).toHaveLength(1);
    expect(paper[0].paidPaise).toBe(90000);
    expect(paper[0].dueBeforePaise).toBe(100000);
  });

  test('subtracts prior allocations from due', () => {
    const prior = new Map([['h:fh-paper', 40000]]);
    const paid = new Map([['h:fh-paper', 50000]]);
    const rows = buildReceiptHeadPaidRows(paperDup, prior, paid);
    expect(rows.find((r) => r.name === 'PaperFund')?.dueBeforePaise).toBe(60000);
  });

  test.each([
    [500000, 500000, 0],
    [100000, 50000, 50000],
  ])('remaining dueBefore=%i paid=%i => remaining=%i', (dueBefore, paid, remaining) => {
    const breakdown = [{ feeHeadId: 'x', name: 'X', amount: dueBefore, category: 'MONTHLY' }];
    const prior = new Map<string, number>();
    const paidMap = new Map([['h:x', paid]]);
    const row = buildReceiptHeadPaidRows(breakdown, prior, paidMap)[0];
    expect(row.remainingPaise).toBe(remaining);
  });
});

describe('buildReceiptHeadRowsFromAllocations', () => {
  test('does not duplicate paid on multiple breakdown rows', () => {
    const rows = buildReceiptHeadRowsFromAllocations(
      paperDup,
      [{ feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 90000, paymentId: 'p-new' }],
      'p-new',
    );
    const paper = rows.filter((r) => r.name === 'PaperFund');
    expect(paper).toHaveLength(1);
    expect(paper[0].paidPaise).toBe(90000);
  });

  test('excludes other payment allocations from paidThis', () => {
    const rows = buildReceiptHeadRowsFromAllocations(
      paperDup,
      [
        { feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 40000, paymentId: 'p-old' },
        { feeHeadId: 'fh-paper', feeExtraItemId: null, amount: 50000, paymentId: 'p-new' },
      ],
      'p-new',
    );
    const paper = rows.find((r) => r.name === 'PaperFund');
    expect(paper?.dueBeforePaise).toBe(60000);
    expect(paper?.paidPaise).toBe(50000);
  });
});

describe('stickerHeadRowsFromBreakdown', () => {
  test('returns merged sticker rows', () => {
    const rows = stickerHeadRowsFromBreakdown(paperDup);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name === 'PaperFund')?.amountPaise).toBe(100000);
  });
});

describe('headRowAmountPaise', () => {
  test.each([
    [{ amountPaise: 100 }, 100],
    [{ dueBeforePaise: 200 }, 200],
    [{ amount: 300 }, 300],
    [{}, 0],
  ])('resolves %j => %i', (row, expected) => {
    expect(headRowAmountPaise(row)).toBe(expected);
  });
});

describe('sumSelectedAllocationPaise', () => {
  test('sums previous + merged heads + extras', () => {
    const total = sumSelectedAllocationPaise({
      previousMonths: [{ amountPaise: 100000 }],
      heads: [
        { feeHeadId: 'fh-paper', amountPaise: 50000 },
        { feeHeadId: 'fh-paper', amountPaise: 50000 },
      ],
      extras: [{ amountPaise: 25000 }],
    });
    expect(total).toBe(225000);
  });
});

describe('family + student allocate payload parity', () => {
  const cases = [
    { label: 'heads only', heads: [{ feeHeadId: 'a', amountPaise: 1000 }], expected: 1000 },
    { label: 'duplicate heads', heads: [{ feeHeadId: 'a', amountPaise: 500 }, { feeHeadId: 'a', amountPaise: 500 }], expected: 1000 },
    { label: 'prev + heads', prev: [{ amountPaise: 2000 }], heads: [{ feeHeadId: 'b', amountPaise: 3000 }], expected: 5000 },
  ];

  test.each(cases)('$label', ({ prev, heads, expected }) => {
    expect(sumSelectedAllocationPaise({
      previousMonths: prev,
      heads,
      extras: [],
    })).toBe(expected);
  });
});

import { applyStockDelta, aggregateSaleItemQuantities, formatStockLabel, normalizeStock, totalStockUnits } from '../../../src/modules/canteen/canteen-stock';

describe('canteen-stock', () => {
  test('totalStockUnits with boxes', () => {
    expect(totalStockUnits(6, 2, 12)).toBe(74);
  });

  test('normalizeStock carries overflow units into boxes', () => {
    expect(normalizeStock(6, 14, 12)).toEqual({ stockBoxes: 7, stockUnits: 2 });
  });

  test('applyStockDelta deducts units', () => {
    expect(applyStockDelta(6, 2, -5, 12)).toEqual({ stockBoxes: 5, stockUnits: 9 });
  });

  test('applyStockDelta rejects negative stock', () => {
    expect(() => applyStockDelta(0, 2, -5, 12)).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('formatStockLabel', () => {
    expect(formatStockLabel(6, 2, 12)).toBe('6 boxes · 2 units');
    expect(formatStockLabel(0, 0, 12)).toBe('0 units');
  });

  test('normalizeStock folds non-boxed stock into boxes when unitsPerBox is 1', () => {
    expect(normalizeStock(0, 6, 1)).toEqual({ stockBoxes: 6, stockUnits: 0 });
  });

  test('formatStockLabel reads the total when unitsPerBox is 1', () => {
    // normalizeStock stores upb=1 stock in stockBoxes — the label must not
    // report "0 units" for it (same class of bug as the sales picker showing
    // "1 box" while inventory showed "6 units").
    expect(formatStockLabel(6, 0, 1)).toBe('6 units');
    expect(formatStockLabel(0, 3, 1)).toBe('3 units');
    expect(formatStockLabel(1, 1, 1)).toBe('2 units');
  });

  test('aggregateSaleItemQuantities merges duplicate product lines', () => {
    expect(
      aggregateSaleItemQuantities([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 5 },
        { productId: 'p1', quantity: 1 },
      ]),
    ).toEqual([
      { productId: 'p1', quantity: 3 },
      { productId: 'p2', quantity: 5 },
    ]);
  });
});

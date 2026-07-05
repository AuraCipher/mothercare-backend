import { applyStockDelta, formatStockLabel, normalizeStock, totalStockUnits } from '../../../src/modules/canteen/canteen-stock';

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
});

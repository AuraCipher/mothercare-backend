/** Box + loose-unit stock helpers for canteen products. */

export function unitsPerBoxOf(unitsPerBox: number | null | undefined): number {
  return unitsPerBox != null && unitsPerBox > 0 ? unitsPerBox : 1;
}

export function totalStockUnits(
  stockBoxes: number,
  stockUnits: number,
  unitsPerBox: number | null | undefined,
): number {
  const upb = unitsPerBoxOf(unitsPerBox);
  return stockBoxes * upb + stockUnits;
}

export function normalizeStock(
  stockBoxes: number,
  stockUnits: number,
  unitsPerBox: number | null | undefined,
): { stockBoxes: number; stockUnits: number } {
  const upb = unitsPerBoxOf(unitsPerBox);
  if (!Number.isInteger(stockBoxes) || stockBoxes < 0) {
    throw { status: 400, message: 'stockBoxes must be a whole number ≥ 0' };
  }
  if (!Number.isInteger(stockUnits) || stockUnits < 0) {
    throw { status: 400, message: 'stockUnits must be a whole number ≥ 0' };
  }
  const total = stockBoxes * upb + stockUnits;
  return {
    stockBoxes: Math.floor(total / upb),
    stockUnits: total % upb,
  };
}

export function applyStockDelta(
  stockBoxes: number,
  stockUnits: number,
  deltaUnits: number,
  unitsPerBox: number | null | undefined,
): { stockBoxes: number; stockUnits: number } {
  const upb = unitsPerBoxOf(unitsPerBox);
  const next = stockBoxes * upb + stockUnits + deltaUnits;
  if (next < 0) {
    throw { status: 400, message: 'Insufficient stock' };
  }
  return {
    stockBoxes: Math.floor(next / upb),
    stockUnits: next % upb,
  };
}

export function formatStockLabel(
  stockBoxes: number,
  stockUnits: number,
  unitsPerBox: number | null | undefined,
): string {
  const upb = unitsPerBoxOf(unitsPerBox);
  if (upb <= 1) return `${stockUnits} unit${stockUnits === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (stockBoxes > 0) parts.push(`${stockBoxes} box${stockBoxes === 1 ? '' : 'es'}`);
  if (stockUnits > 0) parts.push(`${stockUnits} unit${stockUnits === 1 ? '' : 's'}`);
  if (parts.length === 0) return '0 units';
  return parts.join(' · ');
}

export type FeeHeadBreakdownRow = {
  feeHeadId?: string;
  name: string;
  amount: number;
  category: string;
};

export type AllocateHeadInput = {
  feeHeadId?: string;
  headName?: string;
  amountPaise: number;
};

export type ReceiptHeadPaidRow = {
  name: string;
  amountPaise: number;
  dueBeforePaise: number;
  paidPaise: number;
  remainingPaise: number;
};

/** Collapse duplicate feeHeadId / name rows in stored breakdowns. */
export function mergeFeeHeadBreakdown(breakdown: unknown): FeeHeadBreakdownRow[] {
  const merged = new Map<string, FeeHeadBreakdownRow>();
  for (const h of (Array.isArray(breakdown) ? breakdown : []) as Partial<FeeHeadBreakdownRow>[]) {
    const name = (h?.name || h?.feeHeadId || '').trim();
    if (!name) continue;
    const key = h.feeHeadId || `name:${name}`;
    const prev = merged.get(key);
    if (prev) prev.amount += h.amount || 0;
    else merged.set(key, { feeHeadId: h.feeHeadId, name, amount: h.amount || 0, category: h.category || 'OTHER' });
  }
  return [...merged.values()];
}

export function normalizeAllocateHeadsInput(heads: unknown): AllocateHeadInput[] {
  const list = Array.isArray(heads) ? heads : (heads && typeof heads === 'object' ? Object.values(heads as Record<string, unknown>) : []);
  const merged = new Map<string, AllocateHeadInput>();
  for (const h of list as AllocateHeadInput[]) {
    const name = (h?.headName || h?.feeHeadId || '').trim();
    if (!name) continue;
    const key = h.feeHeadId ? `id:${h.feeHeadId}` : `name:${name}`;
    const prev = merged.get(key);
    const amt = h.amountPaise || 0;
    if (prev) prev.amountPaise += amt;
    else merged.set(key, { feeHeadId: h.feeHeadId, headName: h.headName, amountPaise: amt });
  }
  return [...merged.values()];
}

export function headRowAmountPaise(h: { amountPaise?: number; dueBeforePaise?: number; amount?: number }): number {
  return h.amountPaise ?? h.dueBeforePaise ?? h.amount ?? 0;
}

export function stickerHeadRowsFromBreakdown(breakdown: unknown): { name: string; amountPaise: number }[] {
  return mergeFeeHeadBreakdown(breakdown).map((b) => ({ name: b.name, amountPaise: b.amount || 0 }));
}

export function buildReceiptHeadPaidRows(
  breakdown: unknown,
  priorHeadPaid: Map<string, number>,
  paidThisByHead: Map<string, number>,
): ReceiptHeadPaidRow[] {
  const rows: ReceiptHeadPaidRow[] = [];
  for (const b of mergeFeeHeadBreakdown(breakdown)) {
    const headKey = b.feeHeadId ? `h:${b.feeHeadId}` : `n:${b.name}`;
    const paidBefore = priorHeadPaid.get(headKey) || 0;
    const dueBefore = Math.max(0, (b.amount || 0) - paidBefore);
    const paidThis = paidThisByHead.get(headKey) || 0;
    if (dueBefore > 0 || paidThis > 0) {
      rows.push({
        name: b.name,
        amountPaise: dueBefore > 0 ? dueBefore : (b.amount || 0),
        dueBeforePaise: dueBefore > 0 ? dueBefore : (b.amount || 0),
        paidPaise: paidThis,
        remainingPaise: Math.max(0, dueBefore - paidThis),
      });
    }
  }
  return rows;
}

export function buildReceiptHeadRowsFromAllocations(
  breakdown: unknown,
  allAllocs: Array<{ feeHeadId?: string | null; feeExtraItemId?: string | null; amount: number; paymentId: string }>,
  paymentId: string,
): ReceiptHeadPaidRow[] {
  const priorHeadPaid = new Map<string, number>();
  const paidThisByHead = new Map<string, number>();
  for (const a of allAllocs) {
    if (!a.feeHeadId) continue;
    const key = `h:${a.feeHeadId}`;
    if (a.paymentId === paymentId) {
      paidThisByHead.set(key, (paidThisByHead.get(key) || 0) + a.amount);
    } else {
      priorHeadPaid.set(key, (priorHeadPaid.get(key) || 0) + a.amount);
    }
  }
  return buildReceiptHeadPaidRows(breakdown, priorHeadPaid, paidThisByHead);
}

export function sumSelectedAllocationPaise(parts: {
  previousMonths?: { amountPaise?: number }[];
  heads?: AllocateHeadInput[];
  extras?: { amountPaise?: number }[];
}): number {
  const prev = (parts.previousMonths || []).reduce((s, p) => s + (p.amountPaise || 0), 0);
  const heads = normalizeAllocateHeadsInput(parts.heads).reduce((s, h) => s + h.amountPaise, 0);
  const extras = (parts.extras || []).filter((e) => (e.amountPaise || 0) > 0).reduce((s, e) => s + (e.amountPaise || 0), 0);
  return prev + heads + extras;
}

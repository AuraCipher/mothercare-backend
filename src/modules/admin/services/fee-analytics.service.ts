import { prisma } from '../../../lib/prisma';

export type FeeAnalyticsPeriod = 'today' | 'weekly' | 'monthly' | 'yearly' | 'full' | 'custom';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface FeeAnalyticsFilters {
  period: FeeAnalyticsPeriod;
  from: string;
  to: string;
  month: number | null;
  year: number | null;
  groupId: string | null;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function monthsInRange(from: Date, to: Date): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export function resolveFeeAnalyticsFilters(query: {
  period?: string;
  month?: string;
  year?: string;
  from?: string;
  to?: string;
  groupId?: string;
}): FeeAnalyticsFilters {
  const now = new Date();
  const periodRaw = query.period || 'monthly';
  const period = (['today', 'weekly', 'monthly', 'yearly', 'full', 'custom', 'month'].includes(periodRaw)
    ? (periodRaw === 'month' ? 'monthly' : periodRaw)
    : 'monthly') as FeeAnalyticsPeriod;

  let from = startOfDay(now);
  let to = endOfDay(now);
  let month: number | null = now.getMonth() + 1;
  let year: number | null = now.getFullYear();

  if (period === 'today') {
    from = startOfDay(now);
    to = endOfDay(now);
  } else if (period === 'weekly') {
    from = startOfDay(new Date(now.getTime() - 6 * 86400000));
    to = endOfDay(now);
    month = null;
    year = null;
  } else if (period === 'monthly') {
    month = parseInt(query.month || '', 10) || now.getMonth() + 1;
    year = parseInt(query.year || '', 10) || now.getFullYear();
    from = new Date(year, month - 1, 1);
    to = endOfDay(new Date(year, month, 0));
  } else if (period === 'yearly') {
    year = parseInt(query.year || '', 10) || now.getFullYear();
    month = null;
    from = new Date(year, 0, 1);
    to = endOfDay(new Date(year, 11, 31));
  } else if (period === 'full') {
    month = null;
    year = null;
    from = new Date(2000, 0, 1);
    to = endOfDay(new Date(2100, 11, 31));
  } else if (period === 'custom') {
    if (query.from) from = startOfDay(new Date(query.from));
    if (query.to) to = endOfDay(new Date(query.to));
    month = null;
    year = null;
  }

  return {
    period,
    from: fmtDate(from),
    to: fmtDate(to),
    month,
    year,
    groupId: query.groupId || null,
  };
}

function feeDue(f: { netAmount: number; extraItems: { amount: number }[] }): number {
  return f.netAmount + f.extraItems.reduce((s, e) => s + e.amount, 0);
}

function buildFeeMonthWhere(academicYearId: string, filters: FeeAnalyticsFilters, groupId?: string | null) {
  const base: any = { academicYearId };
  if (groupId) base.groupId = groupId;

  if (filters.period === 'full') return base;

  if (filters.period === 'monthly' && filters.month && filters.year) {
    return { ...base, month: filters.month, year: filters.year };
  }

  if (filters.period === 'yearly' && filters.year) {
    return { ...base, year: filters.year };
  }

  const monthPairs = monthsInRange(new Date(filters.from), new Date(filters.to));
  if (monthPairs.length === 0) return { ...base, id: '__none__' };
  if (monthPairs.length === 1) {
    return { ...base, month: monthPairs[0].month, year: monthPairs[0].year };
  }
  return {
    ...base,
    OR: monthPairs.map(p => ({ month: p.month, year: p.year })),
  };
}

function buildPaymentDateWhere(filters: FeeAnalyticsFilters) {
  if (filters.period === 'full') return undefined;
  return {
    gte: startOfDay(new Date(filters.from)),
    lte: endOfDay(new Date(filters.to)),
  };
}

function dayKey(d: Date): string {
  return fmtDate(d);
}

export async function computeFeeAnalytics(academicYearId: string, filters: FeeAnalyticsFilters) {
  const feeWhere = buildFeeMonthWhere(academicYearId, filters, filters.groupId);
  const paymentDateFilter = buildPaymentDateWhere(filters);

  const [fees, allAyFees, paymentsInRange] = await Promise.all([
    prisma.studentFee.findMany({
      where: feeWhere,
      select: {
        id: true, month: true, year: true, netAmount: true, paidAmount: true, status: true,
        groupId: true, studentId: true,
        extraItems: { select: { amount: true } },
        group: { select: { name: true, section: true, displayOrder: true } },
        student: { select: { name: true, rollNumber: true } },
      },
    }),
    prisma.studentFee.findMany({
      where: buildFeeMonthWhere(academicYearId, { ...filters, period: 'full', groupId: filters.groupId }),
      select: {
        month: true, year: true, netAmount: true, paidAmount: true,
        extraItems: { select: { amount: true } },
        groupId: true,
        group: { select: { name: true, section: true, displayOrder: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        revertedAt: null,
        ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
        studentFee: buildFeeMonthWhere(academicYearId, filters, filters.groupId),
      },
      select: { amount: true, paymentMethod: true, paymentDate: true, studentFeeId: true },
      orderBy: { paymentDate: 'asc' },
    }),
  ]);

  let totalDue = 0;
  let totalCollected = 0;
  const statusBreakdown = { paid: 0, partial: 0, unpaid: 0, overpaid: 0 };
  const classMap: Record<string, {
    groupName: string; section: string | null; displayOrder: number;
    total: number; collected: number; count: number;
  }> = {};

  for (const f of fees) {
    const due = feeDue(f);
    totalDue += due;
    totalCollected += f.paidAmount;
    if (f.status === 'PAID') statusBreakdown.paid++;
    else if (f.status === 'PARTIAL') statusBreakdown.partial++;
    else if (f.status === 'UNPAID') statusBreakdown.unpaid++;
    else if (f.status === 'OVERPAID') statusBreakdown.overpaid++;

    const key = f.groupId || 'unassigned';
    if (!classMap[key]) {
      classMap[key] = {
        groupName: f.group?.name || 'Unassigned',
        section: f.group?.section || null,
        displayOrder: f.group?.displayOrder ?? 999,
        total: 0, collected: 0, count: 0,
      };
    }
    classMap[key].total += due;
    classMap[key].collected += f.paidAmount;
    classMap[key].count++;
  }

  const paymentsCollected = paymentsInRange.reduce((s, p) => s + p.amount, 0);
  const pendingCount = statusBreakdown.unpaid + statusBreakdown.partial;
  const outstanding = Math.max(0, totalDue - totalCollected);

  const paymentMethods: Record<string, { amount: number; count: number }> = {};
  for (const p of paymentsInRange) {
    const method = p.paymentMethod || 'OTHER';
    if (!paymentMethods[method]) paymentMethods[method] = { amount: 0, count: 0 };
    paymentMethods[method].amount += p.amount;
    paymentMethods[method].count++;
  }

  const classBreakdown = Object.entries(classMap)
    .map(([gid, d]) => ({
      groupId: gid,
      groupName: d.groupName,
      section: d.section,
      students: d.count,
      total: d.total,
      collected: d.collected,
      pending: d.total - d.collected,
      rate: d.total ? Math.round((d.collected / d.total) * 100) : 0,
      displayOrder: d.displayOrder,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const topDefaulters = fees
    .filter(f => f.status === 'UNPAID' || f.status === 'PARTIAL')
    .map(f => ({
      id: f.id,
      studentId: f.studentId,
      studentName: f.student?.name || '',
      rollNumber: f.student?.rollNumber,
      groupName: f.group?.name || '',
      section: f.group?.section,
      due: feeDue(f),
      paid: f.paidAmount,
      pending: feeDue(f) - f.paidAmount,
      status: f.status,
    }))
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 20);

  // Monthly trend (full AY, respects class filter)
  const monthlyMap: Record<string, { month: number; year: number; due: number; collected: number }> = {};
  for (const f of allAyFees) {
    const key = `${f.year}-${String(f.month).padStart(2, '0')}`;
    if (!monthlyMap[key]) monthlyMap[key] = { month: f.month, year: f.year, due: 0, collected: 0 };
    monthlyMap[key].due += feeDue(f);
    monthlyMap[key].collected += f.paidAmount;
  }

  const monthlyTrend = Object.values(monthlyMap)
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map(t => ({
      month: t.month,
      year: t.year,
      label: `${MONTH_LABELS[t.month - 1]} ${t.year}`,
      due: t.due,
      collected: t.collected,
      rate: t.due ? Math.round((t.collected / t.due) * 100) : 0,
    }));

  // Line trend — daily for short periods, monthly for long
  const useDaily = filters.period === 'today' || filters.period === 'weekly'
    || (filters.period === 'custom' && (new Date(filters.to).getTime() - new Date(filters.from).getTime()) <= 62 * 86400000);

  let lineTrend: {
    key: string; label: string; date: string; due: number; collected: number; rate: number; paymentCount: number;
  }[] = [];

  if (useDaily) {
    const fromD = startOfDay(new Date(filters.from));
    const toD = startOfDay(new Date(filters.to));
    const dayMap: Record<string, { due: number; collected: number; count: number }> = {};

    for (let t = fromD.getTime(); t <= toD.getTime(); t += 86400000) {
      const k = dayKey(new Date(t));
      dayMap[k] = { due: 0, collected: 0, count: 0 };
    }

    for (const p of paymentsInRange) {
      const k = dayKey(new Date(p.paymentDate));
      if (!dayMap[k]) dayMap[k] = { due: 0, collected: 0, count: 0 };
      dayMap[k].collected += p.amount;
      dayMap[k].count++;
    }

    // Spread monthly due evenly across days in that month (approximation for daily view)
    for (const f of fees) {
      const monthStart = new Date(f.year, f.month - 1, 1);
      const monthEnd = new Date(f.year, f.month, 0);
      const daysInMonth = monthEnd.getDate();
      const dailyDue = feeDue(f) / daysInMonth;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(f.year, f.month - 1, d);
        const k = dayKey(dt);
        if (dayMap[k]) dayMap[k].due += dailyDue;
      }
    }

    lineTrend = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const d = new Date(date + 'T00:00:00');
        return {
          key: date,
          date,
          label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          due: Math.round(v.due),
          collected: v.collected,
          rate: v.due ? Math.round((v.collected / v.due) * 100) : (v.collected ? 100 : 0),
          paymentCount: v.count,
        };
      });
  } else {
    const rangeMonths = filters.period === 'full'
      ? monthlyTrend
      : monthsInRange(new Date(filters.from), new Date(filters.to)).map(p => {
          const key = `${p.year}-${String(p.month).padStart(2, '0')}`;
          const m = monthlyMap[key] || { month: p.month, year: p.year, due: 0, collected: 0 };
          return {
            month: p.month,
            year: p.year,
            label: `${MONTH_LABELS[p.month - 1]} ${p.year}`,
            due: m.due,
            collected: m.collected,
            rate: m.due ? Math.round((m.collected / m.due) * 100) : 0,
          };
        });

    lineTrend = rangeMonths.map(t => ({
      key: `${t.year}-${t.month}`,
      date: `${t.year}-${String(t.month).padStart(2, '0')}-01`,
      label: t.label,
      due: t.due,
      collected: t.collected,
      rate: t.rate,
      paymentCount: 0,
    }));

    // Count payments per month for line trend
    for (const p of paymentsInRange) {
      const d = new Date(p.paymentDate);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const pt = lineTrend.find(l => l.key === key);
      if (pt) pt.paymentCount++;
    }
  }

  const avgPayment = paymentsInRange.length ? Math.round(paymentsCollected / paymentsInRange.length) : 0;
  const avgDuePerStudent = fees.length ? Math.round(totalDue / fees.length) : 0;

  return {
    filters,
    summary: {
      totalDue,
      totalCollected,
      totalPaymentsInRange: paymentsCollected,
      outstanding,
      pendingCount,
      totalStudents: fees.length,
      paymentCount: paymentsInRange.length,
      collectionRate: totalDue ? Math.round((totalCollected / totalDue) * 100) : 0,
      paymentRate: totalDue ? Math.round((paymentsCollected / totalDue) * 100) : 0,
      avgPayment,
      avgDuePerStudent,
    },
    statusBreakdown,
    paymentMethods: Object.entries(paymentMethods).map(([method, d]) => ({ method, ...d })),
    classBreakdown,
    topDefaulters,
    monthlyTrend,
    lineTrend,
    trendGranularity: useDaily ? 'daily' as const : 'monthly' as const,
  };
}

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { logAudit, diffFields } from '../../../services/audit.service';
import { resolveAcademicYearId, requireScope } from '../utils/scope-context';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

function getFeeTotalDue(fee: { netAmount: number; extraItems?: { amount: number }[] | null }): number {
  const extra = (fee.extraItems || []).reduce((s, e) => s + e.amount, 0);
  return fee.netAmount + extra;
}

function computeFeeStatus(paidAmount: number, totalDue: number): string {
  if (paidAmount >= totalDue) return paidAmount > totalDue ? 'OVERPAID' : 'PAID';
  return paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
}

function computeStudentStatusFromFees(
  fees: { netAmount: number; paidAmount: number; extraItems?: { amount: number }[] | null }[],
): string {
  if (!fees || fees.length === 0) return 'NO_FEE';
  const totalDue = fees.reduce((s, f) => s + getFeeTotalDue(f), 0);
  const paid = fees.reduce((s, f) => s + f.paidAmount, 0);
  if (totalDue === 0) return 'NO_FEE';
  return computeFeeStatus(paid, totalDue);
}

function matchesFeeStatusFilter(status: string, filter: string): boolean {
  const f = filter.toLowerCase();
  if (f === 'paid') return status === 'PAID' || status === 'OVERPAID';
  if (f === 'partial') return status === 'PARTIAL';
  if (f === 'unpaid') return status === 'UNPAID';
  return true;
}

/** Compute monthly fee total + breakdown from structures, honoring per-head overrides. */
function computeFeeAmountAndBreakdown(
  student: { customFeeAmount?: number | null; feeOverrides?: unknown },
  groupStructures: { feeHeadId: string; feeHead: { name: string; category: string }; amount: number }[],
): { totalAmount: number; breakdown: { feeHeadId?: string; name: string; amount: number; category: string }[] } {
  const sOverrides = student.feeOverrides as Record<string, number> | null;

  if (sOverrides && Object.keys(sOverrides).length > 0) {
    // Per-head overrides merge with structure defaults — only overridden heads
    // replace their amount; waiving one head (0) must not zero the whole month.
    const breakdown = groupStructures.map(s => {
      const amount = sOverrides[s.feeHeadId] !== undefined ? sOverrides[s.feeHeadId] : s.amount;
      return { feeHeadId: s.feeHeadId, name: s.feeHead.name, amount, category: s.feeHead.category };
    });
    const totalAmount = breakdown.reduce((sum, b) => sum + (b.amount || 0), 0);
    return { totalAmount, breakdown };
  }

  if (student.customFeeAmount != null) {
    return {
      totalAmount: student.customFeeAmount,
      breakdown: [{ name: 'Custom Fee', amount: student.customFeeAmount, category: 'CUSTOM' }],
    };
  }

  const breakdown = groupStructures.map(s => ({
    feeHeadId: s.feeHeadId,
    name: s.feeHead.name,
    amount: s.amount,
    category: s.feeHead.category,
  }));
  const totalAmount = groupStructures.reduce((sum, s) => sum + s.amount, 0);
  return { totalAmount, breakdown };
}

/** Copy fee structures from the nearest lower class that already has them. */
async function provisionMissingFeeStructures(
  ayId: string,
  targetGroupIds: string[],
  existingStructures: { id: string; groupId: string; feeHeadId: string; amount: number; effectiveFrom: Date; feeHead: { name: string; category: string } }[],
): Promise<{ structures: typeof existingStructures; groupsProvisioned: string[]; structuresCopied: number }> {
  const groupsWithStructures = new Set(existingStructures.map(s => s.groupId));
  const needsProvision = targetGroupIds.filter(id => !groupsWithStructures.has(id));
  if (needsProvision.length === 0) {
    return { structures: existingStructures, groupsProvisioned: [], structuresCopied: 0 };
  }

  const allGroups = await prisma.group.findMany({
    where: { academicYearId: ayId, isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, displayOrder: true, name: true, section: true },
  });
  const groupById = new Map(allGroups.map(g => [g.id, g]));
  const structures = [...existingStructures];
  const groupsProvisioned: string[] = [];
  let structuresCopied = 0;

  for (const targetId of needsProvision) {
    const target = groupById.get(targetId);
    if (!target) continue;

    const source = [...allGroups]
      .filter(g => g.displayOrder < target.displayOrder && groupsWithStructures.has(g.id))
      .sort((a, b) => b.displayOrder - a.displayOrder)[0];
    if (!source) continue;

    const sourceStructs = await prisma.feeStructure.findMany({
      where: { groupId: source.id, academicYearId: ayId, effectiveTo: null },
      include: { feeHead: { select: { name: true, category: true } } },
    });
    if (sourceStructs.length === 0) continue;

    for (const ss of sourceStructs) {
      const created = await prisma.feeStructure.create({
        data: {
          academicYearId: ayId,
          groupId: targetId,
          feeHeadId: ss.feeHeadId,
          amount: ss.amount,
          effectiveFrom: ss.effectiveFrom,
        },
        include: { feeHead: { select: { name: true, category: true } } },
      });
      structures.push(created);
      structuresCopied++;
    }
    groupsWithStructures.add(targetId);
    groupsProvisioned.push(target.section ? `${target.name} — ${target.section}` : target.name);
  }

  return { structures, groupsProvisioned, structuresCopied };
}

function feeRemainingPaise(fee: { netAmount: number; paidAmount: number; extraItems?: { amount: number }[] | null }): number {
  return Math.max(0, getFeeTotalDue(fee) - fee.paidAmount);
}

function summarizeStudentFees(studentFees: { netAmount: number; paidAmount: number; extraItems?: { amount: number }[] | null }[]): { totalDuePaise: number; unpaidCount: number } {
  let totalDuePaise = 0;
  let unpaidCount = 0;
  for (const f of studentFees) {
    const rem = feeRemainingPaise(f);
    if (rem > 0) {
      totalDuePaise += rem;
      unpaidCount++;
    }
  }
  return { totalDuePaise, unpaidCount };
}

async function appendFamilyChangeLog(
  familyId: string,
  action: string,
  details: Record<string, unknown> | null,
  changedById: string | null,
  tx: { familyChangeLog: { create: (args: any) => Promise<unknown> } } = prisma as any,
) {
  await tx.familyChangeLog.create({
    data: { familyId, action, details: details ?? undefined, changedById: changedById ?? undefined },
  });
}

const familyStudentInclude = (ayId: string | null, opts?: { unpaidOnly?: boolean; includeFees?: boolean }) => {
  const unpaidOnly = opts?.unpaidOnly ?? false;
  const includeFees = opts?.includeFees ?? !!ayId;
  const block: any = {
    where: ayId
      ? { academicYearId: ayId, isActive: true, status: 'ACTIVE' as const }
      : { isActive: true, status: 'ACTIVE' as const },
    select: {
      id: true,
      name: true,
      rollNumber: true,
      admissionNumber: true,
      group: { select: { name: true, section: true, displayOrder: true } },
    },
  };
  if (ayId && includeFees) {
    block.select.studentFees = {
      where: unpaidOnly
        ? { academicYearId: ayId, status: { in: ['UNPAID', 'PARTIAL'] } }
        : { academicYearId: ayId },
      include: { extraItems: { select: { amount: true } } },
      orderBy: [{ year: 'asc' as const }, { month: 'asc' as const }],
    };
  }
  return block;
};

// ═══════════════════════════════════════════════════════════════════
// FEE HEADS CRUD
// ═══════════════════════════════════════════════════════════════════

// GET /admin/fee-heads — List all fee heads
router.get('/fee-heads', asyncHandler(async (req: Request, res: Response) => {
  const heads = await prisma.feeHead.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: heads });
}));

// POST /admin/fee-heads — Create fee head
router.post('/fee-heads', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, isOptional, category } = req.body;
  if (!name) { res.status(400).json({ success: false, message: 'Name is required' }); return; }
  const head = await prisma.feeHead.create({
    data: { name, description, isOptional: isOptional || false, category: category || 'MONTHLY' },
  });
  res.status(201).json({ success: true, data: head });
}));

// PUT /admin/fee-heads/:id — Update fee head
router.put('/fee-heads/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, isOptional, isActive, category } = req.body;
  const head = await prisma.feeHead.update({
    where: { id: req.params.id },
    data: { name, description, isOptional, isActive, category },
  });
  res.json({ success: true, data: head });
}));

// DELETE /admin/fee-heads/:id — Soft delete
router.delete('/fee-heads/:id', asyncHandler(async (req: Request, res: Response) => {
  const head = await prisma.feeHead.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, data: head });
}));

// ═══════════════════════════════════════════════════════════════════
// FEE STRUCTURES — Per-class amounts with effective dating
// ═══════════════════════════════════════════════════════════════════

// GET /admin/fee-structures — List, filtered by academic year (required)
router.get('/fee-structures', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { groupId } = req.query;
  const where: any = { effectiveTo: null, academicYearId: scope.academicYearId };
  if (groupId) where.groupId = groupId as string;
  const structures = await prisma.feeStructure.findMany({
    where,
    include: { feeHead: true, group: { select: { name: true, section: true } } },
    orderBy: [{ groupId: 'asc' }, { feeHead: { name: 'asc' } }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: structures });
}));

// POST /admin/fee-structures — Create or update (upsert by effectiveFrom)
router.post('/fee-structures', asyncHandler(async (req: Request, res: Response) => {
  const { academicYearId, groupId, feeHeadId, amount, effectiveFrom } = req.body;
  if (!academicYearId || !groupId || !feeHeadId || amount == null) {
    res.status(400).json({ success: false, message: 'academicYearId, groupId, feeHeadId, amount required' });
    return;
  }
  const ef = effectiveFrom ? new Date(effectiveFrom) : new Date();
  const userId = (req as any).user?.id;

  const result = await prisma.$transaction(async (tx) => {
    const activeRecords = await tx.feeStructure.findMany({
      where: { academicYearId, groupId, feeHeadId, effectiveTo: null },
      orderBy: { createdAt: 'desc' },
    });

    const latest = activeRecords[0] ?? null;

    // Same amount and only one active row — nothing to do
    if (latest && latest.amount === amount && activeRecords.length === 1) {
      return { structure: latest, isNew: false, logChange: false as const };
    }

    // Same amount but duplicate active rows — dedupe, keep newest
    if (latest && latest.amount === amount && activeRecords.length > 1) {
      await tx.feeStructure.updateMany({
        where: { id: { in: activeRecords.slice(1).map((r) => r.id) } },
        data: { effectiveTo: ef },
      });
      return { structure: latest, isNew: false, logChange: false as const };
    }

    const previousAmount = latest?.amount ?? null;
    const expiredId = latest?.id ?? null;

    // Expire ALL active rows (handles legacy duplicates)
    if (activeRecords.length > 0) {
      await tx.feeStructure.updateMany({
        where: { academicYearId, groupId, feeHeadId, effectiveTo: null },
        data: { effectiveTo: ef },
      });
    }

    const structure = await tx.feeStructure.create({
      data: { academicYearId, groupId, feeHeadId, amount, effectiveFrom: ef },
    });

    return {
      structure,
      isNew: activeRecords.length === 0,
      logChange: previousAmount != null && previousAmount !== amount,
      previousAmount,
      expiredId,
    };
  });

  if (result.logChange && result.expiredId && result.previousAmount != null) {
    await prisma.feeChangeLog.create({
      data: {
        feeStructureId: result.expiredId,
        previousAmount: result.previousAmount,
        newAmount: amount,
        reason: 'Amount update',
        changedById: userId,
      },
    });
  }

  res.status(result.isNew ? 201 : 200).json({ success: true, data: result.structure });
}));

// POST /admin/fee-structures/update-amount — Increase fee with history
router.post('/fee-structures/update-amount', asyncHandler(async (req: Request, res: Response) => {
  const { id, newAmount, effectiveFrom, reason } = req.body;
  if (!id || newAmount == null) { res.status(400).json({ success: false, message: 'id and newAmount required' }); return; }
  const userId = (req as any).user?.id;

  const old = await prisma.feeStructure.findUnique({ where: { id } });
  if (!old) { res.status(404).json({ success: false, message: 'Fee structure not found' }); return; }

  // Set effectiveTo on old record
  await prisma.feeStructure.update({
    where: { id },
    data: { effectiveTo: effectiveFrom ? new Date(effectiveFrom) : new Date() },
  });

  // Create new record with new amount
  const newStructure = await prisma.feeStructure.create({
    data: {
      academicYearId: old.academicYearId,
      groupId: old.groupId,
      feeHeadId: old.feeHeadId,
      amount: newAmount,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });

  // Log the change
  await prisma.feeChangeLog.create({
    data: {
      feeStructureId: id,
      previousAmount: old.amount,
      newAmount,
      reason: reason || 'Fee increase',
      changedById: userId,
    },
  });

  res.json({ success: true, data: newStructure, previousEffectiveTo: old.effectiveTo });
}));

// DELETE /admin/fee-structures/:id
router.delete('/fee-structures/:id', asyncHandler(async (req: Request, res: Response) => {
  await prisma.feeStructure.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Deleted' });
}));

// ═══════════════════════════════════════════════════════════════════
// PER-STUDENT CUSTOM FEE (Scholarship / Concession)
// ═══════════════════════════════════════════════════════════════════

// PUT /admin/students/:id/custom-fee — Set custom fee for a student (supports per-head overrides)
router.put('/students/:id/custom-fee', asyncHandler(async (req: Request, res: Response) => {
  const { customFeeAmount, concessionReason, feeOverrides } = req.body;
  const data: any = {
    customFeeAmount: customFeeAmount != null ? customFeeAmount : null,
    concessionReason: concessionReason || null,
  };
  if (feeOverrides !== undefined) {
    data.feeOverrides = feeOverrides;
  }
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ success: true, data: { id: student.id, customFeeAmount: student.customFeeAmount, concessionReason: student.concessionReason, feeOverrides: student.feeOverrides as any } });
}));

// GET /admin/students/:id/fee — Get student with fee info (scoped to academic year)
router.get('/students/:id/fee', asyncHandler(async (req: Request, res: Response) => {
  const { academicYearId } = req.query;
  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { name: true, section: true, displayOrder: true } },
      family: { select: { id: true, name: true } },
      parents: { include: { parent: { select: { relation: true, phone: true, occupation: true, user: { select: { name: true } } } } } },
      studentFees: {
        where: { academicYearId: ayId },
        include: {
          payments: {
            where: { revertedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              familyPayment: { select: { id: true, receiptNumber: true, familyId: true } },
            },
          },
          extraItems: true,
          headAllocations: { where: { revertedAt: null }, select: { feeHeadId: true, feeExtraItemId: true, amount: true } },
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      },
    },
  });
  if (!student) { res.status(404).json({ success: false, message: 'Student not found' }); return; }
  res.json({ success: true, data: student });
}));

// POST /admin/student-fees/:id/extra-items — Add extra item to a month
router.post('/student-fees/:id/extra-items', asyncHandler(async (req: Request, res: Response) => {
  const { name, amount } = req.body;
  if (!name || !amount || amount < 0) {
    res.status(400).json({ success: false, message: 'name and amount (>=0) required' });
    return;
  }
  const fee = await prisma.studentFee.findUnique({ where: { id: req.params.id } });
  if (!fee) { res.status(404).json({ success: false, message: 'StudentFee not found' }); return; }
  const item = await prisma.feeExtraItem.create({
    data: { studentFeeId: req.params.id, name, amount },
  });
  // Recalculate status after adding extra
  const extraSum = await prisma.feeExtraItem.aggregate({
    where: { studentFeeId: req.params.id },
    _sum: { amount: true },
  });
  const totalExtra = extraSum._sum.amount || 0;
  const totalDue = (fee.totalAmount || fee.netAmount) + totalExtra;
  const newStatus = fee.paidAmount >= totalDue
    ? (fee.paidAmount > totalDue ? 'OVERPAID' : 'PAID')
    : fee.paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
  await prisma.studentFee.update({
    where: { id: req.params.id },
    data: { status: newStatus },
  });
  res.status(201).json({ success: true, data: item });
}));

// DELETE /admin/student-fees/:id/extra-items/:itemId — Remove an extra item
router.delete('/student-fees/:id/extra-items/:itemId', asyncHandler(async (req: Request, res: Response) => {
  const deleted = await prisma.feeExtraItem.delete({ where: { id: req.params.itemId } });
  // Recalculate status after removing extra
  const extraSum = await prisma.feeExtraItem.aggregate({
    where: { studentFeeId: deleted.studentFeeId },
    _sum: { amount: true },
  });
  const sf = await prisma.studentFee.findUnique({ where: { id: deleted.studentFeeId } });
  if (sf) {
    const totalExtra = extraSum._sum.amount || 0;
    const totalDue = (sf.totalAmount || sf.netAmount) + totalExtra;
    const newStatus = sf.paidAmount >= totalDue
      ? (sf.paidAmount > totalDue ? 'OVERPAID' : 'PAID')
      : sf.paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
    await prisma.studentFee.update({
      where: { id: sf.id },
      data: { status: newStatus },
    });
  }
  res.json({ success: true, message: 'Deleted' });
}));

// GET /admin/student-fees/:id/extra-items — List extra items for a month
router.get('/student-fees/:id/extra-items', asyncHandler(async (req: Request, res: Response) => {
  const items = await prisma.feeExtraItem.findMany({ where: { studentFeeId: req.params.id } });
  res.json({ success: true, data: items });
}));

// ═══════════════════════════════════════════════════════════════════
// ALL STUDENTS WITH FEE STATUS (for Collections page)
// ═══════════════════════════════════════════════════════════════════

const studentListSelect = {
  id: true, name: true, rollNumber: true, admissionNumber: true,
  groupId: true, familyId: true, customFeeAmount: true, concessionReason: true, feeOverrides: true,
  group: { select: { name: true, section: true, displayOrder: true } },
  family: { select: { id: true, name: true } },
  parents: {
    include: {
      parent: { select: { relation: true, phone: true, user: { select: { name: true } } } },
    },
  },
} as const;

function buildStudentListWhere(query: {
  groupId?: string; search?: string; roll?: string; fatherSearch?: string; ayId: string;
}) {
  const where: any = { isActive: true, status: 'ACTIVE', academicYearId: query.ayId };
  if (query.groupId) where.groupId = query.groupId;
  if (query.roll) where.rollNumber = query.roll;
  if (query.search) {
    const q = query.search;
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { rollNumber: { contains: q } },
    ];
  }
  if (query.fatherSearch) {
    const fq = query.fatherSearch;
    where.AND = [
      ...(where.AND || []),
      {
        parents: {
          some: {
            parent: {
              relation: 'Father',
              OR: [
                { user: { name: { contains: fq, mode: 'insensitive' } } },
                { phone: { contains: fq } },
              ],
            },
          },
        },
      },
    ];
  }
  return where;
}

// GET /admin/fees/students-list — All active students with their fee for given period
router.get('/fees/students-list', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, groupId, search, roll, period, academicYearId, fatherSearch, feeStatus, page: pageQ, limit: limitQ } = req.query;
  const isFull = period === 'full';
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();
  const page = Math.max(1, parseInt(pageQ as string, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(limitQ as string, 10) || 100));
  const skip = (page - 1) * limit;
  const statusFilter = typeof feeStatus === 'string' && feeStatus.trim() ? feeStatus.trim().toLowerCase() : '';

  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const where = buildStudentListWhere({
    ayId,
    groupId: groupId as string | undefined,
    search: search as string | undefined,
    roll: roll as string | undefined,
    fatherSearch: fatherSearch as string | undefined,
  });

  const feeWhere = isFull
    ? { academicYearId: ayId }
    : { month: m, year: y, academicYearId: ayId };

  const needsStatusFilter = !!statusFilter && ['paid', 'partial', 'unpaid'].includes(statusFilter);
  const total = needsStatusFilter ? undefined : await prisma.student.count({ where });
  const students = await prisma.student.findMany({
    where,
    select: {
      ...studentListSelect,
      studentFees: {
        where: feeWhere,
        include: { payments: { where: { revertedAt: null }, select: { id: true, amount: true, receiptNumber: true, paymentMethod: true, createdAt: true } }, extraItems: true },
      },
    },
    orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
    ...(needsStatusFilter ? {} : { skip, take: limit }),
  });

  const getExtra = (f: any) => (f.extraItems || []).reduce((s: number, e: any) => s + e.amount, 0);

  // For Full AY: how many fee periods (months) should exist this year, so
  // overridden/custom-fee students aren't undercounted for months that
  // were never generated for them specifically. Use the count of distinct
  // (month, year) periods that have been opened for ANY student this
  // academic year as the proxy for "periods that should apply" — this
  // covers a student whose own records lag behind a school-wide generate
  // run (the actual bug: previously this just used `totalFees.length`,
  // which only counts records that already exist for THAT student, so a
  // concession student missing 4 of 10 months still showed only 6 months
  // of dues).
  let expectedPeriodCount = 0;
  if (isFull) {
    const periods = await prisma.studentFee.findMany({
      where: { academicYearId: ayId },
      select: { month: true, year: true },
      distinct: ['month', 'year'],
    });
    expectedPeriodCount = periods.length;
  }

  const data = students.map(s => {
    if (isFull) {
      // Aggregate all months for full AY view
      const totalFees = s.studentFees || [];
      const extraAmount = totalFees.reduce((sum, f) => sum + getExtra(f), 0);
      const paidAmount = totalFees.reduce((sum, f) => sum + f.paidAmount, 0);
      const allPayments = totalFees.flatMap(f => f.payments);

      // Real generated records are always the source of truth — each one's
      // netAmount already reflects whatever override applied at the time it
      // was generated. Overrides/customFeeAmount are ONLY used to estimate
      // months that haven't been generated yet at all. Previously this
      // branch multiplied override-value × total-month-count regardless of
      // whether real records existed, which silently discarded real,
      // already-billed amounts in favor of a fabricated total — e.g. a
      // student with a partial-head override (one fee head reduced/waived,
      // not the whole month) would have real months priced at ~5,000 each
      // collapse to a synthetic "0 or near-0 × month count" total, making
      // fully real payments look like an overpayment against nothing owed.
      const realNetAmount = totalFees.reduce((sum, f) => sum + f.netAmount, 0);
      const periodCount = Math.max(totalFees.length, expectedPeriodCount);
      const missingMonths = Math.max(0, periodCount - totalFees.length);

      let perMonthEstimate = 0;
      const sOverrides = (s as any).feeOverrides as Record<string, number> | null;
      if (sOverrides && Object.keys(sOverrides).length > 0) {
        perMonthEstimate = Object.values(sOverrides).reduce((sum: number, v: any) => sum + (v || 0), 0);
      } else if ((s as any).customFeeAmount != null) {
        perMonthEstimate = (s as any).customFeeAmount;
      } else if (totalFees.length > 0) {
        // No explicit override for the missing months — best estimate is
        // the average of what this student's real generated months cost.
        perMonthEstimate = realNetAmount / totalFees.length;
      }

      const netAmount = realNetAmount + perMonthEstimate * missingMonths;

      const totalDue = netAmount + extraAmount;
      return {
        student: { ...s, studentFees: undefined },
        fee: totalFees.length > 0 ? totalFees[0] : null,
        id: 'full-ay-' + s.id,
        netAmount: totalDue,
        paidAmount,
        status: totalFees.length === 0 && totalDue === 0
          ? 'NO_FEE'
          : paidAmount >= totalDue
            ? (paidAmount > totalDue ? 'OVERPAID' : 'PAID')
            : paidAmount > 0 ? 'PARTIAL' : 'UNPAID',
        payments: allPayments,
        _monthCount: totalFees.length,
        _missingMonths: missingMonths,
        _isEstimated: missingMonths > 0 && perMonthEstimate > 0,
        _extraAmount: extraAmount,
      };
    }
    const mf = s.studentFees[0];
    const mfExtra = mf ? getExtra(mf) : 0;
    // If a StudentFee record already exists for this month, it already
    // reflects whatever override applied at generation time — trust it
    // fully and never re-derive from feeOverrides/customFeeAmount here.
    // Overrides are only an estimate for a month that hasn't been
    // generated yet (mf is null), never a correction to a real record.
    let effectiveNet: number;
    if (mf) {
      effectiveNet = mf.netAmount + mfExtra;
    } else {
      const sOverrides = (s as any).feeOverrides as Record<string, number> | null;
      if (sOverrides && Object.keys(sOverrides).length > 0) {
        effectiveNet = Object.values(sOverrides).reduce((sum: number, v: any) => sum + (v || 0), 0);
      } else if ((s as any).customFeeAmount != null) {
        effectiveNet = (s as any).customFeeAmount;
      } else {
        effectiveNet = 0;
      }
    }
    return {
      student: { ...s, studentFees: undefined, feeOverrides: undefined },
      fee: mf || null,
      id: mf?.id || s.id,
      netAmount: effectiveNet,
      paidAmount: mf?.paidAmount || 0,
      status: !mf && effectiveNet === 0
        ? 'NO_FEE'
        : (mf?.paidAmount ?? 0) >= effectiveNet
          ? ((mf?.paidAmount ?? 0) > effectiveNet ? 'OVERPAID' : 'PAID')
          : (mf?.paidAmount ?? 0) > 0 ? 'PARTIAL' : 'UNPAID',
      payments: mf?.payments || [],
      _extraAmount: mfExtra,
    };
  });

  let filteredData = data;
  if (needsStatusFilter) {
    filteredData = data.filter(row => matchesFeeStatusFilter(row.status, statusFilter));
  }
  const filteredTotal = needsStatusFilter ? filteredData.length : (total ?? data.length);
  const pagedData = needsStatusFilter ? filteredData.slice(skip, skip + limit) : filteredData;

  res.json({
    success: true,
    data: pagedData,
    pagination: { page, limit, total: filteredTotal, totalPages: Math.ceil(filteredTotal / limit) || 0 },
  });
}));

// ═══════════════════════════════════════════════════════════════════
// STUDENT FEE GENERATION
// ═══════════════════════════════════════════════════════════════════

// GET /admin/student-fees — List with filters (AY required)
router.get('/student-fees', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { month, year, status, groupId, search } = req.query;
  const where: any = { academicYearId: scope.academicYearId };
  if (month) where.month = parseInt(month as string, 10);
  if (year) where.year = parseInt(year as string, 10);
  if (status) where.status = { in: (status as string).split(',') };
  if (groupId) where.groupId = groupId as string;
  if (search) {
    where.student = { name: { contains: search as string, mode: 'insensitive' } };
  }

  const fees = await prisma.studentFee.findMany({
    where,
    include: {
      student: {
        select: {
          id: true, name: true, rollNumber: true, admissionNumber: true, familyId: true, customFeeAmount: true,
          parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } },
          group: { select: { name: true, section: true, displayOrder: true } },
        },
      },
      payments: { where: { revertedAt: null } },
    },
    orderBy: [{ netAmount: 'desc' }],
  });
  res.json({ success: true, data: fees });
}));

// POST /admin/student-fees/generate — Generate monthly fees with selected categories
router.post('/student-fees/generate', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId, categories, headIds, groupIds, mode: modeRaw } = req.body;
  if (!month || !year) { res.status(400).json({ success: false, message: 'month and year required' }); return; }
  const mode: 'generate' | 'update' | 'regenerate' = ['generate', 'update', 'regenerate'].includes(modeRaw)
    ? modeRaw
    : 'generate';
  const selectedCats: string[] = categories || ['MONTHLY'];
  const selectedHeadIds: string[] | null = headIds?.length > 0 ? headIds : null;
  const hasGroupFilter = Array.isArray(groupIds);

  const ayId = await resolveAcademicYearId(academicYearId);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const studentWhere: any = { academicYearId: ayId, isActive: true, status: 'ACTIVE' };
  if (hasGroupFilter) studentWhere.groupId = { in: groupIds };

  const students = await prisma.student.findMany({
    where: studentWhere,
    select: { id: true, groupId: true, customFeeAmount: true, feeOverrides: true },
  });

  let deleted = 0;
  let protectedCount = 0;
  if (mode === 'regenerate') {
    const studentIds = students.map(s => s.id);
    if (studentIds.length > 0) {
      const existingFees = await prisma.studentFee.findMany({
        where: { studentId: { in: studentIds }, month, year, academicYearId: ayId },
        select: { id: true, paidAmount: true },
      });
      for (const ef of existingFees) {
        if (ef.paidAmount > 0) { protectedCount++; continue; }
        await prisma.studentFee.delete({ where: { id: ef.id } });
        deleted++;
      }
    }
  }

  // Get fee structures with their head categories
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const structures = await prisma.feeStructure.findMany({
    where: {
      academicYearId: ayId,
      effectiveFrom: { lte: monthEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: monthEnd } }],
    },
    include: { feeHead: { select: { name: true, category: true } } },
  });

  const targetGroupIds = hasGroupFilter
    ? (groupIds as string[])
    : [...new Set(students.map(s => s.groupId).filter(Boolean))] as string[];
  const provisioned = await provisionMissingFeeStructures(ayId, targetGroupIds, structures);
  const activeStructures = provisioned.structures;

  // For ONE_TIME fee: check if this head was already charged by
  // examining the feeHeadBreakdown of the student's existing fees.
  const oneTimeStructures = activeStructures.filter(s => s.feeHead.category === 'ONE_TIME');
  const oneTimeCache = new Map<string, Set<string>>();

  let generated = 0, skipped = 0, updated = 0, skippedNoStructure = 0;
  for (const student of students) {
    // Pre-compute which ONE_TIME structures to skip for this student
    const skippedOneTimeIds = new Set<string>();
    for (const ots of oneTimeStructures) {
      if (ots.groupId === student.groupId) {
        if (!oneTimeCache.has(student.id)) {
          // Fetch all existing fee records to check their breakdowns
          const existingFees = await prisma.studentFee.findMany({
            where: { studentId: student.id, academicYearId: ayId },
            select: { feeHeadBreakdown: true },
          });
          const chargedHeads = new Set<string>();
          for (const ef of existingFees) {
            const bd = ef.feeHeadBreakdown as any[] || [];
            for (const b of bd) chargedHeads.add(b.name);
          }
          oneTimeCache.set(student.id, chargedHeads);
        }
        const chargedNames = oneTimeCache.get(student.id)!;
        // Skip if this head's name already appears in an existing breakdown
        if (chargedNames.has(ots.feeHead.name)) {
          skippedOneTimeIds.add(ots.id);
        }
      }
    }

    // Compute what would be generated with the current head/category selection
    const groupStructures = activeStructures.filter(s => {
      if (s.groupId !== student.groupId) return false;
      const cat = s.feeHead.category || 'MONTHLY';
      if (selectedHeadIds) {
        if (!selectedHeadIds.includes(s.feeHeadId)) return false;
      } else {
        if (!selectedCats.includes(cat)) return false;
      }
      if (cat === 'ONE_TIME' && skippedOneTimeIds.has(s.id)) return false;
      return true;
    });
    let { totalAmount, breakdown } = computeFeeAmountAndBreakdown(student, groupStructures);
    // Fallback: if breakdown is empty but total > 0, show a generic entry
    if (breakdown.length === 0 && totalAmount > 0) {
      breakdown = [{ name: 'Fee', amount: totalAmount, category: 'OTHER' }];
    }

    const existing = await prisma.studentFee.findUnique({
      where: { studentId_month_year_academicYearId: { studentId: student.id, month, year, academicYearId: ayId } },
      include: { extraItems: { select: { amount: true } } },
    });

    if (mode === 'generate') {
      if (existing) { skipped++; continue; }
      if (totalAmount > 0) {
        await prisma.studentFee.create({
          data: {
            academicYearId: ayId,
            studentId: student.id,
            groupId: student.groupId,
            month, year,
            totalAmount,
            netAmount: totalAmount,
            feeHeadBreakdown: breakdown,
          },
        });
        generated++;
      } else if (groupStructures.length === 0) {
        skippedNoStructure++;
      }
      continue;
    }

    if (mode === 'update') {
      if (!existing) { skipped++; continue; }
      const extraSum = (existing.extraItems || []).reduce((s, e) => s + e.amount, 0);
      if (totalAmount > 0 && (totalAmount !== existing.netAmount || !(existing as any).feeHeadBreakdown)) {
        const totalDue = totalAmount + extraSum;
        const status = computeFeeStatus(existing.paidAmount, totalDue);
        await prisma.studentFee.update({
          where: { id: existing.id },
          data: {
            totalAmount, netAmount: totalAmount, feeHeadBreakdown: breakdown,
            status,
            paidAt: status === 'PAID' || status === 'OVERPAID' ? (existing.paidAt ?? new Date()) : null,
          },
        });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    // regenerate: unpaid records were deleted above; paid records are protected
    if (existing) {
      if (existing.paidAmount > 0) { skipped++; continue; }
      skipped++;
      continue;
    }

    if (totalAmount > 0) {
      await prisma.studentFee.create({
        data: {
          academicYearId: ayId,
          studentId: student.id,
          groupId: student.groupId,
          month, year,
          totalAmount,
          netAmount: totalAmount,
          feeHeadBreakdown: breakdown,
        },
      });
      generated++;
    }
  }

  res.json({
    success: true,
    data: {
      generated, skipped, updated, deleted, protected: protectedCount,
      skippedNoStructure,
      structuresCopied: provisioned.structuresCopied,
      groupsProvisioned: provisioned.groupsProvisioned,
      total: students.length, mode,
    },
  });
}));

// POST /admin/student-fees/recalculate — Recalculate existing StudentFee records
// Useful after fee structure amounts change, custom fee updates, or feeOverrides modification
router.post('/student-fees/recalculate', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId, studentId } = req.body;

  const ayId = await resolveAcademicYearId(academicYearId);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  // Build filter: if studentId provided, only recalculate that student; if month/year, only that period
  const where: any = { academicYearId: ayId };
  if (studentId) where.studentId = studentId;
  if (month) where.month = month;
  if (year) where.year = year;

  const studentFees = await prisma.studentFee.findMany({
    where,
    select: { id: true, studentId: true, groupId: true, month: true, year: true, totalAmount: true, extraItems: { select: { amount: true } } },
  });
  if (studentFees.length === 0) {
    res.json({ success: true, data: { updated: 0, unchanged: 0, total: 0, message: 'No records found for the given criteria' } });
    return;
  }

  // Get all students with overrides
  const studentIds = [...new Set(studentFees.map(sf => sf.studentId))];
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, groupId: true, customFeeAmount: true, feeOverrides: true },
  });
  const studentMap = new Map(students.map(s => [s.id, s]));

  // Pre-load ALL fee structures for the academic year — we'll filter by effective dates in memory
  const allStructures = await prisma.feeStructure.findMany({
    where: { academicYearId: ayId },
    include: { feeHead: { select: { name: true, category: true } } },
  });

  let updated = 0, unchanged = 0;

  for (const sf of studentFees) {
    const student = studentMap.get(sf.studentId);
    if (!student) { unchanged++; continue; }

    // Filter structures effective for this student's group at this month
    const monthStart = new Date(sf.year, sf.month - 1, 1);
    const monthEnd = new Date(sf.year, sf.month, 0);
    const effectiveStructures = allStructures.filter(s =>
      s.groupId === student.groupId
      && s.effectiveFrom <= monthEnd
      && (!s.effectiveTo || s.effectiveTo > monthEnd)
    );

    const baseAmount = effectiveStructures.reduce((sum, s) => sum + s.amount, 0);

    let { totalAmount, breakdown } = computeFeeAmountAndBreakdown(student, effectiveStructures);
    // Fallback: if breakdown is empty but total > 0, show a generic entry
    if (breakdown.length === 0 && totalAmount > 0) {
      breakdown = [{ name: 'Fee', amount: totalAmount, category: 'OTHER' }];
    }

    if (totalAmount > 0 && totalAmount !== sf.totalAmount) {
      await prisma.studentFee.update({
        where: { id: sf.id },
        data: { totalAmount, netAmount: totalAmount, feeHeadBreakdown: breakdown },
      });
      updated++;
    } else {
      unchanged++;
    }
  }

  res.json({ success: true, data: { updated, unchanged, total: studentFees.length } });
}));

// ═══════════════════════════════════════════════════════════════════
// RECEIPT SNAPSHOT HELPER
// ═══════════════════════════════════════════════════════════════════

/**
 * Atomic receipt number generation with retry on unique constraint.
 * Catches P2002 (unique constraint) and retries with next sequence number.
 */
async function generateReceiptNumber(
  createFn: (rn: string) => Promise<any>,
  prefix = 'RCP',
  maxAttempts = 10,
): Promise<{ result: any; receiptNumber: string }> {
  const now = new Date();
  const yymm = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  // Matches the base sequence number regardless of a trailing "-N" allocation
  // suffix (waterfall/family payments store "RCP-202607-0100-2" etc — the
  // last 4 *characters* of that string are NOT the sequence number, so a
  // naive slice(-4) silently resets the counter after every multi-month
  // payment. Anchor on the fixed-width 4-digit group right after yymm.
  const seqPattern = new RegExp(`^${prefix}-${yymm}-(\\d{4})(?:-\\d+)?$`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Pull the highest existing sequence by scanning candidates for this
    // month (capped — receipt volume per month is in the hundreds, not
    // thousands) since the base number can be "buried" under suffixed rows
    // when sorted as plain strings.
    const candidates = await prisma.payment.findMany({
      where: { receiptNumber: { startsWith: `${prefix}-${yymm}` } },
      select: { receiptNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let lastSeq = 0;
    for (const c of candidates) {
      const m = c.receiptNumber.match(seqPattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > lastSeq) lastSeq = n;
      }
    }
    const rn = `${prefix}-${yymm}-${String(lastSeq + 1).padStart(4, '0')}`;
    try {
      const result = await createFn(rn);
      return { result, receiptNumber: rn };
    } catch (err: any) {
      if (err.code === 'P2002' && attempt < maxAttempts - 1) {
        // Unique constraint — another request beat us to this number, retry
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to generate unique receipt number after ${maxAttempts} attempts`);
}

/** Atomic family receipt number (FMP-YYYYMM-XXXX) with retry on unique constraint. */
async function generateFamilyReceiptNumber(
  createFn: (rn: string) => Promise<any>,
  maxAttempts = 10,
): Promise<{ result: any; receiptNumber: string }> {
  const prefix = 'FMP';
  const now = new Date();
  const yymm = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const seqPattern = new RegExp(`^${prefix}-${yymm}-(\\d{4})$`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidates = await prisma.familyPayment.findMany({
      where: { receiptNumber: { startsWith: `${prefix}-${yymm}` } },
      select: { receiptNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let lastSeq = 0;
    for (const c of candidates) {
      const m = c.receiptNumber.match(seqPattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > lastSeq) lastSeq = n;
      }
    }
    const rn = `${prefix}-${yymm}-${String(lastSeq + 1).padStart(4, '0')}`;
    try {
      const result = await createFn(rn);
      return { result, receiptNumber: rn };
    } catch (err: any) {
      if (err.code === 'P2002' && attempt < maxAttempts - 1) continue;
      throw err;
    }
  }
  throw new Error(`Failed to generate unique family receipt number after ${maxAttempts} attempts`);
}

/**
 * Create receipt snapshot + audit log after a payment.
 * `input` fields are pre-computed by each caller (single / waterfall / family).
 */
async function createReceiptSnapshot(
  paymentId: string,
  receiptNumber: string,
  input: {
    amountPaidPaise: number;
    currentMonthLabel: string;
    currentMonthHeads: any[];
    currentMonthExtras: any[];
    previousBalancePaise: number;
    previousMonthsCount: number;
    totalDuePaise: number;
    balanceAfterPaise: number;
    paymentMethod: string;
    reference: string | null;
    studentName: string;
    studentClass: string;
    studentRoll: string | null;
    fatherName: string | null;
    isFullyPaid: boolean;
    /** Per-month breakdown for waterfall/family payments spanning multiple
     * months in one transaction. Omitted (or single-entry) for a plain
     * single-fee payment. */
    allocations?: { label: string; amountPaise: number }[];
  },
  userId: string,
) {
  await prisma.paymentReceipt.create({
    data: {
      paymentId,
      receiptNumber,
      currentMonthLabel: input.currentMonthLabel,
      currentMonthTotal: input.currentMonthHeads.reduce((s: number, h: any) => s + (h.amount || 0), 0),
      currentMonthHeads: input.currentMonthHeads,
      currentMonthExtras: input.currentMonthExtras,
      previousBalancePaise: input.previousBalancePaise,
      previousMonthsCount: input.previousMonthsCount,
      allocations: input.allocations && input.allocations.length > 0 ? input.allocations : undefined,
      totalDuePaise: input.totalDuePaise,
      amountPaidPaise: input.amountPaidPaise,
      balanceAfterPaise: input.balanceAfterPaise,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      studentName: input.studentName,
      studentClass: input.studentClass,
      studentRoll: input.studentRoll,
      fatherName: input.fatherName,
      isFullyPaid: input.isFullyPaid,
      paymentDate: new Date(),
    },
  });
  await prisma.paymentAuditLog.create({
    data: {
      paymentId,
      action: 'CREATED',
      newValue: input as any,
      performedById: userId,
      performedByName: input.studentName,
    },
  });
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function feeMonthKey(month: number, year: number) {
  return year * 12 + month;
}

function monthLabelFromFee(month: number, year: number) {
  return `${MONTH_LABELS[(month || 1) - 1]} ${year}`;
}

type StudentReceiptTemplate = 'FIRST' | 'ARREARS' | 'CONTINUATION';

function buildReceiptLine(name: string, dueBefore: number, paidThis: number) {
  return {
    name,
    dueBeforePaise: dueBefore,
    paidPaise: paidThis,
    remainingPaise: Math.max(0, dueBefore - paidThis),
    amountPaise: dueBefore,
  };
}

async function detectStudentReceiptTemplate(
  studentId: string,
  paymentIds: string[],
  prevMonthFeeIds: string[],
  curStudentFeeId: string | null,
): Promise<StudentReceiptTemplate> {
  const excludeIds = paymentIds.filter(Boolean);
  const priorCount = await prisma.payment.count({
    where: {
      studentId,
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      revertedAt: null,
    },
  });
  if (priorCount === 0 && prevMonthFeeIds.length === 0) return 'FIRST';
  if (prevMonthFeeIds.length > 0) return 'ARREARS';
  if (curStudentFeeId) {
    const fee = await prisma.studentFee.findUnique({ where: { id: curStudentFeeId } });
    if (fee) {
      const thisPaymentSum = excludeIds.length > 0
        ? await prisma.payment.aggregate({
            where: { studentFeeId: curStudentFeeId, id: { in: excludeIds }, revertedAt: null },
            _sum: { amount: true },
          })
        : { _sum: { amount: 0 } };
      const paidBefore = fee.paidAmount - (thisPaymentSum._sum.amount || 0);
      if (paidBefore > 0) return 'CONTINUATION';
    }
  }
  return priorCount === 0 ? 'FIRST' : 'ARREARS';
}

type FamilyReceiptTemplate = 'FIRST' | 'ARREARS' | 'CONTINUATION';

async function detectFamilyReceiptTemplate(
  familyId: string,
  familyPaymentId: string,
  payments: { studentId: string; studentFeeId: string; amount: number }[],
  academicYearId: string | null,
): Promise<FamilyReceiptTemplate> {
  const priorCount = await prisma.familyPayment.count({
    where: { familyId, id: { not: familyPaymentId } },
  });
  if (priorCount === 0) return 'FIRST';

  let hasArrears = false;
  let hasContinuation = false;

  const byStudent = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = byStudent.get(p.studentId) || [];
    list.push(p);
    byStudent.set(p.studentId, list);
  }

  for (const [studentId, studentPayments] of byStudent) {
    const ayWhere = academicYearId ? { academicYearId } : {};
    const allFees = await prisma.studentFee.findMany({
      where: { studentId, ...ayWhere },
      select: { id: true, month: true, year: true, paidAmount: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    if (allFees.length === 0) continue;
    const latest = allFees[allFees.length - 1];
    const latestKey = feeMonthKey(latest.month, latest.year);

    for (const p of studentPayments) {
      const fee = allFees.find(f => f.id === p.studentFeeId);
      if (!fee) continue;
      const key = feeMonthKey(fee.month, fee.year);
      if (key < latestKey) hasArrears = true;
      if (key === latestKey && fee.paidAmount - p.amount > 0) hasContinuation = true;
    }
  }

  if (hasArrears) return 'ARREARS';
  if (hasContinuation) return 'CONTINUATION';
  return 'ARREARS';
}

/** Build + persist combined family receipt snapshot after a family payment. */
async function createFamilyReceiptSnapshot(familyPaymentId: string, userId: string) {
  const fp = await prisma.familyPayment.findUnique({
    where: { id: familyPaymentId },
    include: {
      family: { select: { id: true, name: true, fatherName: true, phone: true } },
      payments: {
        where: { revertedAt: null },
        include: {
          student: { select: { id: true, name: true, rollNumber: true, group: { select: { name: true, section: true } } } },
          studentFee: { include: { extraItems: true } },
          headAllocations: { where: { revertedAt: null } },
        },
      },
    },
  });
  if (!fp || fp.payments.length === 0) return;

  const templateType = await detectFamilyReceiptTemplate(
    fp.familyId,
    fp.id,
    fp.payments.map(p => ({ studentId: p.studentId, studentFeeId: p.studentFeeId, amount: p.amount })),
    fp.academicYearId,
  );

  const byStudent = new Map<string, typeof fp.payments>();
  for (const p of fp.payments) {
    const list = byStudent.get(p.studentId) || [];
    list.push(p);
    byStudent.set(p.studentId, list);
  }

  const studentSections: any[] = [];
  let familyTotalDueBefore = 0;
  let familyBalanceAfter = 0;

  for (const [studentId, studentPayments] of byStudent) {
    const student = studentPayments[0].student;
    const sClass = [student.group?.name, student.group?.section].filter(Boolean).join(' — ') || '—';
    const touchedFeeIds = new Set(studentPayments.map(p => p.studentFeeId));

    const allFees = await prisma.studentFee.findMany({
      where: { studentId, ...(fp.academicYearId ? { academicYearId: fp.academicYearId } : {}) },
      include: { extraItems: true },
    });

    let studentDueBefore = 0;
    let studentBalanceAfter = 0;
    for (const f of allFees) {
      const total = getFeeTotalDue(f);
      const rem = Math.max(0, total - f.paidAmount);
      studentBalanceAfter += rem;
      if (touchedFeeIds.has(f.id)) {
        const paidThis = studentPayments.filter(p => p.studentFeeId === f.id).reduce((s, p) => s + p.amount, 0);
        studentDueBefore += rem + paidThis;
      } else if (rem > 0) {
        studentDueBefore += rem;
      }
    }

    const previousMonths: { label: string; amountPaise: number; paidPaise: number }[] = [];
    let currentMonth: any = null;

    const sortedTouched = [...new Set(studentPayments.map(p => p.studentFeeId))]
      .map(id => allFees.find(f => f.id === id)!)
      .filter(Boolean)
      .sort((a, b) => feeMonthKey(a.month, a.year) - feeMonthKey(b.month, b.year));

    const latestTouched = sortedTouched[sortedTouched.length - 1];
    const latestKey = latestTouched ? feeMonthKey(latestTouched.month, latestTouched.year) : 0;

    for (const fee of sortedTouched) {
      const feePayments = studentPayments.filter(p => p.studentFeeId === fee.id);
      const paidThis = feePayments.reduce((s, p) => s + p.amount, 0);
      const feeTotal = getFeeTotalDue(fee);
      const dueBefore = Math.max(0, feeTotal - (fee.paidAmount - paidThis));
      const key = feeMonthKey(fee.month, fee.year);
      const label = monthLabelFromFee(fee.month, fee.year);

      if (key < latestKey || (templateType === 'ARREARS' && sortedTouched.length > 1 && fee.id !== latestTouched?.id)) {
        previousMonths.push({ label, amountPaise: dueBefore, paidPaise: paidThis });
        continue;
      }

      const heads: any[] = [];
      const extras: any[] = [];
      const headBreakdown = (fee.feeHeadBreakdown as any[]) || [];

      for (const h of headBreakdown) {
        const headAllocs = feePayments.flatMap(p => p.headAllocations.filter(a => a.feeHeadId === h.feeHeadId));
        const paidThisHead = headAllocs.reduce((s, a) => s + a.amount, 0);
        const priorAllocs = await prisma.paymentHeadAllocation.findMany({
          where: {
            studentFeeId: fee.id,
            feeHeadId: h.feeHeadId,
            revertedAt: null,
            paymentId: { notIn: feePayments.map(p => p.id) },
          },
        });
        const paidBefore = priorAllocs.reduce((s, a) => s + a.amount, 0);
        const dueBeforeHead = Math.max(0, (h.amount || 0) - paidBefore);
        if (dueBeforeHead > 0 || paidThisHead > 0) {
          heads.push({
            name: h.name,
            dueBeforePaise: dueBeforeHead,
            paidPaise: paidThisHead,
            remainingPaise: Math.max(0, dueBeforeHead - paidThisHead),
          });
        }
      }

      for (const e of fee.extraItems || []) {
        const extraAllocs = feePayments.flatMap(p => p.headAllocations.filter(a => a.feeExtraItemId === e.id));
        const paidThisExtra = extraAllocs.reduce((s, a) => s + a.amount, 0);
        const priorAllocs = await prisma.paymentHeadAllocation.findMany({
          where: {
            studentFeeId: fee.id,
            feeExtraItemId: e.id,
            revertedAt: null,
            paymentId: { notIn: feePayments.map(p => p.id) },
          },
        });
        const paidBefore = priorAllocs.reduce((s, a) => s + a.amount, 0);
        const dueBeforeExtra = Math.max(0, e.amount - paidBefore);
        if (dueBeforeExtra > 0 || paidThisExtra > 0) {
          extras.push({
            name: e.name,
            dueBeforePaise: dueBeforeExtra,
            paidPaise: paidThisExtra,
            remainingPaise: Math.max(0, dueBeforeExtra - paidThisExtra),
          });
        }
      }

      if (heads.length === 0 && extras.length === 0 && paidThis > 0) {
        heads.push({ name: label, dueBeforePaise: dueBefore, paidPaise: paidThis, remainingPaise: Math.max(0, dueBefore - paidThis) });
      }

      currentMonth = {
        label,
        heads,
        extras,
        totalDueBeforePaise: dueBefore,
        paidPaise: paidThis,
        remainingPaise: Math.max(0, feeTotal - fee.paidAmount),
      };
    }

    const amountPaidPaise = studentPayments.reduce((s, p) => s + p.amount, 0);
    studentSections.push({
      studentId,
      name: student.name,
      class: sClass,
      rollNumber: student.rollNumber,
      previousMonths,
      previousBalancePaise: previousMonths.reduce((s, m) => s + m.amountPaise, 0),
      currentMonth,
      amountPaidPaise,
      totalDueBeforePaise: studentDueBefore,
      balanceAfterPaise: studentBalanceAfter,
    });

    familyTotalDueBefore += studentDueBefore;
    familyBalanceAfter += studentBalanceAfter;
  }

  const snapshot = {
    templateType,
    receiptNumber: fp.receiptNumber,
    familyName: fp.family.name,
    fatherName: fp.family.fatherName,
    phone: fp.family.phone,
    paymentMethod: fp.paymentMethod || 'CASH',
    reference: fp.reference,
    paymentDate: fp.paymentDate.toISOString(),
    totalDuePaise: familyTotalDueBefore,
    amountPaidPaise: fp.totalAmount,
    balanceAfterPaise: familyBalanceAfter,
    isFullyPaid: familyBalanceAfter <= 0,
    students: studentSections,
  };

  await prisma.familyPaymentReceipt.upsert({
    where: { familyPaymentId: fp.id },
    create: {
      familyPaymentId: fp.id,
      receiptNumber: fp.receiptNumber,
      templateType,
      snapshot: snapshot as any,
      totalDuePaise: familyTotalDueBefore,
      amountPaidPaise: fp.totalAmount,
      balanceAfterPaise: familyBalanceAfter,
      paymentMethod: fp.paymentMethod,
      reference: fp.reference,
      paymentDate: fp.paymentDate,
    },
    update: {
      templateType,
      snapshot: snapshot as any,
      totalDuePaise: familyTotalDueBefore,
      amountPaidPaise: fp.totalAmount,
      balanceAfterPaise: familyBalanceAfter,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════

// POST /admin/payments — Record single payment
router.post('/payments', asyncHandler(async (req: Request, res: Response) => {
  const { studentFeeId, amount, paymentMethod, reference, note } = req.body;
  if (!studentFeeId || !amount || amount <= 0 || !paymentMethod) {
    res.status(400).json({ success: false, message: 'studentFeeId, amount (>0), and paymentMethod required' });
    return;
  }
  const userId = (req as any).user?.id;

  // Get the student fee (with student info for snapshot)
  const studentFee = await prisma.studentFee.findUnique({
    where: { id: studentFeeId },
    include: { student: { select: { id: true, name: true } } },
  });
  if (!studentFee) { res.status(404).json({ success: false, message: 'Student fee not found' }); return; }

  // Fetch extras once (needed for both payment status AND snapshot)
  const extraItems = await prisma.feeExtraItem.findMany({ where: { studentFeeId } });
  const extraSum = extraItems.reduce((s: number, e: any) => s + e.amount, 0);

  // Atomic receipt number generation + payment creation + fee update
  const { result: payment, receiptNumber } = await generateReceiptNumber(async (rn) => {
    return prisma.$transaction(async (tx) => {
      // Lock the row for the duration of the transaction (SELECT ... FOR UPDATE).
      // Without this, two concurrent payments against the same fee can both
      // read paidAmount=0 before either commits, and the second UPDATE
      // silently clobbers the first (lost update) even though both ran
      // inside their own transaction — read-committed isolation alone does
      // not protect against this for a read-then-compute-then-write pattern.
      const locked = await tx.$queryRaw<{ netAmount: number; paidAmount: number }[]>`
        SELECT "netAmount", "paidAmount" FROM "student_fees" WHERE "id" = ${studentFeeId} FOR UPDATE
      `;
      const freshFee = locked[0];
      if (!freshFee) throw new Error('Student fee not found during payment');

      // Create payment
      const p = await tx.payment.create({
        data: {
          studentFeeId, studentId: studentFee.studentId,
          amount, paymentMethod, reference, receiptNumber: rn, note, recordedById: userId,
        },
      });

      // Update paidAmount and status (include extras in total due)
      const allP = await tx.payment.aggregate({
        where: { studentFeeId, revertedAt: null },
        _sum: { amount: true },
      });
      const totalDue = freshFee.netAmount + extraSum;
      const paidAmt = allP._sum.amount || 0;
      let payStatus = 'PARTIAL';
      if (paidAmt >= totalDue) payStatus = paidAmt > totalDue ? 'OVERPAID' : 'PAID';

      await tx.studentFee.update({
        where: { id: studentFeeId },
        data: { paidAmount: paidAmt, status: payStatus, paidAt: payStatus === 'PAID' ? new Date() : undefined },
      });

      return p;
    });
  });

  // Compute receipt snapshot
  const today = new Date();
  const studentName = studentFee.student?.name || '';
  const studentData = await prisma.student.findUnique({
    where: { id: studentFee.studentId },
    select: { name: true, rollNumber: true, group: { select: { name: true, section: true } }, parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } } },
  });
  const father = studentData?.parents?.find((p: any) => p.parent?.relation === 'Father');
  const fatherName = father?.parent?.user?.name || father?.parent?.phone || null;
  const studentClass = [studentData?.group?.name, studentData?.group?.section].filter(Boolean).join(' — ') || '—';

  // Compute previous balance from all other fees (before this payment)
  const allOtherFees = await prisma.studentFee.findMany({
    where: { studentId: studentFee.studentId, id: { not: studentFeeId } },
    include: { extraItems: { select: { amount: true } } },
  });
  let previousBalance = 0;
  let prevMonths = 0;
  for (const of of allOtherFees) {
    const ofExtra = (of as any).extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0;
    const ofDue = (of.netAmount + ofExtra) - (of.paidAmount || 0);
    if (ofDue > 0) { previousBalance += ofDue; prevMonths++; }
  }

  const totalDueBefore = studentFee.netAmount + extraSum + previousBalance;
  const balanceAfter = Math.max(0, totalDueBefore - amount);

  const monthLabel = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(studentFee.month || 1) - 1] + ' ' + (studentFee.year || '');
  // feeHeadBreakdown / extraItems store the field as "amount" (paise) —
  // the receipt renderer (receipt.ts) reads "amountPaise". Normalize here
  // at write time so every snapshot going forward is self-consistent,
  // instead of relying on the frontend to know which raw DB shape it's
  // looking at.
  const heads = ((studentFee.feeHeadBreakdown as any[]) || []).map((h: any) => ({ name: h.name, amountPaise: h.amount || 0 }));
  const snapExtras = extraItems.map((e: any) => ({ name: e.name, amountPaise: e.amount || 0 }));

  await createReceiptSnapshot(
    payment.id, receiptNumber,
    {
      amountPaidPaise: amount,
      currentMonthLabel: monthLabel,
      currentMonthHeads: heads,
      currentMonthExtras: snapExtras,
      previousBalancePaise: previousBalance,
      previousMonthsCount: prevMonths,
      totalDuePaise: totalDueBefore,
      balanceAfterPaise: balanceAfter,
      paymentMethod: paymentMethod || 'CASH',
      reference: reference || null,
      studentName,
      studentClass,
      studentRoll: studentData?.rollNumber || null,
      fatherName,
      isFullyPaid: balanceAfter <= 0,
    },
    userId,
  );

  res.status(201).json({ success: true, data: { payment, receiptNumber, status: 'PAID' } });
}));

// POST /admin/payments/waterfall — Waterfall payment across unpaid months (oldest first)
router.post('/payments/waterfall', asyncHandler(async (req: Request, res: Response) => {
  const { studentId, amount, paymentMethod, reference, note } = req.body;
  if (!studentId || !amount || amount <= 0) {
    res.status(400).json({ success: false, message: 'studentId and amount (>0) required' });
    return;
  }
  const userId = (req as any).user?.id;

  // ─── Concurrency-safe waterfall: read+validate+allocate inside one transaction ───
  const getTotalDueFn = (f: any) => {
    const extraSum = (f.extraItems || []).reduce((s: number, e: any) => s + e.amount, 0) || 0;
    return f.netAmount + extraSum - f.paidAmount;
  };

  let allocations: any[] = [];
  let receiptNumber = '';
  try {
    const result = await generateReceiptNumber(async (receiptBase) => {
      return prisma.$transaction(async (tx) => {
        // Lock every UNPAID/PARTIAL fee row for this student up front (SELECT
        // ... FOR UPDATE) before reading amounts. Without this, two
        // concurrent waterfall payments against the same student can both
        // read the same paidAmount/status snapshot before either commits,
        // and the later transaction's UPDATE overwrites the earlier one's
        // committed write (lost update) even though both run inside their
        // own transaction — Postgres's default READ COMMITTED isolation
        // does not protect a read-then-compute-then-write pattern by itself.
        const lockedIds = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "student_fees"
          WHERE "studentId" = ${studentId} AND status IN ('UNPAID', 'PARTIAL')
          FOR UPDATE
        `;
        if (lockedIds.length === 0) {
          throw Object.assign(new Error('No unpaid fees found for this student'), { statusCode: 400 });
        }

        // 1. Re-read fees INSIDE the transaction (now guaranteed to reflect
        // the latest committed state, since the rows above are locked)
        const freshFees = await tx.studentFee.findMany({
          where: { id: { in: lockedIds.map(r => r.id) } },
          include: { extraItems: true },
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        });

        if (freshFees.length === 0) {
          throw Object.assign(new Error('No unpaid fees found for this student'), { statusCode: 400 });
        }

        // 2. Re-validate total remaining against latest state
        // Allow overpayments (excess creates OVERPAID status on last fee)
        const totalRemaining = freshFees.reduce((sum: number, f: any) => sum + getTotalDueFn(f), 0);
        if (totalRemaining <= 0) {
          throw Object.assign(new Error('All fees for this student are already paid'), { statusCode: 400 });
        }

        // 3. Allocate across fees
        const allocs: any[] = [];
        let rem = amount;
        for (const fee of freshFees) {
          if (rem <= 0) break;
          const due = getTotalDueFn(fee);
          if (due <= 0) continue;

          const payAmount = Math.min(rem, due);
          rem -= payAmount;

          const payment = await tx.payment.create({
            data: {
              studentFeeId: fee.id, studentId,
              amount: payAmount, paymentMethod: paymentMethod || 'CASH',
              receiptNumber: `${receiptBase}-${allocs.length + 1}`,
              reference, note, recordedById: userId,
            },
          });
          allocs.push(payment);

          // 4. Update fee with OVERPAID support
          const feeExtraSum = (fee.extraItems || []).reduce((s: number, e: any) => s + e.amount, 0) || 0;
          const feeTotalDue = fee.netAmount + feeExtraSum;
          const newPaid = fee.paidAmount + payAmount;
          const newStatus = newPaid >= feeTotalDue
            ? (newPaid > feeTotalDue ? 'OVERPAID' : 'PAID')
            : 'PARTIAL';
          await tx.studentFee.update({
            where: { id: fee.id },
            data: { paidAmount: newPaid, status: newStatus, paidAt: newStatus === 'PAID' ? new Date() : undefined },
          });
        }

        return allocs;
      });
    }, 'RCP');
    allocations = result.result;
    receiptNumber = result.receiptNumber;
  } catch (waterfallErr: any) {
    if (waterfallErr.statusCode === 400) {
      res.status(400).json({ success: false, message: waterfallErr.message });
      return;
    }
    throw waterfallErr;
  }
  // ─── End atomic waterfall ───

  // Compute receipt snapshot from committed state
  const studentData = await prisma.student.findUnique({
    where: { id: studentId },
    select: { name: true, rollNumber: true, group: { select: { name: true, section: true } }, parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } } },
  });
  const father = studentData?.parents?.find((p: any) => p.parent?.relation === 'Father');
  const fatherName = father?.parent?.user?.name || father?.parent?.phone || null;
  const studentClass = [studentData?.group?.name, studentData?.group?.section].filter(Boolean).join(' — ') || '—';

  // Compute snapshot using the paid fee IDs from allocations
  const paidFeeIds = new Set(allocations.map((a: any) => a.studentFeeId));
  const allFees = await prisma.studentFee.findMany({
    where: { studentId, id: { in: Array.from(paidFeeIds) as string[] } },
    include: { extraItems: true },
  });
  // Find latest paid fee = current month
  const latestPaidFee = allFees.sort((a: any, b: any) => (b.year - a.year) || (b.month - a.month))[0];

  // Previous balance: fees NOT paid + any residual due on older paid fees
  const otherFees = await prisma.studentFee.findMany({
    where: { studentId, id: { notIn: Array.from(paidFeeIds) as string[] } },
    include: { extraItems: { select: { amount: true } } },
  });
  let previousBalance = 0;
  let prevMonths = 0;
  for (const f of otherFees) {
    const fe = (f as any).extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0;
    const due = (f.netAmount + fe) - (f.paidAmount || 0);
    if (due > 0) { previousBalance += due; prevMonths++; }
  }

  const monthLabel = latestPaidFee
    ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(latestPaidFee.month || 1) - 1] + ' ' + (latestPaidFee.year || ''))
    : 'Waterfall Payment';
  const cmHeads = ((latestPaidFee?.feeHeadBreakdown as any[]) || []).map((h: any) => ({ name: h.name, amountPaise: h.amount || 0 }));
  const cmExtras = latestPaidFee ? ((latestPaidFee as any).extraItems || []).map((e: any) => ({ name: e.name, amountPaise: e.amount || 0 })) : [];
  const currentTotal = latestPaidFee ? (latestPaidFee.netAmount + ((latestPaidFee as any).extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0)) : 0;
  const totalDueBefore = previousBalance + currentTotal;
  const balanceAfter = Math.max(0, totalDueBefore - amount);

  // Per-month allocation breakdown for the snapshot — this is what was lost
  // when the snapshot only stored the latest month's total. Build it from
  // the actual Payment rows created in this transaction, keyed back to
  // their fee's month/year label.
  const feeById = new Map(allFees.map((f: any) => [f.id, f]));
  const allocationLabels = allocations.map((a: any) => {
    const f = feeById.get(a.studentFeeId);
    const label = f
      ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(f.month || 1) - 1] + ' ' + (f.year || ''))
      : 'Allocation';
    return { label, amountPaise: a.amount };
  });

  try {
    await createReceiptSnapshot(
      allocations[0]?.id || 'unknown', receiptNumber,
      {
        amountPaidPaise: amount,
        currentMonthLabel: monthLabel,
        currentMonthHeads: cmHeads,
        currentMonthExtras: cmExtras,
        previousBalancePaise: previousBalance,
        previousMonthsCount: prevMonths,
        allocations: allocationLabels,
        totalDuePaise: totalDueBefore,
        balanceAfterPaise: balanceAfter,
        paymentMethod: paymentMethod || 'CASH',
        reference: reference || null,
        studentName: studentData?.name || '',
        studentClass,
        studentRoll: studentData?.rollNumber || null,
        fatherName,
        isFullyPaid: balanceAfter <= 0,
      },
      userId,
    );
  } catch (snapErr) {
    console.error('Receipt snapshot creation failed (waterfall):', (snapErr as Error).message);
  }

  res.status(201).json({
    success: true,
    data: {
      receiptNumber,
      totalAmount: amount,
      allocations: allocations.map((a: any) => ({ id: a.id, studentFeeId: a.studentFeeId, amount: a.amount, receiptNumber: a.receiptNumber })),
      monthsCovered: allocations.length,
    },
  });
}));

// POST /admin/payments/allocate — Manual allocation payment (Step 1 UI).
// Unlike /payments/waterfall (which decides allocation itself, oldest-first,
// no accountant input), this endpoint takes an EXPLICIT selection: which
// previous months (whole, no head split) and which current-month heads/
// extras (individually) the accountant checked on the allocation screen.
// Backend re-validates every amount against fresh DB state inside a locked
// transaction — it never trusts client-sent due amounts, only client-sent
// *selection* (which studentFeeId/feeHeadId/feeExtraItemId got how much).
router.post('/payments/allocate', asyncHandler(async (req: Request, res: Response) => {
  const { studentId, amountPaidPaise, paymentMethod, reference, note, previousMonths, currentMonth } = req.body;
  const userId = (req as any).user?.id;

  if (!studentId || !amountPaidPaise || amountPaidPaise <= 0) {
    res.status(400).json({ success: false, message: 'studentId and amountPaidPaise (>0) required' });
    return;
  }
  const prevList: { studentFeeId: string; amountPaise: number }[] = Array.isArray(previousMonths) ? previousMonths : [];
  const curHeads: { feeHeadId?: string; headName?: string; amountPaise: number }[] = currentMonth?.heads || [];
  const curExtras: { feeExtraItemId: string; amountPaise: number }[] = currentMonth?.extras || [];
  const curStudentFeeId: string | undefined = currentMonth?.studentFeeId;

  if (prevList.length === 0 && curHeads.length === 0 && curExtras.length === 0) {
    res.status(400).json({ success: false, message: 'No allocation selected' });
    return;
  }
  if ((curHeads.length > 0 || curExtras.length > 0) && !curStudentFeeId) {
    res.status(400).json({ success: false, message: 'currentMonth.studentFeeId required when heads/extras are selected' });
    return;
  }

  // Selection amounts must sum to exactly the amount being paid — this is
  // the same rule the Step 1 Next button enforces client-side; the backend
  // can't skip re-checking it since the client payload isn't trusted.
  const selectedTotal =
    prevList.reduce((s, p) => s + (p.amountPaise || 0), 0) +
    curHeads.reduce((s, h) => s + (h.amountPaise || 0), 0) +
    curExtras.reduce((s, e) => s + (e.amountPaise || 0), 0);
  if (selectedTotal !== amountPaidPaise) {
    res.status(400).json({ success: false, message: `Selected total (${selectedTotal}) does not match amount paid (${amountPaidPaise})` });
    return;
  }

  const allFeeIds = Array.from(new Set([...prevList.map(p => p.studentFeeId), ...(curStudentFeeId ? [curStudentFeeId] : [])]));

  let payments: any[] = [];
  let receiptNumber = '';
  try {
    const result = await generateReceiptNumber(async (receiptBase) => {
      return prisma.$transaction(async (tx) => {
        // Lock every StudentFee row this request touches, up front — same
        // pattern as waterfall: without FOR UPDATE, two concurrent payment
        // requests against the same fee/head can both read stale amounts
        // and the second commit silently overwrites the first.
        await tx.$queryRaw`
          SELECT id FROM "student_fees" WHERE id = ANY(${allFeeIds}) FOR UPDATE
        `;

        const freshFees = await tx.studentFee.findMany({
          where: { id: { in: allFeeIds }, studentId },
          include: { extraItems: true },
        });
        const feeById = new Map(freshFees.map(f => [f.id, f]));
        if (freshFees.length !== allFeeIds.length) {
          throw Object.assign(new Error('One or more selected fees do not belong to this student'), { statusCode: 400 });
        }

        const createdPayments: any[] = [];
        let seq = 0;

        // Previous months: whole-fee payments, validated against fresh remaining due
        const sortedPrev = [...prevList].sort((a, b) => {
          const fa = feeById.get(a.studentFeeId), fb = feeById.get(b.studentFeeId);
          return ((fa?.year || 0) - (fb?.year || 0)) || ((fa?.month || 0) - (fb?.month || 0));
        });
        for (const p of sortedPrev) {
          const fee = feeById.get(p.studentFeeId);
          if (!fee) throw Object.assign(new Error('Selected previous-month fee not found'), { statusCode: 400 });
          const extraSum = (fee.extraItems || []).reduce((s, e) => s + e.amount, 0);
          const remaining = fee.netAmount + extraSum - fee.paidAmount;
          if (p.amountPaise <= 0 || p.amountPaise > remaining) {
            throw Object.assign(new Error(`Selected amount for ${fee.month}/${fee.year} exceeds its remaining due (${remaining})`), { statusCode: 400 });
          }
          seq++;
          const payment = await tx.payment.create({
            data: {
              studentFeeId: fee.id, studentId,
              amount: p.amountPaise, paymentMethod: paymentMethod || 'CASH',
              receiptNumber: `${receiptBase}-${seq}`,
              reference, note, recordedById: userId,
            },
          });
          createdPayments.push(payment);
          const newPaid = fee.paidAmount + p.amountPaise;
          const feeTotalDue = fee.netAmount + extraSum;
          const newStatus = newPaid >= feeTotalDue ? (newPaid > feeTotalDue ? 'OVERPAID' : 'PAID') : 'PARTIAL';
          await tx.studentFee.update({
            where: { id: fee.id },
            data: { paidAmount: newPaid, status: newStatus, paidAt: newStatus === 'PAID' ? new Date() : undefined },
          });
        }

        // Current month: one Payment row + PaymentHeadAllocation children,
        // validated per-head/per-extra against fresh remaining (sticker
        // price minus whatever was already allocated to that specific
        // head/extra in prior, non-reverted allocations).
        let currentMonthPayment: any = null;
        if (curStudentFeeId && (curHeads.length > 0 || curExtras.length > 0)) {
          const fee = feeById.get(curStudentFeeId);
          if (!fee) throw Object.assign(new Error('Current month fee not found'), { statusCode: 400 });

          const priorAllocs = await tx.paymentHeadAllocation.findMany({
            where: { studentFeeId: curStudentFeeId, revertedAt: null },
          });
          const priorByHead = new Map<string, number>();
          for (const a of priorAllocs) {
            if (a.feeHeadId) {
              priorByHead.set(`h:${a.feeHeadId}`, (priorByHead.get(`h:${a.feeHeadId}`) || 0) + a.amount);
            } else if (a.feeExtraItemId) {
              priorByHead.set(`e:${a.feeExtraItemId}`, (priorByHead.get(`e:${a.feeExtraItemId}`) || 0) + a.amount);
            }
          }

          const headBreakdown = (fee.feeHeadBreakdown as any[]) || [];
          const allocInputs: { feeHeadId?: string; feeExtraItemId?: string; amount: number }[] = [];

          for (const h of curHeads) {
            const headDef = headBreakdown.find((b: any) =>
              (h.feeHeadId && b.feeHeadId === h.feeHeadId) || (h.headName && b.name === h.headName)
            );
            if (!headDef) throw Object.assign(new Error('Selected fee head not found on this month'), { statusCode: 400 });
            const headKey = headDef.feeHeadId ? `h:${headDef.feeHeadId}` : `n:${headDef.name}`;
            const already = priorByHead.get(headKey) || 0;
            const remaining = (headDef.amount || 0) - already;
            if (h.amountPaise <= 0 || h.amountPaise > remaining) {
              throw Object.assign(new Error(`Selected amount for head "${headDef.name}" exceeds its remaining due (${remaining})`), { statusCode: 400 });
            }
            allocInputs.push({ feeHeadId: headDef.feeHeadId || undefined, amount: h.amountPaise });
          }
          for (const e of curExtras) {
            const extraDef = fee.extraItems.find(ei => ei.id === e.feeExtraItemId);
            if (!extraDef) throw Object.assign(new Error('Selected extra item not found on this month'), { statusCode: 400 });
            const already = priorByHead.get(`e:${e.feeExtraItemId}`) || 0;
            const remaining = extraDef.amount - already;
            if (e.amountPaise <= 0 || e.amountPaise > remaining) {
              throw Object.assign(new Error(`Selected amount for extra "${extraDef.name}" exceeds its remaining due (${remaining})`), { statusCode: 400 });
            }
            allocInputs.push({ feeExtraItemId: e.feeExtraItemId, amount: e.amountPaise });
          }

          const curAmount = allocInputs.reduce((s, a) => s + a.amount, 0);
          seq++;
          currentMonthPayment = await tx.payment.create({
            data: {
              studentFeeId: fee.id, studentId,
              amount: curAmount, paymentMethod: paymentMethod || 'CASH',
              receiptNumber: `${receiptBase}-${seq}`,
              reference, note, recordedById: userId,
            },
          });
          for (const a of allocInputs) {
            await tx.paymentHeadAllocation.create({
              data: {
                paymentId: currentMonthPayment.id,
                studentFeeId: fee.id,
                feeHeadId: a.feeHeadId || null,
                feeExtraItemId: a.feeExtraItemId || null,
                amount: a.amount,
              },
            });
          }
          createdPayments.push(currentMonthPayment);

          const extraSum = fee.extraItems.reduce((s, e2) => s + e2.amount, 0);
          const newPaid = fee.paidAmount + curAmount;
          const feeTotalDue = fee.netAmount + extraSum;
          const newStatus = newPaid >= feeTotalDue ? (newPaid > feeTotalDue ? 'OVERPAID' : 'PAID') : 'PARTIAL';
          await tx.studentFee.update({
            where: { id: fee.id },
            data: { paidAmount: newPaid, status: newStatus, paidAt: newStatus === 'PAID' ? new Date() : undefined },
          });
        }

        return createdPayments;
      });
    }, 'RCP');
    payments = result.result;
    receiptNumber = result.receiptNumber;
  } catch (allocErr: any) {
    if (allocErr.statusCode === 400) {
      res.status(400).json({ success: false, message: allocErr.message });
      return;
    }
    throw allocErr;
  }

  // Receipt snapshot — same shape as waterfall's, plus a per-head/per-extra
  // paid-vs-due breakdown for the current month (this is the thing that
  // was previously just a sticker price on the receipt; now it reflects
  // what was actually selected and paid in this transaction).
  const studentData = await prisma.student.findUnique({
    where: { id: studentId },
    select: { name: true, rollNumber: true, group: { select: { name: true, section: true } }, parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } } },
  });
  const father = studentData?.parents?.find((p: any) => p.parent?.relation === 'Father');
  const fatherName = father?.parent?.user?.name || father?.parent?.phone || null;
  const studentClass = [studentData?.group?.name, studentData?.group?.section].filter(Boolean).join(' — ') || '—';

  const touchedFeeIds = new Set(payments.map((p: any) => p.studentFeeId));
  const touchedFees = await prisma.studentFee.findMany({
    where: { id: { in: Array.from(touchedFeeIds) } },
    include: { extraItems: true },
  });
  const currentFee = curStudentFeeId ? touchedFees.find(f => f.id === curStudentFeeId) : undefined;
  const sortedTouched = [...touchedFees].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const latestFee = currentFee || sortedTouched[0];

  const otherFees = await prisma.studentFee.findMany({
    where: { studentId, id: { notIn: Array.from(touchedFeeIds) } },
    include: { extraItems: { select: { amount: true } } },
  });
  let previousBalance = 0;
  let prevMonthsCount = 0;
  for (const f of otherFees) {
    const fe = f.extraItems.reduce((s, e) => s + e.amount, 0);
    const due = f.netAmount + fe - f.paidAmount;
    if (due > 0) { previousBalance += due; prevMonthsCount++; }
  }

  const monthLabel = latestFee
    ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(latestFee.month || 1) - 1] + ' ' + (latestFee.year || ''))
    : 'Allocated Payment';

  // Per-head/extra paid-vs-due for the current month — use remaining due
  // BEFORE this payment, not full sticker prices (critical for 2nd+ partial
  // payments where MonthlyFee/PaperFund are already cleared).
  const curPaymentOnCurrent = curStudentFeeId
    ? payments.filter((p: any) => p.studentFeeId === curStudentFeeId).reduce((s, p) => s + p.amount, 0)
    : 0;
  const headBreakdownForReceipt = curStudentFeeId && currentFee
    ? ((currentFee.feeHeadBreakdown as any[]) || [])
    : [];

  let priorHeadPaid = new Map<string, number>();
  if (curStudentFeeId) {
    const allPriorAllocs = await prisma.paymentHeadAllocation.findMany({
      where: { studentFeeId: curStudentFeeId, revertedAt: null },
      select: { feeHeadId: true, feeExtraItemId: true, amount: true, paymentId: true },
    });
    const thisPaymentIds = new Set(payments.map((p: any) => p.id));
    for (const a of allPriorAllocs) {
      if (thisPaymentIds.has(a.paymentId)) continue;
      if (a.feeHeadId) {
        priorHeadPaid.set(`h:${a.feeHeadId}`, (priorHeadPaid.get(`h:${a.feeHeadId}`) || 0) + a.amount);
      } else if (a.feeExtraItemId) {
        priorHeadPaid.set(`e:${a.feeExtraItemId}`, (priorHeadPaid.get(`e:${a.feeExtraItemId}`) || 0) + a.amount);
      }
    }
  }

  const cmHeads: { name: string; amountPaise: number; paidPaise?: number }[] = [];
  if (curStudentFeeId && currentFee) {
    for (const b of headBreakdownForReceipt) {
      const headKey = b.feeHeadId ? `h:${b.feeHeadId}` : `n:${b.name}`;
      const paidBefore = priorHeadPaid.get(headKey) || 0;
      const dueBefore = Math.max(0, (b.amount || 0) - paidBefore);
      const selected = curHeads.find((h: any) => (h.feeHeadId && h.feeHeadId === b.feeHeadId) || (h.headName && h.headName === b.name));
      const paidThis = selected?.amountPaise || 0;
      if (dueBefore > 0 || paidThis > 0) {
        cmHeads.push({ name: b.name, amountPaise: dueBefore > 0 ? dueBefore : (b.amount || 0), paidPaise: paidThis });
      }
    }
  }
  const cmExtras = curStudentFeeId && currentFee
    ? curExtras.map((e: any) => {
        const def = currentFee.extraItems.find(ei => ei.id === e.feeExtraItemId);
        const paidBefore = priorHeadPaid.get(`e:${e.feeExtraItemId}`) || 0;
        const dueBefore = Math.max(0, (def?.amount || 0) - paidBefore);
        return { name: def?.name || 'Extra', amountPaise: dueBefore > 0 ? dueBefore : (def?.amount || 0), paidPaise: e.amountPaise };
      })
    : [];
  const currentStickerTotal = currentFee ? (currentFee.netAmount + currentFee.extraItems.reduce((s, e) => s + e.amount, 0)) : 0;
  const currentRemainingBefore = currentFee
    ? Math.max(0, currentStickerTotal - (currentFee.paidAmount - curPaymentOnCurrent))
    : 0;
  const totalDueBefore = previousBalance + currentRemainingBefore;
  // touchedFees were re-fetched AFTER the transaction committed, so their
  // paidAmount already reflects this payment — remaining due on them, plus
  // whatever's still owed on untouched fees (previousBalance), is the true
  // post-payment balance.
  const touchedRemaining = touchedFees.reduce((s, f) => s + Math.max(0, (f.netAmount + f.extraItems.reduce((se, e) => se + e.amount, 0)) - f.paidAmount), 0);
  const balanceAfter = previousBalance + touchedRemaining;

  const allocationLabels = payments.map((p: any) => {
    const f = touchedFees.find(tf => tf.id === p.studentFeeId);
    const label = f ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(f.month || 1) - 1] + ' ' + (f.year || '')) : 'Allocation';
    return { label, amountPaise: p.amount };
  });

  try {
    await createReceiptSnapshot(
      payments[0]?.id || 'unknown', receiptNumber,
      {
        amountPaidPaise: amountPaidPaise,
        currentMonthLabel: monthLabel,
        currentMonthHeads: cmHeads,
        currentMonthExtras: cmExtras,
        previousBalancePaise: previousBalance,
        previousMonthsCount: prevMonthsCount,
        allocations: allocationLabels,
        totalDuePaise: totalDueBefore,
        balanceAfterPaise: Math.max(0, balanceAfter),
        paymentMethod: paymentMethod || 'CASH',
        reference: reference || null,
        studentName: studentData?.name || '',
        studentClass,
        studentRoll: studentData?.rollNumber || null,
        fatherName,
        isFullyPaid: balanceAfter <= 0,
      },
      userId,
    );
  } catch (snapErr) {
    console.error('Receipt snapshot creation failed (allocate):', (snapErr as Error).message);
  }

  res.status(201).json({
    success: true,
    data: {
      receiptNumber,
      totalAmount: amountPaidPaise,
      payments: payments.map((p: any) => ({ id: p.id, studentFeeId: p.studentFeeId, amount: p.amount, receiptNumber: p.receiptNumber })),
    },
  });
}));

// POST /admin/payments/:id/revert — Revert a payment
router.post('/payments/:id/revert', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body;
  if (!reason) { res.status(400).json({ success: false, message: 'Revert reason is required' }); return; }
  const userId = (req as any).user?.id;

  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) { res.status(404).json({ success: false, message: 'Payment not found' }); return; }
  if (payment.revertedAt) { res.status(400).json({ success: false, message: 'Payment already reverted' }); return; }

  // Revert the payment
  await prisma.payment.update({
    where: { id: req.params.id },
    data: { revertedAt: new Date(), revertedById: userId, revertReason: reason },
  });

  // Recalculate StudentFee
  const allPayments = await prisma.payment.aggregate({
    where: { studentFeeId: payment.studentFeeId, revertedAt: null },
    _sum: { amount: true },
  });
  const paidAmount = allPayments._sum.amount || 0;
  const studentFee = await prisma.studentFee.findUnique({
    where: { id: payment.studentFeeId },
    include: { extraItems: { select: { amount: true } } },
  });
  const revertExtraSum = (studentFee as any)?.extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0;
  const revertTotalDue = (studentFee?.netAmount || 0) + revertExtraSum;
  let status = 'UNPAID';
  if (paidAmount > 0) status = paidAmount >= revertTotalDue ? 'PAID' : 'PARTIAL';

  await prisma.studentFee.update({
    where: { id: payment.studentFeeId },
    data: { paidAmount, status },
  });

  // Audit log: REVERTED
  await prisma.paymentAuditLog.create({
    data: {
      paymentId: payment.id,
      action: 'REVERTED',
      previousValue: { amount: payment.amount, receiptNumber: payment.receiptNumber, reason },
      performedById: userId,
    },
  });

  res.json({ success: true, data: { reverted: payment.id, status } });
}));

// GET /admin/payments/:id/receipt — Fetch receipt snapshot for a payment
router.get('/payments/:id/receipt', asyncHandler(async (req: Request, res: Response) => {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { paymentId: req.params.id },
  });
  if (!receipt) {
    // No snapshot yet — frontend will fall back to live computation
    res.status(404).json({ success: false, message: 'No receipt snapshot found' });
    return;
  }
  res.json({ success: true, data: receipt });
}));

// POST /admin/payments/:id/print-receipt — Track print event
router.post('/payments/:id/print-receipt', asyncHandler(async (req: Request, res: Response) => {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { paymentId: req.params.id },
  });
  if (!receipt) { res.status(404).json({ success: false, message: 'No receipt snapshot' }); return; }
  const updated = await prisma.paymentReceipt.update({
    where: { id: receipt.id },
    data: {
      printedAt: receipt.printedAt || new Date(),
      printCount: { increment: 1 },
    },
  });
  res.json({ success: true, data: { printCount: updated.printCount } });
}));

// POST /admin/payments/:id/audit-log — Record audit event for a payment
router.post('/payments/:id/audit-log', asyncHandler(async (req: Request, res: Response) => {
  const { action, ipAddress, userAgent } = req.body;
  const validActions = ['CREATED', 'REVERTED', 'REPRINTED', 'DOWNLOADED', 'MODIFIED'];
  if (!action || !validActions.includes(action)) {
    res.status(400).json({ success: false, message: `Action must be one of: ${validActions.join(', ')}` });
    return;
  }
  const userId = (req as any).user?.id;
  const log = await prisma.paymentAuditLog.create({
    data: {
      paymentId: req.params.id,
      action,
      performedById: userId,
      ipAddress,
      userAgent,
    },
  });
  res.status(201).json({ success: true, data: log });
}));

// GET /admin/payments/:id/audit-log — Get audit trail for a payment
router.get('/payments/:id/audit-log', asyncHandler(async (req: Request, res: Response) => {
  const logs = await prisma.paymentAuditLog.findMany({
    where: { paymentId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: logs });
}));

// GET /admin/payments — List payments (AY scoped)
router.get('/payments', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { studentFeeId, studentId } = req.query;
  const where: any = {
    revertedAt: null,
    studentFee: { academicYearId: scope.academicYearId },
  };
  if (studentFeeId) where.studentFeeId = studentFeeId as string;
  if (studentId) where.studentId = studentId as string;
  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { recordedBy: { select: { name: true } } },
  });
  res.json({ success: true, data: payments });
}));

// ═══════════════════════════════════════════════════════════════════
// FAMILY — CRUD + Search + Combined Payment
// ═══════════════════════════════════════════════════════════════════

// GET /admin/families/students-picker — Students available for family assignment
router.get('/families/students-picker', asyncHandler(async (req: Request, res: Response) => {
  const { search, academicYearId, excludeFamilyId } = req.query;
  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const where: any = {
    academicYearId: ayId,
    isActive: true,
    status: 'ACTIVE',
  };
  if (excludeFamilyId) {
    where.OR = [{ familyId: null }, { familyId: excludeFamilyId as string }];
  } else {
    where.familyId = null;
  }
  if (search) {
    where.AND = [{
      OR: [
        { name: { contains: search as string, mode: 'insensitive' } },
        { rollNumber: { contains: search as string, mode: 'insensitive' } },
        { admissionNumber: { contains: search as string, mode: 'insensitive' } },
      ],
    }];
  }

  const students = await prisma.student.findMany({
    where,
    select: {
      id: true,
      name: true,
      rollNumber: true,
      admissionNumber: true,
      familyId: true,
      group: { select: { name: true, section: true } },
      family: { select: { id: true, name: true } },
    },
    orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
    take: 100,
  });

  res.json({ success: true, data: students });
}));

// GET /admin/families — List or search families (family-pay search mode when `search` is set)
router.get('/families', asyncHandler(async (req: Request, res: Response) => {
  const { search, academicYearId, includeInactive, feeStatus } = req.query;
  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);

  const searchTerm = typeof search === 'string' ? search.trim() : '';
  const isSearchMode = searchTerm.length > 0;
  const statusFilter = typeof feeStatus === 'string' && feeStatus.trim() ? feeStatus.trim().toLowerCase() : '';
  const needsStatusFilter = !!statusFilter && ['paid', 'partial', 'unpaid'].includes(statusFilter);

  const resolvedAyId = ayId ?? (isSearchMode ? null : await resolveAcademicYearId(undefined));
  if (isSearchMode && !resolvedAyId) {
    res.status(400).json({ success: false, message: 'No academic year specified' });
    return;
  }

  const where: any = {};
  if (includeInactive !== 'true') where.isActive = true;

  if (isSearchMode) {
    where.OR = [
      { name: { contains: searchTerm, mode: 'insensitive' } },
      { fatherName: { contains: searchTerm, mode: 'insensitive' } },
      { phone: { contains: searchTerm } },
      { students: { some: { name: { contains: searchTerm, mode: 'insensitive' }, academicYearId: resolvedAyId!, isActive: true, status: 'ACTIVE' } } },
    ];
  }

  const families = await prisma.family.findMany({
    where,
    include: {
      students: familyStudentInclude(resolvedAyId, {
        unpaidOnly: isSearchMode && !needsStatusFilter,
        includeFees: isSearchMode || needsStatusFilter,
      }),
      _count: { select: { students: true, payments: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ name: 'asc' }],
    take: isSearchMode ? 50 : 200,
  });

  let data = families.map(f => {
    const students = (f.students || []) as any[];
    const { totalDuePaise, unpaidCount } = summarizeStudentFees(
      students.flatMap(s => s.studentFees || []),
    );
    const { students: _s, ...rest } = f;
    return {
      ...rest,
      studentCount: f._count.students,
      paymentCount: f._count.payments,
      totalDuePaise,
      unpaidFeeCount: unpaidCount,
      students: isSearchMode || needsStatusFilter ? students : undefined,
    };
  });

  // Family-pay search: only families with at least one student having unpaid fees
  if (isSearchMode) {
    data = data
      .map(f => ({
        ...f,
        students: (f.students || []).filter((s: any) => (s.studentFees?.length ?? 0) > 0),
      }))
      .filter(f => (f.students?.length ?? 0) > 0);
  }

  if (needsStatusFilter) {
    data = data
      .filter(f => (f.students || []).some((s: any) =>
        matchesFeeStatusFilter(computeStudentStatusFromFees(s.studentFees || []), statusFilter),
      ))
      .map(({ students, ...rest }) => ({
        ...rest,
        students: isSearchMode ? students : undefined,
      }));
  }

  res.json({ success: true, data });
}));

// POST /admin/families — Create family and assign students
router.post('/families', asyncHandler(async (req: Request, res: Response) => {
  const { name, fatherName, motherName, phone, address, studentIds } = req.body;
  const userId = (req as any).user?.id as string | undefined;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, message: 'Family name is required' });
    return;
  }

  const ids: string[] = Array.isArray(studentIds) ? studentIds.filter(Boolean) : [];
  if (ids.length > 0) {
    const taken = await prisma.student.findMany({
      where: { id: { in: ids }, familyId: { not: null } },
      select: { id: true, name: true, family: { select: { name: true } } },
    });
    if (taken.length > 0) {
      res.status(400).json({
        success: false,
        message: `Student(s) already in a family: ${taken.map(t => t.name).join(', ')}`,
      });
      return;
    }
  }

  const family = await prisma.$transaction(async (tx) => {
    const created = await tx.family.create({
      data: {
        name: name.trim(),
        fatherName: fatherName || null,
        motherName: motherName || null,
        phone: phone || null,
        address: address || null,
        createdById: userId,
        updatedById: userId,
      },
    });

    if (ids.length > 0) {
      await tx.student.updateMany({ where: { id: { in: ids } }, data: { familyId: created.id } });
    }

    await appendFamilyChangeLog(created.id, 'CREATED', { name: created.name, studentIds: ids }, userId ?? null, tx);
    if (ids.length > 0) {
      await appendFamilyChangeLog(created.id, 'STUDENT_ADDED', { studentIds: ids }, userId ?? null, tx);
    }

    return tx.family.findUnique({
      where: { id: created.id },
      include: {
        students: {
          select: {
            id: true, name: true, rollNumber: true,
            group: { select: { name: true, section: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
  });

  await logAudit({
    action: 'CREATE',
    module: 'fees',
    entityType: 'Family',
    entityId: family!.id,
    newValue: { name: family!.name, studentIds: ids },
  });

  res.status(201).json({ success: true, data: family });
}));

// GET /admin/families/:id — Family detail with dues and payment history
router.get('/families/:id', asyncHandler(async (req: Request, res: Response) => {
  const { academicYearId, feeStatus } = req.query;
  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }
  const statusFilter = typeof feeStatus === 'string' && feeStatus.trim() ? feeStatus.trim().toLowerCase() : '';

  const family = await prisma.family.findUnique({
    where: { id: req.params.id },
    include: {
      students: {
        where: { academicYearId: ayId, isActive: true, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          rollNumber: true,
          admissionNumber: true,
          group: { select: { name: true, section: true, displayOrder: true } },
          studentFees: {
            where: { academicYearId: ayId },
            include: {
              extraItems: true,
              headAllocations: { where: { revertedAt: null }, select: { feeHeadId: true, feeExtraItemId: true, amount: true } },
            },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
          },
        },
        orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
        take: 50,
        include: {
          recordedBy: { select: { name: true } },
          payments: {
            select: {
              id: true, amount: true, paymentMethod: true, receiptNumber: true,
              student: { select: { id: true, name: true, rollNumber: true } },
              studentFee: { select: { month: true, year: true } },
            },
          },
        },
      },
      changeLogs: {
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { changedBy: { select: { name: true } } },
      },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });

  if (!family) { res.status(404).json({ success: false, message: 'Family not found' }); return; }

  const studentSummaries = family.students.map(s => {
    const { totalDuePaise, unpaidCount } = summarizeStudentFees(s.studentFees);
    const feeStatusValue = computeStudentStatusFromFees(s.studentFees);
    return {
      id: s.id,
      name: s.name,
      rollNumber: s.rollNumber,
      admissionNumber: s.admissionNumber,
      group: s.group,
      totalDuePaise,
      unpaidFeeCount: unpaidCount,
      feeStatus: feeStatusValue,
      studentFees: s.studentFees.map(f => ({
        ...f,
        totalDuePaise: getFeeTotalDue(f),
        remainingPaise: feeRemainingPaise(f),
      })),
    };
  }).filter(s => matchesFeeStatusFilter(s.feeStatus, statusFilter));

  const totalDuePaise = studentSummaries.reduce((sum, s) => sum + s.totalDuePaise, 0);

  res.json({
    success: true,
    data: {
      ...family,
      students: studentSummaries,
      totalDuePaise,
      studentCount: studentSummaries.length,
    },
  });
}));

// PATCH /admin/families/:id — Update profile and membership
router.patch('/families/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, fatherName, motherName, phone, address, isActive, addStudentIds, removeStudentIds } = req.body;
  const userId = (req as any).user?.id as string | undefined;

  const existing = await prisma.family.findUnique({
    where: { id: req.params.id },
    include: { students: { select: { id: true } } },
  });
  if (!existing) { res.status(404).json({ success: false, message: 'Family not found' }); return; }

  const toAdd: string[] = Array.isArray(addStudentIds) ? addStudentIds.filter(Boolean) : [];
  const toRemove: string[] = Array.isArray(removeStudentIds) ? removeStudentIds.filter(Boolean) : [];

  if (toAdd.length > 0) {
    const taken = await prisma.student.findMany({
      where: {
        id: { in: toAdd },
        familyId: { not: null },
        NOT: { familyId: existing.id },
      },
      select: { id: true, name: true },
    });
    if (taken.length > 0) {
      res.status(400).json({
        success: false,
        message: `Student(s) already in another family: ${taken.map(t => t.name).join(', ')}`,
      });
      return;
    }
  }

  const profilePatch: Record<string, unknown> = {};
  if (name !== undefined) profilePatch.name = typeof name === 'string' ? name.trim() : name;
  if (fatherName !== undefined) profilePatch.fatherName = fatherName || null;
  if (motherName !== undefined) profilePatch.motherName = motherName || null;
  if (phone !== undefined) profilePatch.phone = phone || null;
  if (address !== undefined) profilePatch.address = address || null;
  if (isActive !== undefined) profilePatch.isActive = Boolean(isActive);
  profilePatch.updatedById = userId;

  const family = await prisma.$transaction(async (tx) => {
    const updated = await tx.family.update({
      where: { id: existing.id },
      data: profilePatch as any,
    });

    if (toAdd.length > 0) {
      await tx.student.updateMany({ where: { id: { in: toAdd } }, data: { familyId: existing.id } });
      await appendFamilyChangeLog(existing.id, 'STUDENT_ADDED', { studentIds: toAdd }, userId ?? null, tx);
    }
    if (toRemove.length > 0) {
      await tx.student.updateMany({
        where: { id: { in: toRemove }, familyId: existing.id },
        data: { familyId: null },
      });
      await appendFamilyChangeLog(existing.id, 'STUDENT_REMOVED', { studentIds: toRemove }, userId ?? null, tx);
    }

    if (isActive === true && !existing.isActive) {
      await appendFamilyChangeLog(existing.id, 'REACTIVATED', null, userId ?? null, tx);
    } else if (isActive === false && existing.isActive) {
      await appendFamilyChangeLog(existing.id, 'DEACTIVATED', null, userId ?? null, tx);
    } else if (Object.keys(profilePatch).length > 1) {
      await appendFamilyChangeLog(existing.id, 'UPDATED', profilePatch, userId ?? null, tx);
    }

    return tx.family.findUnique({
      where: { id: existing.id },
      include: {
        students: {
          select: {
            id: true, name: true, rollNumber: true,
            group: { select: { name: true, section: true } },
          },
        },
        updatedBy: { select: { id: true, name: true } },
      },
    });
  });

  const oldSnap = {
    name: existing.name,
    fatherName: existing.fatherName,
    motherName: existing.motherName,
    phone: existing.phone,
    address: existing.address,
    isActive: existing.isActive,
    studentIds: existing.students.map(s => s.id),
  };
  const newSnap = {
    name: family!.name,
    fatherName: family!.fatherName,
    motherName: family!.motherName,
    phone: family!.phone,
    address: family!.address,
    isActive: family!.isActive,
    studentIds: family!.students.map(s => s.id),
  };
  const { oldChanged, newChanged } = diffFields(oldSnap, newSnap);
  if (Object.keys(oldChanged).length > 0) {
    await logAudit({
      action: 'UPDATE',
      module: 'fees',
      entityType: 'Family',
      entityId: existing.id,
      oldValue: oldChanged,
      newValue: newChanged,
    });
  }

  res.json({ success: true, data: family });
}));

/** Run one student's manual allocation inside an existing transaction (shared by family allocate). */
async function executeStudentAllocInTx(
  tx: any,
  opts: {
    studentId: string;
    userId: string;
    paymentMethod: string;
    reference?: string;
    note?: string;
    prevList: { studentFeeId: string; amountPaise: number }[];
    curStudentFeeId?: string;
    curHeads: { feeHeadId?: string; headName?: string; amountPaise: number }[];
    curExtras: { feeExtraItemId: string; amountPaise: number }[];
    receiptNumber: string;
    familyPaymentId?: string;
  },
): Promise<any[]> {
  const {
    studentId, userId, paymentMethod, reference, note,
    prevList, curStudentFeeId, curHeads, curExtras, receiptNumber, familyPaymentId,
  } = opts;

  const allFeeIds = Array.from(new Set([...prevList.map(p => p.studentFeeId), ...(curStudentFeeId ? [curStudentFeeId] : [])]));
  if (allFeeIds.length === 0) return [];

  const freshFees = await tx.studentFee.findMany({
    where: { id: { in: allFeeIds }, studentId },
    include: { extraItems: true },
  });
  const feeById = new Map<string, any>(freshFees.map((f: any) => [f.id, f]));
  if (freshFees.length !== allFeeIds.length) {
    throw Object.assign(new Error('One or more selected fees do not belong to this student'), { statusCode: 400 });
  }

  const createdPayments: any[] = [];

  const sortedPrev = [...prevList].sort((a, b) => {
    const fa = feeById.get(a.studentFeeId), fb = feeById.get(b.studentFeeId);
    return ((fa?.year || 0) - (fb?.year || 0)) || ((fa?.month || 0) - (fb?.month || 0));
  });
  for (const p of sortedPrev) {
    const fee = feeById.get(p.studentFeeId);
    if (!fee) throw Object.assign(new Error('Selected previous-month fee not found'), { statusCode: 400 });
    const extraSum = (fee.extraItems || []).reduce((s: number, e: any) => s + e.amount, 0);
    const remaining = fee.netAmount + extraSum - fee.paidAmount;
    if (p.amountPaise <= 0 || p.amountPaise > remaining) {
      throw Object.assign(new Error(`Selected amount for ${fee.month}/${fee.year} exceeds its remaining due (${remaining})`), { statusCode: 400 });
    }
    const payment = await tx.payment.create({
      data: {
        studentFeeId: fee.id, studentId,
        amount: p.amountPaise, paymentMethod: paymentMethod || 'CASH',
        receiptNumber,
        reference, note, recordedById: userId,
        familyPaymentId: familyPaymentId || undefined,
      },
    });
    createdPayments.push(payment);
    const newPaid = fee.paidAmount + p.amountPaise;
    const feeTotalDue = fee.netAmount + extraSum;
    const newStatus = newPaid >= feeTotalDue ? (newPaid > feeTotalDue ? 'OVERPAID' : 'PAID') : 'PARTIAL';
    await tx.studentFee.update({
      where: { id: fee.id },
      data: { paidAmount: newPaid, status: newStatus, paidAt: newStatus === 'PAID' ? new Date() : undefined },
    });
    fee.paidAmount = newPaid;
  }

  if (curStudentFeeId && (curHeads.length > 0 || curExtras.length > 0)) {
    const fee = feeById.get(curStudentFeeId);
    if (!fee) throw Object.assign(new Error('Current month fee not found'), { statusCode: 400 });

    const priorAllocs = await tx.paymentHeadAllocation.findMany({
      where: { studentFeeId: curStudentFeeId, revertedAt: null },
    });
    const priorByHead = new Map<string, number>();
    for (const a of priorAllocs) {
      if (a.feeHeadId) priorByHead.set(`h:${a.feeHeadId}`, (priorByHead.get(`h:${a.feeHeadId}`) || 0) + a.amount);
      else if (a.feeExtraItemId) priorByHead.set(`e:${a.feeExtraItemId}`, (priorByHead.get(`e:${a.feeExtraItemId}`) || 0) + a.amount);
    }

    const headBreakdown = (fee.feeHeadBreakdown as any[]) || [];
    const allocInputs: { feeHeadId?: string; feeExtraItemId?: string; amount: number }[] = [];

    for (const h of curHeads) {
      const headDef = headBreakdown.find((b: any) =>
        (h.feeHeadId && b.feeHeadId === h.feeHeadId) || (h.headName && b.name === h.headName),
      );
      if (!headDef) throw Object.assign(new Error('Selected fee head not found on this month'), { statusCode: 400 });
      const headKey = headDef.feeHeadId ? `h:${headDef.feeHeadId}` : `n:${headDef.name}`;
      const already = priorByHead.get(headKey) || 0;
      const remaining = (headDef.amount || 0) - already;
      if (h.amountPaise <= 0 || h.amountPaise > remaining) {
        throw Object.assign(new Error(`Selected amount for head "${headDef.name}" exceeds its remaining due (${remaining})`), { statusCode: 400 });
      }
      allocInputs.push({ feeHeadId: headDef.feeHeadId || undefined, amount: h.amountPaise });
    }
    for (const e of curExtras) {
      const extraDef = fee.extraItems.find((ei: any) => ei.id === e.feeExtraItemId);
      if (!extraDef) throw Object.assign(new Error('Selected extra item not found on this month'), { statusCode: 400 });
      const already = priorByHead.get(`e:${e.feeExtraItemId}`) || 0;
      const remaining = extraDef.amount - already;
      if (e.amountPaise <= 0 || e.amountPaise > remaining) {
        throw Object.assign(new Error(`Selected amount for extra "${extraDef.name}" exceeds its remaining due (${remaining})`), { statusCode: 400 });
      }
      allocInputs.push({ feeExtraItemId: e.feeExtraItemId, amount: e.amountPaise });
    }

    const curAmount = allocInputs.reduce((s, a) => s + a.amount, 0);
    const payment = await tx.payment.create({
      data: {
        studentFeeId: fee.id, studentId,
        amount: curAmount, paymentMethod: paymentMethod || 'CASH',
        receiptNumber,
        reference, note, recordedById: userId,
        familyPaymentId: familyPaymentId || undefined,
      },
    });
    for (const a of allocInputs) {
      await tx.paymentHeadAllocation.create({
        data: {
          paymentId: payment.id,
          studentFeeId: fee.id,
          feeHeadId: a.feeHeadId || null,
          feeExtraItemId: a.feeExtraItemId || null,
          amount: a.amount,
        },
      });
    }
    createdPayments.push(payment);

    const extraSum = fee.extraItems.reduce((s: number, e2: any) => s + e2.amount, 0);
    const newPaid = fee.paidAmount + curAmount;
    const feeTotalDue = fee.netAmount + extraSum;
    const newStatus = newPaid >= feeTotalDue ? (newPaid > feeTotalDue ? 'OVERPAID' : 'PAID') : 'PARTIAL';
    await tx.studentFee.update({
      where: { id: fee.id },
      data: { paidAmount: newPaid, status: newStatus, paidAt: newStatus === 'PAID' ? new Date() : undefined },
    });
  }

  return createdPayments;
}

// POST /admin/family-payments/allocate — Family payment with per-student head allocation
router.post('/family-payments/allocate', asyncHandler(async (req: Request, res: Response) => {
  const { familyId, academicYearId, amountPaidPaise, paymentMethod, reference, note, students } = req.body;
  const userId = (req as any).user?.id;

  if (!familyId || !amountPaidPaise || amountPaidPaise <= 0) {
    res.status(400).json({ success: false, message: 'familyId and amountPaidPaise (>0) required' });
    return;
  }
  const studentList: {
    studentId: string;
    amountPaidPaise: number;
    previousMonths?: { studentFeeId: string; amountPaise: number }[];
    currentMonth?: {
      studentFeeId: string;
      heads?: { feeHeadId?: string; headName?: string; amountPaise: number }[];
      extras?: { feeExtraItemId: string; amountPaise: number }[];
    };
  }[] = Array.isArray(students) ? students : [];

  if (studentList.length === 0) {
    res.status(400).json({ success: false, message: 'At least one student allocation required' });
    return;
  }

  const ayId = await resolveAcademicYearId(academicYearId);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, isActive: true, students: { select: { id: true } } },
  });
  if (!family || !family.isActive) {
    res.status(404).json({ success: false, message: 'Family not found' });
    return;
  }
  const familyStudentIds = new Set(family.students.map(s => s.id));

  let studentsTotal = 0;
  const allFeeIds = new Set<string>();
  for (const s of studentList) {
    if (!familyStudentIds.has(s.studentId)) {
      res.status(400).json({ success: false, message: `Student ${s.studentId} is not in this family` });
      return;
    }
    const prevList = Array.isArray(s.previousMonths) ? s.previousMonths : [];
    const curHeads = s.currentMonth?.heads || [];
    const curExtras = s.currentMonth?.extras || [];
    const curStudentFeeId = s.currentMonth?.studentFeeId;
    const selectedTotal =
      prevList.reduce((sum, p) => sum + (p.amountPaise || 0), 0) +
      curHeads.reduce((sum, h) => sum + (h.amountPaise || 0), 0) +
      curExtras.reduce((sum, e) => sum + (e.amountPaise || 0), 0);
    if (selectedTotal !== s.amountPaidPaise) {
      res.status(400).json({ success: false, message: `Student ${s.studentId}: selected total (${selectedTotal}) does not match amount (${s.amountPaidPaise})` });
      return;
    }
    studentsTotal += s.amountPaidPaise;
    prevList.forEach(p => allFeeIds.add(p.studentFeeId));
    if (curStudentFeeId) allFeeIds.add(curStudentFeeId);
  }
  if (studentsTotal !== amountPaidPaise) {
    res.status(400).json({ success: false, message: `Student totals (${studentsTotal}) do not match family amount (${amountPaidPaise})` });
    return;
  }

  let familyPayment: any;
  let allPayments: any[] = [];
  let receiptNumber = '';

  try {
    const result = await generateFamilyReceiptNumber(async (fmpBase) => {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "student_fees" WHERE id = ANY(${Array.from(allFeeIds)}) FOR UPDATE`;

        const fp = await tx.familyPayment.create({
          data: {
            familyId,
            academicYearId: ayId,
            receiptNumber: fmpBase,
            totalAmount: amountPaidPaise,
            paymentMethod: paymentMethod || 'CASH',
            reference: reference || null,
            recordedById: userId,
          },
        });

        const batchPayments: any[] = [];
        let seq = 0;
        for (const s of studentList) {
          const prevList = Array.isArray(s.previousMonths) ? s.previousMonths : [];
          const curHeads = s.currentMonth?.heads || [];
          const curExtras = s.currentMonth?.extras || [];
          const curStudentFeeId = s.currentMonth?.studentFeeId;

          for (const p of prevList) {
            seq++;
            const created = await executeStudentAllocInTx(tx, {
              studentId: s.studentId,
              userId,
              paymentMethod: paymentMethod || 'CASH',
              reference,
              note,
              prevList: [p],
              curHeads: [],
              curExtras: [],
              receiptNumber: `${fmpBase}-${seq}`,
              familyPaymentId: fp.id,
            });
            batchPayments.push(...created);
          }

          if (curStudentFeeId && (curHeads.length > 0 || curExtras.length > 0)) {
            seq++;
            const created = await executeStudentAllocInTx(tx, {
              studentId: s.studentId,
              userId,
              paymentMethod: paymentMethod || 'CASH',
              reference,
              note,
              prevList: [],
              curStudentFeeId,
              curHeads,
              curExtras,
              receiptNumber: `${fmpBase}-${seq}`,
              familyPaymentId: fp.id,
            });
            batchPayments.push(...created);
          }
        }

        if (batchPayments.length === 0) {
          throw Object.assign(new Error('No valid payments in batch'), { statusCode: 400 });
        }

        return { familyPayment: fp, payments: batchPayments, receiptNumber: fmpBase };
      });
    });

    familyPayment = result.result.familyPayment;
    allPayments = result.result.payments;
    receiptNumber = result.receiptNumber;
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message || 'Family allocation payment failed' });
    return;
  }

  for (const cp of allPayments) {
    try {
      const sf = await prisma.studentFee.findUnique({
        where: { id: cp.studentFeeId },
        select: {
          month: true, year: true, netAmount: true, paidAmount: true, academicYearId: true,
          feeHeadBreakdown: true,
          extraItems: { select: { name: true, amount: true } },
          student: {
            select: {
              name: true, rollNumber: true,
              group: { select: { name: true, section: true } },
              parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } },
            },
          },
        },
      });
      if (!sf) continue;
      const father = (sf.student as any)?.parents?.find((p: any) => p.parent?.relation === 'Father');
      const fName = father?.parent?.user?.name || father?.parent?.phone || null;
      const sClass = [(sf.student as any)?.group?.name, (sf.student as any)?.group?.section].filter(Boolean).join(' — ') || '—';
      const mLabel = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(sf.month || 1) - 1] + ' ' + (sf.year || '');
      const cHeads = ((sf.feeHeadBreakdown as any[]) || []).map((h: any) => ({ name: h.name, amountPaise: h.amount || 0 }));
      const cExtras = (sf.extraItems || []).map((e: any) => ({ name: e.name, amountPaise: e.amount || 0 }));
      const feeTotal = getFeeTotalDue(sf);
      const otherFees = await prisma.studentFee.findMany({
        where: { studentId: cp.studentId, academicYearId: sf.academicYearId, id: { not: cp.studentFeeId } },
        include: { extraItems: { select: { amount: true } } },
      });
      let prevBal = 0;
      let prevCnt = 0;
      for (const o of otherFees) {
        const od = getFeeTotalDue(o) - (o.paidAmount || 0);
        if (od > 0) { prevBal += od; prevCnt++; }
      }
      await createReceiptSnapshot(
        cp.id, cp.receiptNumber,
        {
          amountPaidPaise: cp.amount,
          currentMonthLabel: mLabel,
          currentMonthHeads: cHeads,
          currentMonthExtras: cExtras,
          previousBalancePaise: prevBal,
          previousMonthsCount: prevCnt,
          totalDuePaise: feeTotal + prevBal,
          balanceAfterPaise: Math.max(0, feeTotal - cp.amount + prevBal),
          paymentMethod: cp.paymentMethod || 'CASH',
          reference: cp.reference || null,
          studentName: (sf.student as any)?.name || '',
          studentClass: sClass,
          studentRoll: (sf.student as any)?.rollNumber || null,
          fatherName: fName,
          isFullyPaid: cp.amount >= feeTotal,
        },
        userId,
      );
    } catch (snapErr) {
      console.error('Family allocate snapshot failed:', (snapErr as Error).message);
    }
  }

  try {
    await createFamilyReceiptSnapshot(familyPayment.id, userId);
  } catch (famSnapErr) {
    console.error('Family receipt snapshot failed:', (famSnapErr as Error).message);
  }

  res.status(201).json({
    success: true,
    data: {
      familyPayment,
      receiptNumber,
      totalAmount: amountPaidPaise,
      paymentCount: allPayments.length,
      payments: allPayments.map(p => ({ id: p.id, studentId: p.studentId, studentFeeId: p.studentFeeId, amount: p.amount, receiptNumber: p.receiptNumber })),
    },
  });
}));

// POST /admin/family-payments — Record combined sibling payment
router.post('/family-payments', asyncHandler(async (req: Request, res: Response) => {
  const { familyId, payments, academicYearId } = req.body;
  if (!familyId || !payments || !Array.isArray(payments) || payments.length === 0) {
    res.status(400).json({ success: false, message: 'familyId and payments[] required' });
    return;
  }
  const userId = (req as any).user?.id;
  const ayId = await resolveAcademicYearId(academicYearId);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  let totalAmount = 0;
  let createdPayments: any[] = [];
  let familyPayment: any;
  let receiptNumber = '';

  try {
    const result = await generateFamilyReceiptNumber(async (rn) => {
      return prisma.$transaction(async (tx) => {
        const feeIds = payments.map((p: any) => p.studentFeeId);
        await tx.$queryRaw`SELECT id FROM "student_fees" WHERE id = ANY(${feeIds}) FOR UPDATE`;

        const freshFees = await tx.studentFee.findMany({
          where: { id: { in: feeIds }, academicYearId: ayId },
          include: { extraItems: true },
        });
        if (freshFees.length !== feeIds.length) {
          throw Object.assign(new Error('One or more fees do not belong to the selected academic year'), { statusCode: 400 });
        }
        const feeById = new Map(freshFees.map(f => [f.id, f]));

        const batchPayments: any[] = [];
        let batchTotal = 0;

        for (const p of payments) {
          const studentFee = feeById.get(p.studentFeeId);
          if (!studentFee || !p.amount || p.amount <= 0) continue;

          const totalDue = getFeeTotalDue(studentFee);
          const remaining = totalDue - studentFee.paidAmount;
          if (remaining <= 0) {
            throw Object.assign(new Error(`Fee ${p.studentFeeId} is already fully paid`), { statusCode: 400 });
          }

          const payment = await tx.payment.create({
            data: {
              studentFeeId: p.studentFeeId,
              studentId: p.studentId || studentFee.studentId,
              amount: p.amount,
              paymentMethod: p.paymentMethod || 'CASH',
              receiptNumber: `${rn}-${batchPayments.length + 1}`,
              reference: p.reference,
              note: p.note,
              recordedById: userId,
            },
          });
          batchPayments.push(payment);
          batchTotal += p.amount;

          const allP = await tx.payment.aggregate({
            where: { studentFeeId: p.studentFeeId, revertedAt: null },
            _sum: { amount: true },
          });
          const paidAmount = allP._sum.amount || 0;
          const status = computeFeeStatus(paidAmount, totalDue);
          await tx.studentFee.update({
            where: { id: p.studentFeeId },
            data: { paidAmount, status, paidAt: status === 'PAID' ? new Date() : undefined },
          });
        }

        if (batchPayments.length === 0) {
          throw Object.assign(new Error('No valid payments in batch'), { statusCode: 400 });
        }

        const fp = await tx.familyPayment.create({
          data: {
            familyId,
            academicYearId: ayId,
            receiptNumber: rn,
            totalAmount: batchTotal,
            recordedById: userId,
            payments: { connect: batchPayments.map(p => ({ id: p.id })) },
          },
          include: { payments: true, family: { select: { fatherName: true, phone: true } } },
        });

        return { familyPayment: fp, createdPayments: batchPayments, totalAmount: batchTotal, receiptNumber: rn };
      });
    });

    familyPayment = result.result.familyPayment;
    createdPayments = result.result.createdPayments;
    totalAmount = result.result.totalAmount;
    receiptNumber = result.receiptNumber;
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message || 'Family payment failed' });
    return;
  }

  for (const cp of createdPayments) {
    try {
      const sf = await prisma.studentFee.findUnique({
        where: { id: cp.studentFeeId },
        select: {
          month: true, year: true, netAmount: true, paidAmount: true, academicYearId: true,
          feeHeadBreakdown: true,
          extraItems: { select: { name: true, amount: true } },
          student: {
            select: {
              name: true, rollNumber: true,
              group: { select: { name: true, section: true } },
              parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } },
            },
          },
        },
      });
      if (!sf) continue;
      const father = (sf.student as any)?.parents?.find((p: any) => p.parent?.relation === 'Father');
      const fName = father?.parent?.user?.name || father?.parent?.phone || null;
      const sClass = [(sf.student as any)?.group?.name, (sf.student as any)?.group?.section].filter(Boolean).join(' — ') || '—';
      const mLabel = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(sf.month || 1) - 1] + ' ' + (sf.year || '');
      const cHeads = ((sf.feeHeadBreakdown as any[]) || []).map((h: any) => ({ name: h.name, amountPaise: h.amount || 0 }));
      const cExtras = (sf.extraItems || []).map((e: any) => ({ name: e.name, amountPaise: e.amount || 0 }));
      const feeTotal = getFeeTotalDue(sf);
      const otherFees = await prisma.studentFee.findMany({
        where: { studentId: cp.studentId, academicYearId: sf.academicYearId, id: { not: cp.studentFeeId } },
        include: { extraItems: { select: { amount: true } } },
      });
      let prevBal = 0;
      let prevCnt = 0;
      for (const o of otherFees) {
        const od = getFeeTotalDue(o) - (o.paidAmount || 0);
        if (od > 0) { prevBal += od; prevCnt++; }
      }
      await createReceiptSnapshot(
        cp.id, cp.receiptNumber,
        {
          amountPaidPaise: cp.amount,
          currentMonthLabel: mLabel,
          currentMonthHeads: cHeads,
          currentMonthExtras: cExtras,
          previousBalancePaise: prevBal,
          previousMonthsCount: prevCnt,
          totalDuePaise: feeTotal + prevBal,
          balanceAfterPaise: Math.max(0, feeTotal - cp.amount + prevBal),
          paymentMethod: cp.paymentMethod || 'CASH',
          reference: cp.reference || null,
          studentName: (sf.student as any)?.name || '',
          studentClass: sClass,
          studentRoll: (sf.student as any)?.rollNumber || null,
          fatherName: fName,
          isFullyPaid: cp.amount >= feeTotal,
        },
        userId,
      );
    } catch (snapErr) {
      console.error('Family payment snapshot failed:', (snapErr as Error).message);
    }
  }

  try {
    await createFamilyReceiptSnapshot(familyPayment.id, userId);
  } catch (famSnapErr) {
    console.error('Family receipt snapshot failed:', (famSnapErr as Error).message);
  }

  res.status(201).json({ success: true, data: { familyPayment, receiptNumber, totalAmount, paymentCount: createdPayments.length } });
}));

// GET /admin/family-payments/:id/receipt — Combined family receipt snapshot
router.get('/family-payments/:id/receipt', asyncHandler(async (req: Request, res: Response) => {
  const receipt = await prisma.familyPaymentReceipt.findUnique({
    where: { familyPaymentId: req.params.id },
  });
  if (!receipt) {
    res.status(404).json({ success: false, message: 'No family receipt snapshot found' });
    return;
  }
  res.json({ success: true, data: receipt });
}));

// POST /admin/family-payments/:id/print-receipt — Track family receipt print
router.post('/family-payments/:id/print-receipt', asyncHandler(async (req: Request, res: Response) => {
  const receipt = await prisma.familyPaymentReceipt.findUnique({
    where: { familyPaymentId: req.params.id },
  });
  if (!receipt) { res.status(404).json({ success: false, message: 'No family receipt snapshot' }); return; }
  const updated = await prisma.familyPaymentReceipt.update({
    where: { id: receipt.id },
    data: {
      printedAt: receipt.printedAt || new Date(),
      printCount: { increment: 1 },
    },
  });
  res.json({ success: true, data: { printCount: updated.printCount } });
}));

// GET /admin/family-payments/:id — Get family payment detail (for receipt)
router.get('/family-payments/:id', asyncHandler(async (req: Request, res: Response) => {
  const fp = await prisma.familyPayment.findUnique({
    where: { id: req.params.id },
    include: {
      payments: {
        include: {
          studentFee: { select: { month: true, year: true, totalAmount: true } },
          student: { select: { name: true, rollNumber: true, group: { select: { name: true, section: true } } } },
        },
      },
      family: { select: { id: true, name: true, fatherName: true, phone: true, address: true } },
      recordedBy: { select: { name: true } },
    },
  });
  if (!fp) { res.status(404).json({ success: false, message: 'Not found' }); return; }
  res.json({ success: true, data: fp });
}));

// ═══════════════════════════════════════════════════════════════════
// FEE REPORTS & SUMMARY
// ═══════════════════════════════════════════════════════════════════

// GET /admin/fees/summary — Dashboard stats
router.get('/fees/summary', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId } = req.query;
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const where: any = { month: m, year: y, academicYearId: ayId };

  const allFees = await prisma.studentFee.findMany({
    where,
    select: { netAmount: true, paidAmount: true, status: true, extraItems: { select: { amount: true } } },
  });
  const totalDue = allFees.reduce((s, f) => s + f.netAmount + f.extraItems.reduce((es, e) => es + e.amount, 0), 0);
  const totalCollected = allFees.reduce((s, f) => s + f.paidAmount, 0);
  const pendingCount = allFees.filter(f => f.status === 'UNPAID' || f.status === 'PARTIAL').length;

  res.json({
    success: true,
    data: { totalDue, totalCollected, pendingCount, totalStudents: allFees.length, collectionRate: totalDue ? Math.round((totalCollected / totalDue) * 100) : 0 },
  });
}));

// GET /admin/fees/defaulter — Students overdue
router.get('/fees/defaulter', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, days, academicYearId } = req.query;
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const fees = await prisma.studentFee.findMany({
    where: { month: m, year: y, academicYearId: ayId, status: { in: ['UNPAID', 'PARTIAL'] } },
    include: { student: { select: { name: true, rollNumber: true, phone: true, group: { select: { name: true, section: true } } } } },
    orderBy: [{ netAmount: 'desc' }],
  });
  res.json({ success: true, data: fees });
}));

// GET /admin/fees/collection-report — Per-class breakdown
router.get('/fees/collection-report', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId } = req.query;
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const ayId = await resolveAcademicYearId(academicYearId as string | undefined);
  if (!ayId) { res.status(400).json({ success: false, message: 'No academic year specified' }); return; }

  const fees = await prisma.studentFee.findMany({
    where: { month: m, year: y, academicYearId: ayId },
    include: { group: { select: { name: true, section: true } } },
  });

  const classMap: Record<string, { total: number; collected: number; count: number }> = {};
  for (const f of fees) {
    const key = f.groupId || 'Unassigned';
    if (!classMap[key]) classMap[key] = { total: 0, collected: 0, count: 0 };
    classMap[key].total += f.netAmount;
    classMap[key].collected += f.paidAmount;
    classMap[key].count++;
  }

  const report = Object.entries(classMap).map(([key, d]) => ({
    groupId: key,
    total: d.total, collected: d.collected,
    pending: d.total - d.collected,
    students: d.count,
    rate: d.total ? Math.round((d.collected / d.total) * 100) : 0,
  }));

  res.json({ success: true, data: report });
}));

export default router;

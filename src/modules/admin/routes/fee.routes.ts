import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

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

// GET /admin/fee-structures — List, optionally filtered by groupId
router.get('/fee-structures', asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.query;
  const where: any = {};
  if (groupId) where.groupId = groupId as string;
  const structures = await prisma.feeStructure.findMany({
    where,
    include: { feeHead: true, group: { select: { name: true, section: true } } },
    orderBy: [{ groupId: 'asc' }, { feeHead: { name: 'asc' } }],
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
  const structure = await prisma.feeStructure.create({
    data: {
      academicYearId, groupId, feeHeadId, amount,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
  res.status(201).json({ success: true, data: structure });
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

// GET /admin/students/:id/fee — Get student with fee info
router.get('/students/:id/fee', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { name: true, section: true, displayOrder: true } },
      parents: { include: { parent: { select: { relation: true, phone: true, occupation: true, user: { select: { name: true } } } } } },
      studentFees: {
        include: { payments: { where: { revertedAt: null }, orderBy: { createdAt: 'desc' } }, extraItems: true },
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

// GET /admin/fees/students-list — All active students with their fee for given period
router.get('/fees/students-list', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, groupId, search, period } = req.query;
  const isFull = period === 'full';
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const where: any = { isActive: true, status: 'ACTIVE' };
  if (groupId) where.groupId = groupId as string;
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { rollNumber: { contains: search as string } },
    ];
  }

  const students = await prisma.student.findMany({
    where,
    select: {
      id: true, name: true, rollNumber: true, admissionNumber: true,
      groupId: true, customFeeAmount: true, concessionReason: true, feeOverrides: true,
      group: { select: { name: true, section: true, displayOrder: true } },
      parents: {
        include: {
          parent: { select: { relation: true, phone: true, user: { select: { name: true } } } },
        },
      },
      studentFees: {
        where: isFull ? {} : { month: m, year: y },
        include: { payments: { where: { revertedAt: null }, select: { id: true, amount: true, receiptNumber: true, paymentMethod: true, createdAt: true } }, extraItems: true },
      },
    },
    orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
  });

  const getExtra = (f: any) => (f.extraItems || []).reduce((s: number, e: any) => s + e.amount, 0);
  const data = students.map(s => {
    if (isFull) {
      // Aggregate all months for full AY view
      const totalFees = s.studentFees || [];
      const netAmount = totalFees.reduce((sum, f) => sum + f.netAmount, 0);
      const extraAmount = totalFees.reduce((sum, f) => sum + getExtra(f), 0);
      const totalDue = netAmount + extraAmount;
      const paidAmount = totalFees.reduce((sum, f) => sum + f.paidAmount, 0);
      const allPayments = totalFees.flatMap(f => f.payments);
      return {
        student: { ...s, studentFees: undefined },
        fee: totalFees.length > 0 ? totalFees[0] : null,
        id: 'full-ay-' + s.id,
        netAmount: totalDue,
        paidAmount,
        status: paidAmount >= totalDue ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : totalDue > 0 ? 'UNPAID' : 'NO_FEE',
        payments: allPayments,
        _monthCount: totalFees.length,
        _extraAmount: extraAmount,
      };
    }
    const mf = s.studentFees[0];
    const mfExtra = mf ? getExtra(mf) : 0;
    // Check for per-student overrides (feeOverrides or customFeeAmount)
    const sOverrides = (s as any).feeOverrides as Record<string, number> | null;
    let effectiveNet = mf ? (mf.netAmount + mfExtra) : 0;
    if (sOverrides && Object.keys(sOverrides).length > 0) {
      // Sum up overrides to get effective amount, then add extra items
      effectiveNet = Object.values(sOverrides).reduce((sum: number, v: any) => sum + (v || 0), 0) + mfExtra;
    } else if ((s as any).customFeeAmount != null) {
      effectiveNet = (s as any).customFeeAmount + mfExtra;
    }
    return {
      student: { ...s, studentFees: undefined, feeOverrides: undefined },
      fee: mf || null,
      id: mf?.id || s.id,
      netAmount: effectiveNet,
      paidAmount: mf?.paidAmount || 0,
      status: mf?.paidAmount >= effectiveNet ? 'PAID' : mf?.paidAmount > 0 ? 'PARTIAL' : effectiveNet > 0 ? 'UNPAID' : 'NO_FEE',
      payments: mf?.payments || [],
      _extraAmount: mfExtra,
    };
  });

  res.json({ success: true, data });
}));

// ═══════════════════════════════════════════════════════════════════
// STUDENT FEE GENERATION
// ═══════════════════════════════════════════════════════════════════

// GET /admin/student-fees — List with filters
router.get('/student-fees', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, status, groupId, search, academicYearId } = req.query;
  const where: any = {};
  if (month) where.month = parseInt(month as string, 10);
  if (year) where.year = parseInt(year as string, 10);
  if (status) where.status = { in: (status as string).split(',') };
  if (academicYearId) where.academicYearId = academicYearId as string;
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
  const { month, year, academicYearId, categories, headIds } = req.body;
  if (!month || !year) { res.status(400).json({ success: false, message: 'month and year required' }); return; }
  const selectedCats: string[] = categories || ['MONTHLY'];
  const selectedHeadIds: string[] | null = headIds?.length > 0 ? headIds : null;

  const ayId = academicYearId || (await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }))?.id;
  if (!ayId) { res.status(400).json({ success: false, message: 'No active academic year' }); return; }

  const students = await prisma.student.findMany({
    where: { academicYearId: ayId, isActive: true, status: 'ACTIVE' },
    select: { id: true, groupId: true, customFeeAmount: true, feeOverrides: true },
  });

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

  // For ONE_TIME fee: check if this head was already charged by
  // examining the feeHeadBreakdown of the student's existing fees.
  const oneTimeStructures = structures.filter(s => s.feeHead.category === 'ONE_TIME');
  const oneTimeCache = new Map<string, Set<string>>();

  let generated = 0, skipped = 0, updated = 0;
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
    const groupStructures = structures.filter(s => {
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
    const baseAmount = groupStructures.reduce((sum, s) => sum + s.amount, 0);
    const sOverrides = (student as any).feeOverrides as Record<string, number> | null;
    let totalAmount = baseAmount;
    let breakdown: any[] = [];

    if (sOverrides && Object.keys(sOverrides).length > 0) {
      totalAmount = Object.values(sOverrides).reduce((sum: number, v: any) => sum + (v || 0), 0);
      breakdown = groupStructures
        .filter(s => (sOverrides as any)[(s as any).feeHeadId] !== undefined)
        .map(s => ({ name: s.feeHead.name, amount: (sOverrides as any)[(s as any).feeHeadId], category: s.feeHead.category }));
    } else if ((student as any).customFeeAmount != null) {
      totalAmount = (student as any).customFeeAmount;
      breakdown = [{ name: 'Custom Fee', amount: (student as any).customFeeAmount, category: 'CUSTOM' }];
    } else {
      breakdown = groupStructures.map(s => ({ name: s.feeHead.name, amount: s.amount, category: s.feeHead.category }));
    }
    // Fallback: if breakdown is empty but total > 0, show a generic entry
    if (breakdown.length === 0 && totalAmount > 0) {
      breakdown = [{ name: 'Fee', amount: totalAmount, category: 'OTHER' }];
    }

    const existing = await prisma.studentFee.findUnique({
      where: { studentId_month_year: { studentId: student.id, month, year } },
    });

    if (existing) {
      // Update existing record if amount differs or breakdown is missing
      if (totalAmount > 0 && (totalAmount !== existing.netAmount || !(existing as any).feeHeadBreakdown)) {
        await prisma.studentFee.update({
          where: { id: existing.id },
          data: { totalAmount, netAmount: totalAmount, feeHeadBreakdown: breakdown },
        });
        updated++;
      } else {
        skipped++;
      }
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

  res.json({ success: true, data: { generated, skipped, updated, total: students.length } });
}));

// POST /admin/student-fees/recalculate — Recalculate existing StudentFee records
// Useful after fee structure amounts change, custom fee updates, or feeOverrides modification
router.post('/student-fees/recalculate', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId, studentId } = req.body;

  const ayId = academicYearId || (await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }))?.id;
  if (!ayId) { res.status(400).json({ success: false, message: 'No active academic year' }); return; }

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

    // Apply overrides (same priority as generation)
    let totalAmount: number;
    let breakdown: any[] = [];
    const fOverrides = (student as any).feeOverrides as Record<string, number> | null;
    if (fOverrides && Object.keys(fOverrides).length > 0) {
      totalAmount = Object.values(fOverrides).reduce((sum: number, v: any) => sum + (v || 0), 0);
      breakdown = effectiveStructures
        .filter(s => (fOverrides as any)[(s as any).feeHeadId] !== undefined)
        .map(s => ({ name: s.feeHead.name, amount: (fOverrides as any)[(s as any).feeHeadId], category: s.feeHead.category }));
    } else if (student.customFeeAmount != null) {
      totalAmount = student.customFeeAmount;
      breakdown = [{ name: 'Custom Fee', amount: student.customFeeAmount, category: 'CUSTOM' }];
    } else {
      totalAmount = baseAmount;
      breakdown = effectiveStructures.map(s => ({ name: s.feeHead.name, amount: s.amount, category: s.feeHead.category }));
    }
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
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const last = await prisma.payment.findFirst({
      where: { receiptNumber: { startsWith: `${prefix}-${yymm}` } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    const lastSeq = last ? parseInt(last.receiptNumber.slice(-4), 10) || 0 : 0;
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
    // Re-read fee inside the retry callback so we see the latest state
    const freshFee = await prisma.studentFee.findUnique({
      where: { id: studentFeeId },
      select: { netAmount: true, paidAmount: true },
    });
    if (!freshFee) throw new Error('Student fee not found during payment');

    return prisma.$transaction(async (tx) => {
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
  const heads = (studentFee.feeHeadBreakdown as any[]) || [];
  const snapExtras = extraItems.map((e: any) => ({ name: e.name, amount: e.amount }));

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
        // 1. Re-read fees INSIDE the transaction (sees latest committed state — concurrency guard)
        const freshFees = await tx.studentFee.findMany({
          where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] } },
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
  const cmHeads = (latestPaidFee?.feeHeadBreakdown as any[]) || [];
  const cmExtras = latestPaidFee ? ((latestPaidFee as any).extraItems || []).map((e: any) => ({ name: e.name, amount: e.amount })) : [];
  const currentTotal = latestPaidFee ? (latestPaidFee.netAmount + ((latestPaidFee as any).extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0)) : 0;
  const totalDueBefore = previousBalance + currentTotal;
  const balanceAfter = Math.max(0, totalDueBefore - amount);

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

// GET /admin/payments — List payments
router.get('/payments', asyncHandler(async (req: Request, res: Response) => {
  const { studentFeeId, studentId } = req.query;
  const where: any = {};
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
// FAMILY — Search + Combined Payment
// ═══════════════════════════════════════════════════════════════════

// GET /admin/families — Search families by father name or phone
router.get('/families', asyncHandler(async (req: Request, res: Response) => {
  const { search } = req.query;
  if (!search) { res.json({ success: true, data: [] }); return; }

  const families = await prisma.family.findMany({
    where: {
      OR: [
        { fatherName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
      ],
    },
    include: {
      students: {
        include: {
          studentFees: { where: { status: { in: ['UNPAID', 'PARTIAL'] } }, take: 5 },
          group: { select: { name: true, section: true, displayOrder: true } },
        },
      },
    },
  });
  res.json({ success: true, data: families });
}));

// POST /admin/family-payments — Record combined sibling payment
router.post('/family-payments', asyncHandler(async (req: Request, res: Response) => {
  const { familyId, payments } = req.body;
  if (!familyId || !payments || !Array.isArray(payments) || payments.length === 0) {
    res.status(400).json({ success: false, message: 'familyId and payments[] required' });
    return;
  }
  const userId = (req as any).user?.id;

  // Generate family receipt number
  const now = new Date();
  const yymm = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const count = await prisma.familyPayment.count();
  const receiptNumber = `FMP-${yymm}-${String(count + 1).padStart(4, '0')}`;

  let totalAmount = 0;
  const createdPayments: any[] = [];

  // Process each payment in the batch
  for (const p of payments) {
    const studentFee = await prisma.studentFee.findUnique({ where: { id: p.studentFeeId } });
    if (!studentFee) continue;

    const payment = await prisma.payment.create({
      data: {
        studentFeeId: p.studentFeeId,
        studentId: p.studentId || studentFee.studentId,
        amount: p.amount, paymentMethod: p.paymentMethod || 'CASH',
        receiptNumber: `${receiptNumber}-${createdPayments.length + 1}`,
        reference: p.reference, note: p.note, recordedById: userId,
      },
    });
    createdPayments.push(payment);
    totalAmount += p.amount;

    // Update StudentFee
    const allP = await prisma.payment.aggregate({
      where: { studentFeeId: p.studentFeeId, revertedAt: null },
      _sum: { amount: true },
    });
    const paidAmount = allP._sum.amount || 0;
    let status = 'PARTIAL';
    if (paidAmount >= studentFee.netAmount) status = paidAmount > studentFee.netAmount ? 'OVERPAID' : 'PAID';
    await prisma.studentFee.update({
      where: { id: p.studentFeeId },
      data: { paidAmount, status, paidAt: status === 'PAID' ? new Date() : undefined },
    });
  }

  // Create family payment record
  const familyPayment = await prisma.familyPayment.create({
    data: {
      familyId, receiptNumber, totalAmount,
      recordedById: userId,
      payments: { connect: createdPayments.map((p: any) => ({ id: p.id })) },
    },
    include: { payments: true, family: { select: { fatherName: true, phone: true } } },
  });

  // Create receipt snapshots for each child payment
  for (const cp of createdPayments) {
    try {
      const sf = await prisma.studentFee.findUnique({
        where: { id: cp.studentFeeId },
        select: { month: true, year: true, netAmount: true, paidAmount: true, feeHeadBreakdown: true, extraItems: { select: { name: true, amount: true } }, student: { select: { name: true, rollNumber: true, group: { select: { name: true, section: true } }, parents: { include: { parent: { select: { relation: true, phone: true, user: { select: { name: true } } } } } } } } },
      });
      if (!sf) continue;
      const father = (sf.student as any)?.parents?.find((p: any) => p.parent?.relation === 'Father');
      const fName = father?.parent?.user?.name || father?.parent?.phone || null;
      const sClass = [(sf.student as any)?.group?.name, (sf.student as any)?.group?.section].filter(Boolean).join(' — ') || '—';
      const mLabel = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(sf.month || 1) - 1] + ' ' + (sf.year || '');
      const cHeads = (sf.feeHeadBreakdown as any[]) || [];
      const cExtras = (sf.extraItems || []).map((e: any) => ({ name: e.name, amount: e.amount }));
      // Previous balance for this student: other unpaid fees
      const otherFees = await prisma.studentFee.findMany({
        where: { studentId: cp.studentId, id: { not: cp.studentFeeId } },
        include: { extraItems: { select: { amount: true } } },
      });
      let prevBal = 0;
      let prevCnt = 0;
      for (const o of otherFees) {
        const oe = (o as any).extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0;
        const od = (o.netAmount + oe) - (o.paidAmount || 0);
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
          totalDuePaise: sf.netAmount + (sf.extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0) + prevBal,
          balanceAfterPaise: Math.max(0, (sf.netAmount + (sf.extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0)) - cp.amount + prevBal),
          paymentMethod: cp.paymentMethod || 'CASH',
          reference: cp.reference || null,
          studentName: (sf.student as any)?.name || '',
          studentClass: sClass,
          studentRoll: (sf.student as any)?.rollNumber || null,
          fatherName: fName,
          isFullyPaid: cp.amount >= sf.netAmount + (sf.extraItems?.reduce((s: number, e: any) => s + e.amount, 0) || 0),
        },
        userId,
      );
    } catch (snapErr) {
      console.error('Family payment snapshot failed:', (snapErr as Error).message);
    }
  }

  res.status(201).json({ success: true, data: { familyPayment, receiptNumber, totalAmount, paymentCount: createdPayments.length } });
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
      family: { select: { fatherName: true, phone: true, address: true } },
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

  const where: any = { month: m, year: y };
  if (academicYearId) where.academicYearId = academicYearId as string;

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
  const { month, year, days } = req.query;
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const fees = await prisma.studentFee.findMany({
    where: { month: m, year: y, status: { in: ['UNPAID', 'PARTIAL'] } },
    include: { student: { select: { name: true, rollNumber: true, phone: true, group: { select: { name: true, section: true } } } } },
    orderBy: [{ netAmount: 'desc' }],
  });
  res.json({ success: true, data: fees });
}));

// GET /admin/fees/collection-report — Per-class breakdown
router.get('/fees/collection-report', asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = req.query;
  const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
  const y = parseInt(year as string, 10) || new Date().getFullYear();

  const fees = await prisma.studentFee.findMany({
    where: { month: m, year: y },
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

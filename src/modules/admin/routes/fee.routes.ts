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

// PUT /admin/students/:id/custom-fee — Set custom fee for a student
router.put('/students/:id/custom-fee', asyncHandler(async (req: Request, res: Response) => {
  const { customFeeAmount, concessionReason } = req.body;
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data: {
      customFeeAmount: customFeeAmount != null ? customFeeAmount : null,
      concessionReason: concessionReason || null,
    },
  });
  res.json({ success: true, data: { id: student.id, customFeeAmount: student.customFeeAmount, concessionReason: student.concessionReason } });
}));

// GET /admin/students/:id/fee — Get student with fee info
router.get('/students/:id/fee', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { name: true, section: true } },
      parents: { include: { parent: { select: { relation: true, phone: true, occupation: true, user: { select: { name: true } } } } } },
      studentFees: {
        include: { payments: { where: { revertedAt: null }, orderBy: { createdAt: 'desc' } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      },
    },
  });
  if (!student) { res.status(404).json({ success: false, message: 'Student not found' }); return; }
  res.json({ success: true, data: student });
}));

// ═══════════════════════════════════════════════════════════════════
// ALL STUDENTS WITH FEE STATUS (for Collections page)
// ═══════════════════════════════════════════════════════════════════

// GET /admin/fees/students-list — All active students with their fee for given month
router.get('/fees/students-list', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, groupId, search } = req.query;
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
      groupId: true, customFeeAmount: true, concessionReason: true,
      group: { select: { name: true, section: true } },
      parents: {
        include: {
          parent: { select: { relation: true, phone: true, user: { select: { name: true } } } },
        },
      },
      studentFees: {
        where: { month: m, year: y },
        include: { payments: { where: { revertedAt: null }, select: { id: true, amount: true, receiptNumber: true, paymentMethod: true, createdAt: true } } },
      },
    },
    orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
  });

  const data = students.map(s => ({
    student: s,
    fee: s.studentFees[0] || null,
    // Include fee fields at top level for compatibility with existing code
    id: s.studentFees[0]?.id || null,
    netAmount: s.studentFees[0]?.netAmount || 0,
    paidAmount: s.studentFees[0]?.paidAmount || 0,
    status: s.studentFees[0]?.status || 'NO_FEE',
    payments: s.studentFees[0]?.payments || [],
  }));

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
          group: { select: { name: true, section: true } },
        },
      },
      payments: { where: { revertedAt: null } },
    },
    orderBy: [{ netAmount: 'desc' }],
  });
  res.json({ success: true, data: fees });
}));

// POST /admin/student-fees/generate — Generate monthly fees for all active students
router.post('/student-fees/generate', asyncHandler(async (req: Request, res: Response) => {
  const { month, year, academicYearId } = req.body;
  if (!month || !year) { res.status(400).json({ success: false, message: 'month and year required' }); return; }

  const ayId = academicYearId || (await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }))?.id;
  if (!ayId) { res.status(400).json({ success: false, message: 'No active academic year' }); return; }

  const students = await prisma.student.findMany({
    where: { academicYearId: ayId, isActive: true, status: 'ACTIVE' },
    select: { id: true, groupId: true, customFeeAmount: true },
  });

  // Get fee structures that were effective for this month
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const structures = await prisma.feeStructure.findMany({
    where: {
      academicYearId: ayId,
      effectiveFrom: { lte: monthEnd },
      AND: [{ effectiveTo: null }, { effectiveTo: { gte: monthStart } }],
    },
  });

  let generated = 0, skipped = 0;
  for (const student of students) {
    const existing = await prisma.studentFee.findUnique({
      where: { studentId_month_year: { studentId: student.id, month, year } },
    });
    if (existing) { skipped++; continue; }

    // Find structures for this student's group
    const groupStructures = structures.filter(s => s.groupId === student.groupId);
    const baseAmount = groupStructures.reduce((sum, s) => sum + s.amount, 0);
	    const totalAmount = student.customFeeAmount ?? baseAmount;

    if (totalAmount > 0) {
      await prisma.studentFee.create({
        data: {
          academicYearId: ayId,
          studentId: student.id,
          groupId: student.groupId,
          month, year,
          totalAmount,
          netAmount: totalAmount,
        },
      });
      generated++;
    }
  }

  res.json({ success: true, data: { generated, skipped, total: students.length } });
}));

// ═══════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════

// POST /admin/payments — Record single payment
router.post('/payments', asyncHandler(async (req: Request, res: Response) => {
  const { studentFeeId, amount, paymentMethod, reference, note } = req.body;
  if (!studentFeeId || !amount || !paymentMethod) {
    res.status(400).json({ success: false, message: 'studentFeeId, amount, paymentMethod required' });
    return;
  }
  const userId = (req as any).user?.id;

  // Get the student fee
  const studentFee = await prisma.studentFee.findUnique({
    where: { id: studentFeeId },
    include: { student: { select: { id: true, name: true } } },
  });
  if (!studentFee) { res.status(404).json({ success: false, message: 'Student fee not found' }); return; }

  // Generate receipt number
  const now = new Date();
  const yymm = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const count = await prisma.payment.count({ where: { receiptNumber: { startsWith: `RCP-${yymm}` } } });
  const receiptNumber = `RCP-${yymm}-${String(count + 1).padStart(4, '0')}`;

  // Create payment in transaction
  const [payment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        studentFeeId,
        studentId: studentFee.studentId,
        amount, paymentMethod, receiptNumber,
        reference, note, recordedById: userId,
      },
    }),
  ]);

  // Update paidAmount and status on StudentFee
  const allPayments = await prisma.payment.aggregate({
    where: { studentFeeId, revertedAt: null },
    _sum: { amount: true },
  });
  const paidAmount = allPayments._sum.amount || 0;
  let status = 'PARTIAL';
  if (paidAmount >= studentFee.netAmount) status = paidAmount > studentFee.netAmount ? 'OVERPAID' : 'PAID';

  await prisma.studentFee.update({
    where: { id: studentFeeId },
    data: { paidAmount, status, paidAt: status === 'PAID' ? new Date() : undefined },
  });

  res.status(201).json({ success: true, data: { payment, receiptNumber, status } });
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
  const studentFee = await prisma.studentFee.findUnique({ where: { id: payment.studentFeeId } });
  let status = 'UNPAID';
  if (paidAmount > 0) status = paidAmount >= (studentFee?.netAmount || 0) ? 'PAID' : 'PARTIAL';

  await prisma.studentFee.update({
    where: { id: payment.studentFeeId },
    data: { paidAmount, status },
  });

  res.json({ success: true, data: { reverted: payment.id, status } });
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
          group: { select: { name: true, section: true } },
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

  const allFees = await prisma.studentFee.findMany({ where, select: { netAmount: true, paidAmount: true, status: true } });
  const totalDue = allFees.reduce((s, f) => s + f.netAmount, 0);
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

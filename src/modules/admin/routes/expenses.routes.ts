import { Router, Request, Response, NextFunction } from 'express';
import { ExpenseCategoryKind } from '@prisma/client';
import { expensesService } from '../services/expenses.service';
import { computePayrollMonth, listPayrollPayees } from '../services/payroll-calculation.service';
import { requireScope } from '../utils/scope-context';
import { notifyTeacherPayrollPayment } from '../../chat/services/system-notification.service';
import { prisma } from '../../../lib/prisma';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

function resolveBranchId(req: Request): string {
  const branchId = (req.query.branchId as string | undefined)
    || (req.body?.branchId as string | undefined)
    || ((req as any).user?.branchIds?.length === 1 ? (req as any).user.branchIds[0] : undefined);
  if (!branchId) throw { status: 400, message: 'branchId is required' };
  return branchId;
}

router.get('/expenses/summary', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.getSummary(branchId, req.query.month as string | undefined);
  res.json({ success: true, data });
}));

router.get('/expenses/vouchers', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listVouchers(branchId, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    type: req.query.type as any,
    status: req.query.status as string | undefined,
  });
  res.json({ success: true, data });
}));

router.get('/expenses/vouchers/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.getVoucher(branchId, req.params.id);
  res.json({ success: true, data });
}));

router.post('/expenses/vouchers/:id/void', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const userId = (req as any).user?.id;
  const data = await expensesService.voidPayment(branchId, req.params.id, userId, req.body?.reason);
  res.json({ success: true, data });
}));

// ─── Payroll ───────────────────────────────────────────────────────

router.get('/expenses/payroll/payees', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await listPayrollPayees(branchId);
  res.json({ success: true, data });
}));

router.get('/expenses/payroll/preview', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const salaryMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const payeeType = req.query.payeeType as 'TEACHER' | 'STAFF' | 'WORKER' | 'ALL' | undefined;
  const data = await expensesService.previewPayrollBulk(scope.branchId, salaryMonth, scope.academicYearId, {
    payeeType: payeeType || 'ALL',
    unpaidOnly: req.query.unpaidOnly === 'true',
    missingAttendanceOnly: req.query.missingAttendanceOnly === 'true',
  });
  res.json({ success: true, data, month: salaryMonth });
}));

router.post('/expenses/payroll/bulk', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const userId = (req as any).user?.id;
  const data = await expensesService.recordPayrollBulk(scope.branchId, userId, {
    ...req.body,
    academicYearId: scope.academicYearId,
  });
  for (const item of data.results ?? []) {
    if (!item.success || !item.payeeUserId) continue;
    const outgoing = await prisma.branchOutgoingPayment.findFirst({
      where: { branchId: scope.branchId, voucherNumber: item.voucherNumber },
      select: { id: true, amount: true, paymentMethod: true },
    });
    if (!outgoing) continue;
    void notifyTeacherPayrollPayment({
      teacherUserId: item.payeeUserId,
      academicYearId: scope.academicYearId,
      branchId: scope.branchId,
      outgoingPaymentId: outgoing.id,
      amountPaise: Number(outgoing.amount),
      salaryMonth: req.body.salaryMonth,
      paymentMethod: outgoing.paymentMethod,
      isBulkRun: true,
    }).catch(() => undefined);
  }
  res.status(201).json({ success: true, data });
}));

router.get('/expenses/payroll/profile/:userId', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 12;
  const data = await expensesService.getPayeePayrollProfile(
    scope.branchId,
    req.params.userId,
    scope.academicYearId,
    limit,
  );
  res.json({ success: true, data });
}));

router.get('/expenses/payroll', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const salaryMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const data = await expensesService.listPayroll(scope.branchId, salaryMonth, scope.academicYearId);
  res.json({ success: true, data, month: salaryMonth });
}));

router.get('/expenses/payroll/payee/:userId', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const salaryMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const payees = await listPayrollPayees(scope.branchId);
  const payee = payees.find((p) => p.userId === req.params.userId);
  if (!payee) {
    res.status(404).json({ success: false, message: 'Payee not found' });
    return;
  }
  const computed = await computePayrollMonth(
    scope.branchId,
    payee.userId,
    payee.payeeType,
    salaryMonth,
    scope.academicYearId,
    payee.profileSalary,
  );
  const history = await expensesService.listPayrollHistory(scope.branchId, payee.userId, salaryMonth);
  res.json({ success: true, data: { payee, ...computed, history } });
}));

router.post('/expenses/payroll', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const userId = (req as any).user?.id;
  const data = await expensesService.recordPayrollPayment(scope.branchId, userId, {
    ...req.body,
    academicYearId: scope.academicYearId,
  });
  void notifyTeacherPayrollPayment({
    teacherUserId: req.body.payeeUserId,
    academicYearId: scope.academicYearId,
    branchId: scope.branchId,
    outgoingPaymentId: data.payment.id,
    amountPaise: Number(data.payment.amount),
    salaryMonth: req.body.salaryMonth,
    paymentMethod: data.payment.paymentMethod,
    isPartial: req.body.paymentKind === 'PARTIAL',
  }).catch(() => undefined);
  res.status(201).json({ success: true, data });
}));

router.get('/expenses/payroll/history/:userId', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listPayrollHistory(
    branchId,
    req.params.userId,
    req.query.month as string | undefined,
  );
  res.json({ success: true, data });
}));

// ─── Utilities ───────────────────────────────────────────────────

router.get('/expenses/utilities/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listCategories(branchId, 'UTILITY');
  res.json({ success: true, data });
}));

router.post('/expenses/utilities/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.upsertCategory(branchId, 'UTILITY', req.body?.name, req.body?.isActive);
  res.status(201).json({ success: true, data });
}));

router.patch('/expenses/utilities/categories/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const { prisma } = await import('../../../lib/prisma');
  const current = await prisma.branchExpenseCategory.findFirst({
    where: { id: req.params.id, branchId, kind: 'UTILITY' },
  });
  if (!current) throw { status: 404, message: 'Category not found' };
  const data = await prisma.branchExpenseCategory.update({
    where: { id: req.params.id },
    data: {
      name: req.body?.name?.trim() ?? undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    },
  });
  res.json({ success: true, data });
}));

router.get('/expenses/utilities/providers', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listUtilityProviders(branchId);
  res.json({ success: true, data });
}));

router.post('/expenses/utilities/providers', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.createUtilityProvider(branchId, req.body);
  res.status(201).json({ success: true, data });
}));

router.post('/expenses/utilities/duplicate-last', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const userId = (req as any).user?.id;
  const { providerId, amount, paymentMethod } = req.body;
  if (!providerId) {
    res.status(400).json({ success: false, message: 'providerId is required' });
    return;
  }
  const data = await expensesService.duplicateLastUtilityBill(branchId, userId, providerId, {
    amount: amount != null ? Number(amount) : undefined,
    paymentMethod,
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/expenses/utilities/providers/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.updateUtilityProvider(branchId, req.params.id, req.body);
  res.json({ success: true, data });
}));

router.get('/expenses/utilities/reminders', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listUtilityReminders(branchId);
  res.json({ success: true, data });
}));

router.get('/expenses/export/payroll', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const salaryMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const data = await expensesService.exportPayrollCsv(scope.branchId, salaryMonth, scope.academicYearId);
  res.json({ success: true, data });
}));

router.get('/expenses/export/utilities', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.exportUtilitiesCsv(branchId, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });
  res.json({ success: true, data });
}));

router.get('/expenses/export/others', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.exportOthersCsv(branchId, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });
  res.json({ success: true, data });
}));

router.get('/expenses/utilities', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listUtilities(branchId, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    categoryId: req.query.categoryId as string | undefined,
  });
  res.json({ success: true, data });
}));

router.post('/expenses/utilities', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const userId = (req as any).user?.id;
  const data = await expensesService.recordUtility(branchId, userId, req.body);
  res.status(201).json({ success: true, data });
}));

// ─── Others ──────────────────────────────────────────────────────

router.get('/expenses/others/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listCategories(branchId, 'OTHER' as ExpenseCategoryKind);
  res.json({ success: true, data });
}));

router.post('/expenses/others/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.upsertCategory(branchId, 'OTHER', req.body?.name, req.body?.isActive);
  res.status(201).json({ success: true, data });
}));

router.patch('/expenses/others/categories/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const { prisma } = await import('../../../lib/prisma');
  const current = await prisma.branchExpenseCategory.findFirst({
    where: { id: req.params.id, branchId, kind: 'OTHER' },
  });
  if (!current) throw { status: 404, message: 'Category not found' };
  const data = await prisma.branchExpenseCategory.update({
    where: { id: req.params.id },
    data: {
      name: req.body?.name?.trim() ?? undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    },
  });
  res.json({ success: true, data });
}));

router.get('/expenses/others', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await expensesService.listOthers(branchId, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    categoryId: req.query.categoryId as string | undefined,
  });
  res.json({ success: true, data });
}));

router.post('/expenses/others', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const userId = (req as any).user?.id;
  const data = await expensesService.recordOther(branchId, userId, req.body);
  res.status(201).json({ success: true, data });
}));

export default router;

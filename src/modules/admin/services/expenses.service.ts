import {
  ExpenseCategoryKind,
  OutgoingPaymentMethod,
  OutgoingPaymentType,
  PayrollPaymentKind,
  PayrollPayeeType,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  computePayrollMonth,
  listPayrollPayees,
  refreshPayrollMonthBalance,
} from './payroll-calculation.service';

const DEFAULT_UTILITY_CATEGORIES = [
  'Electricity', 'Water', 'Gas', 'Internet', 'Phone / Mobile', 'Security', 'Waste',
];
const DEFAULT_OTHER_CATEGORIES = [
  'Maintenance', 'Repairs', 'Cleaning', 'Transport', 'Miscellaneous',
];

async function nextVoucherNumber(branchId: string): Promise<string> {
  const now = new Date();
  const yymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `VCH-${yymm}-`;
  const last = await prisma.branchOutgoingPayment.findFirst({
    where: { branchId, voucherNumber: { startsWith: prefix } },
    orderBy: { voucherNumber: 'desc' },
    select: { voucherNumber: true },
  });
  const seq = last ? parseInt(last.voucherNumber.slice(-4), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function ensureDefaultCategories(branchId: string, kind: ExpenseCategoryKind) {
  const names = kind === 'UTILITY' ? DEFAULT_UTILITY_CATEGORIES : DEFAULT_OTHER_CATEGORIES;
  for (const name of names) {
    await prisma.branchExpenseCategory.upsert({
      where: { branchId_kind_name: { branchId, kind, name } },
      create: { branchId, kind, name },
      update: {},
    });
  }
}

class ExpensesService {
  async getSummary(branchId: string, month?: string) {
    const m = month || new Date().toISOString().slice(0, 7);
    const from = new Date(`${m}-01T00:00:00`);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);

    const rows = await prisma.branchOutgoingPayment.groupBy({
      by: ['type'],
      where: {
        branchId,
        status: 'PAID',
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: true,
    });

    const byType: Record<string, { total: number; count: number }> = {};
    let grandTotal = 0;
    for (const r of rows) {
      const total = Number(r._sum.amount ?? 0);
      byType[r.type] = { total, count: r._count };
      grandTotal += total;
    }
    return { month: m, byType, grandTotal };
  }

  async listCategories(branchId: string, kind: ExpenseCategoryKind) {
    await ensureDefaultCategories(branchId, kind);
    return prisma.branchExpenseCategory.findMany({
      where: { branchId, kind },
      orderBy: { name: 'asc' },
    });
  }

  async upsertCategory(branchId: string, kind: ExpenseCategoryKind, name: string, isActive?: boolean) {
    const trimmed = name.trim();
    if (!trimmed) throw { status: 400, message: 'name is required' };
    return prisma.branchExpenseCategory.upsert({
      where: { branchId_kind_name: { branchId, kind, name: trimmed } },
      create: { branchId, kind, name: trimmed, isActive: isActive ?? true },
      update: { isActive: typeof isActive === 'boolean' ? isActive : undefined },
    });
  }

  async listUtilityProviders(branchId: string) {
    return prisma.utilityProvider.findMany({
      where: { branchId, isActive: true },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createUtilityProvider(branchId: string, data: {
    categoryId: string;
    name: string;
    consumerNumber?: string;
    contactNumber?: string;
    note?: string;
  }) {
    const name = data.name.trim();
    if (!name || !data.categoryId) throw { status: 400, message: 'name and categoryId are required' };
    return prisma.utilityProvider.create({
      data: {
        branchId,
        categoryId: data.categoryId,
        name,
        consumerNumber: data.consumerNumber?.trim() || null,
        contactNumber: data.contactNumber?.trim() || null,
        note: data.note?.trim() || null,
      },
    });
  }

  async listPayroll(branchId: string, salaryMonth: string, academicYearId: string) {
    const payees = await listPayrollPayees(branchId);
    const results = [];
    for (const p of payees) {
      const computed = await computePayrollMonth(
        branchId, p.userId, p.payeeType, salaryMonth, academicYearId, p.profileSalary,
      );
      results.push({
        ...p,
        ...computed.summary,
        balanceId: computed.balance.id,
      });
    }
    return results;
  }

  async recordPayrollPayment(
    branchId: string,
    recordedById: string,
    input: {
      payeeUserId: string;
      salaryMonth: string;
      amount: number;
      paymentMethod: OutgoingPaymentMethod;
      paymentKind?: PayrollPaymentKind;
      reference?: string;
      note?: string;
      paidAt?: string;
      academicYearId: string;
    },
  ) {
    if (!input.payeeUserId || !input.salaryMonth || !input.amount || input.amount <= 0) {
      throw { status: 400, message: 'payeeUserId, salaryMonth, and amount (>0) are required' };
    }

    const payees = await listPayrollPayees(branchId);
    const payee = payees.find((p) => p.userId === input.payeeUserId);
    if (!payee) throw { status: 404, message: 'Payee not found in branch payroll list' };

    const computed = await computePayrollMonth(
      branchId,
      payee.userId,
      payee.payeeType,
      input.salaryMonth,
      input.academicYearId,
      payee.profileSalary,
    );

    const voucherNumber = await nextVoucherNumber(branchId);
    const paymentKind = input.paymentKind ?? 'REGULAR';

    const payment = await prisma.$transaction(async (tx) => {
      const header = await tx.branchOutgoingPayment.create({
        data: {
          branchId,
          type: 'PAYROLL',
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          voucherNumber,
          recordedById,
        },
      });
      await tx.payrollPaymentDetail.create({
        data: {
          outgoingPaymentId: header.id,
          payeeUserId: payee.userId,
          payeeType: payee.payeeType,
          salaryMonth: input.salaryMonth,
          paymentKind,
          profileSalary: payee.profileSalary,
          attendanceEarned: computed.summary.attendanceEarned,
          openingBalance: computed.summary.openingBalance,
        },
      });
      return header;
    });

    const refreshed = await refreshPayrollMonthBalance(branchId, payee.userId, input.salaryMonth);
    return { payment, summary: refreshed.summary, voucherNumber };
  }

  async listPayrollHistory(branchId: string, payeeUserId: string, salaryMonth?: string) {
    return prisma.payrollPaymentDetail.findMany({
      where: {
        payeeUserId,
        ...(salaryMonth ? { salaryMonth } : {}),
        outgoingPayment: { branchId },
      },
      include: {
        outgoingPayment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listUtilities(branchId: string, opts?: { from?: string; to?: string; categoryId?: string }) {
    const where: any = { branchId, type: 'UTILITY', status: 'PAID' };
    if (opts?.from || opts?.to) {
      where.paidAt = {};
      if (opts.from) where.paidAt.gte = new Date(opts.from);
      if (opts.to) where.paidAt.lte = new Date(`${opts.to}T23:59:59`);
    }
    return prisma.branchOutgoingPayment.findMany({
      where,
      include: {
        utilityDetail: { include: { category: true, provider: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  async recordUtility(
    branchId: string,
    recordedById: string,
    input: {
      categoryId: string;
      providerId?: string;
      providerName: string;
      amount: number;
      paymentMethod: OutgoingPaymentMethod;
      paymentKind?: PayrollPaymentKind;
      consumerNumber?: string;
      billReference?: string;
      periodStart?: string;
      periodEnd?: string;
      dueDate?: string;
      reference?: string;
      note?: string;
      paidAt?: string;
    },
  ) {
    if (!input.categoryId || !input.providerName?.trim() || !input.amount || input.amount <= 0) {
      throw { status: 400, message: 'categoryId, providerName, and amount (>0) are required' };
    }
    const voucherNumber = await nextVoucherNumber(branchId);
    return prisma.$transaction(async (tx) => {
      const header = await tx.branchOutgoingPayment.create({
        data: {
          branchId,
          type: 'UTILITY',
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          voucherNumber,
          recordedById,
        },
      });
      await tx.utilityBillDetail.create({
        data: {
          outgoingPaymentId: header.id,
          categoryId: input.categoryId,
          providerId: input.providerId || null,
          providerName: input.providerName.trim(),
          consumerNumber: input.consumerNumber?.trim() || null,
          billReference: input.billReference?.trim() || null,
          periodStart: input.periodStart ? new Date(input.periodStart) : null,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          paymentKind: input.paymentKind ?? 'REGULAR',
        },
      });
      return header;
    });
  }

  async listOthers(branchId: string, opts?: { from?: string; to?: string; categoryId?: string }) {
    const where: any = { branchId, type: 'OTHER', status: 'PAID' };
    if (opts?.from || opts?.to) {
      where.paidAt = {};
      if (opts.from) where.paidAt.gte = new Date(opts.from);
      if (opts.to) where.paidAt.lte = new Date(`${opts.to}T23:59:59`);
    }
    return prisma.branchOutgoingPayment.findMany({
      where,
      include: {
        otherDetail: { include: { category: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  async recordOther(
    branchId: string,
    recordedById: string,
    input: {
      categoryId: string;
      payeeName: string;
      amount: number;
      paymentMethod: OutgoingPaymentMethod;
      paymentKind?: PayrollPaymentKind;
      description?: string;
      reference?: string;
      note?: string;
      paidAt?: string;
    },
  ) {
    if (!input.categoryId || !input.payeeName?.trim() || !input.amount || input.amount <= 0) {
      throw { status: 400, message: 'categoryId, payeeName, and amount (>0) are required' };
    }
    const voucherNumber = await nextVoucherNumber(branchId);
    return prisma.$transaction(async (tx) => {
      const header = await tx.branchOutgoingPayment.create({
        data: {
          branchId,
          type: 'OTHER',
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          voucherNumber,
          recordedById,
        },
      });
      await tx.otherPaymentDetail.create({
        data: {
          outgoingPaymentId: header.id,
          categoryId: input.categoryId,
          payeeName: input.payeeName.trim(),
          description: input.description?.trim() || null,
          paymentKind: input.paymentKind ?? 'REGULAR',
        },
      });
      return header;
    });
  }

  async voidPayment(branchId: string, paymentId: string, voidedById: string, reason: string) {
    if (!reason?.trim()) throw { status: 400, message: 'void reason is required' };
    const payment = await prisma.branchOutgoingPayment.findFirst({
      where: { id: paymentId, branchId },
      include: { payrollDetail: true },
    });
    if (!payment) throw { status: 404, message: 'Payment not found' };
    if (payment.status === 'VOID') throw { status: 400, message: 'Payment already voided' };

    await prisma.branchOutgoingPayment.update({
      where: { id: paymentId },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidReason: reason.trim(),
        voidedById,
      },
    });

    if (payment.payrollDetail) {
      await refreshPayrollMonthBalance(
        branchId,
        payment.payrollDetail.payeeUserId,
        payment.payrollDetail.salaryMonth,
      );
    }
    return { message: 'Payment voided' };
  }

  async getVoucher(branchId: string, id: string) {
    const payment = await prisma.branchOutgoingPayment.findFirst({
      where: { id, branchId },
      include: {
        payrollDetail: { include: { payee: { select: { id: true, name: true } } } },
        utilityDetail: { include: { category: true, provider: true } },
        otherDetail: { include: { category: true } },
        recordedBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
      },
    });
    if (!payment) throw { status: 404, message: 'Voucher not found' };
    return payment;
  }
}

export const expensesService = new ExpensesService();

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
    reminderDayOfMonth?: number;
    typicalAmount?: number;
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
        reminderDayOfMonth: data.reminderDayOfMonth ?? null,
        typicalAmount: data.typicalAmount ?? null,
      },
    });
  }

  async updateUtilityProvider(branchId: string, id: string, data: {
    name?: string;
    consumerNumber?: string;
    contactNumber?: string;
    note?: string;
    reminderDayOfMonth?: number | null;
    typicalAmount?: number | null;
    isActive?: boolean;
  }) {
    const current = await prisma.utilityProvider.findFirst({ where: { id, branchId } });
    if (!current) throw { status: 404, message: 'Provider not found' };
    return prisma.utilityProvider.update({
      where: { id },
      data: {
        name: data.name?.trim() ?? undefined,
        consumerNumber: data.consumerNumber !== undefined ? (data.consumerNumber.trim() || null) : undefined,
        contactNumber: data.contactNumber !== undefined ? (data.contactNumber.trim() || null) : undefined,
        note: data.note !== undefined ? (data.note.trim() || null) : undefined,
        reminderDayOfMonth: data.reminderDayOfMonth !== undefined ? data.reminderDayOfMonth : undefined,
        typicalAmount: data.typicalAmount !== undefined ? data.typicalAmount : undefined,
        isActive: typeof data.isActive === 'boolean' ? data.isActive : undefined,
      },
    });
  }

  async getLastUtilityBill(branchId: string, providerId: string) {
    const bill = await prisma.branchOutgoingPayment.findFirst({
      where: {
        branchId,
        type: 'UTILITY',
        status: 'PAID',
        utilityDetail: { providerId },
      },
      include: { utilityDetail: { include: { category: true, provider: true } } },
      orderBy: { paidAt: 'desc' },
    });
    return bill;
  }

  async duplicateLastUtilityBill(
    branchId: string,
    recordedById: string,
    providerId: string,
    overrides?: { amount?: number; paymentMethod?: OutgoingPaymentMethod },
  ) {
    const last = await this.getLastUtilityBill(branchId, providerId);
    if (!last?.utilityDetail) throw { status: 404, message: 'No previous bill found for this provider' };
    const d = last.utilityDetail;
    return this.recordUtility(branchId, recordedById, {
      categoryId: d.categoryId,
      providerId,
      providerName: d.providerName,
      amount: overrides?.amount ?? Number(last.amount),
      paymentMethod: overrides?.paymentMethod ?? last.paymentMethod,
      paymentKind: d.paymentKind,
      consumerNumber: d.consumerNumber ?? undefined,
      billReference: d.billReference ?? undefined,
      note: `Duplicated from ${last.voucherNumber}`,
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
        missingDates: computed.missingDates,
        attendancePath: p.payeeType === 'TEACHER' ? '/admin/attendance/teachers' : '/admin/attendance/staff',
      });
    }
    return results;
  }

  async previewPayrollBulk(
    branchId: string,
    salaryMonth: string,
    academicYearId: string,
    filters?: {
      payeeType?: 'TEACHER' | 'STAFF' | 'WORKER' | 'ALL';
      unpaidOnly?: boolean;
      missingAttendanceOnly?: boolean;
    },
  ) {
    let rows = await this.listPayroll(branchId, salaryMonth, academicYearId);
    const payeeType = filters?.payeeType ?? 'ALL';
    if (payeeType === 'TEACHER') {
      rows = rows.filter((r) => r.payeeType === 'TEACHER');
    } else if (payeeType === 'STAFF') {
      rows = rows.filter((r) => r.payeeType === 'STAFF' && r.branchRole !== 'worker');
    } else if (payeeType === 'WORKER') {
      rows = rows.filter((r) => r.branchRole === 'worker');
    }
    if (filters?.unpaidOnly) {
      rows = rows.filter((r) => Number(r.closingBalance ?? 0) > 0);
    }
    if (filters?.missingAttendanceOnly) {
      rows = rows.filter((r) => Number(r.unmarkedDays ?? 0) > 0);
    }
    return rows.map((r) => ({
      ...r,
      suggestedAmount: Math.max(0, Number(r.closingBalance ?? r.remainingToPay ?? 0)),
    }));
  }

  async recordPayrollBulk(
    branchId: string,
    recordedById: string,
    input: {
      salaryMonth: string;
      paymentMethod: OutgoingPaymentMethod;
      paymentKind?: PayrollPaymentKind;
      note?: string;
      academicYearId: string;
      payments: Array<{ payeeUserId: string; amount: number }>;
    },
  ) {
    if (!input.salaryMonth || !input.payments?.length) {
      throw { status: 400, message: 'salaryMonth and payments array are required' };
    }
    const paymentKind = input.paymentKind ?? 'REGULAR';
    const payees = await listPayrollPayees(branchId);
    const payeeMap = new Map(payees.map((p) => [p.userId, p]));

    const results: Array<{ payeeUserId: string; success: boolean; voucherNumber?: string; error?: string }> = [];
    let totalAmount = 0;
    let successCount = 0;
    let failCount = 0;

    const bulkRun = await prisma.payrollBulkRun.create({
      data: {
        branchId,
        salaryMonth: input.salaryMonth,
        paymentMethod: input.paymentMethod,
        paymentKind,
        totalAmount: 0,
        successCount: 0,
        failCount: 0,
        note: input.note?.trim() || null,
        recordedById,
      },
    });

    for (const item of input.payments) {
      if (!item.payeeUserId || !item.amount || item.amount <= 0) {
        results.push({ payeeUserId: item.payeeUserId, success: false, error: 'Invalid amount' });
        failCount++;
        continue;
      }
      const payee = payeeMap.get(item.payeeUserId);
      if (!payee) {
        results.push({ payeeUserId: item.payeeUserId, success: false, error: 'Payee not found' });
        failCount++;
        continue;
      }
      try {
        const computed = await computePayrollMonth(
          branchId,
          payee.userId,
          payee.payeeType,
          input.salaryMonth,
          input.academicYearId,
          payee.profileSalary,
        );
        const voucherNumber = await nextVoucherNumber(branchId);
        await prisma.$transaction(async (tx) => {
          const header = await tx.branchOutgoingPayment.create({
            data: {
              branchId,
              type: 'PAYROLL',
              amount: item.amount,
              paymentMethod: input.paymentMethod,
              paidAt: new Date(),
              note: input.note?.trim() || null,
              voucherNumber,
              recordedById,
              bulkRunId: bulkRun.id,
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
        });
        await refreshPayrollMonthBalance(branchId, payee.userId, input.salaryMonth);
        results.push({ payeeUserId: item.payeeUserId, success: true, voucherNumber });
        totalAmount += item.amount;
        successCount++;
      } catch (e: any) {
        results.push({
          payeeUserId: item.payeeUserId,
          success: false,
          error: e?.message || 'Payment failed',
        });
        failCount++;
      }
    }

    await prisma.payrollBulkRun.update({
      where: { id: bulkRun.id },
      data: { totalAmount, successCount, failCount },
    });

    return { bulkRunId: bulkRun.id, totalAmount, successCount, failCount, results };
  }

  async getPayeePayrollProfile(
    branchId: string,
    payeeUserId: string,
    academicYearId: string,
    limit = 12,
  ) {
    const payees = await listPayrollPayees(branchId);
    const payee = payees.find((p) => p.userId === payeeUserId);
    if (!payee) throw { status: 404, message: 'Payee not found in branch payroll list' };

    const balances = await prisma.payrollMonthBalance.findMany({
      where: { branchId, payeeUserId },
      orderBy: { salaryMonth: 'desc' },
      take: limit,
    });

    const currentMonth = new Date().toISOString().slice(0, 7);
    const hasCurrent = balances.some((b) => b.salaryMonth === currentMonth);
    const months = [...balances];
    if (!hasCurrent) {
      const computed = await computePayrollMonth(
        branchId,
        payee.userId,
        payee.payeeType,
        currentMonth,
        academicYearId,
        payee.profileSalary,
      );
      months.unshift({
        ...computed.balance,
        salaryMonth: currentMonth,
      } as typeof balances[0]);
      if (months.length > limit) months.pop();
    }

    const payments = await prisma.payrollPaymentDetail.findMany({
      where: { payeeUserId, outgoingPayment: { branchId, status: 'PAID' } },
      include: {
        outgoingPayment: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            paidAt: true,
            voucherNumber: true,
            note: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      payee,
      months: months.map((m) => ({
        salaryMonth: m.salaryMonth,
        profileSalary: Number(m.profileSalary),
        attendanceEarned: Number(m.attendanceEarned),
        openingBalance: Number(m.openingBalance),
        totalPaid: Number(m.totalPaid),
        closingBalance: Number(m.closingBalance),
        unmarkedDays: m.unmarkedDays,
        workingDays: m.workingDays,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        salaryMonth: p.salaryMonth,
        paymentKind: p.paymentKind,
        amount: Number(p.outgoingPayment.amount),
        paymentMethod: p.outgoingPayment.paymentMethod,
        paidAt: p.outgoingPayment.paidAt,
        voucherNumber: p.outgoingPayment.voucherNumber,
        note: p.outgoingPayment.note,
        status: p.outgoingPayment.status,
      })),
    };
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
      saveProvider?: boolean;
      contactNumber?: string;
      reminderDayOfMonth?: number;
    },
  ) {
    if (!input.categoryId || !input.providerName?.trim() || !input.amount || input.amount <= 0) {
      throw { status: 400, message: 'categoryId, providerName, and amount (>0) are required' };
    }

    let providerId = input.providerId;
    if (!providerId && input.saveProvider) {
      const existing = await prisma.utilityProvider.findFirst({
        where: { branchId, name: input.providerName.trim() },
      });
      if (existing) {
        providerId = existing.id;
      } else {
        const created = await this.createUtilityProvider(branchId, {
          categoryId: input.categoryId,
          name: input.providerName.trim(),
          consumerNumber: input.consumerNumber,
          contactNumber: input.contactNumber,
          reminderDayOfMonth: input.reminderDayOfMonth,
          typicalAmount: input.amount,
        });
        providerId = created.id;
      }
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
          providerId: providerId || null,
          providerName: input.providerName.trim(),
          consumerNumber: input.consumerNumber?.trim() || null,
          billReference: input.billReference?.trim() || null,
          periodStart: input.periodStart ? new Date(input.periodStart) : null,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          paymentKind: input.paymentKind ?? 'REGULAR',
        },
      });
      if (providerId && input.amount) {
        await tx.utilityProvider.update({
          where: { id: providerId },
          data: { typicalAmount: input.amount },
        });
      }
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

  private csvEscape(v: unknown): string {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  private toCsv(headers: string[], rows: unknown[][]): string {
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(row.map((c) => this.csvEscape(c)).join(','));
    }
    return lines.join('\n');
  }

  async listVouchers(branchId: string, opts?: {
    from?: string; to?: string; type?: OutgoingPaymentType; status?: string;
  }) {
    const where: any = { branchId };
    if (opts?.type) where.type = opts.type;
    if (opts?.status) where.status = opts.status;
    if (opts?.from || opts?.to) {
      where.paidAt = {};
      if (opts.from) where.paidAt.gte = new Date(opts.from);
      if (opts.to) where.paidAt.lte = new Date(`${opts.to}T23:59:59`);
    }
    return prisma.branchOutgoingPayment.findMany({
      where,
      include: {
        payrollDetail: { include: { payee: { select: { name: true } } } },
        utilityDetail: { include: { category: true } },
        otherDetail: { include: { category: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 500,
    });
  }

  async exportPayrollCsv(branchId: string, salaryMonth: string, academicYearId: string) {
    const rows = await this.listPayroll(branchId, salaryMonth, academicYearId);
    const csv = this.toCsv(
      ['Name', 'Work Role', 'Type', 'Profile Salary', 'Earned', 'Opening', 'Paid', 'Balance', 'Unmarked Days'],
      rows.map((r) => [
        r.name, r.workRole ?? '', `${r.payeeType} / ${r.branchRole}`,
        r.profileSalary, r.attendanceEarned, r.openingBalance, r.totalPaid, r.closingBalance, r.unmarkedDays,
      ]),
    );
    return { filename: `payroll-${salaryMonth}.csv`, csv };
  }

  async exportUtilitiesCsv(branchId: string, opts?: { from?: string; to?: string }) {
    const bills = await this.listUtilities(branchId, opts);
    const csv = this.toCsv(
      ['Date', 'Voucher', 'Category', 'Provider', 'Kind', 'Amount', 'Method', 'Status'],
      bills.map((b) => [
        new Date(b.paidAt).toISOString().slice(0, 10),
        b.voucherNumber,
        b.utilityDetail?.category?.name ?? '',
        b.utilityDetail?.providerName ?? '',
        b.utilityDetail?.paymentKind ?? '',
        Number(b.amount),
        b.paymentMethod,
        b.status,
      ]),
    );
    return { filename: `utility-bills-${opts?.from || 'all'}.csv`, csv };
  }

  async exportOthersCsv(branchId: string, opts?: { from?: string; to?: string }) {
    const payments = await this.listOthers(branchId, opts);
    const csv = this.toCsv(
      ['Date', 'Voucher', 'Category', 'Payee', 'Kind', 'Amount', 'Method', 'Status'],
      payments.map((p) => [
        new Date(p.paidAt).toISOString().slice(0, 10),
        p.voucherNumber,
        p.otherDetail?.category?.name ?? '',
        p.otherDetail?.payeeName ?? '',
        p.otherDetail?.paymentKind ?? '',
        Number(p.amount),
        p.paymentMethod,
        p.status,
      ]),
    );
    return { filename: `other-payments-${opts?.from || 'all'}.csv`, csv };
  }

  async listUtilityReminders(branchId: string) {
    const today = new Date().getDate();
    const providers = await prisma.utilityProvider.findMany({
      where: { branchId, isActive: true, reminderDayOfMonth: { not: null } },
      include: { category: { select: { name: true } } },
      orderBy: { reminderDayOfMonth: 'asc' },
    });
    return providers.map((p) => ({
      ...p,
      typicalAmount: p.typicalAmount != null ? Number(p.typicalAmount) : null,
      isDueSoon: p.reminderDayOfMonth != null && Math.abs(p.reminderDayOfMonth - today) <= 3,
    }));
  }
}

export const expensesService = new ExpensesService();

import { PayrollPayeeType } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  attendancePayWeight,
  monthBounds,
  prevSalaryMonth,
} from '../utils/employee-attendance';

export type PayrollPayeeRow = {
  userId: string;
  name: string;
  payeeType: PayrollPayeeType;
  branchRole: string;
  profileSalary: number;
  employeeId: string | null;
  workRole: string | null;
};

const STAFF_PAYROLL_ROLES = ['management', 'canteen_staff', 'worker'] as const;

// ═══════════════════════════════════════════════════════════════════
// BATCH CONTEXT — eliminates N+1 query pattern
// ═══════════════════════════════════════════════════════════════════

export type PayrollComputeContext = {
  academicYearCalendar: { startDate: Date; endDate: Date } | null;
  branchMembers: Map<string, {
    isActive: boolean;
    resignedAt: Date | null;
    tenures: { joinedAt: Date; leftAt: Date | null; sequence: number }[];
  }>;
  joiningDates: Map<string, Date>;
  previousBalances: Map<string, number>; // key: `${payeeUserId}`
  teacherAttendance: Map<string, { date: Date; status: string }[]>;
  staffAttendance: Map<string, { date: Date; status: string }[]>;
  paymentDetails: Map<string, { amount: number; paymentKind: string }[]>;
};

/**
 * Build a batch context that pre-fetches all shared data needed for
 * computePayrollMonth across all payees. This eliminates the N+1 pattern:
 * instead of ~200 queries per payee (validateAttendanceDate + BranchMember
 * lookups per day), we fetch everything once and validate in-memory.
 */
export async function buildPayrollContext(
  branchId: string,
  academicYearId: string,
  salaryMonth: string,
  payees: PayrollPayeeRow[],
): Promise<PayrollComputeContext> {
  const { from, to } = monthBounds(salaryMonth);
  const prev = prevSalaryMonth(salaryMonth);
  const payeeUserIds = payees.map((p) => p.userId);

  // 1. Academic year calendar — 1 query (was ~N*31)
  const ay = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
    select: { calendar: { select: { startDate: true, endDate: true } } },
  });
  const academicYearCalendar = ay?.calendar
    ? { startDate: new Date(ay.calendar.startDate), endDate: new Date(ay.calendar.endDate) }
    : null;

  // 2. BranchMember with tenures — 1 query (was ~N*31)
  const members = await prisma.branchMember.findMany({
    where: { branchId, userId: { in: payeeUserIds } },
    include: { tenures: { orderBy: { sequence: 'asc' }, select: { joinedAt: true, leftAt: true, sequence: true } } },
  });
  const branchMembers = new Map<string, typeof members[number]>();
  for (const m of members) {
    branchMembers.set(m.userId, m);
  }

  // 3. Joining dates (fallback when no tenures) — 1 query (was ~N*31)
  const users = await prisma.user.findMany({
    where: { id: { in: payeeUserIds } },
    select: {
      id: true,
      teacherProfile: { select: { joiningDate: true } },
      staffProfile: { select: { joiningDate: true } },
    },
  });
  const joiningDates = new Map<string, Date>();
  for (const u of users) {
    const jd = u.teacherProfile?.joiningDate ?? u.staffProfile?.joiningDate;
    if (jd) joiningDates.set(u.id, jd);
  }

  // 4. Previous month balances — 1 query (was ~N)
  const prevBals = await prisma.payrollMonthBalance.findMany({
    where: { branchId, salaryMonth: prev, payeeUserId: { in: payeeUserIds } },
    select: { payeeUserId: true, closingBalance: true },
  });
  const previousBalances = new Map<string, number>();
  for (const b of prevBals) {
    previousBalances.set(b.payeeUserId, Number(b.closingBalance));
  }

  // 5. Teacher attendance — 1 query (was ~N*2)
  const teacherIds = payees.filter((p) => p.payeeType === 'TEACHER').map((p) => p.userId);
  const teacherAttRaw = teacherIds.length > 0
    ? await prisma.teacherAttendance.findMany({
        where: { teacherId: { in: teacherIds }, academicYearId, date: { gte: from, lte: to } },
        select: { teacherId: true, date: true, status: true },
      })
    : [];
  const teacherAttendance = new Map<string, { date: Date; status: string }[]>();
  for (const r of teacherAttRaw) {
    const list = teacherAttendance.get(r.teacherId) ?? [];
    list.push({ date: r.date, status: r.status });
    teacherAttendance.set(r.teacherId, list);
  }

  // 6. Staff attendance — 1 query (was ~N*2)
  const staffIds = payees.filter((p) => p.payeeType !== 'TEACHER').map((p) => p.userId);
  const staffAttRaw = staffIds.length > 0
    ? await prisma.staffAttendance.findMany({
        where: { staffUserId: { in: staffIds }, academicYearId, date: { gte: from, lte: to } },
        select: { staffUserId: true, date: true, status: true },
      })
    : [];
  const staffAttendance = new Map<string, { date: Date; status: string }[]>();
  for (const r of staffAttRaw) {
    const list = staffAttendance.get(r.staffUserId) ?? [];
    list.push({ date: r.date, status: r.status });
    staffAttendance.set(r.staffUserId, list);
  }

  // 7. Payment details — 1 query (was ~N)
  const paymentsRaw = await prisma.payrollPaymentDetail.findMany({
    where: {
      payeeUserId: { in: payeeUserIds },
      salaryMonth,
      outgoingPayment: { branchId, status: 'PAID' },
    },
    select: {
      payeeUserId: true,
      paymentKind: true,
      outgoingPayment: { select: { amount: true } },
    },
  });
  const paymentDetails = new Map<string, { amount: number; paymentKind: string }[]>();
  for (const p of paymentsRaw) {
    const list = paymentDetails.get(p.payeeUserId) ?? [];
    list.push({ amount: Number(p.outgoingPayment.amount), paymentKind: p.paymentKind });
    paymentDetails.set(p.payeeUserId, list);
  }

  return {
    academicYearCalendar,
    branchMembers,
    joiningDates,
    previousBalances,
    teacherAttendance,
    staffAttendance,
    paymentDetails,
  };
}

// ═══════════════════════════════════════════════════════════════════
// IN-MEMORY DATE VALIDATION (replaces per-day DB queries)
// ═══════════════════════════════════════════════════════════════════

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

function dateInTenure(dateObj: Date, tenures: { joinedAt: Date; leftAt: Date | null }[]): boolean {
  const d = startOfDay(dateObj);
  return tenures.some((t) => {
    const joined = startOfDay(t.joinedAt);
    if (d < joined) return false;
    if (t.leftAt) {
      const left = endOfDay(t.leftAt);
      if (d > left) return false;
    }
    return true;
  });
}

/**
 * In-memory date validation replicating the exact semantics of
 * validateAttendanceDate + validateEmployeeAttendanceDate from the
 * employee-attendance module, using pre-fetched context data.
 */
function isDateValidFromContext(
  dateObj: Date,
  ctx: PayrollComputeContext,
  branchId: string,
  userId: string,
): string | null {
  // Replicate validateAttendanceDate: future date check
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  if (dateObj > now) {
    return 'Cannot mark attendance for future dates';
  }

  // Replicate validateAttendanceDate: academic year calendar range check
  if (ctx.academicYearCalendar) {
    const ayStart = new Date(ctx.academicYearCalendar.startDate);
    const ayEnd = new Date(ctx.academicYearCalendar.endDate);
    ayEnd.setHours(23, 59, 59, 999);
    if (dateObj < ayStart || dateObj > ayEnd) {
      return 'Date is outside the academic year range';
    }
  }

  // Replicate validateEmployeeAttendanceDate: branch member check
  const member = ctx.branchMembers.get(userId);
  if (!member) return 'Employee not found in this branch';

  // Tenure-based validation (when tenures exist)
  if (member.tenures.length > 0) {
    if (!dateInTenure(dateObj, member.tenures)) {
      return 'Cannot mark attendance outside employee tenure (before join or after leave date)';
    }
    return null;
  }

  // Fallback: profile joining date validation
  const joiningDate = ctx.joiningDates.get(userId);
  if (joiningDate) {
    if (startOfDay(dateObj) < startOfDay(joiningDate)) {
      return 'Cannot mark attendance before employee joining date';
    }
  }

  // Inactive member with resigned date
  if (!member.isActive && member.resignedAt) {
    if (dateObj > endOfDay(member.resignedAt)) {
      return 'Cannot mark attendance after employee leave date';
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// PAYROLL COMPUTATION
// ═══════════════════════════════════════════════════════════════════

async function getOpeningBalance(
  branchId: string,
  payeeUserId: string,
  salaryMonth: string,
  ctx?: PayrollComputeContext,
): Promise<number> {
  if (ctx) {
    return ctx.previousBalances.get(payeeUserId) ?? 0;
  }
  const prev = prevSalaryMonth(salaryMonth);
  const prevBal = await prisma.payrollMonthBalance.findUnique({
    where: { branchId_payeeUserId_salaryMonth: { branchId, payeeUserId, salaryMonth: prev } },
  });
  return prevBal ? Number(prevBal.closingBalance) : 0;
}

function getAttendanceRecords(
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  ctx?: PayrollComputeContext,
): { date: Date; status: string }[] {
  if (ctx) {
    return payeeType === 'TEACHER'
      ? (ctx.teacherAttendance.get(payeeUserId) ?? [])
      : (ctx.staffAttendance.get(payeeUserId) ?? []);
  }
  return [];
}

function getPaymentTotals(
  payeeUserId: string,
  ctx?: PayrollComputeContext,
): { totalPaid: number; extraPaid: number } {
  if (ctx) {
    const details = ctx.paymentDetails.get(payeeUserId) ?? [];
    let totalPaid = 0;
    let extraPaid = 0;
    for (const p of details) {
      totalPaid += p.amount;
      if (p.paymentKind === 'EXTRA') extraPaid += p.amount;
    }
    return { totalPaid, extraPaid };
  }
  return { totalPaid: 0, extraPaid: 0 };
}

/**
 * Compute payroll for a single payee month.
 *
 * When `ctx` is provided (batch mode), pre-fetched data is used and zero
 * additional DB queries are issued for date validation, opening balance,
 * attendance, or payment lookups. Only the balance upsert requires a DB write.
 *
 * When `ctx` is omitted (legacy mode), the original per-query behavior is
 * preserved for backward compatibility.
 */
export async function computePayrollMonth(
  branchId: string,
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  salaryMonth: string,
  academicYearId: string,
  profileSalary: number,
  ctx?: PayrollComputeContext,
) {
  const { from, to, daysInMonth } = monthBounds(salaryMonth);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  // --- Attendance records ---
  let records: { date: Date; status: string }[];
  if (ctx) {
    records = getAttendanceRecords(payeeUserId, payeeType, ctx);
  } else {
    const attendanceWhere = { academicYearId, date: { gte: from, lte: to } };
    records = payeeType === 'TEACHER'
      ? await prisma.teacherAttendance.findMany({
          where: { teacherId: payeeUserId, ...attendanceWhere },
          select: { date: true, status: true },
        })
      : await prisma.staffAttendance.findMany({
          where: { staffUserId: payeeUserId, ...attendanceWhere },
          select: { date: true, status: true },
        });
  }

  const byDate = new Map<string, string>();
  for (const r of records) {
    byDate.set(r.date.toISOString().slice(0, 10), r.status);
  }

  // --- Day-by-day validation + attendance counting ---
  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let leaveDays = 0;
  let unmarkedDays = 0;
  let weightedDays = 0;
  let workingDays = 0;

  const cursor = new Date(from);
  while (cursor <= to) {
    const dStr = cursor.toISOString().slice(0, 10);
    const err = ctx
      ? isDateValidFromContext(cursor, ctx, branchId, payeeUserId)
      : await import('../utils/employee-attendance').then((m) =>
          m.validateEmployeeAttendanceDate(branchId, payeeUserId, academicYearId, cursor),
        );
    if (!err) {
      workingDays++;
      const status = byDate.get(dStr);
      if (!status) {
        unmarkedDays++;
      } else {
        if (status === 'present' || status === 'holiday' || status === 'function') presentDays++;
        else if (status === 'late') lateDays++;
        else if (status === 'leave') leaveDays++;
        else absentDays++;
        weightedDays += attendancePayWeight(status);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // --- Salary computation ---
  const dailyRate = workingDays > 0 ? profileSalary / workingDays : profileSalary / daysInMonth;
  const attendanceEarned = Math.round(dailyRate * weightedDays * 100) / 100;

  // --- Opening balance ---
  const openingBalance = await getOpeningBalance(branchId, payeeUserId, salaryMonth, ctx);

  // --- Payment totals ---
  let totalPaid: number;
  let extraPaid: number;
  if (ctx) {
    const totals = getPaymentTotals(payeeUserId, ctx);
    totalPaid = totals.totalPaid;
    extraPaid = totals.extraPaid;
  } else {
    const payments = await prisma.payrollPaymentDetail.findMany({
      where: {
        payeeUserId,
        salaryMonth,
        outgoingPayment: { branchId, status: 'PAID' },
      },
      include: { outgoingPayment: { select: { amount: true } } },
    });
    totalPaid = 0;
    extraPaid = 0;
    for (const p of payments) {
      const amt = Number(p.outgoingPayment.amount);
      totalPaid += amt;
      if (p.paymentKind === 'EXTRA') extraPaid += amt;
    }
  }

  // --- Balance computation ---
  const totalDue = openingBalance + attendanceEarned;
  const closingBalance = Math.round((totalDue - totalPaid) * 100) / 100;

  // --- Upsert balance (always a DB write) ---
  const balance = await prisma.payrollMonthBalance.upsert({
    where: { branchId_payeeUserId_salaryMonth: { branchId, payeeUserId, salaryMonth } },
    create: {
      branchId,
      payeeUserId,
      payeeType,
      salaryMonth,
      profileSalary,
      attendanceEarned,
      extraDue: extraPaid,
      openingBalance,
      totalPaid,
      closingBalance,
      presentDays,
      absentDays,
      lateDays,
      leaveDays,
      unmarkedDays,
      workingDays,
      computedAt: new Date(),
    },
    update: {
      profileSalary,
      attendanceEarned,
      extraDue: extraPaid,
      openingBalance,
      totalPaid,
      closingBalance,
      presentDays,
      absentDays,
      lateDays,
      leaveDays,
      unmarkedDays,
      workingDays,
      computedAt: new Date(),
    },
  });

  return {
    balance,
    summary: {
      salaryMonth,
      from: fromStr,
      to: toStr,
      profileSalary,
      workingDays,
      presentDays,
      absentDays,
      lateDays,
      leaveDays,
      unmarkedDays,
      attendanceEarned,
      openingBalance,
      extraDue: extraPaid,
      totalDue,
      totalPaid,
      closingBalance,
      remainingToPay: closingBalance > 0 ? closingBalance : 0,
      overpaid: closingBalance < 0 ? Math.abs(closingBalance) : 0,
    },
    missingDates: listMissingAttendanceDatesFromContext(
      branchId, payeeUserId, payeeType, from, to, byDate, ctx,
    ),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MISSING ATTENDANCE DATES
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute missing attendance dates from already-fetched data.
 *
 * In batch mode (ctx provided), reuses the attendance `byDate` map from
 * computePayrollMonth and validates in-memory — zero additional DB queries.
 *
 * In legacy mode (ctx omitted), falls back to the original per-query behavior.
 */
function listMissingAttendanceDatesFromContext(
  branchId: string,
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  from: Date,
  to: Date,
  byDate: Map<string, string>,
  ctx?: PayrollComputeContext,
): string[] {
  if (ctx) {
    // Batch mode: validate in-memory, reuse attendance data
    const missing: string[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dStr = cursor.toISOString().slice(0, 10);
      const err = isDateValidFromContext(cursor, ctx, branchId, payeeUserId);
      if (!err && !byDate.has(dStr)) missing.push(dStr);
      cursor.setDate(cursor.getDate() + 1);
    }
    return missing;
  }
  // Legacy mode: return empty (will be computed by legacy path)
  return [];
}

/**
 * Legacy standalone function for backward compatibility.
 * When called outside batch context, performs the original per-query behavior.
 */
export async function listMissingAttendanceDates(
  branchId: string,
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  academicYearId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
  const { validateEmployeeAttendanceDate } = await import('../utils/employee-attendance');
  const attendanceWhere = { academicYearId, date: { gte: from, lte: to } };
  const records = payeeType === 'TEACHER'
    ? await prisma.teacherAttendance.findMany({
        where: { teacherId: payeeUserId, ...attendanceWhere },
        select: { date: true },
      })
    : await prisma.staffAttendance.findMany({
        where: { staffUserId: payeeUserId, ...attendanceWhere },
        select: { date: true },
      });

  const marked = new Set(records.map((r) => r.date.toISOString().slice(0, 10)));
  const missing: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const dStr = cursor.toISOString().slice(0, 10);
    const err = await validateEmployeeAttendanceDate(branchId, payeeUserId, academicYearId, cursor);
    if (!err && !marked.has(dStr)) missing.push(dStr);
    cursor.setDate(cursor.getDate() + 1);
  }
  return missing;
}

// ═══════════════════════════════════════════════════════════════════
// EXISTING FUNCTIONS (unchanged)
// ═══════════════════════════════════════════════════════════════════

export async function listPayrollPayees(branchId: string): Promise<PayrollPayeeRow[]> {
  const teachers = await prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
    },
    select: {
      id: true,
      name: true,
      teacherProfile: { select: { salary: true, employeeId: true } },
      branchMembers: { where: { branchId }, select: { role: true } },
    },
    orderBy: { name: 'asc' },
  });

  const teacherRows: PayrollPayeeRow[] = teachers.map((t) => ({
    userId: t.id,
    name: t.name,
    payeeType: 'TEACHER',
    branchRole: t.branchMembers[0]?.role ?? 'teacher',
    profileSalary: t.teacherProfile?.salary != null ? Number(t.teacherProfile.salary) : 0,
    employeeId: t.teacherProfile?.employeeId ?? null,
    workRole: null,
  }));

  const staff = await prisma.user.findMany({
    where: {
      status: 'active',
      branchMembers: {
        some: { branchId, isActive: true, role: { in: [...STAFF_PAYROLL_ROLES] } },
      },
    },
    select: {
      id: true,
      name: true,
      staffProfile: { select: { salary: true, employeeId: true, workRole: true } },
      branchMembers: { where: { branchId }, select: { role: true } },
    },
    orderBy: { name: 'asc' },
  });

  const staffRows: PayrollPayeeRow[] = staff
    .filter((s) => s.branchMembers[0]?.role !== 'teacher')
    .map((s) => ({
      userId: s.id,
      name: s.name,
      payeeType: 'STAFF',
      branchRole: s.branchMembers[0]?.role ?? 'management',
      profileSalary: s.staffProfile?.salary != null ? Number(s.staffProfile.salary) : 0,
      employeeId: s.staffProfile?.employeeId ?? null,
      workRole: s.staffProfile?.workRole ?? null,
    }));

  return [...teacherRows, ...staffRows];
}

export async function refreshPayrollMonthBalance(
  branchId: string,
  payeeUserId: string,
  salaryMonth: string,
) {
  const payees = await listPayrollPayees(branchId);
  const payee = payees.find((p) => p.userId === payeeUserId);
  if (!payee) throw { status: 404, message: 'Payee not found' };

  const ay = await prisma.academicYear.findFirst({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!ay) throw { status: 400, message: 'No active academic year for payroll calculation' };

  return computePayrollMonth(
    branchId,
    payeeUserId,
    payee.payeeType,
    salaryMonth,
    ay.id,
    payee.profileSalary,
  );
}

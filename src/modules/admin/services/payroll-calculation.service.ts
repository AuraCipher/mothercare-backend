import { PayrollPayeeType } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  attendancePayWeight,
  monthBounds,
  prevSalaryMonth,
  validateEmployeeAttendanceDate,
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

async function getOpeningBalance(
  branchId: string,
  payeeUserId: string,
  salaryMonth: string,
): Promise<number> {
  const prev = prevSalaryMonth(salaryMonth);
  const prevBal = await prisma.payrollMonthBalance.findUnique({
    where: { branchId_payeeUserId_salaryMonth: { branchId, payeeUserId, salaryMonth: prev } },
  });
  return prevBal ? Number(prevBal.closingBalance) : 0;
}

export async function computePayrollMonth(
  branchId: string,
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  salaryMonth: string,
  academicYearId: string,
  profileSalary: number,
) {
  const { from, to, daysInMonth } = monthBounds(salaryMonth);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const attendanceWhere = {
    academicYearId,
    date: { gte: from, lte: to },
  };

  const records = payeeType === 'TEACHER'
    ? await prisma.teacherAttendance.findMany({
        where: { teacherId: payeeUserId, ...attendanceWhere },
        select: { date: true, status: true },
      })
    : await prisma.staffAttendance.findMany({
        where: { staffUserId: payeeUserId, ...attendanceWhere },
        select: { date: true, status: true },
      });

  const byDate = new Map<string, string>();
  for (const r of records) {
    const d = r.date.toISOString().slice(0, 10);
    byDate.set(d, r.status);
  }

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
    const err = await validateEmployeeAttendanceDate(branchId, payeeUserId, academicYearId, cursor);
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

  const dailyRate = workingDays > 0 ? profileSalary / workingDays : profileSalary / daysInMonth;
  const attendanceEarned = Math.round(dailyRate * weightedDays * 100) / 100;

  const openingBalance = await getOpeningBalance(branchId, payeeUserId, salaryMonth);

  const payments = await prisma.payrollPaymentDetail.findMany({
    where: {
      payeeUserId,
      salaryMonth,
      outgoingPayment: { branchId, status: 'PAID' },
    },
    include: { outgoingPayment: { select: { amount: true } } },
  });

  let totalPaid = 0;
  let extraPaid = 0;
  for (const p of payments) {
    const amt = Number(p.outgoingPayment.amount);
    totalPaid += amt;
    if (p.paymentKind === 'EXTRA') extraPaid += amt;
  }

  const totalDue = openingBalance + attendanceEarned;
  const closingBalance = Math.round((totalDue - totalPaid) * 100) / 100;

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
    missingDates: await listMissingAttendanceDates(
      branchId, payeeUserId, payeeType, academicYearId, from, to,
    ),
  };
}

export async function listMissingAttendanceDates(
  branchId: string,
  payeeUserId: string,
  payeeType: PayrollPayeeType,
  academicYearId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
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

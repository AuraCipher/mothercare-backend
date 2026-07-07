import { prisma } from '../../../lib/prisma';
import { validateAttendanceDate } from './attendance-scope';

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

/** Whether `date` falls inside any tenure segment (join..leave). */
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
 * Strict validation: attendance cannot be before join or after leave.
 * Uses BranchTenure when available; falls back to profile joiningDate.
 */
export async function validateEmployeeAttendanceDate(
  branchId: string,
  userId: string,
  academicYearId: string,
  dateObj: Date,
): Promise<string | null> {
  const ayErr = await validateAttendanceDate(academicYearId, dateObj);
  if (ayErr) return ayErr;

  const member = await prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId, userId } },
    include: { tenures: { orderBy: { sequence: 'asc' } } },
  });
  if (!member) return 'Employee not found in this branch';

  if (member.tenures.length > 0) {
    if (!dateInTenure(dateObj, member.tenures)) {
      return 'Cannot mark attendance outside employee tenure (before join or after leave date)';
    }
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      teacherProfile: { select: { joiningDate: true } },
      staffProfile: { select: { joiningDate: true } },
    },
  });
  const joiningDate = user?.teacherProfile?.joiningDate ?? user?.staffProfile?.joiningDate;
  if (joiningDate) {
    if (startOfDay(dateObj) < startOfDay(joiningDate)) {
      return 'Cannot mark attendance before employee joining date';
    }
  }

  if (!member.isActive && member.resignedAt) {
    if (dateObj > endOfDay(member.resignedAt)) {
      return 'Cannot mark attendance after employee leave date';
    }
  }

  return null;
}

export async function assertTeachersInScopeWithTenure(
  teacherIds: string[],
  branchId: string,
  academicYearId: string,
  dateObj: Date,
): Promise<string | null> {
  const uniqueIds = [...new Set(teacherIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const found = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      role: 'teacher',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
    },
    select: { id: true },
  });
  if (found.length !== uniqueIds.length) {
    return 'One or more teachers are not active in the selected branch';
  }

  for (const id of uniqueIds) {
    const err = await validateEmployeeAttendanceDate(branchId, id, academicYearId, dateObj);
    if (err) return err;
  }
  return null;
}

export async function assertStaffInScopeWithTenure(
  staffIds: string[],
  branchId: string,
  academicYearId: string,
  dateObj: Date,
): Promise<string | null> {
  const uniqueIds = [...new Set(staffIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const payrollRoles = ['management', 'canteen_staff', 'worker'] as const;
  const found = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      status: 'active',
      branchMembers: {
        some: { branchId, isActive: true, role: { in: [...payrollRoles] } },
      },
    },
    select: { id: true },
  });
  if (found.length !== uniqueIds.length) {
    return 'One or more staff workers are not active in the selected branch';
  }

  for (const id of uniqueIds) {
    const err = await validateEmployeeAttendanceDate(branchId, id, academicYearId, dateObj);
    if (err) return err;
  }
  return null;
}

/** Attendance weight for payroll: present/holiday=1, late=0.75, leave=0, absent=0 */
export function attendancePayWeight(status: string): number {
  if (status === 'present' || status === 'holiday' || status === 'function') return 1;
  if (status === 'late') return 0.75;
  if (status === 'leave') return 0;
  return 0;
}

export function monthBounds(salaryMonth: string): { from: Date; to: Date; daysInMonth: number } {
  const [y, m] = salaryMonth.split('-').map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  return { from, to, daysInMonth: to.getDate() };
}

export function prevSalaryMonth(salaryMonth: string): string {
  const [y, m] = salaryMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

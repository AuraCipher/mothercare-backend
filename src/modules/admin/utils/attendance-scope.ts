import { prisma } from '../../../lib/prisma';
import type { ScopeContext } from './scope-context';

export async function validateAttendanceDate(
  academicYearId: string,
  dateObj: Date,
): Promise<string | null> {
  const checkDate = new Date();
  checkDate.setHours(23, 59, 59, 999);
  if (dateObj > checkDate) {
    return 'Cannot mark attendance for future dates';
  }

  const ay = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
    select: { calendar: { select: { startDate: true, endDate: true } } },
  });

  if (ay?.calendar) {
    const ayStart = new Date(ay.calendar.startDate);
    const ayEnd = new Date(ay.calendar.endDate);
    ayEnd.setHours(23, 59, 59, 999);
    if (dateObj < ayStart || dateObj > ayEnd) {
      return 'Date is outside the academic year range';
    }
  }

  return null;
}

export async function assertGroupInScope(
  groupId: string,
  { academicYearId }: ScopeContext,
): Promise<string | null> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, academicYearId },
    select: { id: true },
  });
  if (!group) {
    return 'Group not found in the selected academic year';
  }
  return null;
}

export async function assertStudentsInScope(
  studentIds: string[],
  groupId: string,
  scope: ScopeContext,
): Promise<string | null> {
  const groupErr = await assertGroupInScope(groupId, scope);
  if (groupErr) return groupErr;

  const uniqueIds = [...new Set(studentIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const found = await prisma.student.findMany({
    where: {
      id: { in: uniqueIds },
      groupId,
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
      isActive: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  if (found.length !== uniqueIds.length) {
    return 'One or more students are not in the selected group, branch, or academic year';
  }

  return null;
}

export async function assertTeachersInScope(
  teacherIds: string[],
  { branchId }: ScopeContext,
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

  return null;
}

export async function assertStudentsInBranchAy(
  studentIds: string[],
  scope: ScopeContext,
): Promise<string | null> {
  const uniqueIds = [...new Set(studentIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const found = await prisma.student.findMany({
    where: {
      id: { in: uniqueIds },
      academicYearId: scope.academicYearId,
      academicYear: { branchId: scope.branchId },
      isActive: true,
    },
    select: { id: true },
  });

  if (found.length !== uniqueIds.length) {
    return 'One or more students are not in the selected branch or academic year';
  }

  return null;
}

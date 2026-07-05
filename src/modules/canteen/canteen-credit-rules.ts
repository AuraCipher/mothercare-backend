import { CanteenPersonType } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const STAFF_BRANCH_ROLES = new Set([
  'branch_admin',
  'sub_admin',
  'management',
  'canteen_staff',
]);

/** Active teachers linked to a branch via branch_members (not academic year). */
export async function isTeacherInBranch(branchId: string, userId: string) {
  const membership = await prisma.branchMember.findFirst({
    where: {
      branchId,
      userId,
      isActive: true,
      user: { role: 'teacher', status: 'active' },
    },
    select: { id: true },
  });
  return !!membership;
}

async function upsertTeacherBranchMember(branchId: string, userId: string) {
  const existing = await prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId, userId } },
  });
  if (existing) {
    if (!existing.isActive || existing.role !== 'teacher') {
      await prisma.branchMember.update({
        where: { id: existing.id },
        data: { isActive: true, role: 'teacher' },
      });
    }
    return;
  }
  await prisma.branchMember.create({
    data: { branchId, userId, role: 'teacher', isActive: true },
  });
}

/**
 * Ensure teachers are linked to a branch via branch_members (not academic year).
 * - Teachers with any class assignment in this branch (any year) → linked here
 * - Teachers with no branch link anywhere → linked here if this branch has teacher activity
 */
export async function syncTeachersForBranch(branchId: string) {
  const assigned = await prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      teacherAssignments: {
        some: { group: { academicYear: { branchId } } },
      },
    },
    select: { id: true },
  });

  for (const { id } of assigned) {
    await upsertTeacherBranchMember(branchId, id);
  }

  const branchHasTeacherActivity = assigned.length > 0
    || !!(await prisma.teacherAssignment.findFirst({
      where: { group: { academicYear: { branchId } } },
      select: { id: true },
    }));

  if (!branchHasTeacherActivity) return { linkedFromAssignments: assigned.length, linkedOrphans: 0 };

  const orphans = await prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      teacherProfile: { isNot: null },
      branchMembers: { none: { isActive: true } },
    },
    select: { id: true },
  });

  for (const { id } of orphans) {
    await upsertTeacherBranchMember(branchId, id);
  }

  return { linkedFromAssignments: assigned.length, linkedOrphans: orphans.length };
}

export async function searchBranchTeachers(branchId: string, term?: string) {
  await syncTeachersForBranch(branchId);

  const q = term?.trim();
  return prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: 'asc' },
    take: 50,
  });
}

/**
 * Canteen is branch-scoped only — never pass or persist academicYearId.
 * Credit accounts must reference a real branch student or branch staff user.
 */
export async function assertBranchCreditPerson(params: {
  branchId: string;
  personType: CanteenPersonType;
  studentId?: string | null;
  userId?: string | null;
}) {
  const { branchId, personType, studentId, userId } = params;

  if (personType === CanteenPersonType.STUDENT) {
    if (!studentId || userId) {
      throw { status: 400, message: 'Credit for a student requires studentId only' };
    }
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        isActive: true,
        status: 'ACTIVE',
        academicYear: { branchId },
      },
      select: { id: true, name: true, phone: true },
    });
    if (!student) {
      throw { status: 400, message: 'Student not found in this branch' };
    }
    return {
      displayName: student.name,
      displayPhone: student.phone ?? null,
      studentId: student.id,
      userId: null as string | null,
    };
  }

  if (personType === CanteenPersonType.TEACHER) {
    if (!userId || studentId) {
      throw { status: 400, message: 'Credit for a teacher requires userId only' };
    }
    const membership = await prisma.branchMember.findFirst({
      where: {
        branchId,
        userId,
        isActive: true,
        user: { role: 'teacher', status: 'active' },
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!membership?.user) {
      throw { status: 400, message: 'Teacher not found in this branch' };
    }
    return {
      displayName: membership.user.name,
      displayPhone: membership.user.phone ?? null,
      studentId: null as string | null,
      userId: membership.user.id,
    };
  }

  if (personType === CanteenPersonType.STAFF) {
    if (!userId || studentId) {
      throw { status: 400, message: 'Credit for staff requires userId only' };
    }
    const membership = await prisma.branchMember.findFirst({
      where: { branchId, userId, isActive: true },
      include: {
        user: {
          select: { id: true, name: true, phone: true, role: true, status: true },
        },
      },
    });
    if (!membership?.user || membership.user.status !== 'active') {
      throw { status: 400, message: 'Person not found in this branch' };
    }
    const isStaff =
      membership.user.role === 'management'
      || STAFF_BRANCH_ROLES.has(membership.role);
    if (!isStaff || membership.user.role === 'teacher') {
      throw { status: 400, message: 'Selected user is not branch staff' };
    }
    return {
      displayName: membership.user.name,
      displayPhone: membership.user.phone ?? null,
      studentId: null as string | null,
      userId: membership.user.id,
    };
  }

  throw { status: 400, message: 'Invalid credit person type' };
}

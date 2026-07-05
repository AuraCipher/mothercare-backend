import { CanteenPersonType } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const STAFF_BRANCH_ROLES = new Set([
  'branch_admin',
  'sub_admin',
  'management',
  'canteen_staff',
]);

async function activeBranchAcademicYearId(branchId: string) {
  const ay = await prisma.academicYear.findFirst({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return ay?.id ?? null;
}

/** Teachers in a branch: branch members OR assigned in the active academic year. */
export async function isTeacherInBranch(branchId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: 'teacher', status: 'active' },
    select: { id: true },
  });
  if (!user) return false;

  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId, isActive: true },
    select: { id: true },
  });
  if (member) return true;

  const ayId = await activeBranchAcademicYearId(branchId);
  if (!ayId) return false;

  const assigned = await prisma.teacherAssignment.findFirst({
    where: {
      teacherId: userId,
      academicYearId: ayId,
      group: { academicYear: { branchId } },
    },
    select: { id: true },
  });
  return !!assigned;
}

export async function searchBranchTeachers(branchId: string, term?: string) {
  const q = term?.trim();
  const nameFilter = q
    ? { name: { contains: q, mode: 'insensitive' as const } }
    : {};

  const memberTeachers = await prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
      ...nameFilter,
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: 'asc' },
    take: 100,
  });

  const ayId = await activeBranchAcademicYearId(branchId);
  let assignedTeachers: typeof memberTeachers = [];
  if (ayId) {
    assignedTeachers = await prisma.user.findMany({
      where: {
        role: 'teacher',
        status: 'active',
        teacherAssignments: {
          some: {
            academicYearId: ayId,
            group: { academicYear: { branchId } },
          },
        },
        ...nameFilter,
      },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  const byId = new Map(memberTeachers.map((t) => [t.id, t]));
  for (const teacher of assignedTeachers) {
    if (!byId.has(teacher.id)) byId.set(teacher.id, teacher);
  }

  return Array.from(byId.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);
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
    const inBranch = await isTeacherInBranch(branchId, userId);
    if (!inBranch) {
      throw { status: 400, message: 'Teacher not found in this branch' };
    }
    const user = await prisma.user.findFirst({
      where: { id: userId, role: 'teacher', status: 'active' },
      select: { id: true, name: true, phone: true },
    });
    if (!user) {
      throw { status: 400, message: 'Teacher not found in this branch' };
    }
    return {
      displayName: user.name,
      displayPhone: user.phone ?? null,
      studentId: null as string | null,
      userId: user.id,
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

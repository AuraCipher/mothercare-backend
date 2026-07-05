import { CanteenPersonType } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const STAFF_BRANCH_ROLES = new Set([
  'branch_admin',
  'sub_admin',
  'management',
  'canteen_staff',
]);

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

  if (personType === CanteenPersonType.TEACHER || personType === CanteenPersonType.STAFF) {
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
    if (personType === CanteenPersonType.TEACHER) {
      if (membership.user.role !== 'teacher') {
        throw { status: 400, message: 'Selected user is not a teacher in this branch' };
      }
    } else {
      const isStaff =
        membership.user.role === 'management'
        || STAFF_BRANCH_ROLES.has(membership.role);
      if (!isStaff || membership.user.role === 'teacher') {
        throw { status: 400, message: 'Selected user is not branch staff' };
      }
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

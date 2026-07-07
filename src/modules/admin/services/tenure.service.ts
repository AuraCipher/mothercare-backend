import { prisma } from '../../../lib/prisma';
import type { TenureEndReason } from '@prisma/client';

class TenureService {
  async listBranchTenures(branchMemberId: string) {
    return prisma.branchTenure.findMany({
      where: { branchMemberId },
      orderBy: { sequence: 'asc' },
    });
  }

  async recordBranchJoin(branchMemberId: string, joinedAt: Date, createdById?: string, previousTenureId?: string) {
    const last = await prisma.branchTenure.findFirst({
      where: { branchMemberId },
      orderBy: { sequence: 'desc' },
    });
    if (last && !last.leftAt) {
      throw { status: 409, message: 'Member already has an open tenure. Record leave before rejoining.' };
    }
    const sequence = (last?.sequence ?? 0) + 1;
    return prisma.branchTenure.create({
      data: {
        branchMemberId,
        sequence,
        joinedAt,
        previousTenureId: previousTenureId ?? last?.id,
        createdById,
      },
    });
  }

  async recordBranchLeave(
    branchMemberId: string,
    leftAt: Date,
    endReason: TenureEndReason,
    notes?: string,
  ) {
    const open = await prisma.branchTenure.findFirst({
      where: { branchMemberId, leftAt: null },
      orderBy: { sequence: 'desc' },
    });
    if (!open) throw { status: 404, message: 'No open tenure to close' };
    return prisma.branchTenure.update({
      where: { id: open.id },
      data: { leftAt, endReason, notes },
    });
  }

  async listStudentSchoolTenures(personId: string) {
    return prisma.studentSchoolTenure.findMany({
      where: { personId },
      orderBy: { sequence: 'asc' },
    });
  }

  async recordStudentJoin(
    personId: string,
    branchId: string,
    joinedAt: Date,
    createdById?: string,
  ) {
    const last = await prisma.studentSchoolTenure.findFirst({
      where: { personId },
      orderBy: { sequence: 'desc' },
    });
    if (last && !last.leftAt) {
      throw { status: 409, message: 'Student already has an open school tenure' };
    }
    const sequence = (last?.sequence ?? 0) + 1;
    return prisma.studentSchoolTenure.create({
      data: {
        personId,
        branchId,
        sequence,
        joinedAt,
        previousTenureId: last?.id,
        createdById,
      },
    });
  }

  async recordStudentLeave(
    personId: string,
    leftAt: Date,
    endReason: TenureEndReason,
    notes?: string,
  ) {
    const open = await prisma.studentSchoolTenure.findFirst({
      where: { personId, leftAt: null },
      orderBy: { sequence: 'desc' },
    });
    if (!open) throw { status: 404, message: 'No open student tenure to close' };
    return prisma.studentSchoolTenure.update({
      where: { id: open.id },
      data: { leftAt, endReason, notes },
    });
  }

  async recordClassMovement(input: {
    studentId: string;
    academicYearId: string;
    fromGroupId?: string | null;
    toGroupId: string;
    effectiveAt: Date;
    reason?: string;
    createdById?: string;
  }) {
    const last = await prisma.studentClassMovement.findFirst({
      where: { studentId: input.studentId },
      orderBy: { sequence: 'desc' },
    });
    const sequence = (last?.sequence ?? 0) + 1;
    const movement = await prisma.studentClassMovement.create({
      data: {
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        sequence,
        fromGroupId: input.fromGroupId ?? undefined,
        toGroupId: input.toGroupId,
        effectiveAt: input.effectiveAt,
        reason: input.reason,
        createdById: input.createdById,
      },
    });
    await prisma.student.update({
      where: { id: input.studentId },
      data: { groupId: input.toGroupId },
    });
    return movement;
  }
}

export const tenureService = new TenureService();

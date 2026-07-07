import { prisma } from '../../../lib/prisma';
import type { AcademicYearAuditAction, AcademicYearStatus } from '@prisma/client';

export interface CreateAcademicYearInput {
  branchId: string;
  calendarId: string;
  previousAcademicYearId?: string;
  directToArchived?: boolean; // Skip BUILD_STAGE, create directly as ARCHIVED (for historical import)
  createdById?: string;
}

export interface UpdateAcademicYearInput {
  previousAcademicYearId?: string;
  updatedById?: string;
}

class AcademicYearService {
  private async logAudit(input: {
    academicYearId: string;
    branchId: string;
    action: AcademicYearAuditAction;
    fromStatus?: AcademicYearStatus | null;
    toStatus?: AcademicYearStatus | null;
    note?: string;
    performedById?: string;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.academicYearAuditLog.create({
      data: {
        academicYearId: input.academicYearId,
        branchId: input.branchId,
        action: input.action,
        fromStatus: input.fromStatus ?? undefined,
        toStatus: input.toStatus ?? undefined,
        note: input.note?.trim() || null,
        performedById: input.performedById ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async create(data: CreateAcademicYearInput) {
    // Verify branch exists
    const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
    if (!branch) {
      throw { status: 404, message: 'Branch not found' };
    }

    // Verify calendar exists
    const calendar = await prisma.academicCalendar.findUnique({ where: { id: data.calendarId } });
    if (!calendar) {
      throw { status: 404, message: 'Academic calendar not found' };
    }

    // Enforce unique branch+calendar
    const existing = await prisma.academicYear.findFirst({
      where: { branchId: data.branchId, calendarId: data.calendarId },
    });
    if (existing) {
      throw {
        status: 409,
        message: `Academic year already exists for this branch and calendar (status: ${existing.status})`,
      };
    }

    // Skip BUILD_STAGE uniqueness check for historical imports
    if (!data.directToArchived) {
      const existingBuildStage = await prisma.academicYear.findFirst({
        where: { branchId: data.branchId, status: 'BUILD_STAGE' },
      });
      if (existingBuildStage) {
        throw {
          status: 409,
          message: 'A BUILD_STAGE academic year already exists for this branch. Publish or delete it first.',
        };
      }
    }

    // If previousAcademicYearId is provided, verify it exists
    if (data.previousAcademicYearId) {
      const prev = await prisma.academicYear.findUnique({
        where: { id: data.previousAcademicYearId },
      });
      if (!prev) {
        throw { status: 404, message: 'Previous academic year not found' };
      }
      if (prev.branchId !== data.branchId) {
        throw { status: 400, message: 'Previous academic year must belong to the same branch' };
      }
    }

    // Historical years are still created as BUILD_STAGE so the admin can add data.
    // They manually click Archive when done, or Publish if it should be the active year.
    const ay = await prisma.academicYear.create({
      data: {
        branchId: data.branchId,
        calendarId: data.calendarId,
        status: 'BUILD_STAGE',
        previousAcademicYearId: data.previousAcademicYearId ?? null,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        calendar: { select: { id: true, label: true } },
        _count: { select: { groups: true, students: true } },
      },
    });

    await this.logAudit({
      academicYearId: ay.id,
      branchId: ay.branchId,
      action: 'CREATED',
      toStatus: 'BUILD_STAGE',
      performedById: data.createdById,
      metadata: { calendarLabel: ay.calendar.label },
    });

    return ay;
  }

  async findAll(branchId?: string, status?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    return prisma.academicYear.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        calendar: { select: { id: true, label: true } },
        _count: { select: { groups: true, students: true, members: true } },
      },
    });
  }

  async findById(id: string) {
    const ay = await prisma.academicYear.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        calendar: { select: { id: true, label: true, startDate: true, endDate: true } },
        previousAcademicYear: { select: { id: true, status: true } },
        nextAcademicYears: { select: { id: true, status: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        },
        groups: {
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            name: true,
            section: true,
            displayOrder: true,
            _count: { select: { members: true, students: true } },
          },
        },
        _count: { select: { groups: true, students: true, members: true, subjects: true } },
      },
    });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }
    return ay;
  }

  async update(id: string, data: UpdateAcademicYearInput) {
    const existing = await prisma.academicYear.findUnique({ where: { id } });
    if (!existing) {
      throw { status: 404, message: 'Academic year not found' };
    }

    return prisma.academicYear.update({
      where: { id },
      data: {
        ...(data.previousAcademicYearId !== undefined
          ? { previousAcademicYearId: data.previousAcademicYearId }
          : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        calendar: { select: { id: true, label: true } },
      },
    });
  }

  async pause(id: string) {
    const ay = await prisma.academicYear.findUnique({ where: { id }, select: { status: true } });
    if (!ay) throw { status: 404, message: 'Academic year not found' };
    if (ay.status !== 'ACTIVE') throw { status: 400, message: 'Only ACTIVE years can be paused' };

    return prisma.academicYear.update({
      where: { id },
      data: { status: 'ON_HOLD' },
    });
  }

  async resume(id: string) {
    const ay = await prisma.academicYear.findUnique({ where: { id }, select: { status: true } });
    if (!ay) throw { status: 404, message: 'Academic year not found' };
    if (ay.status !== 'ON_HOLD') throw { status: 400, message: 'Only ON_HOLD years can be resumed' };

    return prisma.academicYear.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }

  async publish(id: string) {
    const ay = await prisma.academicYear.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }

    if (ay.status === 'ACTIVE') {
      throw { status: 409, message: 'Academic year is already ACTIVE' };
    }

    if (ay.status === 'ARCHIVED') {
      throw { status: 400, message: 'Cannot publish an ARCHIVED academic year' };
    }

    // Ensure only one ACTIVE per branch
    const activeAy = await prisma.academicYear.findFirst({
      where: { branchId: ay.branchId, status: 'ACTIVE', id: { not: id } },
    });
    if (activeAy) {
      throw {
        status: 409,
        message: `Branch "${ay.branch.name}" already has an ACTIVE academic year. Archive it first.`,
      };
    }

    const updated = await prisma.academicYear.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: {
        branch: { select: { id: true, name: true } },
        calendar: { select: { id: true, label: true } },
        _count: { select: { groups: true, students: true } },
      },
    });

    await this.logAudit({
      academicYearId: id,
      branchId: ay.branchId,
      action: 'PUBLISHED',
      fromStatus: ay.status,
      toStatus: 'ACTIVE',
    });

    return updated;
  }

  async archive(id: string, performedById?: string) {
    const ay = await prisma.academicYear.findUnique({ where: { id } });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }

    if (ay.status === 'ARCHIVED') {
      throw { status: 409, message: 'Academic year is already ARCHIVED' };
    }

    const updated = await prisma.academicYear.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await this.logAudit({
      academicYearId: id,
      branchId: ay.branchId,
      action: 'ARCHIVED',
      fromStatus: ay.status,
      toStatus: 'ARCHIVED',
      performedById,
    });

    return updated;
  }

  /**
   * Remove a year from the archive bucket so it can be edited again.
   * BUILD_STAGE = setup / historical data entry; ON_HOLD = paused operational year.
   */
  async unarchive(id: string, target: 'BUILD_STAGE' | 'ON_HOLD' = 'BUILD_STAGE', performedById?: string) {
    const ay = await prisma.academicYear.findUnique({ where: { id } });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }
    if (ay.status !== 'ARCHIVED') {
      throw { status: 400, message: 'Only ARCHIVED academic years can be restored from the archive' };
    }

    if (target === 'BUILD_STAGE') {
      const existingBuild = await prisma.academicYear.findFirst({
        where: { branchId: ay.branchId, status: 'BUILD_STAGE', id: { not: id } },
      });
      if (existingBuild) {
        throw {
          status: 409,
          message: 'Another BUILD_STAGE year already exists. Publish or archive it before restoring this year to setup mode.',
        };
      }
    }

    if (target === 'ON_HOLD') {
      const activeAy = await prisma.academicYear.findFirst({
        where: { branchId: ay.branchId, status: 'ACTIVE', id: { not: id } },
      });
      if (!activeAy) {
        throw {
          status: 400,
          message: 'Cannot restore to ON_HOLD without an ACTIVE year in the branch. Use BUILD_STAGE for historical re-entry.',
        };
      }
    }

    const updated = await prisma.academicYear.update({
      where: { id },
      data: { status: target },
      include: {
        branch: { select: { id: true, name: true } },
        calendar: { select: { id: true, label: true } },
        _count: { select: { groups: true, students: true } },
      },
    });

    await this.logAudit({
      academicYearId: id,
      branchId: ay.branchId,
      action: 'UNARCHIVED',
      fromStatus: 'ARCHIVED',
      toStatus: target,
      performedById,
      note: `Restored to ${target}`,
    });

    return updated;
  }

  async getDeletePreview(id: string) {
    const ay = await prisma.academicYear.findUnique({
      where: { id },
      include: {
        calendar: { select: { label: true } },
        _count: {
          select: {
            groups: true,
            students: true,
            members: true,
            attendances: true,
            studentFees: true,
            examSessions: true,
            feeStructures: true,
            teacherAttendances: true,
            staffAttendances: true,
          },
        },
      },
    });
    if (!ay) throw { status: 404, message: 'Academic year not found' };

    return {
      id: ay.id,
      label: ay.calendar.label,
      status: ay.status,
      canDelete: ay.status === 'ARCHIVED',
      counts: ay._count,
    };
  }

  async listAuditLogs(branchId: string, opts?: { academicYearId?: string; limit?: number }) {
    return prisma.academicYearAuditLog.findMany({
      where: {
        branchId,
        ...(opts?.academicYearId ? { academicYearId: opts.academicYearId } : {}),
      },
      include: {
        performedBy: { select: { id: true, name: true } },
        academicYear: { include: { calendar: { select: { label: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async delete(id: string, opts?: { confirmLabel?: string; performedById?: string }) {
    const ay = await prisma.academicYear.findUnique({
      where: { id },
      include: {
        calendar: { select: { label: true } },
        _count: { select: { groups: true, students: true, members: true } },
      },
    });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }

    if (ay.status === 'ACTIVE') {
      throw { status: 409, message: 'Cannot delete an ACTIVE academic year. Archive it first.' };
    }

    if (ay.status === 'BUILD_STAGE') {
      throw {
        status: 409,
        message: 'Cannot delete a BUILD_STAGE academic year. Archive it first or remove its contents.',
      };
    }

    if (ay.status !== 'ARCHIVED') {
      throw { status: 400, message: 'Only ARCHIVED academic years can be permanently deleted' };
    }

    const expectedLabel = ay.calendar.label.trim();
    if (!opts?.confirmLabel || opts.confirmLabel.trim() !== expectedLabel) {
      throw {
        status: 400,
        message: `Type the year label exactly to confirm: "${expectedLabel}"`,
      };
    }

    await this.logAudit({
      academicYearId: id,
      branchId: ay.branchId,
      action: 'DELETED',
      fromStatus: ay.status,
      performedById: opts.performedById,
      note: 'Permanent delete from archive bucket',
      metadata: { counts: ay._count, label: expectedLabel },
    });

    return prisma.academicYear.delete({ where: { id } });
  }

  // ─── Member Management ───────────────────────────────────────

  async addMember(academicYearId: string, userId: string, role: string) {
    const ay = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!ay) {
      throw { status: 404, message: 'Academic year not found' };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw { status: 404, message: 'User not found' };
    }

    const existing = await prisma.academicYearMember.findUnique({
      where: { academicYearId_userId: { academicYearId, userId } },
    });
    if (existing) {
      throw { status: 409, message: 'User is already a member of this academic year' };
    }

    return prisma.academicYearMember.create({
      data: {
        academicYearId,
        userId,
        role: role as any, // Validated by Zod schema in route
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async removeMember(academicYearId: string, userId: string) {
    const existing = await prisma.academicYearMember.findUnique({
      where: { academicYearId_userId: { academicYearId, userId } },
    });
    if (!existing) {
      throw { status: 404, message: 'Membership not found' };
    }

    await prisma.academicYearMember.delete({
      where: { academicYearId_userId: { academicYearId, userId } },
    });
  }

  // ─── Branch Member Management ────────────────────────────────

  async addBranchMember(branchId: string, userId: string) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw { status: 404, message: 'Branch not found' };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw { status: 404, message: 'User not found' };
    }

    const existing = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });
    if (existing) {
      throw { status: 409, message: 'User is already a member of this branch' };
    }

    return prisma.branchMember.create({
      data: { branchId, userId },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async removeBranchMember(branchId: string, userId: string) {
    const existing = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });
    if (!existing) {
      throw { status: 404, message: 'Branch membership not found' };
    }

    await prisma.branchMember.delete({
      where: { branchId_userId: { branchId, userId } },
    });
  }

  // ─── Current User's Academic Year ────────────────────────────

  async findCurrentAcademicYear(userId: string) {
    // Get the user's branch memberships
    const branchMemberships = await prisma.branchMember.findMany({
      where: { userId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    if (branchMemberships.length === 0) {
      throw { status: 404, message: 'User is not a member of any branch' };
    }

    // Find ACTIVE academic year for the first branch
    const branchId = branchMemberships[0].branch.id;
    const activeAy = await prisma.academicYear.findFirst({
      where: { branchId, status: 'ACTIVE' },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        calendar: { select: { id: true, label: true, startDate: true, endDate: true } },
        _count: { select: { groups: true, students: true, members: true } },
      },
    });

    if (!activeAy) {
      throw { status: 404, message: 'No active academic year found for your branch' };
    }

    return activeAy;
  }
}

export const academicYearService = new AcademicYearService();

import { prisma } from '../../../lib/prisma';
import type { BranchRole } from '@prisma/client';

export interface AddMemberInput {
  branchId: string;
  userId: string;
  role: BranchRole;
  keepTeacherRole?: boolean;
  assignedById?: string;
}

export interface UpdateMemberInput {
  role?: BranchRole;
  keepTeacherRole?: boolean;
  updatedById?: string;
}

class BranchMemberService {
  async addMember(data: AddMemberInput) {
    // Verify branch exists
    const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
    if (!branch) throw { status: 404, message: 'Branch not found' };

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw { status: 404, message: 'User not found' };

    // Check for existing membership
    const existing = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: data.branchId, userId: data.userId } },
    });
    if (existing) {
      throw { status: 409, message: 'User is already a member of this branch' };
    }

    // Enforce one branch_admin per branch
    if (data.role === 'branch_admin') {
      const existingAdmin = await prisma.branchMember.findFirst({
        where: { branchId: data.branchId, role: 'branch_admin', isActive: true },
      });
      if (existingAdmin) {
        throw {
          status: 409,
          message: 'This branch already has a branch_admin (Principal). Remove or reassign them first.',
        };
      }
    }

    return prisma.branchMember.create({
      data: {
        branchId: data.branchId,
        userId: data.userId,
        role: data.role,
        keepTeacherRole: data.keepTeacherRole ?? true,
        assignedById: data.assignedById,
      },
      include: {
        user: { select: { id: true, name: true, role: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async updateRole(branchId: string, userId: string, data: UpdateMemberInput) {
    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });
    if (!membership) throw { status: 404, message: 'Branch membership not found' };

    // If promoting to branch_admin, enforce one-admin rule
    if (data.role === 'branch_admin' && membership.role !== 'branch_admin') {
      const existingAdmin = await prisma.branchMember.findFirst({
        where: { branchId, role: 'branch_admin', isActive: true, userId: { not: userId } },
      });
      if (existingAdmin) {
        throw { status: 409, message: 'This branch already has a branch_admin (Principal).' };
      }
    }

    // If demoting from branch_admin to non-teacher role, reset keepTeacherRole
    const updateData: any = {};
    if (data.role !== undefined) updateData.role = data.role;
    if (data.keepTeacherRole !== undefined) {
      updateData.keepTeacherRole = data.keepTeacherRole;
    } else if (membership.role === 'branch_admin' && data.role && data.role !== 'teacher' && data.role !== 'branch_admin') {
      // Demoting from admin to non-teacher: keepTeacherRole becomes false
      updateData.keepTeacherRole = false;
    }

    return prisma.branchMember.update({
      where: { branchId_userId: { branchId, userId } },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async removeMember(branchId: string, userId: string) {
    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });
    if (!membership) throw { status: 404, message: 'Branch membership not found' };

    // If this is the last active branch_admin, require successor
    if (membership.role === 'branch_admin' && membership.isActive) {
      const adminCount = await prisma.branchMember.count({
        where: { branchId, role: 'branch_admin', isActive: true, userId: { not: userId } },
      });
      if (adminCount === 0) {
        throw {
          status: 409,
          message: 'Cannot remove the only branch_admin. Promote a successor first.',
        };
      }
    }

    // Soft delete
    await prisma.branchMember.update({
      where: { branchId_userId: { branchId, userId } },
      data: { isActive: false },
    });
  }

  async listStaff(branchId: string, roleFilter?: string) {
    const where: any = { branchId, isActive: true };
    if (roleFilter) where.role = roleFilter;

    return prisma.branchMember.findMany({
      where,
      orderBy: [
        { role: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        user: { select: { id: true, name: true, role: true, email: true } },
      },
    });
  }

  async listUserBranches(userId: string) {
    return prisma.branchMember.findMany({
      where: { userId, isActive: true },
      include: {
        branch: { select: { id: true, name: true, code: true, isActive: true } },
      },
    });
  }
}

export const branchMemberService = new BranchMemberService();

import { prisma } from '../../../lib/prisma';
import { branchMemberService } from './branch-member.service';

class BranchAdminService {
  /**
   * CEO promotes a user to branch_admin at a branch.
   * keepTeacherRole: if true, user stays in TeacherProfile + group assignments.
   */
  async promoteToAdmin(branchId: string, userId: string, keepTeacherRole: boolean = true) {
    // Verify user exists at this branch
    let membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });

    if (!membership) {
      // User is not a member yet — add them as branch_admin
      return branchMemberService.addMember({
        branchId,
        userId,
        role: 'branch_admin',
        keepTeacherRole,
      });
    }

    if (membership.role === 'branch_admin') {
      throw { status: 409, message: 'User is already a branch_admin at this branch' };
    }

    // Check one-admin rule
    const existingAdmin = await prisma.branchMember.findFirst({
      where: { branchId, role: 'branch_admin', isActive: true, userId: { not: userId } },
    });
    if (existingAdmin) {
      throw { status: 409, message: 'This branch already has a branch_admin. Remove or reassign them first.' };
    }

    return branchMemberService.updateRole(branchId, userId, {
      role: 'branch_admin',
      keepTeacherRole,
    });
  }

  /**
   * Principal resigns with succession.
   * TRANSACTION: demotes caller, promotes successor to branch_admin.
   */
  async resign(
    branchId: string,
    resigningUserId: string,
    successorUserId: string,
    demoteToRole: string = 'teacher',
  ) {
    // Validate successor exists at this branch
    const successor = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: successorUserId } },
    });
    if (!successor) {
      throw { status: 400, message: 'Successor must be an existing member of this branch' };
    }
    if (successor.role === 'branch_admin') {
      throw { status: 409, message: 'Successor is already a branch_admin' };
    }
    if (!successor.isActive) {
      throw { status: 400, message: 'Successor is not an active member of this branch' };
    }

    // Validate demoteToRole is valid
    const validDemotions = ['sub_admin', 'management', 'teacher', 'parent'];
    if (!validDemotions.includes(demoteToRole)) {
      throw { status: 400, message: `Invalid demotion role. Must be one of: ${validDemotions.join(', ')}` };
    }

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      // Promote successor to branch_admin
      await tx.branchMember.update({
        where: { branchId_userId: { branchId, userId: successorUserId } },
        data: {
          role: 'branch_admin',
          keepTeacherRole: successor.keepTeacherRole,
        },
      });

      // Demote resigning user
      const resigningKeepTeacher = demoteToRole === 'teacher' ? true : false;
      await tx.branchMember.update({
        where: { branchId_userId: { branchId, userId: resigningUserId } },
        data: {
          role: demoteToRole as any,
          keepTeacherRole: resigningKeepTeacher,
          resignedAt: new Date(),
          resignedInFavorOfId: successorUserId,
        },
      });
    });

    return {
      message: `Successor promoted to branch_admin. Resigning user demoted to ${demoteToRole}.`,
      successorUserId,
    };
  }
}

export const branchAdminService = new BranchAdminService();

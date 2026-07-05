import { prisma } from '../../../lib/prisma';
import { hashPassword } from '../../../lib/password';
import type { StaffModule } from '@prisma/client';
import {
  normalizePermissionInput,
  type ModulePermissionInput,
  FULL_ADMIN_BRANCH_ROLES,
  type ResolvedModulePermission,
} from '../staff-permissions.constants';

export type StaffMemberRow = {
  userId: string;
  branchMemberId: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  branchRole: string;
  permissions: ResolvedModulePermission[];
};

class StaffService {
  private mapMember(m: {
    id: string;
    role: string;
    user: {
      id: string;
      name: string;
      username: string | null;
      email: string | null;
      phone: string | null;
      status: string;
    };
    modulePermissions: Array<{
      module: StaffModule;
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }>;
  }): StaffMemberRow {
    return {
      userId: m.user.id,
      branchMemberId: m.id,
      name: m.user.name,
      username: m.user.username,
      email: m.user.email,
      phone: m.user.phone,
      status: m.user.status,
      branchRole: m.role,
      permissions: m.modulePermissions.map((p) => ({
        module: p.module as ResolvedModulePermission['module'],
        canCreate: p.canCreate,
        canRead: true,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
      })),
    };
  }

  async listBranchStaff(
    branchId: string,
    opts?: { search?: string; status?: string },
  ): Promise<StaffMemberRow[]> {
    const where: any = {
      branchId,
      role: { in: ['management', 'canteen_staff'] },
      OR: [
        { modulePermissions: { some: {} } },
        { role: 'canteen_staff' },
      ],
    };

    const members = await prisma.branchMember.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        modulePermissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let rows = members.map((m) => this.mapMember(m));

    if (opts?.status && opts.status !== 'all') {
      rows = rows.filter((r) => r.status === opts.status);
    }
    if (opts?.search?.trim()) {
      const q = opts.search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q)
          || (r.username || '').toLowerCase().includes(q)
          || (r.email || '').toLowerCase().includes(q),
      );
    }
    return rows;
  }

  async getStaffDetail(branchId: string, userId: string) {
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: {
        modulePermissions: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            phone: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
      },
    });
    if (!member) throw { status: 404, message: 'Staff member not found in this branch' };
    if (!['management', 'canteen_staff'].includes(member.role)) {
      throw { status: 404, message: 'Staff member not found in this branch' };
    }
    return {
      ...this.mapMember(member),
      createdAt: member.user.createdAt,
      lastLoginAt: member.user.lastLoginAt,
      isActive: member.isActive,
    };
  }

  async updateStaffProfile(
    branchId: string,
    userId: string,
    data: { name?: string; email?: string; phone?: string },
  ) {
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
    });
    if (!member) throw { status: 404, message: 'Staff member not found' };

    if (data.email) {
      const clash = await prisma.user.findFirst({
        where: { email: data.email.trim(), id: { not: userId } },
      });
      if (clash) throw { status: 409, message: 'Email already in use' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      },
    });

    return this.getStaffDetail(branchId, userId);
  }

  async deactivateStaff(branchId: string, userId: string) {
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: { user: { select: { name: true, status: true } } },
    });
    if (!member) throw { status: 404, message: 'Staff member not found' };
    if (member.user.status === 'inactive') {
      throw { status: 400, message: 'Staff member is already inactive' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
    await prisma.branchMember.update({
      where: { branchId_userId: { branchId, userId } },
      data: { isActive: false },
    });

    return { message: `"${member.user.name}" deactivated.` };
  }

  async reactivateStaff(branchId: string, userId: string) {
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: { user: { select: { name: true, status: true } } },
    });
    if (!member) throw { status: 404, message: 'Staff member not found' };
    if (member.user.status === 'active') {
      throw { status: 400, message: 'Staff member is already active' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    });
    await prisma.branchMember.update({
      where: { branchId_userId: { branchId, userId } },
      data: { isActive: true },
    });

    return { message: `"${member.user.name}" reactivated.` };
  }

  async createStaff(
    branchId: string,
    data: {
      name: string;
      username: string;
      password?: string;
      email?: string;
      phone?: string;
      permissions: ModulePermissionInput[];
    },
    createdById?: string,
  ) {
    const permissions = normalizePermissionInput(data.permissions);

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: data.username },
          ...(data.email ? [{ email: data.email }] : []),
        ],
      },
    });
    if (existingUser) {
      throw { status: 409, message: 'Username or email already exists' };
    }

    const password = data.password?.trim()
      || `tmp_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

    const passwordHash = await hashPassword(password);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name.trim(),
          username: data.username.trim(),
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
          passwordHash,
          role: 'management',
          status: 'active',
        },
      });

      const member = await tx.branchMember.create({
        data: {
          branchId,
          userId: user.id,
          role: 'management',
          assignedById: createdById,
        },
      });

      await tx.staffModulePermission.createMany({
        data: permissions.map((p) => ({
          branchMemberId: member.id,
          module: p.module as StaffModule,
          canCreate: p.canCreate,
          canRead: true,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete,
        })),
      });

      const saved = await tx.staffModulePermission.findMany({
        where: { branchMemberId: member.id },
      });

      return {
        userId: user.id,
        branchMemberId: member.id,
        name: user.name,
        username: user.username,
        permissions: saved.map((p) => ({
          module: p.module,
          canCreate: p.canCreate,
          canRead: true,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete,
        })),
      };
    });
  }

  async setStaffPermissions(
    branchId: string,
    userId: string,
    permissions: ModulePermissionInput[],
  ) {
    const normalized = normalizePermissionInput(permissions);

    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: { modulePermissions: true },
    });
    if (!member) {
      throw { status: 404, message: 'Staff member not found in this branch' };
    }
    if (FULL_ADMIN_BRANCH_ROLES.has(member.role)) {
      throw { status: 400, message: 'Cannot restrict module permissions for branch admins' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.staffModulePermission.deleteMany({ where: { branchMemberId: member.id } });
      await tx.staffModulePermission.createMany({
        data: normalized.map((p) => ({
          branchMemberId: member.id,
          module: p.module as StaffModule,
          canCreate: p.canCreate,
          canRead: true,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete,
        })),
      });
    });

    return this.getStaffPermissions(branchId, userId);
  }

  async getStaffPermissions(branchId: string, userId: string) {
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: {
        modulePermissions: true,
        user: { select: { id: true, name: true, username: true, status: true } },
      },
    });
    if (!member) {
      throw { status: 404, message: 'Staff member not found in this branch' };
    }

    return {
      userId: member.user.id,
      branchMemberId: member.id,
      name: member.user.name,
      username: member.user.username,
      branchRole: member.role,
      isFullAdmin: FULL_ADMIN_BRANCH_ROLES.has(member.role),
      permissions: member.modulePermissions.map((p) => ({
        module: p.module,
        canCreate: p.canCreate,
        canRead: true,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
      })),
    };
  }

  async resolveUserAccess(userId: string, branchId: string, globalRole: string) {
    if (globalRole === 'super_admin') {
      return { isRestricted: false as const, isFullAdmin: true, permissions: [] as ResolvedModulePermission[] };
    }

    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: { modulePermissions: true },
    });

    if (!member || !member.isActive) {
      return { isRestricted: true as const, isFullAdmin: false, permissions: [] as ResolvedModulePermission[] };
    }

    if (FULL_ADMIN_BRANCH_ROLES.has(member.role)) {
      return { isRestricted: false as const, isFullAdmin: true, permissions: [] as ResolvedModulePermission[] };
    }

    const permissions = (member.modulePermissions ?? []).map((p) => ({
      module: p.module as ResolvedModulePermission['module'],
      canCreate: p.canCreate,
      canRead: true,
      canUpdate: p.canUpdate,
      canDelete: p.canDelete,
    }));

    // Legacy canteen_staff without module rows → canteen read + sales actions
    if (member.role === 'canteen_staff' && permissions.length === 0) {
      return {
        isRestricted: true as const,
        isFullAdmin: false,
        permissions: [{
          module: 'CANTEEN' as const,
          canCreate: true,
          canRead: true,
          canUpdate: false,
          canDelete: false,
        }],
      };
    }

    // management with no module rows → full branch admin UI (backward compat)
    if (permissions.length === 0) {
      return { isRestricted: false as const, isFullAdmin: false, permissions: [] as ResolvedModulePermission[] };
    }

    return { isRestricted: true as const, isFullAdmin: false, permissions };
  }

  async setPassword(
    branchId: string,
    userId: string,
    newPassword: string,
    adminId: string,
    adminPassword: string,
    ipAddress?: string,
  ) {
    const bc = await import('bcryptjs');
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      include: { user: { select: { id: true, username: true, name: true } } },
    });
    if (!member) throw { status: 404, message: 'Staff member not found' };

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw { status: 404, message: 'Admin user not found' };

    const isMatch = await bc.compare(adminPassword, admin.passwordHash);
    if (!isMatch) throw { status: 403, message: 'Admin password is incorrect' };

    const recentChanges = await prisma.auditLog.findMany({
      where: { entity: 'StaffMember', entityId: member.id, action: 'password_reset' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { newValue: true },
    });
    for (const entry of recentChanges) {
      const prevHash = (entry.newValue as any)?.passwordHash;
      if (prevHash && typeof prevHash === 'string') {
        const isReused = await bc.compare(newPassword, prevHash);
        if (isReused) {
          throw { status: 409, message: 'This password was used recently. Please choose a different one.' };
        }
      }
    }

    const newHash = await bc.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'password_reset',
          entity: 'StaffMember',
          entityId: member.id,
          newValue: {
            username: member.user.username || member.user.name,
            passwordHash: newHash,
          },
          ipAddress,
        },
      });
    } catch { /* best-effort */ }

    return { message: 'Password updated successfully' };
  }

  async sendCredentials(
    branchId: string,
    staffUserId: string,
    adminId: string,
    ipAddress?: string,
  ) {
    const bc = await import('bcryptjs');
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: staffUserId } },
      include: {
        user: { select: { id: true, name: true, username: true, phone: true } },
      },
    });
    if (!member) throw { status: 404, message: 'Staff member not found' };

    const phone = member.user.phone?.trim();
    if (!phone) throw { status: 400, message: 'No phone number on file. Add a phone number first.' };

    const { generatePassword } = await import('../../../utils/username');
    const tempPassword = generatePassword();
    const hash = await bc.hash(tempPassword, 12);
    await prisma.user.update({
      where: { id: staffUserId },
      data: { passwordHash: hash },
    });

    const notificationService = (await import('../../../services/notification.service')).default;
    const result = await notificationService.sendCredential({
      to: phone,
      username: member.user.username || member.user.name,
      password: tempPassword,
      name: member.user.name,
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'credential_sent',
          entity: 'StaffMember',
          entityId: member.id,
          newValue: {
            sent: result.success,
            status: result.success ? 'sent' : 'failed',
            to: phone.slice(0, 6) + '****',
          },
          ipAddress,
        },
      });
    } catch { /* best-effort */ }

    return { sent: result.success, status: result.success ? 'sent' : 'failed' };
  }
}

export const staffService = new StaffService();

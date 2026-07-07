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
  profilePhotoId?: string | null;
  employeeId?: string | null;
  qualification?: string | null;
};

export type StaffProfileFields = {
  employeeId?: string;
  qualification?: string;
  specialization?: string;
  joiningDate?: string;
  salary?: number;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  dateOfBirth?: string;
  gender?: string;
  bloodGroup?: string;
  fatherName?: string;
  cardId?: string;
  severeDisease?: string;
  experience?: string;
  bio?: string;
  profilePhotoId?: string | null;
};

class StaffService {
  private mapPermissionRow(p: {
    module: StaffModule;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    archivedCanRead?: boolean;
    archivedCanCreate?: boolean;
    archivedCanUpdate?: boolean;
    archivedCanDelete?: boolean;
  }): ResolvedModulePermission {
    return {
      module: p.module as ResolvedModulePermission['module'],
      canCreate: p.canCreate,
      canRead: true,
      canUpdate: p.canUpdate,
      canDelete: p.canDelete,
      archivedCanRead: !!p.archivedCanRead,
      archivedCanCreate: !!p.archivedCanCreate,
      archivedCanUpdate: !!p.archivedCanUpdate,
      archivedCanDelete: !!p.archivedCanDelete,
    };
  }

  private async ensureStaffProfile(userId: string) {
    const existing = await prisma.staffProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.staffProfile.create({ data: { userId } });
  }

  private serializeProfile(profile: {
    id: string;
    employeeId: string | null;
    qualification: string | null;
    specialization: string | null;
    joiningDate: Date | null;
    salary: { toString(): string } | null;
    phone: string | null;
    emergencyContact: string | null;
    address: string | null;
    dateOfBirth: Date | null;
    gender: string | null;
    bloodGroup: string | null;
    fatherName: string | null;
    cardId: string | null;
    severeDisease: string | null;
    experience: string | null;
    bio: string | null;
  }) {
    return {
      profileId: profile.id,
      employeeId: profile.employeeId,
      qualification: profile.qualification,
      specialization: profile.specialization,
      joiningDate: profile.joiningDate,
      salary: profile.salary != null ? Number(profile.salary) : null,
      phone: profile.phone,
      emergencyContact: profile.emergencyContact,
      address: profile.address,
      dateOfBirth: profile.dateOfBirth,
      gender: profile.gender,
      bloodGroup: profile.bloodGroup,
      fatherName: profile.fatherName,
      cardId: profile.cardId,
      severeDisease: profile.severeDisease,
      experience: profile.experience,
      bio: profile.bio,
    };
  }
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
      profilePhotoId?: string | null;
      staffProfile?: {
        employeeId: string | null;
        qualification: string | null;
      } | null;
    };
    modulePermissions: Array<{
      module: StaffModule;
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
      archivedCanRead?: boolean;
      archivedCanCreate?: boolean;
      archivedCanUpdate?: boolean;
      archivedCanDelete?: boolean;
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
      profilePhotoId: m.user.profilePhotoId,
      employeeId: m.user.staffProfile?.employeeId ?? null,
      qualification: m.user.staffProfile?.qualification ?? null,
      permissions: m.modulePermissions.map((p) => this.mapPermissionRow(p)),
    };
  }

  async listBranchStaff(
    branchId: string,
    opts?: { search?: string; status?: string },
  ): Promise<StaffMemberRow[]> {
    const where: any = {
      branchId,
      role: { in: ['management', 'canteen_staff', 'worker'] },
      OR: [
        { modulePermissions: { some: {} } },
        { role: 'canteen_staff' },
        { role: 'worker' },
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
            profilePhotoId: true,
            staffProfile: true,
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
          || (r.email || '').toLowerCase().includes(q)
          || (r.employeeId || '').toLowerCase().includes(q),
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
            profilePhotoId: true,
            createdAt: true,
            lastLoginAt: true,
            staffProfile: true,
          },
        },
      },
    });
    if (!member) throw { status: 404, message: 'Staff member not found in this branch' };
    if (!['management', 'canteen_staff', 'worker'].includes(member.role)) {
      throw { status: 404, message: 'Staff member not found in this branch' };
    }

    const profile = member.user.staffProfile ?? await this.ensureStaffProfile(userId);

    return {
      ...this.mapMember(member),
      ...this.serializeProfile(profile),
      profilePhotoId: member.user.profilePhotoId,
      createdAt: member.user.createdAt,
      lastLoginAt: member.user.lastLoginAt,
      isActive: member.isActive,
    };
  }

  async updateStaffProfile(
    branchId: string,
    userId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
    } & StaffProfileFields,
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

    if (data.employeeId) {
      const clash = await prisma.staffProfile.findFirst({
        where: { employeeId: data.employeeId.trim(), userId: { not: userId } },
      });
      if (clash) throw { status: 409, message: `Employee ID "${data.employeeId}" is already in use` };
    }

    await this.ensureStaffProfile(userId);

    const profilePhone = data.phone?.trim() || undefined;
    const userPhone = profilePhone ?? data.phone;

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(userPhone !== undefined ? { phone: userPhone?.trim() || null } : {}),
      },
    });

    if (data.profilePhotoId !== undefined) {
      const oldUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { profilePhotoId: true },
      });
      const oldPhotoId = oldUser?.profilePhotoId;
      if (oldPhotoId && oldPhotoId !== data.profilePhotoId) {
        try {
          const oldRecord = await prisma.fileRecord.findUnique({ where: { id: oldPhotoId } });
          if (oldRecord) {
            const fs = await import('fs/promises');
            const path = await import('path');
            await fs.unlink(path.join(process.cwd(), oldRecord.storagePath)).catch(() => {});
            await prisma.fileRecord.delete({ where: { id: oldPhotoId } }).catch(() => {});
          }
        } catch { /* best-effort */ }
      }
      await prisma.user.update({
        where: { id: userId },
        data: { profilePhotoId: data.profilePhotoId || null },
      });
    }

    await prisma.staffProfile.update({
      where: { userId },
      data: {
        employeeId: data.employeeId !== undefined ? (data.employeeId.trim() || null) : undefined,
        qualification: data.qualification !== undefined ? (data.qualification.trim() || null) : undefined,
        specialization: data.specialization !== undefined ? (data.specialization.trim() || null) : undefined,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : data.joiningDate === '' ? null : undefined,
        salary: data.salary !== undefined ? data.salary : undefined,
        phone: profilePhone !== undefined ? (profilePhone || null) : undefined,
        emergencyContact: data.emergencyContact !== undefined ? (data.emergencyContact.trim() || null) : undefined,
        address: data.address !== undefined ? (data.address.trim() || null) : undefined,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : data.dateOfBirth === '' ? null : undefined,
        gender: data.gender !== undefined ? (data.gender as any || null) : undefined,
        bloodGroup: data.bloodGroup !== undefined ? (data.bloodGroup.trim() || null) : undefined,
        fatherName: data.fatherName !== undefined ? (data.fatherName.trim() || null) : undefined,
        cardId: data.cardId !== undefined ? (data.cardId.trim() || null) : undefined,
        severeDisease: data.severeDisease !== undefined ? (data.severeDisease.trim() || null) : undefined,
        experience: data.experience !== undefined ? (data.experience.trim() || null) : undefined,
        bio: data.bio !== undefined ? (data.bio.trim() || null) : undefined,
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
    } & StaffProfileFields,
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

    if (data.employeeId?.trim()) {
      const clash = await prisma.staffProfile.findFirst({
        where: { employeeId: data.employeeId.trim() },
      });
      if (clash) throw { status: 409, message: `Employee ID "${data.employeeId}" is already in use` };
    }

    const password = data.password?.trim()
      || `tmp_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

    const passwordHash = await hashPassword(password);
    const profilePhone = data.phone?.trim() || null;

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name.trim(),
          username: data.username.trim(),
          email: data.email?.trim() || null,
          phone: profilePhone,
          passwordHash,
          role: 'management',
          status: 'active',
          ...(data.profilePhotoId ? { profilePhotoId: data.profilePhotoId } : {}),
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
          archivedCanRead: p.archivedCanRead ?? false,
          archivedCanCreate: p.archivedCanCreate ?? false,
          archivedCanUpdate: p.archivedCanUpdate ?? false,
          archivedCanDelete: p.archivedCanDelete ?? false,
        })),
      });

      await tx.staffProfile.create({
        data: {
          userId: user.id,
          phone: profilePhone,
          employeeId: data.employeeId?.trim() || null,
          qualification: data.qualification?.trim() || null,
          specialization: data.specialization?.trim() || null,
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
          salary: data.salary ?? null,
          emergencyContact: data.emergencyContact?.trim() || null,
          address: data.address?.trim() || null,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          gender: (data.gender as any) || null,
          bloodGroup: data.bloodGroup?.trim() || null,
          fatherName: data.fatherName?.trim() || null,
          cardId: data.cardId?.trim() || null,
          severeDisease: data.severeDisease?.trim() || null,
          experience: data.experience?.trim() || null,
          bio: data.bio?.trim() || null,
        },
      });

      const saved = await tx.staffModulePermission.findMany({
        where: { branchMemberId: member.id },
      });

      return {
        userId: user.id,
        branchMemberId: member.id,
        name: user.name,
        username: user.username,
        permissions: saved.map((p) => this.mapPermissionRow(p)),
      };
    });
  }

  /** Worker (cleaner, guard, etc.) — payroll + attendance, optional login, no module permissions. */
  async createWorker(
    branchId: string,
    data: {
      name: string;
      username?: string;
      phone?: string;
    } & StaffProfileFields,
    createdById?: string,
  ) {
    const baseUsername = (data.username?.trim()
      || `worker_${data.name.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 20)}_${Date.now().toString(36).slice(-4)}`);

    let username = baseUsername;
    let suffix = 1;
    while (await prisma.user.findFirst({ where: { username } })) {
      username = `${baseUsername}_${suffix++}`;
    }

    if (data.employeeId?.trim()) {
      const clash = await prisma.staffProfile.findFirst({
        where: { employeeId: data.employeeId.trim() },
      });
      if (clash) throw { status: 409, message: `Employee ID "${data.employeeId}" is already in use` };
    }

    const password = `tmp_${Math.random().toString(36).slice(2, 10)}`;
    const passwordHash = await hashPassword(password);
    const profilePhone = data.phone?.trim() || null;

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name.trim(),
          username,
          phone: profilePhone,
          passwordHash,
          role: 'management',
          status: 'active',
        },
      });

      const member = await tx.branchMember.create({
        data: {
          branchId,
          userId: user.id,
          role: 'worker',
          assignedById: createdById,
        },
      });

      await tx.staffProfile.create({
        data: {
          userId: user.id,
          phone: profilePhone,
          employeeId: data.employeeId?.trim() || null,
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : new Date(),
          salary: data.salary ?? null,
          address: data.address?.trim() || null,
        },
      });

      await tx.branchTenure.create({
        data: {
          branchMemberId: member.id,
          sequence: 1,
          joinedAt: data.joiningDate ? new Date(data.joiningDate) : new Date(),
          createdById,
        },
      });

      return {
        userId: user.id,
        branchMemberId: member.id,
        name: user.name,
        username: user.username,
        branchRole: 'worker',
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
          archivedCanRead: p.archivedCanRead ?? false,
          archivedCanCreate: p.archivedCanCreate ?? false,
          archivedCanUpdate: p.archivedCanUpdate ?? false,
          archivedCanDelete: p.archivedCanDelete ?? false,
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
      permissions: member.modulePermissions.map((p) => this.mapPermissionRow(p)),
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

    const permissions = (member.modulePermissions ?? []).map((p) => this.mapPermissionRow(p));

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
          archivedCanRead: false,
          archivedCanCreate: false,
          archivedCanUpdate: false,
          archivedCanDelete: false,
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

    const phone = member.user.phone?.trim() || (await prisma.staffProfile.findUnique({ where: { userId: staffUserId }, select: { phone: true } }))?.phone?.trim();
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
      recipientType: 'staff',
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

    return {
      sent: result.success,
      status: result.success ? 'sent' : 'failed',
      channel: result.channel,
      messageId: result.messageId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
      solvable: result.solvable,
    };
  }
}

export const staffService = new StaffService();

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { basePrisma as prisma } from '../../../lib/prisma';
import env from '../../../config/env';

const INVITATION_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 12;

class InvitationService {
  /**
   * Create an invitation for a new branch admin.
   * Generates a one-time token, stores it, returns the registration link.
   */
  async createInvitation(email: string, branchId: string, createdById?: string) {
    // Check if email already has a pending invitation
    const existing = await prisma.adminInvitation.findFirst({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (existing) {
      return {
        token: existing.token,
        link: `${this.getBaseUrl()}/register-admin?token=${existing.token}`,
        expiresAt: existing.expiresAt,
        message: 'A pending invitation already exists for this email. The existing link is still valid.',
      };
    }

    // Check if a user with this email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw Object.assign(new Error('A user with this email already exists'), { status: 409 });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await prisma.adminInvitation.create({
      data: { email, branchId, token, expiresAt, createdById },
    });

    return {
      token,
      link: `${this.getBaseUrl()}/register-admin?token=${token}`,
      expiresAt,
      message: 'Invitation created successfully.',
    };
  }

  /**
   * Validate an invitation token.
   * Returns the invitation data if valid, throws otherwise.
   */
  async validateInvitation(token: string) {
    const invitation = await prisma.adminInvitation.findUnique({ where: { token } });

    if (!invitation) {
      throw Object.assign(new Error('Invalid invitation token'), { status: 404 });
    }

    if (invitation.usedAt) {
      throw Object.assign(new Error('This invitation has already been used'), { status: 400 });
    }

    if (invitation.expiresAt < new Date()) {
      throw Object.assign(new Error('This invitation has expired'), { status: 400 });
    }

    // Fetch branch name
    const branch = await prisma.branch.findUnique({
      where: { id: invitation.branchId },
      select: { name: true, code: true },
    });

    return {
      email: invitation.email,
      branchId: invitation.branchId,
      branchName: branch?.name || 'Unknown',
      branchCode: branch?.code || '',
    };
  }

  /**
   * Complete the registration: create user + assign as branch_admin.
   */
  async completeRegistration(
    token: string,
    data: {
      name: string;
      username: string;
      password: string;
      phone?: string;
      employeeId?: string;
      qualification?: string;
      specialization?: string;
      joiningDate?: string;
      address?: string;
      emergencyContact?: string;
      workRole?: string;
      bio?: string;
    },
  ) {
    const invitation = await prisma.adminInvitation.findUnique({ where: { token } });

    if (!invitation) {
      throw Object.assign(new Error('Invalid invitation token'), { status: 404 });
    }

    if (invitation.usedAt) {
      throw Object.assign(new Error('This invitation has already been used'), { status: 400 });
    }

    if (invitation.expiresAt < new Date()) {
      throw Object.assign(new Error('This invitation has expired'), { status: 400 });
    }

    if (!data.name || !data.password || !data.username) {
      throw Object.assign(new Error('Name, username, and password are required'), { status: 400 });
    }

    if (data.password.length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    // Create user + mark invitation used + assign branch membership in a transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          username: data.username,
          email: invitation.email,
          phone: data.phone || null,
          passwordHash,
          role: 'management',
          status: 'active',
        },
      });

      await tx.adminInvitation.update({
        where: { id: invitation.id },
        data: {
          usedAt: new Date(),
          name: data.name,
          phone: data.phone || null,
        },
      });

      await tx.branchMember.create({
        data: {
          userId: user.id,
          branchId: invitation.branchId,
          role: 'branch_admin',
        },
      });

      await tx.staffProfile.create({
        data: {
          userId: user.id,
          employeeId: data.employeeId?.trim() || null,
          workRole: data.workRole?.trim() || 'Branch Administrator',
          qualification: data.qualification?.trim() || null,
          specialization: data.specialization?.trim() || null,
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : new Date(),
          phone: data.phone?.trim() || null,
          emergencyContact: data.emergencyContact?.trim() || null,
          address: data.address?.trim() || null,
          bio: data.bio?.trim() || null,
        },
      });

      return { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role };
    });

    return result;
  }

  /**
   * List pending invitations.
   */
  async listPendingInvitations() {
    return prisma.adminInvitation.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true, code: true } },
      },
    });
  }

  /**
   * List all admins (management role users with branch_admin branch role).
   */
  async listAdmins() {
    const branchMembers = await prisma.branchMember.findMany({
      where: { role: 'branch_admin' },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, phone: true,
            role: true, status: true, createdAt: true,
          },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return branchMembers.map((bm: { id: string; createdAt: Date; user: { id: string; name: string; email: string | null; phone: string | null; role: string; status: string; createdAt: Date }; branch: { id: string; name: string; code: string } }) => ({
      id: bm.id,
      userId: bm.user.id,
      name: bm.user.name,
      email: bm.user.email,
      phone: bm.user.phone,
      role: bm.user.role,
      status: bm.user.status,
      branchId: bm.branch.id,
      branchName: bm.branch.name,
      branchCode: bm.branch.code,
      createdAt: bm.createdAt,
    }));
  }

  async getAdminDetail(userId: string) {
    const membership = await prisma.branchMember.findFirst({
      where: { userId, role: 'branch_admin' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            phone: true,
            status: true,
            profilePhotoId: true,
            createdAt: true,
          },
        },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    if (!membership) {
      throw Object.assign(new Error('Admin not found'), { status: 404 });
    }

    const profile = await prisma.staffProfile.findUnique({ where: { userId } });

    return {
      membershipId: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      username: membership.user.username,
      phone: membership.user.phone,
      status: membership.user.status,
      profilePhotoId: membership.user.profilePhotoId,
      branch: membership.branch,
      memberSince: membership.createdAt,
      profile,
    };
  }

  async updateAdminProfile(
    userId: string,
    data: {
      name?: string;
      phone?: string | null;
      employeeId?: string | null;
      workRole?: string | null;
      qualification?: string | null;
      specialization?: string | null;
      joiningDate?: string | null;
      address?: string | null;
      emergencyContact?: string | null;
      bio?: string | null;
    },
  ) {
    const membership = await prisma.branchMember.findFirst({
      where: { userId, role: 'branch_admin' },
      select: { id: true },
    });
    if (!membership) {
      throw Object.assign(new Error('Admin not found'), { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      if (data.name !== undefined || data.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.phone !== undefined && { phone: data.phone }),
          },
        });
      }

      const profileData = {
        ...(data.employeeId !== undefined && { employeeId: data.employeeId }),
        ...(data.workRole !== undefined && { workRole: data.workRole }),
        ...(data.qualification !== undefined && { qualification: data.qualification }),
        ...(data.specialization !== undefined && { specialization: data.specialization }),
        ...(data.joiningDate !== undefined && {
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
        }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.emergencyContact !== undefined && { emergencyContact: data.emergencyContact }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.phone !== undefined && { phone: data.phone }),
      };

      if (Object.keys(profileData).length > 0) {
        await tx.staffProfile.upsert({
          where: { userId },
          create: {
            userId,
            workRole: data.workRole ?? 'Branch Administrator',
            ...profileData,
          },
          update: profileData,
        });
      }
    });

    return this.getAdminDetail(userId);
  }

  private getBaseUrl(): string {
    return env.FRONTEND_URL || 'http://localhost:3000';
  }
}

export default new InvitationService();
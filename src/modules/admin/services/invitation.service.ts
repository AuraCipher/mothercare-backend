import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
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
    data: { name: string; username: string; password: string; phone?: string },
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

  private getBaseUrl(): string {
    return env.FRONTEND_URL || 'http://localhost:3000';
  }
}

export default new InvitationService();
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, generateOTP, hashOTP } from '../../lib/password';
import { signToken, verifyToken } from '../../lib/jwt';
import env from '../../config/env';
import { z } from 'zod';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ─── LOGIN INPUT SCHEMA ───────────────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().min(1, 'Username, email, or phone is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
});

type LoginInput = z.infer<typeof loginSchema>;

class AuthService {
  // ─── LOGIN ─────────────────────────────────────────────────────────
  /**
   * Accepts username, email, or phone in the first field.
   * Tries to match any of: username, email, phone
   * Returns token + user data on success.
   */
  async login(data: LoginInput) {
    const { identifier, password } = data;

    // Try to find user by username, email, or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: identifier, mode: 'insensitive' } },
          { email: { equals: identifier, mode: 'insensitive' } },
          { phone: identifier },
        ],
      },
    });

    if (!user) {
      throw { status: 401, message: 'Invalid credentials' };
    }

    if (user.status !== 'active') {
      throw { status: 403, message: 'Account is not active' };
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw { status: 401, message: 'Invalid credentials' };
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastSeen: new Date() },
    });

    // Query user's branch memberships
    const branchMemberships = await prisma.branchMember.findMany({
      where: { userId: user.id, isActive: true },
      select: { branchId: true },
    });
    const branchIds = branchMemberships.map(bm => bm.branchId);

    // Generate token with branchIds
    const tokenPayload = {
      id: user.id,
      role: user.role,
      name: user.name,
      schoolId: user.schoolId || undefined,
      branchIds,
    };
    const token = signToken(tokenPayload);

    // Handle remember me
    let rememberMeToken: string | null = null;
    if (data.rememberMe) {
      rememberMeToken = crypto.randomBytes(64).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: {
          rememberMeToken,
          rememberMeExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });
    }

    return {
      success: true,
      token,
      rememberMeToken,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    };
  }

  // ─── GET CURRENT USER ─────────────────────────────────────────────
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        role: true,
        gender: true,
        dateOfBirth: true,
        address: true,
        profilePhoto: true,
        status: true,
        managementPerms: true,
        lastLoginAt: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw { status: 404, message: 'User not found' };
    }

    // Fetch current branch memberships
    const memberships = await prisma.branchMember.findMany({
      where: { userId: user.id, isActive: true },
      select: { branchId: true },
    });
    const branchIds = memberships.map(bm => bm.branchId);

    // If management role, include permissions
    const managementPerms = user.role === 'management' ? user.managementPerms : null;

    return {
      ...user,
      branchIds,
      managementPerms,
    };
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw { status: 404, message: 'User not found' };
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw { status: 400, message: 'Current password is incorrect' };
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Invalidate remember me tokens
    await prisma.user.update({
      where: { id: userId },
      data: { rememberMeToken: null, rememberMeExpiry: null },
    });

    return { success: true, message: 'Password changed successfully' };
  }

  // ─── LOGOUT ─────────────────────────────────────────────────────────
  async logout(userId: string) {
    // Clear remember me tokens
    await prisma.user.update({
      where: { id: userId },
      data: { rememberMeToken: null, rememberMeExpiry: null },
    });

    return { success: true, message: 'Logged out successfully' };
  }

  // ─── REFRESH TOKEN (for remember me) ──────────────────────────────
  async refreshRememberMe(rememberMeToken: string) {
    const user = await prisma.user.findFirst({
      where: {
        rememberMeToken,
        rememberMeExpiry: { gte: new Date() },
        status: 'active',
      },
    });

    if (!user) {
      throw { status: 401, message: 'Invalid or expired session' };
    }

    // Update last seen and generate new token
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeen: new Date() },
    });

    const branchMemberships = await prisma.branchMember.findMany({
      where: { userId: user.id, isActive: true },
      select: { branchId: true },
    });
    const branchIds = branchMemberships.map(bm => bm.branchId);

    const token = signToken({
      id: user.id,
      role: user.role,
      name: user.name,
      schoolId: user.schoolId || undefined,
      branchIds,
    });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  // ─── REFRESH TOKEN ────────────────────────────────────────────────
  async refresh(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, username: true, email: true, phone: true,
        role: true, status: true, schoolId: true,
      },
    });

    if (!user || user.status !== 'active') {
      throw { status: 401, message: 'User not found or inactive' };
    }

    // Re-query current branch memberships
    const memberships = await prisma.branchMember.findMany({
      where: { userId: user.id, isActive: true },
      select: { branchId: true },
    });
    const branchIds = memberships.map(bm => bm.branchId);

    // Generate new token with fresh branchIds
    const token = signToken({
      id: user.id,
      role: user.role,
      name: user.name,
      schoolId: user.schoolId || undefined,
      branchIds,
    });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchIds,
      },
    };
  }

  // ─── VALIDATE TOKEN ───────────────────────────────────────────────
  async validateToken(token: string) {
    try {
      const payload: any = verifyToken(token);

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          managementPerms: true,
          status: true,
          lastSeen: true,
        },
      });

      if (!user || user.status !== 'active') {
        throw { status: 401, message: 'User not found or inactive' };
      }

      return { user, payload };
    } catch (error) {
      throw { status: 401, message: 'Invalid or expired token' };
    }
  }
}

export default new AuthService();

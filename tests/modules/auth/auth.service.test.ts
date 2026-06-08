/**
 * AuthService Unit Tests
 *
 * Tests the AuthService methods (login, getMe, logout) in isolation
 * using a mocked Prisma client.
 */

// IMPORTANT: prisma mock must be imported first so that jest.mock('@prisma/client')
// is hoisted and registered before any source module loads @prisma/client.
import { prismaMock } from '../../mocks/prisma';
import authService from '../../../src/modules/auth/auth.service';
import { createMockUser } from '../../helpers/factories';
import type { MockUser } from '../../helpers/factories';

// ─── Helpers ─────────────────────────────────────────────────

/** Minimal shape returned by prisma.user.findUnique with `select` in getMe */
function selectUserData(user: MockUser) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    address: user.address,
    profilePhoto: user.profilePhoto,
    status: user.status,
    managementPerms: user.managementPerms,
    lastLoginAt: user.lastLoginAt,
    lastSeen: user.lastSeen,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── LOGIN ──────────────────────────────────────────────────

describe('AuthService.login', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
    prismaMock.branchMember.findMany.mockResolvedValue([]);
  });

  // ─── Success ─────────────────────────────────────────

  test('success: returns token + user data for valid admin credentials', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.login({
      identifier: mockUser.username!,
      password: 'password123',
      rememberMe: false,
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.rememberMeToken).toBeNull();
    expect(result.user.id).toBe(mockUser.id);
    expect(result.user.name).toBe(mockUser.name);
    expect(result.user.username).toBe(mockUser.username);
    expect(result.user.email).toBe(mockUser.email);
    expect(result.user.role).toBe(mockUser.role);
    expect(result.user.status).toBe(mockUser.status);
  });

  // ─── Wrong password ────────────────────────────────

  test('error: wrong password throws 401', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    await expect(
      authService.login({
        identifier: mockUser.username!,
        password: 'wrong-password',
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
  });

  // ─── User not found ────────────────────────────────

  test('error: unknown identifier throws 401', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(
      authService.login({
        identifier: 'unknown-user',
        password: 'password123',
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
  });

  // ─── Inactive user ─────────────────────────────────

  test('error: inactive status throws 403', async () => {
    const inactiveUser = createMockUser({ status: 'inactive' });
    prismaMock.user.findFirst.mockResolvedValue(inactiveUser);

    await expect(
      authService.login({
        identifier: inactiveUser.username!,
        password: 'password123',
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Account is not active' });
  });

  test('error: suspended status throws 403', async () => {
    const suspendedUser = createMockUser({ status: 'suspended' });
    prismaMock.user.findFirst.mockResolvedValue(suspendedUser);

    await expect(
      authService.login({
        identifier: suspendedUser.username!,
        password: 'password123',
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Account is not active' });
  });

  // ─── Remember me ───────────────────────────────────

  test('rememberMe=true: returns rememberMeToken', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.login({
      identifier: mockUser.username!,
      password: 'password123',
      rememberMe: true,
    });

    expect(result.success).toBe(true);
    expect(result.rememberMeToken).toBeDefined();
    expect(typeof result.rememberMeToken).toBe('string');
    expect(result.rememberMeToken!.length).toBeGreaterThan(0);
  });

  test('rememberMe=false: rememberMeToken is null', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.login({
      identifier: mockUser.username!,
      password: 'password123',
      rememberMe: false,
    });

    expect(result.rememberMeToken).toBeNull();
  });

  // ─── Login by email ────────────────────────────────

  test('by email: finds user using email as identifier', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.login({
      identifier: mockUser.email!,
      password: 'password123',
      rememberMe: false,
    });

    expect(result.success).toBe(true);
    expect(result.user.id).toBe(mockUser.id);
  });

  // ─── Login by phone ────────────────────────────────

  test('by phone: finds user using phone as identifier', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.login({
      identifier: mockUser.phone!,
      password: 'password123',
      rememberMe: false,
    });

    expect(result.success).toBe(true);
    expect(result.user.id).toBe(mockUser.id);
  });

  // ─── Case insensitive ──────────────────────────────

  test('case insensitive: finds user with different case username', async () => {
    const adminUser = createMockUser({ username: 'AdminUser' });
    prismaMock.user.findFirst.mockResolvedValue(adminUser);
    prismaMock.user.update.mockResolvedValue(adminUser);

    const result = await authService.login({
      identifier: 'adminuser', // lowercase lookup
      password: 'password123',
      rememberMe: false,
    });

    expect(result.success).toBe(true);
    expect(result.user.id).toBe(adminUser.id);
  });

  // ─── Update last login ─────────────────────────────

  test('updates lastLoginAt and lastSeen on successful login', async () => {
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    prismaMock.user.update.mockResolvedValue(mockUser);

    await authService.login({
      identifier: mockUser.username!,
      password: 'password123',
      rememberMe: false,
    });

    // Should have called update for lastLoginAt and lastSeen
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockUser.id },
        data: expect.objectContaining({
          lastLoginAt: expect.any(Date),
          lastSeen: expect.any(Date),
        }),
      }),
    );
  });
});

// ─── GET ME ──────────────────────────────────────────────────

describe('AuthService.getMe', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  test('success: returns user data without passwordHash', async () => {
    const userData = selectUserData(mockUser);
    prismaMock.user.findUnique.mockResolvedValue(userData as any);

    const result = await authService.getMe(mockUser.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(mockUser.id);
    expect(result.name).toBe(mockUser.name);
    expect(result.email).toBe(mockUser.email);
    expect(result.role).toBe(mockUser.role);
    expect(result.status).toBe(mockUser.status);
    expect((result as any).passwordHash).toBeUndefined();
  });

  test('success: includes managementPerms for management role', async () => {
    const mgmtUser = createMockUser({
      role: 'management',
      managementPerms: ['users.read', 'users.write'],
    });
    const userData = selectUserData(mgmtUser);
    prismaMock.user.findUnique.mockResolvedValue(userData as any);

    const result = await authService.getMe(mgmtUser.id);

    expect(result.managementPerms).toEqual(['users.read', 'users.write']);
  });

  test('success: managementPerms is null for non-management roles', async () => {
    const teacherUser = createMockUser({ role: 'teacher' });
    const userData = selectUserData(teacherUser);
    prismaMock.user.findUnique.mockResolvedValue(userData as any);

    const result = await authService.getMe(teacherUser.id);

    expect(result.managementPerms).toBeNull();
  });

  test('error: unknown userId throws 404', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(authService.getMe('unknown-id')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    });
  });
});

// ─── LOGOUT ──────────────────────────────────────────────────

describe('AuthService.logout', () => {
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  test('success: clears rememberMeToken and returns success message', async () => {
    prismaMock.user.update.mockResolvedValue(mockUser);

    const result = await authService.logout(mockUser.id);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Logged out successfully');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockUser.id },
      data: { rememberMeToken: null, rememberMeExpiry: null },
    });
  });
});

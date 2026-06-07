/**
 * Mocked Prisma Client
 *
 * Provides a deeply mocked Prisma client using jest-mock-extended.
 * This allows test files to set up mock return values for any Prisma
 * query without connecting to a real database.
 *
 * Usage:
 *   import { prismaMock } from '../mocks/prisma';
 *   prismaMock.user.findUnique.mockResolvedValue(mockUser);
 */

import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

// ─── Type: The deeply mocked Prisma client ────────────────
export type MockPrismaClient = DeepMockProxy<PrismaClient>;

// ─── Create the mock instance ─────────────────────────────
export const prismaMock = mockDeep<PrismaClient>();

// ─── Mock the @prisma/client module ───────────────────────
// This ensures that anywhere in the codebase that does
// `new PrismaClient()` or imports enums from @prisma/client,
// they get our mocked versions.
jest.mock('@prisma/client', () => ({
  __esModule: true,

  // The PrismaClient constructor returns our pre-created mock
  PrismaClient: jest.fn(() => prismaMock),

  // ─── Enums used across the codebase ───────────────────
  Role: {
    super_admin: 'super_admin',
    management: 'management',
    teacher: 'teacher',
    parent: 'parent',
  },

  AccountStatus: {
    active: 'active',
    inactive: 'inactive',
    suspended: 'suspended',
  },

  Gender: {
    male: 'male',
    female: 'female',
    other: 'other',
  },

  ApiKeyType: {
    publishable: 'publishable',
    secret: 'secret',
  },

  BranchRole: {
    branch_admin: 'branch_admin',
    sub_admin: 'sub_admin',
    management: 'management',
    teacher: 'teacher',
    parent: 'parent',
  },

  AcademicYearStatus: {
    BUILD_STAGE: 'BUILD_STAGE',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
  },

  PromotionStatus: {
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    REVERSED: 'REVERSED',
    FAILED: 'FAILED',
  },

  StudentStatus: {
    ACTIVE: 'ACTIVE',
    GRADUATED: 'GRADUATED',
    WITHDRAWN: 'WITHDRAWN',
    TRANSFERRED: 'TRANSFERRED',
  },
}));

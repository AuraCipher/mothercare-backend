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

// ─── Fix: $extends must return the mock itself ────────────
// src/lib/prisma.ts calls createAuditExtension(basePrisma) at module-load
// time, which does basePrisma.$extends({...}) to attach audit hooks.
// jest-mock-extended creates $extends as a bare jest.fn() that returns
// undefined by default. Without this stub, createAuditExtension returns
// undefined, the exported `prisma` is undefined, and every route handler
// crashes with "Cannot read properties of undefined (reading 'findMany')".
// This configures $extends to return the mock itself, preserving the
// expected shape (payment.findMany, user.findUnique, etc.) so routes can
// be set up per-test with prismaMock.xxx.mockReturnValue/ResolvedValue.
(prismaMock as any).$extends.mockReturnValue(prismaMock);

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
    canteen_staff: 'canteen_staff',
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
    SUSPENDED: 'SUSPENDED',
    EXPELED: 'EXPELED',
    DECEASED: 'DECEASED',
  },

  ExamStatus: {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
  },

  ReportCardStatus: {
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
  },

  CanteenPersonType: {
    STUDENT: 'STUDENT',
    TEACHER: 'TEACHER',
    STAFF: 'STAFF',
  },

  CanteenSupplierPaymentDirection: {
    WE_PAID_SUPPLIER: 'WE_PAID_SUPPLIER',
    SUPPLIER_PAID_US: 'SUPPLIER_PAID_US',
  },

  CanteenSalePaymentType: {
    CASH: 'CASH',
    CREDIT: 'CREDIT',
  },

  Prisma: {
    Decimal: class {
      constructor(public value: number) {}
      toString() { return String(this.value); }
      [Symbol.toPrimitive]() { return this.value; }
    },
  },
}));

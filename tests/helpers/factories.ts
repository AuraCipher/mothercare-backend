/**
 * Test Data Factories
 *
 * Provides factory functions to create mock model instances with sensible
 * defaults. Each factory accepts optional overrides to customize the result.
 *
 * Usage:
 *   import { createMockUser, createMockApiKey } from '../helpers/factories';
 *   const user = createMockUser({ role: 'super_admin' });
 */

// ─── Types ─────────────────────────────────────────────────

export interface MockUser {
  id: string;
  schoolId: string | null;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: 'super_admin' | 'management' | 'teacher' | 'parent';
  managementPerms: string[];
  gender: 'male' | 'female' | 'other' | null;
  dateOfBirth: Date | null;
  address: string | null;
  profilePhoto: string | null;
  status: 'active' | 'inactive' | 'suspended';
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastLoginAt: Date | null;
  lastSeen: Date | null;
  rememberMeToken: string | null;
  rememberMeExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockApiKey {
  id: string;
  name: string;
  type: 'publishable' | 'secret';
  keyHash: string;
  prefix: string;
  createdBy: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface MockGroup {
  id: string;
  academicYearId: string;
  name: string;
  section: string | null;
  displayOrder: number;
  capacity: number;
  onlyAdminCanSend: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockStudent {
  id: string;
  academicYearId: string;
  groupId: string | null;
  name: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  gender: 'male' | 'female' | 'other' | null;
  dateOfBirth: Date | null;
  religion: string | null;
  nationality: string | null;
  address: string | null;
  phone: string | null;
  bloodGroup: string | null;
  previousSchool: string | null;
  status: 'ACTIVE' | 'GRADUATED' | 'WITHDRAWN' | 'TRANSFERRED';
  isActive: boolean;
  admissionDate: Date;
  createdAt: Date;
}

export interface MockTeacher {
  id: string;
  userId: string;
  employeeId: string | null;
  qualification: string | null;
  specialization: string | null;
  joiningDate: Date | null;
  salary: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ═════════════════════════════════════════════════════════════
// Phase 02: Branch + Academic Year Model Factories
// ═════════════════════════════════════════════════════════════

export interface MockBranch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockAcademicCalendar {
  id: string;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  createdAt: Date;
}

export interface MockAcademicYear {
  id: string;
  branchId: string;
  calendarId: string;
  status: 'BUILD_STAGE' | 'ACTIVE' | 'ARCHIVED';
  previousAcademicYearId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockAcademicYearMember {
  id: string;
  academicYearId: string;
  userId: string;
  role: 'super_admin' | 'management' | 'teacher' | 'parent';
}

export interface MockBranchMember {
  id: string;
  branchId: string;
  userId: string;
}

export interface MockGroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'super_admin' | 'management' | 'teacher' | 'parent';
  joinedAt: Date;
}

export interface MockCommunity {
  id: string;
  name: string;
  description: string | null;
  schoolId: string | null;
  academicYear: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockCommunityMember {
  id: string;
  communityId: string;
  userId: string;
  role: 'super_admin' | 'management' | 'teacher' | 'parent';
  joinedAt: Date;
}

// ─── Helpers ───────────────────────────────────────────────

let counter = 0;
const unique = (prefix: string) => `${prefix}_${++counter}`;

const now = () => new Date();
const pastDate = (days: number) => new Date(Date.now() - days * 86400000);

// ─── Factories ─────────────────────────────────────────---

/**
 * Creates a mock User object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockUser
 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const id = overrides.id || unique('user');
  return {
    id,
    schoolId: null,
    name: 'Test User',
    username: `testuser_${id.slice(0, 8)}`,
    email: `testuser_${id.slice(0, 8)}@example.com`,
    phone: `+92300123456${counter % 10}`,
    passwordHash: '$2a$12$JCTfy9lCuFKCbEHHl4KPYuJRGTFWyadJ85s8DSb/gybXqGSfdKS6m', // "password123"
    role: 'parent',
    managementPerms: [],
    gender: null,
    dateOfBirth: null,
    address: null,
    profilePhoto: null,
    status: 'active',
    isEmailVerified: false,
    isPhoneVerified: false,
    lastLoginAt: null,
    lastSeen: null,
    rememberMeToken: null,
    rememberMeExpiry: null,
    createdAt: pastDate(7),
    updatedAt: now(),
    ...overrides,
  };
}

/**
 * Creates a mock ApiKey object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockApiKey
 */
export function createMockApiKey(overrides: Partial<MockApiKey> = {}): MockApiKey {
  const type = overrides.type || 'publishable';
  const keyPrefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
  return {
    id: unique('key'),
    name: 'Test API Key',
    type,
    keyHash: '$2a$12$LJ3m4ys3Lk0TSwHnbfOMiOXPm1Qlq5GzVpYKqWqV0KqV0KqV0KqV0',
    prefix: `${keyPrefix}${unique('pfx').slice(0, 4)}`,
    createdBy: unique('user'),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: pastDate(7),
    ...overrides,
  };
}

/**
 * Creates a mock Group (class) object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockGroup
 */
export function createMockGroup(overrides: Partial<MockGroup> = {}): MockGroup {
  return {
    id: unique('group'),
    academicYearId: unique('ay'),
    name: 'Class 1',
    section: null,
    displayOrder: 1,
    capacity: 30,
    onlyAdminCanSend: true,
    isActive: true,
    createdAt: pastDate(7),
    updatedAt: now(),
    ...overrides,
  };
}

/**
 * Creates a mock Student object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockStudent
 */
export function createMockStudent(overrides: Partial<MockStudent> = {}): MockStudent {
  return {
    id: unique('student'),
    academicYearId: unique('ay'),
    groupId: unique('group'),
    name: 'Test Student',
    rollNumber: null,
    admissionNumber: null,
    gender: null,
    dateOfBirth: null,
    religion: null,
    nationality: 'Pakistani',
    address: null,
    phone: null,
    bloodGroup: null,
    previousSchool: null,
    status: 'ACTIVE',
    isActive: true,
    admissionDate: pastDate(30),
    createdAt: pastDate(30),
    ...overrides,
  };
}

/**
 * Creates a mock Teacher object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockTeacher
 */
// ═════════════════════════════════════════════════════════════
// Phase 02 Factory Functions
// ═════════════════════════════════════════════════════════════

export function createMockBranch(overrides: Partial<MockBranch> = {}): MockBranch {
  const id = overrides.id || unique('branch');
  return {
    id,
    name: `Branch ${id.slice(0, 4)}`,
    code: `BR_${id.slice(0, 4).toUpperCase()}`,
    address: null,
    phone: null,
    email: null,
    logoUrl: null,
    isActive: true,
    createdAt: pastDate(7),
    updatedAt: now(),
    ...overrides,
  };
}

export function createMockAcademicCalendar(overrides: Partial<MockAcademicCalendar> = {}): MockAcademicCalendar {
  const id = overrides.id || unique('cal');
  return {
    id,
    label: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
    startDate: pastDate(30),
    endDate: new Date(Date.now() + 300 * 86400000),
    isCurrent: false,
    createdAt: pastDate(7),
    ...overrides,
  };
}

export function createMockAcademicYear(overrides: Partial<MockAcademicYear> = {}): MockAcademicYear {
  const id = overrides.id || unique('ay');
  return {
    id,
    branchId: unique('branch'),
    calendarId: unique('cal'),
    status: 'BUILD_STAGE',
    previousAcademicYearId: null,
    createdAt: pastDate(7),
    updatedAt: now(),
    ...overrides,
  };
}

export function createMockAcademicYearMember(overrides: Partial<MockAcademicYearMember> = {}): MockAcademicYearMember {
  return {
    id: unique('aym'),
    academicYearId: unique('ay'),
    userId: unique('user'),
    role: 'teacher',
    ...overrides,
  };
}

export function createMockBranchMember(overrides: Partial<MockBranchMember> = {}): MockBranchMember {
  return {
    id: unique('bm'),
    branchId: unique('branch'),
    userId: unique('user'),
    ...overrides,
  };
}

export function createMockTeacher(overrides: Partial<MockTeacher> = {}): MockTeacher {
  return {
    id: unique('teacher'),
    userId: unique('user'),
    employeeId: `EMP${counter}`,
    qualification: "Bachelor's Degree",
    specialization: 'Mathematics',
    joiningDate: pastDate(365),
    salary: 50000,
    createdAt: pastDate(365),
    updatedAt: now(),
    ...overrides,
  };
}

/**
 * Creates a mock Community object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockCommunity
 */
export function createMockCommunity(overrides: Partial<MockCommunity> = {}): MockCommunity {
  return {
    id: unique('comm'),
    name: 'Mother Care School',
    description: 'Main school community',
    schoolId: null,
    academicYear: '2025-2026',
    createdAt: pastDate(7),
    updatedAt: now(),
    ...overrides,
  };
}

/**
 * Creates a mock GroupMember object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockGroupMember
 */
export function createMockGroupMember(overrides: Partial<MockGroupMember> = {}): MockGroupMember {
  return {
    id: unique('gm'),
    groupId: unique('group'),
    userId: unique('user'),
    role: 'parent',
    joinedAt: pastDate(7),
    ...overrides,
  };
}

/**
 * Creates a mock CommunityMember object with sensible defaults.
 *
 * @param overrides - Partial fields to override defaults
 * @returns A complete MockCommunityMember
 */
export function createMockCommunityMember(overrides: Partial<MockCommunityMember> = {}): MockCommunityMember {
  return {
    id: unique('cm'),
    communityId: unique('comm'),
    userId: unique('user'),
    role: 'parent',
    joinedAt: pastDate(7),
    ...overrides,
  };
}

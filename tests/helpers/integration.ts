/**
 * Shared helpers for backend integration tests (supertest + mocked Prisma).
 */
import { prismaMock } from '../mocks/prisma';
import { generateTestToken, getAuthHeader } from './auth';

export const TEST_BRANCH_ID = 'b1';
export const TEST_AY_ID = 'ay1';

export const adminAuth = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
export const branchQuery = { branchId: TEST_BRANCH_ID };
export const scopeQuery = { branchId: TEST_BRANCH_ID, academicYearId: TEST_AY_ID };

export function mockActiveAcademicYear(overrides: Record<string, unknown> = {}) {
  const ay = {
    id: TEST_AY_ID,
    branchId: TEST_BRANCH_ID,
    status: 'ACTIVE',
    calendar: { label: '2025-2026' },
    branch: { id: TEST_BRANCH_ID, name: 'Test Branch', code: 'TST' },
    ...overrides,
  };
  (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(ay);
  (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(ay);
  return ay;
}

export function mockArchivedAcademicYear() {
  return mockActiveAcademicYear({ status: 'ARCHIVED' });
}

export function mockStudentWithPerson(studentId = 's1', personId = 'person-1') {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({
    id: studentId,
    personId,
    groupId: 'g1',
  });
}

export function mockBranchMember(userId = 't1', memberId = 'bm-1') {
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
    id: memberId,
    branchId: TEST_BRANCH_ID,
    userId,
    isActive: true,
  });
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface EndpointSpec {
  method: HttpMethod;
  path: string;
  /** Query params merged with branchId */
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  needsScope?: boolean;
  successStatus?: number;
}

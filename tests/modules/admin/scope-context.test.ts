/**
 * Scope context tests — branch-scoped academic year resolution.
 *
 * The bug these guard: when a request carried no academicYearId, the year was
 * resolved with a GLOBAL "newest ACTIVE year" lookup. That year can belong to
 * a DIFFERENT branch, so the scope check rejected the request with 400 — and
 * the list pages swallowed the 400, leaving an empty roster with no error.
 */

import { prismaMock } from '../../mocks/prisma';
import {
  resolveAcademicYearId,
  resolveScopeContext,
} from '../../../src/modules/admin/utils/scope-context';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const AY_A = 'ay-of-branch-a';
const AY_B = 'ay-of-branch-b';

function makeReq(overrides: Record<string, any> = {}) {
  return {
    query: {},
    body: {},
    params: {},
    headers: {},
    user: { id: 'u1', role: 'management', branchIds: [BRANCH_A] },
    ...overrides,
  } as any;
}

describe('resolveAcademicYearId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the explicit id without touching the database', async () => {
    const result = await resolveAcademicYearId(AY_A, BRANCH_A);
    expect(result).toBe(AY_A);
    expect(prismaMock.academicYear.findFirst).not.toHaveBeenCalled();
  });

  test('scopes the fallback to the given branch', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: AY_A });

    const result = await resolveAcademicYearId(undefined, BRANCH_A);

    expect(result).toBe(AY_A);
    expect(prismaMock.academicYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', branchId: BRANCH_A },
      }),
    );
  });

  test('falls back to the branch\'s newest year when it has no ACTIVE year', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ay-build-stage' });

    const result = await resolveAcademicYearId(undefined, BRANCH_A);

    expect(result).toBe('ay-build-stage');
    expect(prismaMock.academicYear.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { branchId: BRANCH_A } }),
    );
  });

  test('never resolves another branch\'s year when a branch is given', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: AY_A });

    await resolveAcademicYearId(undefined, BRANCH_A);

    const call = (prismaMock.academicYear.findFirst as jest.Mock).mock.calls[0][0];
    expect(call.where.branchId).toBe(BRANCH_A);
  });
});

describe('resolveScopeContext', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resolves the year inside the requested branch', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: AY_A });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({
      id: AY_A, branchId: BRANCH_A, status: 'ACTIVE',
    });

    const result: any = await resolveScopeContext(
      makeReq({ query: { branchId: BRANCH_A } }),
    );

    expect(result.error).toBeUndefined();
    expect(result.academicYearId).toBe(AY_A);
    expect(result.branchId).toBe(BRANCH_A);
  });

  test('scopes the year to the caller\'s own branch when the request omits it', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: AY_A });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({
      id: AY_A, branchId: BRANCH_A, status: 'ACTIVE',
    });

    const result: any = await resolveScopeContext(makeReq());

    expect(result.error).toBeUndefined();
    expect(result.academicYearId).toBe(AY_A);
    // The lookup must have been restricted to the caller's branch.
    const call = (prismaMock.academicYear.findFirst as jest.Mock).mock.calls[0][0];
    expect(call.where.branchId).toBe(BRANCH_A);
  });

  test('does not fall back to another branch\'s ACTIVE year', async () => {
    // A foreign branch's year must never be picked up: the branch check
    // below would turn it into a 400 and the UI would show an empty list.
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaMock.academicYear.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result: any = await resolveScopeContext(
      makeReq({ query: { branchId: BRANCH_A } }),
    );

    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(400);
    expect(result.error.message).toMatch(/No academic year specified/i);
  });

  test('rejects an academic year that belongs to another branch', async () => {
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({
      id: AY_B, branchId: BRANCH_B, status: 'ACTIVE',
    });

    const result: any = await resolveScopeContext(
      makeReq({ query: { branchId: BRANCH_A, academicYearId: AY_B } }),
    );

    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(400);
    expect(result.error.message).toMatch(/does not belong to the specified branch/i);
  });
});

import { prismaMock } from '../mocks/prisma';
import { requireBranchRole } from '../../src/middleware/auth/branch-role.middleware';
import { createMockBranchMember } from '../helpers/factories';

function mockReq(userId: string, branchId: string) {
  return {
    user: { id: userId },
    params: { branchId },
    body: {},
    query: {},
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('branch-role middleware', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('allows access when user has the required role', async () => {
    prismaMock.branchMember.findUnique.mockResolvedValue(
      createMockBranchMember({ role: 'branch_admin', isActive: true }) as any,
    );
    const middleware = requireBranchRole('branch_admin');
    const req = mockReq('user-1', 'branch-1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).branchMember).toBeDefined();
  });

  test('returns 403 when user does not have the required role', async () => {
    prismaMock.branchMember.findUnique.mockResolvedValue(
      createMockBranchMember({ role: 'teacher', isActive: true }) as any,
    );
    const middleware = requireBranchRole('branch_admin');
    const req = mockReq('user-1', 'branch-1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when user is not an active member', async () => {
    prismaMock.branchMember.findUnique.mockResolvedValue(null);
    const middleware = requireBranchRole('branch_admin');
    const req = mockReq('user-1', 'branch-1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when membership is inactive', async () => {
    prismaMock.branchMember.findUnique.mockResolvedValue(
      createMockBranchMember({ role: 'branch_admin', isActive: false }) as any,
    );
    const middleware = requireBranchRole('branch_admin');
    const req = mockReq('user-1', 'branch-1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 401 when user not authenticated', async () => {
    const middleware = requireBranchRole('branch_admin');
    const req = { user: null, params: {}, body: {}, query: {} } as any;
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 400 when branchId is missing', async () => {
    const middleware = requireBranchRole('branch_admin');
    const req = { user: { id: 'user-1' }, params: {}, body: {}, query: {} } as any;
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

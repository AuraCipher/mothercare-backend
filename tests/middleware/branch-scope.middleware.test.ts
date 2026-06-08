import { branchScopeMiddleware } from '../../src/middleware/branch-scope.middleware';

function mockReq(overrides: any = {}) {
  return {
    user: overrides.user || null,
    apiKey: overrides.apiKey || null,
    params: overrides.params || {},
    body: overrides.body || {},
    query: overrides.query || {},
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('branch-scope middleware', () => {
  test('allows when JWT user has branchId in their branchIds', () => {
    const req = mockReq({
      user: { branchIds: ['branch-1', 'branch-2'] },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows super_admin even without branchId in list', () => {
    const req = mockReq({
      user: { role: 'super_admin', branchIds: ['branch-2'] },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks when JWT user does NOT have branchId in their branchIds', () => {
    const req = mockReq({
      user: { branchIds: ['branch-2', 'branch-3'] },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  test('passes when JWT has no branchIds (old token — backward compatible)', () => {
    const req = mockReq({
      user: { role: 'management' },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows global API key (no branchId) for any branch', () => {
    const req = mockReq({
      apiKey: { branchId: null },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows scoped API key when branchId matches', () => {
    const req = mockReq({
      apiKey: { branchId: 'branch-1' },
      params: { branchId: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks scoped API key when branchId does NOT match', () => {
    const req = mockReq({
      apiKey: { branchId: 'branch-1' },
      params: { branchId: 'branch-2' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('skips when no branchId in request (CEO-only route)', () => {
    const req = mockReq({
      user: { branchIds: ['branch-1'] },
      params: {},
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('reads branchId from req.params.id', () => {
    const req = mockReq({
      user: { branchIds: ['branch-1'] },
      params: { id: 'branch-1' },
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('reads branchId from req.body.branchId', () => {
    const req = mockReq({
      user: { branchIds: ['branch-1'] },
      body: { branchId: 'branch-1' },
      params: {},
    });
    const res = mockRes();
    const next = jest.fn();
    branchScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

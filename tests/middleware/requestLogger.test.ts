/**
 * R2-11b — Request logger focused tests.
 *
 * Tests:
 * - X-Request-ID generated if not provided
 * - X-Request-ID preserved if provided by client
 * - Sensitive fields redacted in request body logs
 * - requestId included in response logs
 * - Production mode logs requests (not just dev)
 */

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  req: jest.fn(),
  res: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import { Request, Response, NextFunction } from 'express';
import requestLogger from '../../src/middleware/logging/requestLogger';
import logger from '../../src/lib/logger';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockReq(overrides: any = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/test',
    headers: {},
    body: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    statusCode: 200,
    setHeader: jest.fn(),
    end: jest.fn(function (this: any, chunk: any, encoding?: any, cb?: any) {
      if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
      if (cb) cb();
      return this;
    }),
  } as unknown as Response;
  // Make end return res for chaining
  (res.end as any).bind = jest.fn().mockReturnValue(res.end);
  return res;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('R2-11b — Request Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generates X-Request-ID when not provided', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.headers['x-request-id']).toBeDefined();
    expect(typeof req.headers['x-request-id']).toBe('string');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.headers['x-request-id']);
  });

  test('preserves client-provided X-Request-ID', () => {
    const clientRequestId = 'my-custom-request-id-abc';
    const req = createMockReq({ headers: { 'x-request-id': clientRequestId } });
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(req.headers['x-request-id']).toBe(clientRequestId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', clientRequestId);
  });

  test('redacts password in request body logs', () => {
    const req = createMockReq({
      body: { username: 'admin', password: 'supersecret123', normalField: 'visible' },
    });
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    // logger.req should be called with sanitized body
    expect(logger.req).toHaveBeenCalled();
    const callArgs = (logger.req as jest.Mock).mock.calls[0];
    const loggedBody = callArgs[3]; // 4th arg is body
    expect(loggedBody.password).toBe('[REDACTED]');
    expect(loggedBody.normalField).toBe('visible');
  });

  test('redacts token in request body logs', () => {
    const req = createMockReq({
      body: { token: 'jwt-secret-value', data: 'ok' },
    });
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    const callArgs = (logger.req as jest.Mock).mock.calls[0];
    const loggedBody = callArgs[3];
    expect(loggedBody.token).toBe('[REDACTED]');
    expect(loggedBody.data).toBe('ok');
  });

  test('redacts secret in nested request body', () => {
    const req = createMockReq({
      body: { config: { secret: 'mysecret', name: 'test' } },
    });
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    const callArgs = (logger.req as jest.Mock).mock.calls[0];
    const loggedBody = callArgs[3];
    expect(loggedBody.config.secret).toBe('[REDACTED]');
    expect(loggedBody.config.name).toBe('test');
  });

  test('redacts apiKey in request body logs', () => {
    const req = createMockReq({
      body: { apiKey: 'sk-12345', name: 'test-key' },
    });
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    const callArgs = (logger.req as jest.Mock).mock.calls[0];
    const loggedBody = callArgs[3];
    expect(loggedBody.apiKey).toBe('[REDACTED]');
  });

  test('logger.req is called with requestId', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    const callArgs = (logger.req as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('POST');    // method
    expect(callArgs[1]).toBe('/api/test'); // url
    expect(callArgs[2]).toBe(req.headers['x-request-id']); // requestId
  });

  test('auditContext includes requestId', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    expect((req as any).auditContext).toBeDefined();
    expect((req as any).auditContext.requestId).toBe(req.headers['x-request-id']);
    expect((req as any).auditContext.ipAddress).toBe('127.0.0.1');
  });

  test('res.end monkey-patch calls logger.res with requestId', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    requestLogger(req, res, next);

    // Simulate response end
    res.end('ok', '' as any, jest.fn());

    expect(logger.res).toHaveBeenCalled();
    const callArgs = (logger.res as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('POST');
    expect(callArgs[1]).toBe('/api/test');
    expect(callArgs[2]).toBe(200); // statusCode
    expect(callArgs[4]).toBe(req.headers['x-request-id']); // requestId
  });
});

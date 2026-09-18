/**
 * R2-11b — Error handler production safety focused tests.
 *
 * Tests:
 * - 500 errors return generic message in production
 * - err.errors not leaked in production
 * - requestId included in error log
 * - Stack trace not leaked in production
 * - Prisma P2025 returns 404
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

jest.mock('../../src/lib/sentry', () => ({
  initSentry: jest.fn(),
  captureRequestError: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import { Request, Response, NextFunction } from 'express';
import errorHandler from '../../src/middleware/error/errorHandler';
import logger from '../../src/lib/logger';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/test',
    headers: { 'x-request-id': 'req-123' },
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('R2-11b — Error Handler Production Safety', () => {
  const originalAppMode = process.env.APP_MODE;

  afterEach(() => {
    process.env.APP_MODE = originalAppMode;
    jest.clearAllMocks();
  });

  describe('Production mode (APP_MODE=production)', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'production';
    });

    test('500 errors return generic message', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Database connection failed at host:5432');
      (err as any).status = 500;

      errorHandler(err, req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Internal server error',
        }),
      );
    });

    test('err.errors is NOT included in production response', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Validation failed');
      (err as any).status = 400;
      (err as any).errors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Too short' },
      ];

      errorHandler(err, req, res, jest.fn());

      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody).not.toHaveProperty('errors');
    });

    test('stack trace is NOT included in production response', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Something broke');
      (err as any).status = 500;
      err.stack = 'Error: Something broke\n    at /app/src/index.ts:42:10';

      errorHandler(err, req, res, jest.fn());

      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody).not.toHaveProperty('stack');
    });

    test('error log includes requestId', () => {
      const req = createMockReq({ headers: { 'x-request-id': 'abc-def-123' } } as any);
      const res = createMockRes();
      const err = new Error('Test error');
      (err as any).status = 500;

      errorHandler(err, req, res, jest.fn());

      expect(logger.error).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          requestId: 'abc-def-123',
        }),
      );
    });

    test('non-500 error message IS passed to client', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Resource not found');
      (err as any).status = 404;

      errorHandler(err, req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Resource not found',
        }),
      );
    });
  });

  describe('Development mode (APP_MODE=development)', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'development';
    });

    test('500 errors return actual error message in dev', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('DB connection timeout');
      (err as any).status = 500;

      errorHandler(err, req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'DB connection timeout',
        }),
      );
    });

    test('err.errors IS included in dev response', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Validation failed');
      (err as any).status = 400;
      (err as any).errors = [{ field: 'email', message: 'Invalid' }];

      errorHandler(err, req, res, jest.fn());

      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.errors).toBeDefined();
    });

    test('stack trace IS included in dev response', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Dev error');
      (err as any).status = 500;
      err.stack = 'Error: Dev error\n    at test.ts:1:1';

      errorHandler(err, req, res, jest.fn());

      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.stack).toBeDefined();
    });
  });

  describe('Prisma P2025 handling', () => {
    test('P2025 returns 404 with not found message', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err = new Error('Record not found');
      (err as any).code = 'P2025';

      errorHandler(err, req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'The requested resource was not found.',
      });
    });
  });
});

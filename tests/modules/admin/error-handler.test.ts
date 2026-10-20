/**
 * Error handler tests — Prisma failure mapping.
 *
 * Every Prisma failure used to collapse into a masked 500 ("Internal server
 * error"), so the UI could not tell a duplicate record from a broken server.
 * These lock in the real status for each known code and the masking rules for
 * everything else.
 */

import request from 'supertest';

type HandlerArgs = {
  err: any;
  req?: any;
  res?: any;
};

function invokeHandler({ err, req, res }: HandlerArgs) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const handler = require('../../../src/middleware/error/errorHandler').default;
  const calls: unknown[] = [];
  const mockRes = {
    status: (c: number) => ({ json: (b: unknown) => { calls.push([c, b]); } }),
  } as never;
  const mockReq = { headers: {}, method: 'POST', originalUrl: '/x', ...req } as never;
  handler(err, mockReq, mockRes, () => undefined);
  return calls[0] as [number, Record<string, unknown>];
}

describe('errorHandler — Prisma error mapping', () => {
  const originalMode = process.env.APP_MODE;

  afterEach(() => {
    process.env.APP_MODE = originalMode;
  });

  test('P2002 (unique violation) is a 409, not a masked 500', () => {
    process.env.APP_MODE = 'production';
    const [code, body] = invokeHandler({
      err: Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    });
    expect(code).toBe(409);
    expect(body.success).toBe(false);
    expect(body.message).toBe('That record already exists.');
  });

  test('P2003 (foreign key violation) is a 400', () => {
    process.env.APP_MODE = 'production';
    const [code, body] = invokeHandler({
      err: Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' }),
    });
    expect(code).toBe(400);
    expect(body.message).toMatch(/still linked to other data/i);
  });

  test('P2014 (required relation still holds rows) is a 400', () => {
    process.env.APP_MODE = 'production';
    const [code] = invokeHandler({
      err: Object.assign(new Error('Relation violation'), { code: 'P2014' }),
    });
    expect(code).toBe(400);
  });

  test('P2024 (connection pool exhausted) is a 503 — the server is busy, not broken', () => {
    process.env.APP_MODE = 'production';
    const [code, body] = invokeHandler({
      err: Object.assign(new Error('Timed out fetching a new connection'), { code: 'P2024' }),
    });
    expect(code).toBe(503);
    expect(body.message).toMatch(/busy right now/i);
  });

  test('P2025 (not found) stays a 404', () => {
    process.env.APP_MODE = 'production';
    const [code, body] = invokeHandler({
      err: Object.assign(new Error('Record not found'), { code: 'P2025' }),
    });
    expect(code).toBe(404);
    expect(body.message).toBe('The requested resource was not found.');
  });

  test('an unknown 500 is still masked as "Internal server error" in production', () => {
    process.env.APP_MODE = 'production';
    const [code, body] = invokeHandler({ err: new Error('boom') });
    expect(code).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
  });

  test('in development the real Prisma message is returned', () => {
    process.env.APP_MODE = 'development';
    const [code, body] = invokeHandler({
      err: Object.assign(new Error('Unique constraint failed on students_admissionNumber'), { code: 'P2002' }),
    });
    expect(code).toBe(409);
    expect(body.message).toMatch(/students_admissionNumber/);
  });

  test('a Prisma failure never leaks internals in production', () => {
    process.env.APP_MODE = 'production';
    const [, body] = invokeHandler({
      err: Object.assign(new Error('prisma SELECT * FROM users /tmp/secret'), {
        code: 'P2002',
        meta: { target: ['id'] },
      }),
    });
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/prisma|SELECT|\/tmp/i);
  });
});

describe('errorHandler — thrown error through express', () => {
  const originalMode = process.env.APP_MODE;

  afterEach(() => {
    process.env.APP_MODE = originalMode;
  });

  test('a database constraint failure surfaces as 409 end to end', async () => {
    process.env.APP_MODE = 'production';
    const express = jest.requireActual('express');
    const testApp = express();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const errorHandler = require('../../../src/middleware/error/errorHandler').default;
    testApp.post('/dup', () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });
    testApp.use(errorHandler);

    const res = await request(testApp).post('/dup');
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('That record already exists.');
  });
});

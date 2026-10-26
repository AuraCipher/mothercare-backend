/**
 * Rate limiter configuration tests.
 *
 * Tests:
 * - Global pool defaults to 200 requests per 60s window
 * - RATE_LIMIT_GLOBAL_MAX env override is respected and 429 after exhaustion
 * - Pool refills after the window rolls over
 */

import express, { Request, Response } from 'express';
import request from 'supertest';

const SETUP_JEST_POOL = '9999';

afterAll(() => {
  // setup.ts pins a large pool for the rest of the suite — restore it.
  process.env.RATE_LIMIT_GLOBAL_MAX = SETUP_JEST_POOL;
});

async function importLimiter(env: Record<string, string>) {
  jest.resetModules();
  delete process.env.RATE_LIMIT_GLOBAL_MAX;
  delete process.env.RATE_LIMIT_GLOBAL_WINDOW_MS;
  Object.assign(process.env, env);
  const mod = await import('../../src/middleware/security/rateLimiter');
  return mod;
}

function buildApp(limiter: express.RequestHandler) {
  const app = express();
  app.use(limiter);
  app.get('/x', (_req: Request, res: Response) => res.status(204).end());
  return app;
}

describe('globalLimiter', () => {
  it('defaults to 200 requests per 60s window when env is silent', async () => {
    const { globalLimiter } = await importLimiter({});

    const res = await request(buildApp(globalLimiter)).get('/x');

    expect(res.status).toBe(204);
    expect(res.headers['ratelimit-limit']).toBe('200');
  });

  it('honours the env override and rejects once the pool is drained', async () => {
    const { globalLimiter } = await importLimiter({ RATE_LIMIT_GLOBAL_MAX: '3' });
    const app = buildApp(globalLimiter);

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/x');
      expect(ok.status).toBe(204);
    }

    const drained = await request(app).get('/x');
    expect(drained.status).toBe(429);
    expect(drained.body.message).toBe('Too many requests. Please slow down.');
    expect(drained.headers['ratelimit-remaining']).toBe('0');
  });

  it('refills the pool once the window rolls over', async () => {
    const { globalLimiter } = await importLimiter({
      RATE_LIMIT_GLOBAL_MAX: '1',
      RATE_LIMIT_GLOBAL_WINDOW_MS: '400',
    });
    const app = buildApp(globalLimiter);

    expect((await request(app).get('/x')).status).toBe(204);
    expect((await request(app).get('/x')).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const refilled = await request(app).get('/x');
    expect(refilled.status).toBe(204);
    expect(refilled.headers['ratelimit-limit']).toBe('1');
  });
});

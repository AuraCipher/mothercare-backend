/**
 * R2-11b — Health endpoint focused tests.
 *
 * Tests:
 * - GET /health/live returns 200 with alive status
 * - GET /health/ready returns 200 when database is ready
 * - GET /health/ready returns 503 when database is not ready
 * - GET /health backward compat returns 200
 * - GET /health/deep checks DB + Redis
 * - No sensitive data in health responses
 */

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
  basePrisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getUpstashRedis: jest.fn().mockReturnValue(null),
  kv: null,
  testRedisConnection: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/config/redis-tcp', () => ({
  getRedisConnectionConfig: jest.fn().mockReturnValue(null),
  testTcpRedisConnection: jest.fn().mockResolvedValue(false),
  closeRedisConnection: jest.fn(),
}));

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

jest.mock('../../src/lib/startup', () => ({
  runStartupChecks: jest.fn().mockResolvedValue([]),
  printStartupBanner: jest.fn(),
  setupGracefulShutdown: jest.fn(),
}));

jest.mock('../../src/config/env', () => ({
  default: {
    NODE_ENV: 'test',
    APP_MODE: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    JWT_SECRET: 'test-secret-key-for-testing-only-that-is-at-least-32-chars',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/mcs_test',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    SOCKET_PATH: '/socket.io',
  },
}));

jest.mock('../../src/modules/auth/auth.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/api-key/api-key.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/setup/setup.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/admin/routes/admin.routes', () => {
  const r = require('express').Router();
  r.meRouter = require('express').Router();
  return r;
});
jest.mock('../../src/modules/admin/routes/invitation.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/admin/routes/branch-admin.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/upload/upload.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/chat/routes/chat.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/staff/routes/staff.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/canteen/canteen.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/teacher/routes/teacher.routes', () => {
  const r = require('express').Router();
  return r;
});
jest.mock('../../src/modules/student/routes/student.routes', () => {
  const r = require('express').Router();
  return r;
});

jest.mock('../../src/middleware/logging/requestLogger', () => {
  return (req: any, _res: any, next: any) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || 'test-req-id';
    next();
  };
});

jest.mock('../../src/middleware/auth/auditContext.middleware', () => ({
  auditContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../src/middleware/security/rateLimiter', () => ({
  globalLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../src/middleware/error/errorHandler', () => {
  return (err: any, _req: any, res: any, _next: any) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({
      success: false,
      message: process.env.APP_MODE === 'development' ? err.message : 'Internal server error',
    });
  };
});

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import request from 'supertest';
import app from '../../src/app';
import { markReady, markDown } from '../../src/lib/componentStatus';

/* ------------------------------------------------------------------ */
/*  Tests: Liveness                                                    */
/* ------------------------------------------------------------------ */

describe('R2-11b — GET /health/live', () => {
  test('returns 200 with alive status', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(res.body.timestamp).toBeDefined();
  });

  test('does not depend on any external service', async () => {
    // Even if database is down, liveness must return 200
    markDown('database', 'simulated failure');
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    // Restore
    markReady('database');
  });

  test('response contains no sensitive data', async () => {
    const res = await request(app).get('/health/live');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/password|secret|token|key|database_url|redis_url/i);
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: Readiness                                                   */
/* ------------------------------------------------------------------ */

describe('R2-11b — GET /health/ready', () => {
  beforeEach(() => {
    markReady('database');
  });

  test('returns 200 when database is ready', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.ready).toBe(true);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.components).toBeDefined();
    expect(res.body.components.database.state).toBe('ready');
  });

  test('returns 503 when database is not ready', async () => {
    markDown('database', 'connection refused');
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.ready).toBe(false);
    expect(res.body.message).toMatch(/Database not ready/i);
  });

  test('readiness includes uptimeMs', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.body.uptimeMs).toBeDefined();
    expect(typeof res.body.uptimeMs).toBe('number');
  });

  test('readiness includes all component statuses', async () => {
    const res = await request(app).get('/health/ready');
    const components = res.body.components;
    expect(components).toHaveProperty('database');
    expect(components).toHaveProperty('tcpRedis');
    expect(components).toHaveProperty('upstashRedis');
    expect(components).toHaveProperty('messageWorker');
    expect(components).toHaveProperty('chatWorker');
    expect(components).toHaveProperty('socketIo');
  });

  test('response contains no sensitive data', async () => {
    const res = await request(app).get('/health/ready');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/password|secret|token(?!s)|database_url|redis_url/i);
  });

  test('returns 503 when only database is down (not when Redis is down)', async () => {
    markReady('database');
    markDown('tcpRedis', 'unreachable');
    markDown('upstashRedis', 'not configured');
    const res = await request(app).get('/health/ready');
    // Database is ready, so readiness should be OK despite Redis failures
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: Backward-compatible /health                                 */
/* ------------------------------------------------------------------ */

describe('R2-11b — GET /health (backward compat)', () => {
  test('returns 200 with OK status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.timestamp).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: Deep health check (backward compat)                         */
/* ------------------------------------------------------------------ */

describe('R2-11b — GET /health/deep', () => {
  test('returns 200 when DB is available', async () => {
    const res = await request(app).get('/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.checks.database).toBe('ok');
  });
});

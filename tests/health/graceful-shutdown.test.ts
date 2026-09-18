/**
 * R2-11b — Graceful shutdown focused tests.
 *
 * Tests:
 * - SIGTERM triggers shutdown and logs signal name
 * - Shutdown step logs include durationMs
 * - prisma.$disconnect is called during shutdown
 * - SIGINT also triggers shutdown
 * - process.exit is called after successful shutdown
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

jest.mock('../../src/config/redis', () => ({
  testRedisConnection: jest.fn().mockResolvedValue(false),
  getUpstashRedis: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/config/redis-tcp', () => ({
  testTcpRedisConnection: jest.fn().mockResolvedValue(false),
  closeRedisConnection: jest.fn(),
}));

jest.mock('../../src/queues/message.queue', () => ({
  closeMessageQueue: jest.fn(),
}));

jest.mock('../../src/queues/chat.queue', () => ({
  closeChatQueue: jest.fn(),
}));

jest.mock('../../src/queues/message.worker', () => ({
  stopMessageWorker: jest.fn(),
  startMessageWorker: jest.fn(),
}));

jest.mock('../../src/queues/chat.worker', () => ({
  stopChatWorker: jest.fn(),
  startChatWorker: jest.fn(),
}));

jest.mock('../../src/modules/chat/socket/chat.socket', () => ({
  closeChatSocket: jest.fn(),
  initChatSocket: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    $disconnect: jest.fn(),
    $connect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

jest.mock('../../src/lib/componentStatus', () => ({
  markReady: jest.fn(),
  markDegraded: jest.fn(),
  markDown: jest.fn(),
  markServerStarted: jest.fn(),
  isReady: jest.fn().mockReturnValue(true),
  getReadinessReport: jest.fn().mockReturnValue({ ready: true, uptimeMs: 1000, components: {} }),
  getComponentStatus: jest.fn().mockReturnValue({}),
  getUptimeMs: jest.fn().mockReturnValue(1000),
}));

jest.mock('../../src/config/env', () => ({
  default: {
    NODE_ENV: 'test',
    APP_MODE: 'test',
    JWT_SECRET: 'test-secret-key-for-testing-only-that-is-at-least-32-chars',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/mcs_test',
  },
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import http from 'http';
import { setupGracefulShutdown } from '../../src/lib/startup';
import { prisma } from '../../src/lib/prisma';
import logger from '../../src/lib/logger';

/* ------------------------------------------------------------------ */
/*  Helper: wait for shutdown to complete                              */
/* ------------------------------------------------------------------ */

function waitForExit(spy: jest.SpyInstance, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (spy.mock.calls.length > 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for process.exit'));
      setTimeout(check, 10);
    };
    check();
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('R2-11b — Graceful Shutdown', () => {
  let server: http.Server;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
  });

  afterEach(() => {
    server.removeAllListeners();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    exitSpy.mockRestore();
  });

  test('SIGTERM triggers shutdown and logs signal name', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGTERM' as NodeJS.Signals);

    await waitForExit(exitSpy);

    // Find the log call containing the signal name
    const allCalls = (logger.info as jest.Mock).mock.calls;
    const shutdownLog = allCalls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SIGTERM'),
    );
    expect(shutdownLog).toBeDefined();
    expect(shutdownLog![0]).toContain('SIGTERM');
  });

  test('shutdown completion log includes totalDurationMs', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGTERM' as NodeJS.Signals);

    await waitForExit(exitSpy);

    const allCalls = (logger.info as jest.Mock).mock.calls;
    const completionLog = allCalls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('Graceful shutdown completed'),
    );
    expect(completionLog).toBeDefined();
    expect(completionLog![1]).toHaveProperty('totalDurationMs');
    expect(typeof completionLog![1].totalDurationMs).toBe('number');
  });

  test('shutdown step logs include durationMs', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGTERM' as NodeJS.Signals);

    await waitForExit(exitSpy);

    const allCalls = (logger.info as jest.Mock).mock.calls;
    const stepLogs = allCalls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('Shutdown step completed'),
    );
    expect(stepLogs.length).toBeGreaterThan(0);

    for (const log of stepLogs) {
      expect(log[1]).toHaveProperty('durationMs');
      expect(typeof log[1].durationMs).toBe('number');
    }
  });

  test('prisma.$disconnect is called during shutdown', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGTERM' as NodeJS.Signals);

    await waitForExit(exitSpy);

    expect(prisma.$disconnect).toHaveBeenCalled();
  });

  test('SIGINT also triggers shutdown', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGINT' as NodeJS.Signals);

    await waitForExit(exitSpy);

    const allCalls = (logger.info as jest.Mock).mock.calls;
    const shutdownLog = allCalls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SIGINT'),
    );
    expect(shutdownLog).toBeDefined();
  });

  test('process.exit is called after successful shutdown', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));

    setupGracefulShutdown(prisma as any, server);
    process.emit('SIGTERM' as NodeJS.Signals);

    await waitForExit(exitSpy);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

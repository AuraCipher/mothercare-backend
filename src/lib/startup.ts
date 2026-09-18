import logger from './logger';
import env from '../config/env';
import { testRedisConnection } from '../config/redis';
import { closeRedisConnection, testTcpRedisConnection } from '../config/redis-tcp';
import { closeMessageQueue } from '../queues/message.queue';
import { closeChatQueue } from '../queues/chat.queue';
import { stopMessageWorker } from '../queues/message.worker';
import { stopChatWorker } from '../queues/chat.worker';
import { closeChatSocket } from '../modules/chat/socket/chat.socket';
import { prisma } from './prisma';
import { markReady, markDegraded, markDown, markServerStarted } from './componentStatus';

type CheckResult = { name: string; status: 'ok' | 'fail'; detail?: string };

/**
 * Run all startup health checks before accepting traffic.
 * Returns true if all critical checks pass.
 */
export async function runStartupChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ─── 1. Environment ──────────────────────────────────────
  logger.info('Checking environment variables...');
  results.push({
    name: 'ENV Variables',
    status: env.JWT_SECRET && env.DATABASE_URL ? 'ok' : 'fail',
    detail: `Mode: ${env.APP_MODE || 'production'}`,
  });

  // ─── 2. Database (Prisma) ──────────────────────────────
  logger.info('Checking database connection...');
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    results.push({ name: 'Database (PostgreSQL)', status: 'ok' });
    markReady('database');

    // Idempotent seed — default grade scale for exam/report card grading
    try {
      const { seedDefaultGradeScale } = await import('../modules/admin/services/grade-scale.seed');
      await seedDefaultGradeScale();
      results.push({ name: 'Grade Scale Seed', status: 'ok' });
    } catch (seedErr: any) {
      results.push({
        name: 'Grade Scale Seed',
        status: 'ok',
        detail: seedErr?.message || 'skipped',
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Database (PostgreSQL)',
      status: 'fail',
      detail: err.message,
    });
    markDown('database', 'Connection failed');
  }

  // ─── 3. Redis (Upstash REST — JWT blacklist) ─────────────
  logger.info('Checking Redis connection...');
  const redisOk = await testRedisConnection();
  if (redisOk) {
    results.push({ name: 'Redis (Upstash REST)', status: 'ok' });
    markReady('upstashRedis');
  } else {
    results.push({
      name: 'Redis (Upstash REST)',
      status: 'ok',
      detail: 'Not configured — non-critical, auth will still work',
    });
    markDegraded('upstashRedis', 'Not configured — JWT blacklist disabled');
  }

  // ─── 4. Redis TCP (BullMQ message queue) ─────────────────
  const tcpRedisOk = await testTcpRedisConnection();
  if (tcpRedisOk) {
    results.push({ name: 'Redis (TCP / Queue)', status: 'ok' });
    markReady('tcpRedis');
  } else {
    results.push({
      name: 'Redis (TCP / Queue)',
      status: 'ok',
      detail: env.REDIS_URL ? 'Configured but unreachable — sends fall back to direct delivery' : 'REDIS_URL not set — queue disabled',
    });
    markDegraded('tcpRedis', env.REDIS_URL ? 'Unreachable — queue disabled' : 'Not configured');
  }

  return results;
}

/**
 * Print startup banner with check results
 */
export function printStartupBanner(results: CheckResult[]) {
  const allOk = results.every((r) => r.status === 'ok');

  const border = '═'.repeat(55);
  const pad = (s: string) => s.padEnd(20);

  console.log('');
  console.log(`  ╔${border}╗`);
  console.log(`  ║        🏫  Mother Care School — Backend API              ║`);
  console.log(`  ║        ${env.SCHOOL_NAME || 'School Management'}              ║`);
  console.log(`  ╠${border}╣`);
  for (const r of results) {
    const icon = r.status === 'ok' ? ' ✅' : ' ❌';
    console.log(`  ${icon}    ${pad(r.name)}  ${r.detail || ''}`);
  }
  console.log(`  ╠${border}╣`);
  console.log(`  ║     📅  ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  console.log(`  ║     🔧  ${env.APP_MODE === 'development' ? 'Development Mode' : 'Production Mode'}`);
  console.log(`  ╚${border}╝`);
  console.log('');

  if (!allOk) {
    throw new Error('Startup checks failed. Server will not start.');
  }
}

/**
 * Graceful shutdown handler with per-step timing and structured logs.
 */
export function setupGracefulShutdown(prisma: { $disconnect: () => Promise<void> }, server: any) {
  let forceExitTimer: ReturnType<typeof setTimeout> | null = null;
  let shutdownCompleted = false;

  const shutdown = async (signal: string) => {
    if (shutdownCompleted) return;
    const shutdownStart = Date.now();
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Step helper: log each teardown step with timing
    const step = async (name: string, fn: () => Promise<void>) => {
      const stepStart = Date.now();
      try {
        await fn();
        const ms = Date.now() - stepStart;
        logger.info(`Shutdown step completed: ${name}`, { durationMs: ms });
      } catch (e: any) {
        const ms = Date.now() - stepStart;
        logger.error(`Shutdown step failed: ${name}`, {
          durationMs: ms,
          error: e?.message || 'unknown',
        });
      }
    };

    server.close(async () => {
      logger.info('HTTP server closed — no new connections accepted');

      await step('stopMessageWorker', stopMessageWorker);
      await step('stopChatWorker', stopChatWorker);
      await step('closeMessageQueue', closeMessageQueue);
      await step('closeChatQueue', closeChatQueue);
      await step('closeChatSocket', closeChatSocket);
      await step('closeRedisConnection', closeRedisConnection);

      await step('prismaDisconnect', async () => {
        await prisma.$disconnect();
      });

      const totalMs = Date.now() - shutdownStart;
      logger.info('Graceful shutdown completed', { totalDurationMs: totalMs, signal });

      shutdownCompleted = true;
      if (forceExitTimer) {
        clearTimeout(forceExitTimer);
        forceExitTimer = null;
      }
      process.exit(0);
    });

    // Force shutdown after 10s — only if graceful shutdown hasn't completed
    forceExitTimer = setTimeout(() => {
      if (!shutdownCompleted) {
        const totalMs = Date.now() - shutdownStart;
        logger.error('Forced shutdown: could not close gracefully within 10s', {
          totalDurationMs: totalMs,
          signal,
        });
        process.exit(1);
      }
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception — exiting', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection — exiting to prevent corrupted state', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
  });
}

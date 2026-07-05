import logger from './logger';
import env from '../config/env';
import { testRedisConnection } from '../config/redis';
import { closeRedisConnection, testTcpRedisConnection } from '../config/redis-tcp';
import { closeMessageQueue } from '../queues/message.queue';
import { stopMessageWorker } from '../queues/message.worker';
import { prisma } from './prisma';

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
  }

  // ─── 3. Redis (Upstash REST — JWT blacklist) ─────────────
  logger.info('Checking Redis connection...');
  const redisOk = await testRedisConnection();
  if (redisOk) {
    results.push({ name: 'Redis (Upstash REST)', status: 'ok' });
  } else {
    results.push({
      name: 'Redis (Upstash REST)',
      status: 'ok',
      detail: 'Not configured — non-critical, auth will still work',
    });
  }

  // ─── 4. Redis TCP (BullMQ message queue) ─────────────────
  const tcpRedisOk = await testTcpRedisConnection();
  if (tcpRedisOk) {
    results.push({ name: 'Redis (TCP / Queue)', status: 'ok' });
  } else {
    results.push({
      name: 'Redis (TCP / Queue)',
      status: 'ok',
      detail: env.REDIS_URL ? 'Configured but unreachable — sends fall back to direct delivery' : 'REDIS_URL not set — queue disabled',
    });
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
 * Graceful shutdown handler
 */
export function setupGracefulShutdown(prisma: { $disconnect: () => Promise<void> }, server: any) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    server.close(async () => {
      logger.info('HTTP server closed.');

      try {
        await stopMessageWorker();
        await closeMessageQueue();
        await closeRedisConnection();
      } catch (e) {
        logger.error('Error closing message queue / Redis', e);
      }

      try {
        await prisma.$disconnect();
        logger.info('Database disconnected.');
      } catch (e) {
        logger.error('Error disconnecting from database', e);
      }

      logger.info('Process terminated cleanly.');
      process.exit(0);
    });

    // Force shutdown after 10s
    setTimeout(() => {
      logger.error('Forced shutdown: could not close gracefully within 10s');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err);
    throw err;
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', reason as any);
  });
}

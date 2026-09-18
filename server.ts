import 'dotenv/config';
import http from 'http';
import app from './src/app';
import env from './src/config/env';
import { initSentry } from './src/lib/sentry';
import { prisma } from './src/lib/prisma';
import { runStartupChecks, printStartupBanner, setupGracefulShutdown } from './src/lib/startup';
import logger from './src/lib/logger';
import { startMessageWorker } from './src/queues/message.worker';
import { startChatWorker } from './src/queues/chat.worker';
import { initChatSocket } from './src/modules/chat/socket/chat.socket';
import { markServerStarted, markReady } from './src/lib/componentStatus';

const PORT = parseInt(env.PORT as any, 10) || 5000;
const HOST = (env as any).HOST || '0.0.0.0';

async function main() {
  try {
    initSentry();
    // ─── 1. Run startup health checks ──────────────────────
    const checks = await runStartupChecks();
    printStartupBanner(checks);

    // ─── 2. Create and start HTTP server ───────────────────
    const server = http.createServer(app);

    const io = await initChatSocket(server);
    if (io) {
      markReady('socketIo', 'Connected');
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `Port ${PORT} is already in use. Stop the other process (e.g. kill $(lsof -t -i:${PORT})) or change PORT in .env`,
            ),
          );
          return;
        }
        reject(err);
      });
      server.listen(PORT, HOST, () => resolve());
    });

    // ─── Request timeout — 60 s safety net ────────────────
    server.requestTimeout = 60_000;

    // ─── Mark server as started (for uptime tracking) ──────
    markServerStarted();

    logger.info(`Server running on http://${HOST}:${PORT}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`App Mode: ${env.APP_MODE}`);
    logger.info(`Started at: ${new Date().toISOString()}`);
    logger.info(`Health (liveness):  http://${HOST}:${PORT}/health/live`);
    logger.info(`Health (readiness): http://${HOST}:${PORT}/health/ready`);

    // ─── 3. Setup graceful shutdown ────────────────────────
    setupGracefulShutdown(prisma, server);

    startMessageWorker();
    startChatWorker();

    // ─── 4. Process info ─────────────────────────────────────
    if (env.APP_MODE === 'development') {
      logger.info('File watching enabled (ts-node-dev --respawn)');
    }
  } catch (err: any) {
    logger.error('Failed to start server:', err.message || err);
    process.exit(1);
  }
}

main();

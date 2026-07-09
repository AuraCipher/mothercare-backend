import 'dotenv/config';
import http from 'http';
import app from './src/app';
import env from './src/config/env';
import { prisma } from './src/lib/prisma';
import { runStartupChecks, printStartupBanner, setupGracefulShutdown } from './src/lib/startup';
import logger from './src/lib/logger';
import { startMessageWorker } from './src/queues/message.worker';
import { startChatWorker } from './src/queues/chat.worker';
import { initChatSocket } from './src/modules/chat/socket/chat.socket';

const PORT = parseInt(env.PORT as any, 10) || 5000;
const HOST = (env as any).HOST || '0.0.0.0';

async function main() {
  try {
    // ─── 1. Run startup health checks ──────────────────────
    const checks = await runStartupChecks();
    printStartupBanner(checks);

    // ─── 2. Create and start HTTP server ───────────────────
    const server = http.createServer(app);

    await initChatSocket(server);

    server.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
      logger.info(`📍 Environment: ${env.NODE_ENV}`);
      logger.info(`🔧 App Mode: ${env.APP_MODE}`);
      logger.info(`📅 Started at: ${new Date().toISOString()}`);
      logger.info(`➡️  Health check:  http://${HOST}:${PORT}/health`);
      logger.info(`➡️  Key Manager:   http://${HOST}:${PORT}/key-manager`);
    });

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

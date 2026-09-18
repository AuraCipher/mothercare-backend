import { Worker } from 'bullmq';
import env from '../config/env';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';
import { sendEncryptedPushToUsers } from '../modules/chat/push/fcm.service';
import {
  CHAT_PUSH_FANOUT_JOB,
  CHAT_QUEUE_NAME,
  type ChatPushFanoutJob,
} from './chat.queue';

let worker: Worker | null = null;
let consecutiveWorkerErrors = 0;

async function handlePushFanout(data: ChatPushFanoutJob) {
  await sendEncryptedPushToUsers(data.recipientUserIds, data.keyVersion, {
    type: 'chat_message',
    roomId: data.roomId,
    messageId: data.messageId,
    senderId: data.senderId,
    preview: data.preview,
    roomName: data.roomName,
  });
}

export function startChatWorker(): Worker | null {
  const connection = getRedisConnectionConfig();
  if (!connection) {
    logger.info('Chat worker skipped — REDIS_URL not configured');
    return null;
  }
  if (worker) return worker;

  const concurrency = parseInt(env.CHAT_QUEUE_CONCURRENCY || '5', 10);
  worker = new Worker(
    CHAT_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case CHAT_PUSH_FANOUT_JOB:
          await handlePushFanout(job.data as ChatPushFanoutJob);
          break;
        default:
          throw new Error(`Unknown chat job: ${job.name}`);
      }
    },
    { connection, concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error('Chat worker job failed', { jobId: job?.id, name: job?.name, error: err.message });
  });

  worker.on('error', (err) => {
    consecutiveWorkerErrors++;
    if (consecutiveWorkerErrors === 1 || consecutiveWorkerErrors % 10 === 0) {
      logger.error('Chat worker error (repeated)', {
        error: err.message,
        consecutiveErrors: consecutiveWorkerErrors,
      });
    }
  });

  worker.on('ready', () => {
    if (consecutiveWorkerErrors > 0) {
      logger.info('Chat worker reconnected', { afterErrors: consecutiveWorkerErrors });
    }
    consecutiveWorkerErrors = 0;
  });

  logger.info('Chat worker started', { concurrency });
  return worker;
}

export async function stopChatWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Chat worker stopped');
  }
}

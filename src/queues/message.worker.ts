import { Worker } from 'bullmq';
import env from '../config/env';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';
import { deliverCredential, type SendCredentialResult } from '../services/credential-delivery.service';
import {
  CREDENTIAL_SEND_JOB,
  MESSAGE_QUEUE_NAME,
  type CredentialSendJobData,
} from './message.queue';

let worker: Worker | null = null;

export function startMessageWorker(): Worker | null {
  const connection = getRedisConnectionConfig();
  if (!connection) {
    logger.info('Message worker skipped — REDIS_URL not configured');
    return null;
  }

  if (worker) return worker;

  const concurrency = parseInt(env.MESSAGE_QUEUE_CONCURRENCY || '3', 10);

  worker = new Worker<CredentialSendJobData, SendCredentialResult>(
    MESSAGE_QUEUE_NAME,
    async (job) => {
      if (job.name !== CREDENTIAL_SEND_JOB) {
        throw new Error(`Unknown job type: ${job.name}`);
      }
      return deliverCredential(job.data);
    },
    {
      connection,
      concurrency,
      limiter: {
        max: 20,
        duration: 1000,
      },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Message worker job failed', {
      jobId: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Message worker error', { error: err.message });
  });

  logger.info('Message worker started', { concurrency });
  return worker;
}

export async function stopMessageWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Message worker stopped');
  }
}

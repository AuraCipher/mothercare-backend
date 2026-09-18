import { UnrecoverableError, Worker } from 'bullmq';
import env from '../config/env';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';
import { markReady, markDegraded } from '../lib/componentStatus';
import { processMediaFile } from '../modules/media/media-processor';
import { MEDIA_PROCESS_JOB, MEDIA_QUEUE_NAME, type MediaProcessJob } from './media.queue';

/**
 * M5 — media processing worker. Bounded concurrency for the 3 vCPU / 4 GB
 * VPS (default 2; each job additionally passes the module pLimit(2) and
 * Sharp pLimit(3)). Permanent validation failures throw UnrecoverableError
 * (no pointless retries of malformed user media); infrastructure failures
 * use the queue attempts/backoff. Long jobs (big Sharp/probe) get a 5 min
 * lock so BullMQ never treats them as stalled mid-work.
 */
let worker: Worker | null = null;
let consecutiveWorkerErrors = 0;

/** Exported for unit tests (no Redis needed to prove the mapping). */
export async function handleMediaProcess(data: MediaProcessJob) {
  try {
    await processMediaFile(data.fileRecordId);
  } catch (err: any) {
    if (err?.retryable === true || err?.status === 502) {
      throw err; // retryable: queue attempts/backoff apply
    }
    throw new UnrecoverableError(err?.message || 'Media processing failed permanently');
  }
}

export function startMediaWorker(): Worker | null {
  const connection = getRedisConnectionConfig();
  if (!connection) {
    logger.info('Media worker skipped — REDIS_URL not configured');
    return null;
  }
  if (worker) return worker;

  const concurrency = parseInt(env.MEDIA_WORKER_CONCURRENCY || '2', 10);
  worker = new Worker(MEDIA_QUEUE_NAME, async (job) => {
    switch (job.name) {
      case MEDIA_PROCESS_JOB:
        await handleMediaProcess(job.data as MediaProcessJob);
        break;
      default:
        throw new UnrecoverableError(`Unknown media job: ${job.name}`);
    }
  }, { connection, concurrency, lockDuration: 300000 });

  worker.on('failed', (job, err) => {
    logger.error('Media worker job failed', {
      jobId: job?.id,
      name: job?.name,
      fileRecordId: (job?.data as MediaProcessJob | undefined)?.fileRecordId,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    consecutiveWorkerErrors++;
    if (consecutiveWorkerErrors === 1 || consecutiveWorkerErrors % 10 === 0) {
      logger.error('Media worker error (repeated)', {
        error: err.message,
        consecutiveErrors: consecutiveWorkerErrors,
      });
    }
    if (consecutiveWorkerErrors === 1) {
      markDegraded('mediaWorker', 'Connection errors');
    }
  });

  worker.on('ready', () => {
    if (consecutiveWorkerErrors > 0) {
      logger.info('Media worker reconnected', { afterErrors: consecutiveWorkerErrors });
    }
    consecutiveWorkerErrors = 0;
    markReady('mediaWorker', `concurrency=${concurrency}`);
  });

  logger.info('Media worker started', { concurrency });
  return worker;
}

export async function stopMediaWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Media worker stopped');
  }
}

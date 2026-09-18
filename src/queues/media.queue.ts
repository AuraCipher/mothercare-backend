import { Queue } from 'bullmq';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';

/**
 * M5 — media processing queue. Job payloads carry REFERENCES only
 * ({fileRecordId, processingVersion}) — never media bytes (§19).
 */
export const MEDIA_QUEUE_NAME = 'media';
export const MEDIA_PROCESS_JOB = 'media_process';
export const MEDIA_PROCESSING_VERSION = 1;

export type MediaProcessJob = {
  fileRecordId: string;
  processingVersion: number;
};

let queue: Queue | null = null;

export function buildMediaJobData(fileRecordId: string): MediaProcessJob {
  return { fileRecordId, processingVersion: MEDIA_PROCESSING_VERSION };
}

export function isMediaQueueEnabled(): boolean {
  return !!getRedisConnectionConfig();
}

export function getMediaQueue(): Queue | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;
  if (!queue) queue = new Queue(MEDIA_QUEUE_NAME, { connection });
  return queue;
}

export async function enqueueMediaProcess(data: MediaProcessJob) {
  const q = getMediaQueue();
  if (!q) {
    logger.debug('Media queue disabled — caller falls back to inline processing', {
      fileRecordId: data.fileRecordId,
    });
    return null;
  }
  return q.add(MEDIA_PROCESS_JOB, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}

export async function closeMediaQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

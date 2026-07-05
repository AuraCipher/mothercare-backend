import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';
import {
  deliverCredential,
  type CredentialDeliveryParams,
  type SendCredentialResult,
} from '../services/credential-delivery.service';

export const CREDENTIAL_SEND_JOB = 'credential_send';
export const MESSAGE_QUEUE_NAME = 'messages';

export type CredentialSendJobData = CredentialDeliveryParams;

let queue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

export function isMessageQueueEnabled(): boolean {
  return !!getRedisConnectionConfig();
}

export function getCredentialQueue(): Queue | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;

  if (!queue) {
    queue = new Queue(MESSAGE_QUEUE_NAME, { connection });
  }

  return queue;
}

export function getQueueEvents(): QueueEvents | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;

  if (!queueEvents) {
    queueEvents = new QueueEvents(MESSAGE_QUEUE_NAME, { connection });
  }

  return queueEvents;
}

export async function enqueueCredentialSend(
  data: CredentialSendJobData,
  opts?: { wait?: boolean; jobId?: string },
): Promise<SendCredentialResult> {
  const q = getCredentialQueue();
  if (!q) {
    return deliverCredential(data);
  }

  const job = await q.add(CREDENTIAL_SEND_JOB, data, {
    jobId: opts?.jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  if (opts?.wait === false) {
    return {
      success: true,
      channel: 'whatsapp',
      messageStatus: 'queued',
      messageId: job.id,
    };
  }

  const events = getQueueEvents();
  if (!events) {
    return deliverCredential(data);
  }

  try {
    const result = await job.waitUntilFinished(events, 60_000);
    return result as SendCredentialResult;
  } catch (err: unknown) {
    const state = await job.getState();
    const failedReason = job.failedReason || (err instanceof Error ? err.message : 'Job failed');
    logger.error('Credential queue job failed', { jobId: job.id, state, failedReason });

    const returnvalue = job.returnvalue as SendCredentialResult | undefined;
    if (returnvalue && typeof returnvalue === 'object') {
      return returnvalue;
    }

    return {
      success: false,
      channel: 'whatsapp',
      messageStatus: 'failed',
      errorCode: 'queue_failed',
      errorMessage: failedReason,
      retryable: state === 'failed',
      solvable: false,
    };
  }
}

export async function closeMessageQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}

import { Queue } from 'bullmq';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';

export const CHAT_QUEUE_NAME = 'chat';
export const CHAT_PUSH_FANOUT_JOB = 'chat_push_fanout';

export type ChatPushFanoutJob = {
  roomId: string;
  messageId: string;
  senderId: string;
  recipientUserIds: string[];
  preview: string;
  roomName: string;
  keyVersion: number;
};

let queue: Queue | null = null;

export function isChatQueueEnabled(): boolean {
  return !!getRedisConnectionConfig();
}

export function getChatQueue(): Queue | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;
  if (!queue) queue = new Queue(CHAT_QUEUE_NAME, { connection });
  return queue;
}

export async function enqueueChatPushFanout(data: ChatPushFanoutJob) {
  const q = getChatQueue();
  if (!q) {
    logger.debug('Chat queue disabled — push fanout skipped', { messageId: data.messageId });
    return null;
  }
  return q.add(CHAT_PUSH_FANOUT_JOB, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}

export async function closeChatQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

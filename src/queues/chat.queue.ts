import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';

export const CHAT_QUEUE_NAME = 'chat';
export const CHAT_PUSH_FANOUT_JOB = 'chat_push_fanout';
export const CHAT_OFFLINE_DELIVER_JOB = 'chat_offline_deliver';
export const ATTENDANCE_DAILY_REPORT_JOB = 'attendance_daily_report';

export type ChatPushFanoutJob = {
  roomId: string;
  messageId: string;
  senderId: string;
  recipientUserIds: string[];
  preview: string;
  roomName: string;
  keyVersion: number;
};

export type AttendanceDailyReportJob = {
  academicYearId: string;
  branchId: string;
  date: string;
};

let queue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

export function isChatQueueEnabled(): boolean {
  return !!getRedisConnectionConfig();
}

export function getChatQueue(): Queue | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;
  if (!queue) queue = new Queue(CHAT_QUEUE_NAME, { connection });
  return queue;
}

export function getChatQueueEvents(): QueueEvents | null {
  const connection = getRedisConnectionConfig();
  if (!connection) return null;
  if (!queueEvents) queueEvents = new QueueEvents(CHAT_QUEUE_NAME, { connection });
  return queueEvents;
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

export async function enqueueAttendanceDailyReport(data: AttendanceDailyReportJob) {
  const q = getChatQueue();
  if (!q) return null;
  return q.add(ATTENDANCE_DAILY_REPORT_JOB, data, {
    jobId: `attendance-report:${data.branchId}:${data.date}`,
    attempts: 2,
    removeOnComplete: 50,
  });
}

export async function closeChatQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}

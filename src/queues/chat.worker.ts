import { Worker } from 'bullmq';
import env from '../config/env';
import { getRedisConnectionConfig } from '../config/redis-tcp';
import logger from '../lib/logger';
import { sendEncryptedPushToUsers } from '../modules/chat/push/fcm.service';
import {
  ATTENDANCE_DAILY_REPORT_JOB,
  CHAT_OFFLINE_DELIVER_JOB,
  CHAT_PUSH_FANOUT_JOB,
  CHAT_QUEUE_NAME,
  type AttendanceDailyReportJob,
  type ChatPushFanoutJob,
} from './chat.queue';

let worker: Worker | null = null;

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

async function handleAttendanceDailyReport(data: AttendanceDailyReportJob) {
  // v0 placeholder — wired for BullMQ cron / admin trigger in Phase 1
  logger.info('Attendance daily report job received', data);
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
        case CHAT_OFFLINE_DELIVER_JOB:
          logger.debug('Offline deliver job (v0 noop)', { jobId: job.id });
          break;
        case ATTENDANCE_DAILY_REPORT_JOB:
          await handleAttendanceDailyReport(job.data as AttendanceDailyReportJob);
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

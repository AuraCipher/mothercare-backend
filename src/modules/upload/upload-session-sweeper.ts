import logger from '../../lib/logger';
import { uploadSessionService } from './upload-session.service';

/**
 * M2 — in-process expiration sweeper for UploadSessions.
 *
 * Deliberately NOT a BullMQ worker or new container: expiry correctness
 * never depends on this (every operation derives EXPIRED from the clock),
 * so hygiene + R2 abort can live on a lightweight unref'd interval inside
 * the existing backend process. Each run is bounded (one page of the
 * oldest candidates) and idempotent.
 */

let timer: ReturnType<typeof setInterval> | null = null;

function intervalMs(): number {
  const ms = Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS ?? 15 * 60 * 1000);
  return Number.isFinite(ms) ? ms : 15 * 60 * 1000;
}

export function startUploadSessionSweeper(): void {
  if (timer) return;
  const ms = intervalMs();
  if (ms <= 0) {
    logger.info('upload-session:sweeper-disabled');
    return;
  }
  timer = setInterval(async () => {
    try {
      await uploadSessionService.cleanupExpiredSessions();
    } catch (err: any) {
      logger.error('upload-session:sweeper-failed', {
        error: err?.message || String(err),
      });
    }
  }, ms);
  // Never hold the process open for hygiene work.
  (timer as any).unref?.();
  logger.info('upload-session:sweeper-started', { intervalMs: ms });
}

export function stopUploadSessionSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

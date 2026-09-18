import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MediaProcessingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import logger from '../../lib/logger';
import env from '../../config/env';
import { pLimit } from '../../lib/p-limit';
import {
  getDefaultDocumentsBucket,
  isR2Enabled,
  storage,
} from '../upload/storage';
import { createR2Client } from '../upload/storage/r2.storage';
import { UPLOAD_ROOT } from '../upload/storage/local.storage';
import {
  MAX_FILE_SIZE,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VOICE_DURATION_SECONDS,
} from '../upload/upload.service';
import { processUploadBuffer } from '../upload/media.pipeline';
import {
  probeDurationSeconds,
  probeHasStream,
  probeMedia,
  probeVideoDimensions,
  type ProbeRunner,
} from './media-probe';

/**
 * M5 — post-upload media processing (off the request path).
 *
 * Pipeline per FileRecord:
 *   PENDING --claim--> PROCESSING --> READY | REJECTED | FAILED
 *   - images: Sharp re-encode per legacy policy (chat 2048/webp, profile 300)
 *     into a deterministic derived key, FileRecord updated in place.
 *   - video/voice: ffprobe duration/stream validation (10 min caps).
 *   - documents/other: size re-verification only (fast path).
 *
 * Invariants:
 * - uploaded ≠ ready: attach/download gates require READY for media.
 * - Idempotent: same file + same PROCESSING_VERSION converges (deterministic
 *   derived keys, single-winner claim, converged replays).
 * - Bounded: worker concurrency (BullMQ) × pLimit(2) here × Sharp pLimit(3);
 *   images ≤20 MB in heap; R2 probes stream via presigned URL (no 1 GB
 *   downloads); temp files always cleaned.
 */

export const PROCESSING_VERSION = 1;
/** Derived display object key — deterministic for idempotent retries. */
export function derivedMediaKey(fileId: string, ext: string): string {
  return `media/${fileId}/processed-v${PROCESSING_VERSION}.${ext}`;
}

/** Media kinds the worker must handle (everything else is READY at finalize). */
export function needsMediaProcessing(purpose?: string | null, mimeType?: string | null): boolean {
  if (purpose === 'video' || purpose === 'voice_note') return true;
  if (mimeType?.startsWith('image/')) return true;
  return false;
}

/** Chat attach gate (§17): these must be READY before they become messages. */
export function requiresReadyForAttach(purpose?: string | null, mimeType?: string | null): boolean {
  return needsMediaProcessing(purpose, mimeType);
}

// Duration tolerance: container rounding can overshoot by milliseconds.
// Explicit, tiny, documented — never rounds an over-limit file down.
const DURATION_EPSILON_SECONDS = 0.5;

function sharpTimeoutMs(): number {
  const ms = Number(process.env.MEDIA_SHARP_TIMEOUT_MS ?? env.MEDIA_SHARP_TIMEOUT_MS ?? 120000);
  return Number.isFinite(ms) && ms > 0 ? ms : 120000;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface ProcessMediaResult {
  fileRecordId: string;
  status: MediaProcessingStatus;
  reused: boolean;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface ProcessMediaDeps {
  probeRunner?: ProbeRunner;
  /** Test seam: observe slot enter/exit for concurrency assertions. */
  onSlot?: (active: number) => void;
}

// Module slot limiter: even with several BullMQ workers in one process,
// CPU-heavy steps never exceed this (Sharp has its own pLimit(3) too).
let mediaSlotLimit = pLimit(2);
let slotActive = 0;

export async function withMediaSlot<T>(fn: () => Promise<T>, onSlot?: (active: number) => void): Promise<T> {
  return mediaSlotLimit(async () => {
    slotActive += 1;
    try {
      onSlot?.(slotActive);
      return await fn();
    } finally {
      slotActive -= 1;
    }
  });
}

// Exported for security tests (injection/traversal vectors).
export function assertSafeStorageKey(key: string): void {
  if (!key || key.includes('..') || path.isAbsolute(key)) {
    throw new Error('Invalid storage key');
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mcs-media-'));
  try {
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** Resolve a probed/downloadable input: local path or short-lived presigned R2 URL. */
async function resolveProbeTarget(
  storageKey: string,
  bucket: string,
): Promise<{ target: string; cleanup: () => Promise<void> }> {
  assertSafeStorageKey(storageKey);
  if (!isR2Enabled()) {
    const full = path.join(UPLOAD_ROOT, storageKey);
    if (!full.startsWith(UPLOAD_ROOT)) throw new Error('Invalid storage key');
    return { target: full, cleanup: async () => {} };
  }
  const client: S3Client = createR2Client();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    { expiresIn: 900 },
  );
  try {
    (client as any).destroy?.();
  } catch {}
  return { target: url, cleanup: async () => {} };
}

async function downloadToTemp(
  storageKey: string,
  bucket: string,
  dir: string,
  maxBytes: number,
): Promise<{ filePath: string; size: number }> {
  const dest = path.join(dir, `source-${crypto.randomBytes(8).toString('hex')}`);
  const buffer = await storage.get(storageKey, { bucket });
  if (buffer.length > maxBytes) {
    throw { status: 422, message: 'File exceeds the allowed size', retryable: false };
  }
  await fs.promises.writeFile(dest, buffer);
  return { filePath: dest, size: buffer.length };
}

export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

const permanent = (message: string, userMessage?: string) =>
  new MediaProcessingError(message, false, userMessage ?? message);
const retryableError = (message: string) => new MediaProcessingError(message, true, message);

/**
 * Process one FileRecord to READY. Safe to call repeatedly (worker retries,
 * reconciler, inline fallback): same version converges without duplicates.
 */
export async function processMediaFile(
  fileRecordId: string,
  deps: ProcessMediaDeps = {},
): Promise<ProcessMediaResult> {
  const record = await prisma.fileRecord.findUnique({ where: { id: fileRecordId } });
  if (!record) throw permanent('FileRecord not found', 'File not found');
  // Validate the server-minted key BEFORE claiming: traversal/injection in
  // stored state is a permanent defect, never a retryable one.
  try {
    assertSafeStorageKey(record.storagePath);
  } catch {
    throw permanent('Invalid storage key', 'File cannot be processed');
  }
  if (record.processingStatus === 'READY' && record.processingVersion >= PROCESSING_VERSION) {
    return { fileRecordId, status: 'READY', reused: true };
  }
  if (record.processingStatus === 'REJECTED') {
    return { fileRecordId, status: 'REJECTED', reused: true };
  }

  // Single-winner claim (PENDING or re-drivable FAILED).
  const claimed = await prisma.fileRecord.updateMany({
    where: { id: fileRecordId, processingStatus: { in: ['PENDING', 'FAILED'] } },
    data: { processingStatus: 'PROCESSING', processingError: null },
  }).catch(() => ({ count: 0 }));
  if ((claimed as { count: number }).count === 0) {
    const fresh = await prisma.fileRecord.findUnique({ where: { id: fileRecordId } });
    if (fresh?.processingStatus === 'READY') {
      return { fileRecordId, status: 'READY', reused: true };
    }
    if (fresh?.processingStatus === 'REJECTED') {
      return { fileRecordId, status: 'REJECTED', reused: true };
    }
    throw retryableError('Processing already in progress elsewhere');
  }

  const startedAt = Date.now();
  const logBase = { fileRecordId, purpose: record.purpose, mimeType: record.mimeType };
  try {
    const result = await withMediaSlot(() => processClaimed(record as any, deps), deps.onSlot);
    await prisma.fileRecord.update({
      where: { id: fileRecordId },
      data: {
        processingStatus: 'READY',
        processingError: null,
        processingVersion: PROCESSING_VERSION,
        processedAt: new Date(),
        ...(result.patch ?? {}),
      },
    });
    logger.info('media:ready', {
      ...logBase,
      durationMs: Date.now() - startedAt,
      ...(result.durationSeconds != null ? { durationSeconds: result.durationSeconds } : {}),
      ...(result.width != null ? { width: result.width, height: result.height } : {}),
    });
    return {
      fileRecordId,
      status: 'READY',
      reused: false,
      ...(result.durationSeconds != null ? { durationSeconds: result.durationSeconds } : {}),
      ...(result.width != null ? { width: result.width, height: result.height } : {}),
    };
  } catch (err: any) {
    const isStructuredRetryable = err?.retryable === true;
    const isPermanent =
      err instanceof MediaProcessingError ? !err.retryable : err?.status === 422 || err?.status === 400 || err?.status === 413;
    if (isPermanent && !isStructuredRetryable) {
      const userMessage =
        err instanceof MediaProcessingError ? err.userMessage : err?.message || 'Media validation failed';
      // REJECTED: policy violation — remove bytes (keep row for audit), block attach/download.
      try {
        await storage.delete(record.storagePath, { bucket: record.storageBucket });
      } catch (delErr: any) {
        logger.warn('media:reject-cleanup-failed', { ...logBase, error: delErr?.message });
      }
      await prisma.fileRecord.update({
        where: { id: fileRecordId },
        data: { processingStatus: 'REJECTED', processingError: String(userMessage).slice(0, 500), processedAt: new Date() },
      });
      logger.warn('media:rejected', { ...logBase, reason: userMessage, durationMs: Date.now() - startedAt });
      const terminal: any = new Error(userMessage);
      terminal.status = err?.status ?? 422;
      terminal.retryable = false;
      throw terminal;
    }
    // FAILED: infrastructure — object kept, re-drivable by retry/reconciler.
    await prisma.fileRecord.update({
      where: { id: fileRecordId },
      data: {
        processingStatus: 'FAILED',
        processingError: String(err?.message || 'processing failed').slice(0, 500),
      },
    }).catch(() => {});
    logger.error('media:failed', {
      ...logBase,
      error: err?.message || String(err),
      providerCode: err?.providerCode,
      durationMs: Date.now() - startedAt,
    });
    const retryable: any = new Error(err?.message || 'Media processing failed — retry later');
    retryable.retryable = true;
    throw retryable;
  }
}

async function processClaimed(
  record: {
    id: string;
    originalName: string;
    storagePath: string;
    storageBucket: string;
    purpose: string | null;
    mimeType: string;
    size: number;
    metadata: unknown;
  },
  deps: ProcessMediaDeps,
): Promise<{ patch?: Record<string, unknown>; summary?: Partial<ProcessMediaResult>; durationSeconds?: number; width?: number; height?: number }> {
  const bucket = record.storageBucket || getDefaultDocumentsBucket();
  const purpose = record.purpose ?? 'document';

  if (record.mimeType.startsWith('image/')) {
    return processImageRecord(record, bucket);
  }
  if (purpose === 'video' || purpose === 'voice_note') {
    return processAudioVideoRecord(record, bucket, deps);
  }
  // Documents/other: authoritative size re-verification (fast path, no worker weight).
  const stat = await statObjectSafe(record.storagePath, bucket);
  if (stat == null) throw retryableError('Stored object missing');
  if (stat.size !== record.size) {
    throw permanent(
      `Size mismatch (record ${record.size}, object ${stat.size})`,
      'File failed integrity verification',
    );
  }
  return {};
}

async function statObjectSafe(
  storageKey: string,
  bucket: string,
): Promise<{ size: number } | null> {
  if (isR2Enabled()) {
    const { R2MultipartStorage } = await import('../upload/storage/multipart-storage');
    const { createR2Client } = await import('../upload/storage/r2.storage');
    const helper = new R2MultipartStorage(createR2Client(), bucket);
    return helper.statObject(storageKey).catch(() => null);
  }
  try {
    const st = await fs.promises.stat(path.join(UPLOAD_ROOT, storageKey));
    return { size: st.size };
  } catch {
    return null;
  }
}

async function processImageRecord(
  record: { id: string; originalName: string; storagePath: string; storageBucket: string; purpose: string | null; mimeType: string; size: number; metadata: unknown },
  bucket: string,
): Promise<{ patch: Record<string, unknown>; width?: number; height?: number }> {
  const maxBytes = MAX_FILE_SIZE;
  if (record.size > maxBytes) {
    throw permanent(`Image exceeds 20 MB`, 'Image is too large (max 20MB)');
  }
  return withTempDir(async (dir) => {
    const { filePath, size } = await downloadToTemp(record.storagePath, bucket, dir, maxBytes);
    if (size !== record.size) {
      throw permanent(
        `Size mismatch (record ${record.size}, object ${size})`,
        'File failed integrity verification',
      );
    }
    const buffer = await fs.promises.readFile(filePath);
    let processed;
    try {
      // Mirror the legacy policy exactly: profile→300 cover, chat→2048
      // inside, everything else keeps dimensions (all → webp q80).
      const sharpPurpose =
        record.purpose === 'profile' ? 'profile' : record.purpose === 'chat' ? 'chat' : 'document';
      processed = await withTimeout(
        processUploadBuffer({
          buffer,
          originalName: record.originalName,
          purpose: sharpPurpose,
          maxBytes,
        }),
        sharpTimeoutMs(),
        'Sharp processing',
      );
    } catch (err: any) {
      if (err?.status === 413 || err?.status === 400) {
        throw permanent(err.message, err.message);
      }
      if (/timed out/i.test(err?.message || '')) {
        throw retryableError(`Sharp processing timed out`);
      }
      // Deterministic decode failure (same bytes always fail): corrupt or
      // hostile image — never heals on retry.
      throw permanent(`Image could not be decoded: ${err?.message || err}`, 'Unsupported or corrupt image');
    }
    const derivedKey = derivedMediaKey(record.id, processed.ext);
    await storage.save(derivedKey, processed.buffer, {
      bucket,
      contentType: processed.mimeType,
    });
    // Verify the derived object before switching the record to it.
    const verify = await statObjectSafe(derivedKey, bucket);
    if (!verify || verify.size !== processed.buffer.length) {
      await storage.delete(derivedKey, { bucket }).catch(() => {});
      throw retryableError('Derived image verification failed');
    }
    const originalKey = record.storagePath;
    if (originalKey !== derivedKey) {
      await storage.delete(originalKey, { bucket }).catch((delErr: any) => {
        logger.warn('media:original-cleanup-failed', { fileRecordId: record.id, error: delErr?.message });
      });
    }
    return {
      patch: {
        storagePath: derivedKey,
        mimeType: processed.mimeType,
        size: processed.buffer.length,
        width: processed.width,
        height: processed.height,
        metadata: {
          ...((record.metadata as Record<string, unknown> | null) ?? {}),
          originalStoragePath: originalKey,
          processedVersion: PROCESSING_VERSION,
        },
      },
      width: processed.width ?? undefined,
      height: processed.height ?? undefined,
    };
  });
}

async function processAudioVideoRecord(
  record: { id: string; originalName: string; storagePath: string; storageBucket: string; purpose: string | null; mimeType: string; size: number; metadata: unknown },
  bucket: string,
  deps: ProcessMediaDeps,
): Promise<{ patch: Record<string, unknown>; durationSeconds?: number; width?: number; height?: number }> {
  const isVideo = record.purpose === 'video';
  // Shared 1 GiB infrastructure object ceiling for both (§14/§15).
  const cap = MAX_VIDEO_BYTES;
  const maxDuration = isVideo ? MAX_VIDEO_DURATION_SECONDS : MAX_VOICE_DURATION_SECONDS;

  const stat = await statObjectSafe(record.storagePath, bucket);
  if (stat == null) throw retryableError('Stored object missing');
  if (stat.size !== record.size) {
    throw permanent(
      `Size mismatch (record ${record.size}, object ${stat.size})`,
      'File failed integrity verification',
    );
  }
  if (stat.size > cap) {
    throw permanent(`File exceeds the allowed size`, 'File is too large');
  }

  const { target } = await resolveProbeTarget(record.storagePath, bucket);
  let probe;
  try {
    probe = await probeMedia(target, { runner: deps.probeRunner });
  } catch (err: any) {
    if (err?.retryable || err?.status === 502) throw retryableError(err.message);
    throw permanent(err?.message || 'Media file could not be inspected', 'Unsupported or corrupt media file');
  }

  const kind = isVideo ? 'video' : 'audio';
  if (!probeHasStream(probe, kind)) {
    // Voice containers (m4a) sometimes report only a video track wrapper —
    // accept any audio-bearing result, but a streamless file is corrupt.
    if (probe.streams.length === 0) {
      throw permanent('No decodable media streams', 'Unsupported or corrupt media file');
    }
    if (isVideo && !probeHasStream(probe, 'video') && !probeHasStream(probe, 'audio')) {
      throw permanent('No decodable media streams', 'Unsupported or corrupt media file');
    }
  }
  const duration = probeDurationSeconds(probe);
  if (duration == null) {
    throw permanent('Media duration is missing', 'Unsupported or corrupt media file');
  }
  if (duration - maxDuration > DURATION_EPSILON_SECONDS) {
    const label = isVideo ? 'Video' : 'Voice note';
    throw permanent(
      `${label} duration ${duration.toFixed(1)}s exceeds ${maxDuration / 60} minutes`,
      `${label} must be ${maxDuration / 60} minutes or shorter`,
    );
  }
  const dims = isVideo ? probeVideoDimensions(probe) : undefined;
  const stream = probe.streams.find((s) => s.kind === kind) ?? probe.streams[0];
  return {
    patch: {
      metadata: {
        ...((record.metadata as Record<string, unknown> | null) ?? {}),
        probedDurationSeconds: duration,
        ...(dims ? { probedWidth: dims.width, probedHeight: dims.height } : {}),
        ...(stream?.codec ? { probedCodec: stream.codec } : {}),
        ...(probe.container ? { probedContainer: probe.container } : {}),
        processedVersion: PROCESSING_VERSION,
      },
    },
    durationSeconds: duration,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
  };
}

/** Re-drive helper for the reconciler: only PENDING/FAILED rows, oldest first. */
export async function reconcilePendingMedia(
  limit = 20,
  trigger: (fileRecordId: string) => Promise<unknown> = (id) => enqueueMediaJobOrProcessInline(id),
): Promise<{ queued: number; failed: number }> {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const rows = await prisma.fileRecord.findMany({
    where: {
      processingStatus: { in: ['PENDING', 'FAILED'] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });
  let queued = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await trigger(row.id);
      queued += 1;
    } catch {
      failed += 1;
    }
  }
  if (rows.length > 0) {
    logger.info('media:reconcile-sweep', { scanned: rows.length, queued, failed });
  }
  return { queued, failed };
}

// Lazy to avoid a hard import cycle with the queue module (queue imports config only).
async function enqueueMediaJobOrProcessInline(fileRecordId: string): Promise<'queued' | 'inline'> {
  const { getMediaQueue } = await import('../../queues/media.queue');
  const queue = getMediaQueue();
  if (queue) {
    const { buildMediaJobData } = await import('../../queues/media.queue');
    await queue.add('media_process', buildMediaJobData(fileRecordId), {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return 'queued';
  }
  await processMediaFile(fileRecordId);
  return 'inline';
}

/** Entry point used by completion paths after a record becomes PENDING. */
export async function triggerMediaProcessing(fileRecordId: string): Promise<void> {
  try {
    await enqueueMediaJobOrProcessInline(fileRecordId);
  } catch (err: any) {
    // Never fail the upload response: the row stays PENDING and the
    // reconciler picks it up on the next sweep.
    logger.error('media:trigger-failed', {
      fileRecordId,
      error: err?.message || String(err),
    });
  }
}

/**
 * Completion-path entry: decides PENDING vs READY and triggers processing.
 * - alreadyProcessed (legacy in-request Sharp images): mark READY explicitly.
 * - documents/other: READY by schema default; nothing to do.
 * - video/voice/M2 images: PENDING + trigger (queue or inline fallback).
 * Never throws (best-effort; reconciler covers misses).
 */
export async function requestMediaProcessing(
  fileRecordId: string,
  opts: { alreadyProcessed?: boolean } = {},
): Promise<void> {
  try {
    if (await markPendingForProcessing(fileRecordId, opts)) {
      await triggerMediaProcessing(fileRecordId);
    }
  } catch (err: any) {
    logger.error('media:request-failed', {
      fileRecordId,
      error: err?.message || String(err),
    });
  }
}

/**
 * Synchronously (awaited) marks a media row PENDING. Returns whether the
 * caller must trigger processing. Never throws — false on any doubt (the
 * row stays READY-default, preserving legacy behavior).
 */
export async function markPendingForProcessing(
  fileRecordId: string,
  opts: { alreadyProcessed?: boolean } = {},
): Promise<boolean> {
  try {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileRecordId } });
    if (!record) return false;
    if (!needsMediaProcessing(record.purpose, record.mimeType)) return false;
    if (opts.alreadyProcessed) {
      await prisma.fileRecord.update({
        where: { id: fileRecordId },
        data: {
          processingStatus: 'READY',
          processingError: null,
          processingVersion: PROCESSING_VERSION,
          processedAt: new Date(),
        },
      });
      return false;
    }
    await prisma.fileRecord.update({
      where: { id: fileRecordId },
      data: { processingStatus: 'PENDING', processingError: null },
    });
    return true;
  } catch (err: any) {
    logger.error('media:mark-pending-failed', {
      fileRecordId,
      error: err?.message || String(err),
    });
    return false;
  }
}

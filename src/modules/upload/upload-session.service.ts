import type { UploadSession, UploadSessionStatus } from '@prisma/client';
import { basePrisma, prisma } from '../../lib/prisma';
import logger from '../../lib/logger';
import { getMaxBytesForPurpose, MAX_VIDEO_DURATION_SECONDS } from './upload.service';
import {
  buildStoragePath,
  UPLOAD_ENTITY_TYPES,
  UPLOAD_PURPOSES,
  type UploadPurpose,
} from './storage-paths';
import { buildFileServeUrl } from './file-url.util';
import { getDefaultDocumentsBucket } from './storage';
import {
  classifyProviderError,
  resolveMultipartStorage,
  type MultipartStorage,
} from './storage/multipart-storage';
import { teacherAppChatAllowsAttachments } from '../chat/services/teacher-app-chat-permissions.service';

/**
 * M1 — UploadSession lifecycle service (control plane only).
 *
 * An UploadSession is the durable identity of one logical file upload.
 * It carries the authoritative offset (bytesUploaded), the idempotency
 * key, and the terminal-state guarantees that let a client safely retry
 * after a lost response WITHOUT creating duplicate storage or FileRecords.
 *
 * Explicitly OUT of scope for M1 (see M2 findings in the audit):
 * byte transfer (no chunk endpoint here), R2 multipart resume
 * (providerUploadId/providerState are stored but never written yet),
 * duration probing, and background cleanup (expireSession is the
 * contract the future sweeper will call).
 */

// ─── Expiration ─────────────────────────────────────────────
// 24h covers a 1 GB video on a poor mobile network plus app
// backgrounding gaps, while bounding storage-reservation abuse.
// A shorter TTL would make mobile resume unreliable; a longer one
// would hoard reserved keys. Overridable for tests/ops.
function sessionTtlMs(): number {
  const hours = Number(process.env.UPLOAD_SESSION_TTL_HOURS ?? 24);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

// ─── Validation bounds ──────────────────────────────────────
const MAX_FILENAME_LENGTH = 255;
const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_MIME_LENGTH = 127;
const MAX_ENTITY_ID_LENGTH = 128;
const MAX_METADATA_JSON_LENGTH = 4096;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIME_PATTERN = /^[-\w.+]*\/[-\w.+]+$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;

// ─── State machine ──────────────────────────────────────────
// Terminal: COMPLETED, FAILED, CANCELLED, EXPIRED (no exits).
// Transient failures do NOT get their own state: a failed chunk keeps
// UPLOADING and bumps retryCount (M2). FAILED is permanent (validation).
// COMPLETING admits only COMPLETED/FAILED — cancel/expire during the
// single-winner finalize window is rejected with 409 so a FileRecord
// can never be orphaned by a racing cancel.
const ACTIVE_STATUSES: UploadSessionStatus[] = ['INITIATED', 'UPLOADING', 'COMPLETING'];

const VALID_TRANSITIONS: Record<UploadSessionStatus, UploadSessionStatus[]> = {
  INITIATED: ['UPLOADING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  UPLOADING: ['UPLOADING', 'COMPLETING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  COMPLETING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function isTerminalStatus(status: UploadSessionStatus): boolean {
  return (VALID_TRANSITIONS[status] ?? []).length === 0;
}

export function assertValidTransition(from: UploadSessionStatus, to: UploadSessionStatus): void {
  if (!(VALID_TRANSITIONS[from] ?? []).includes(to)) {
    throw {
      status: 409,
      message: `Invalid upload session transition from ${from} to ${to}`,
    };
  }
}

// ─── Expiry (deterministic, no worker required) ─────────────
// A session is effectively expired when its clock passed while still
// active. Reads derive this; mutating ops reject with 410; the future
// sweeper persists EXPIRED via expireSession().
export function isSessionExpired(session: Pick<UploadSession, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return ACTIVE_STATUSES.includes(session.status) && session.expiresAt <= now;
}

export function effectiveStatus(session: UploadSession, now = new Date()): UploadSessionStatus {
  return isSessionExpired(session, now) ? 'EXPIRED' : session.status;
}

function ensureActive(session: UploadSession): void {
  if (isSessionExpired(session)) {
    throw { status: 410, message: 'Upload session expired' };
  }
  if (!ACTIVE_STATUSES.includes(session.status)) {
    throw { status: 409, message: `Upload session is already ${session.status}` };
  }
}

// ─── Input types ────────────────────────────────────────────
export interface CreateUploadSessionInput {
  purpose?: string;
  originalFilename?: string;
  mimeType?: string;
  expectedSize?: number;
  idempotencyKey?: string;
  checksum?: string;
  entityType?: string;
  entityId?: string;
  roomId?: string;
  academicYearId?: string;
  metadata?: unknown;
}

export interface SerializedUploadSession {
  id: string;
  status: UploadSessionStatus;
  purpose: string;
  originalFilename: string;
  mimeType: string;
  expectedSize: number;
  bytesUploaded: number;
  expiresAt: Date;
  fileRecordId: string | null;
  fileUrl: string | null;
  metadata: unknown;
  retryCount: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Serialization (never leaks provider internals) ─────────
// providerUploadId, providerState, storageKey, and checksum are
// control-plane secrets-in-waiting: the future client needs none of
// them (it learns id, status, sizes, expiry, and the FileRecord link).
export function serializeUploadSession(session: UploadSession, now = new Date()): SerializedUploadSession {
  return {
    id: session.id,
    status: effectiveStatus(session, now),
    purpose: session.purpose,
    originalFilename: session.originalFilename,
    mimeType: session.mimeType,
    expectedSize: session.expectedSize,
    bytesUploaded: session.bytesUploaded,
    expiresAt: session.expiresAt,
    fileRecordId: session.fileRecordId,
    fileUrl: session.fileRecordId ? buildFileServeUrl(session.fileRecordId) : null,
    metadata: session.metadata ?? null,
    retryCount: session.retryCount,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

// ─── Validation ─────────────────────────────────────────────
function sanitizeFilename(raw: string): string {
  // Strip directory components (no path traversal into display names),
  // trim, and keep the readable name — the storage key is a server UUID.
  const base = String(raw).split(/[\\/]/).pop() ?? '';
  return base.trim();
}

function validateCreateInput(input: CreateUploadSessionInput): {
  purpose: UploadPurpose;
  originalFilename: string;
  mimeType: string;
  expectedSize: number;
  idempotencyKey: string;
  checksum?: string;
  entityType?: string;
  entityId?: string;
  roomId?: string;
  academicYearId?: string;
  metadata?: Record<string, unknown>;
} {
  const fail = (message: string): never => {
    throw { status: 400, message };
  };

  if (!input.purpose || !UPLOAD_PURPOSES.includes(input.purpose as UploadPurpose)) {
    fail(`purpose must be one of: ${UPLOAD_PURPOSES.join(', ')}`);
  }
  const purpose = input.purpose as UploadPurpose;

  const originalFilename = sanitizeFilename(input.originalFilename ?? '');
  if (!originalFilename) fail('originalFilename is required');
  if (originalFilename.length > MAX_FILENAME_LENGTH) {
    fail(`originalFilename must be at most ${MAX_FILENAME_LENGTH} characters`);
  }
  if (CONTROL_CHARS_PATTERN.test(originalFilename)) fail('originalFilename contains invalid characters');

  const mimeType = (input.mimeType ?? '').trim();
  if (!mimeType) fail('mimeType is required');
  if (mimeType.length > MAX_MIME_LENGTH) fail('mimeType is too long');
  if (!MIME_PATTERN.test(mimeType)) fail('mimeType must look like type/subtype');

  const maxBytes = getMaxBytesForPurpose(purpose);
  const expectedSize = input.expectedSize;
  if (!Number.isInteger(expectedSize) || (expectedSize as number) < 1) {
    fail('expectedSize must be a positive integer number of bytes');
  }
  if ((expectedSize as number) > maxBytes) {
    fail(`File too large (max ${maxBytes / 1024 / 1024}MB)`);
  }

  const idempotencyKey = (input.idempotencyKey ?? '').trim();
  if (!idempotencyKey) fail('idempotencyKey is required');
  if (
    idempotencyKey.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    fail('idempotencyKey must be 8-64 URL-safe characters (uuid recommended)');
  }

  let checksum: string | undefined;
  if (input.checksum != null && input.checksum !== '') {
    if (!SHA256_PATTERN.test(String(input.checksum))) fail('checksum must be a sha256 hex string');
    checksum = String(input.checksum).toLowerCase();
  }

  let entityType: string | undefined;
  let entityId: string | undefined;
  if (input.entityType != null && input.entityType !== '') {
    if (!(UPLOAD_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
      fail(`entityType must be one of: ${UPLOAD_ENTITY_TYPES.join(', ')}`);
    }
    entityType = input.entityType;
  }
  if (input.entityId != null && input.entityId !== '') {
    if (!entityType) fail('entityType is required when entityId is provided');
    const trimmed = String(input.entityId).trim();
    if (!trimmed || trimmed.length > MAX_ENTITY_ID_LENGTH) fail('entityId is invalid');
    entityId = trimmed;
  }

  let roomId: string | undefined;
  let academicYearId: string | undefined;
  if (input.roomId != null && input.roomId !== '') {
    const trimmed = String(input.roomId).trim();
    if (!trimmed || trimmed.length > MAX_ENTITY_ID_LENGTH) fail('roomId is invalid');
    roomId = trimmed;
  }
  if (input.academicYearId != null && input.academicYearId !== '') {
    const trimmed = String(input.academicYearId).trim();
    if (!trimmed || trimmed.length > MAX_ENTITY_ID_LENGTH) fail('academicYearId is invalid');
    academicYearId = trimmed;
  }

  let metadata: Record<string, unknown> | undefined;
  if (input.metadata != null) {
    if (typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      fail('metadata must be a JSON object');
    }
    const json = JSON.stringify(input.metadata);
    if (json.length > MAX_METADATA_JSON_LENGTH) fail('metadata is too large');
    metadata = input.metadata as Record<string, unknown>;
  }

  // Mirror the single-shot contract: chat videos declare a duration.
  // This is still client-asserted in M1; authoritative probing is M2.
  if (purpose === 'video') {
    const duration = (metadata as Record<string, unknown> | undefined)?.durationSeconds;
    const parsed = typeof duration === 'string' ? Number(duration) : (duration as number);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      fail('Video duration is required');
    }
    if (parsed > MAX_VIDEO_DURATION_SECONDS) fail('Videos must be 10 minutes or shorter');
  }

  return {
    purpose,
    originalFilename,
    mimeType,
    expectedSize: expectedSize as number,
    idempotencyKey,
    checksum,
    entityType,
    entityId,
    roomId,
    academicYearId,
    metadata,
  };
}

function storageExtFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  return ext && ext.length <= 10 ? ext : 'bin';
}

// ─── Service ────────────────────────────────────────────────
export class UploadSessionService {
  /**
   * Create a session (idempotent on [userId, idempotencyKey]).
   * A retry with the same key returns the EXISTING session with its
   * authoritative bytesUploaded — never a second row. Concurrency is
   * safe via the DB unique constraint + P2002 re-read (no check-then-insert race).
   */
  async createSession(userId: string | undefined, input: CreateUploadSessionInput) {
    if (!userId) throw { status: 401, message: 'Authentication required' };
    const v = validateCreateInput(input);

    // Server-side room validation (never trust client membership claims).
    if (v.roomId) {
      const room = await prisma.chatRoom.findUnique({
        where: { id: v.roomId },
        select: { id: true, branchId: true, academicYearId: true },
      });
      if (!room) throw { status: 404, message: 'Chat room not found' };
      if (v.academicYearId && v.academicYearId !== room.academicYearId) {
        throw { status: 400, message: 'academicYearId does not match the room' };
      }
      const member = await prisma.chatRoomMember.findFirst({
        where: { roomId: v.roomId, userId, leftAt: null, canRead: true },
      });
      if (!member) throw { status: 403, message: 'Not a member of this chat room' };
      if (room.branchId) {
        const attachmentsOk = await teacherAppChatAllowsAttachments(userId, room.branchId);
        if (!attachmentsOk) {
          throw { status: 403, message: 'Sending chat attachments is not allowed for your account' };
        }
      }
    }

    const storageKey = buildStoragePath({
      purpose: v.purpose,
      ext: storageExtFor(v.originalFilename),
      entityType: v.entityType,
      entityId: v.entityId,
      roomId: v.roomId,
      academicYearId: v.academicYearId,
    });
    const expiresAt = new Date(Date.now() + sessionTtlMs());

    try {
      const session = await prisma.uploadSession.create({
        data: {
          userId,
          idempotencyKey: v.idempotencyKey,
          status: 'INITIATED',
          purpose: v.purpose,
          originalFilename: v.originalFilename,
          mimeType: v.mimeType,
          expectedSize: v.expectedSize,
          bytesUploaded: 0,
          storageKey,
          checksum: v.checksum,
          entityType: v.entityType,
          entityId: v.entityId,
          roomId: v.roomId,
          academicYearId: v.academicYearId,
          metadata: (v.metadata ?? undefined) as object | undefined,
          expiresAt,
        },
      });
      logger.info('upload-session:created', {
        uploadSessionId: session.id,
        userId,
        purpose: v.purpose,
        expectedSize: v.expectedSize,
        expiresAt: expiresAt.toISOString(),
      });
      return { session: serializeUploadSession(session), created: true };
    } catch (err: any) {
      // Idempotent replay (including concurrent double-create): the unique
      // [userId, idempotencyKey] constraint fired — return the winner.
      if (err?.code === 'P2002') {
        const target = Array.isArray(err?.meta?.target) ? err.meta.target.join(',') : '';
        if (target.includes('idempotencyKey')) {
          const existing = await prisma.uploadSession.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: v.idempotencyKey } },
          });
          if (existing) {
            logger.info('upload-session:reused', { uploadSessionId: existing.id, userId });
            return { session: serializeUploadSession(existing), created: false };
          }
        }
        logger.error('upload-session:create-conflict', { userId, target });
      }
      throw err;
    }
  }

  /** Owner-scoped read. Other users' sessions are indistinguishable from missing (404). */
  async getSession(id: string, userId: string | undefined) {
    if (!userId) throw { status: 401, message: 'Authentication required' };
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw { status: 404, message: 'Upload session not found' };
    }
    return serializeUploadSession(session);
  }

  /**
   * Atomically transition an active session to CANCELLED.
   * Never touches a FileRecord: only active sessions can cancel, and only
   * COMPLETED sessions own one — so there is nothing to delete by construction.
   */
  async cancelSession(id: string, userId: string | undefined) {
    if (!userId) throw { status: 401, message: 'Authentication required' };
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw { status: 404, message: 'Upload session not found' };
    }
    ensureActive(session);
    if (session.status === 'COMPLETING') {
      throw { status: 409, message: 'Upload session finalization in progress' };
    }
    assertValidTransition(session.status, 'CANCELLED');

    const updated = await prisma.uploadSession.updateMany({
      where: { id, status: { in: ACTIVE_STATUSES.filter((s) => s !== 'COMPLETING') } },
      data: { status: 'CANCELLED', lastActivityAt: new Date() },
    });
    if (updated.count === 0) {
      // Lost a race with another transition — report current truth.
      const current = await prisma.uploadSession.findUnique({ where: { id } });
      throw {
        status: 409,
        message: `Upload session is already ${current?.status ?? 'unavailable'}`,
      };
    }
    const cancelled = await prisma.uploadSession.findUnique({ where: { id } });
    logger.info('upload-session:cancelled', { uploadSessionId: id, userId });
    // M2: connect cancellation to storage — abort the provider multipart and
    // drop the part ledger. Best-effort: the CANCELLED transition above is
    // already committed and authoritative; abort failure is logged, never fatal.
    await this.releaseStorage(cancelled!);
    return serializeUploadSession(cancelled!);
  }

  /**
   * Release provider-side transfer state for a dead session (M2): delete the
   * durable part ledger, then abort the provider multipart upload.
   * Idempotent and never throws — the DB state machine is the authority on
   * usability; the R2 bucket lifecycle rule is the backstop for crash windows.
   */
  async releaseStorage(
    session: { id: string; storageKey: string; providerUploadId: string | null },
    storage: MultipartStorage = resolveMultipartStorage(),
  ): Promise<void> {
    // Promise.resolve: this is best-effort hygiene — a missing/broken client
    // shape must never turn cleanup into a crash.
    await Promise.resolve(
      prisma.uploadSessionPart.deleteMany({ where: { sessionId: session.id } }),
    ).catch(() => {});
    if (!session.providerUploadId) return;
    try {
      await storage.abortUpload(session.storageKey, session.providerUploadId);
      logger.info('upload-session:storage-released', { uploadSessionId: session.id });
    } catch (err: any) {
      const classified = classifyProviderError(err);
      logger.error('upload-session:storage-release-failed', {
        uploadSessionId: session.id,
        providerCode: classified.code,
        retryable: classified.retryable,
      });
    }
  }

  /**
   * Bounded expiration sweep (M2): transition active past-expiry sessions to
   * EXPIRED and release their provider state, one independent attempt each.
   * Idempotent — re-running changes nothing. Correctness never depends on
   * this (expiry is derived on every op); it is hygiene + R2 abort.
   */
  async cleanupExpiredSessions(limit = 100): Promise<{ expired: number; failed: number }> {
    const storage = resolveMultipartStorage();
    const candidates = await prisma.uploadSession.findMany({
      where: { status: { in: ['INITIATED', 'UPLOADING'] }, expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(limit, 1000)),
      select: { id: true },
    });
    let expired = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        const done = await this.expireSession(id, storage);
        if (done.status === 'EXPIRED') expired += 1;
      } catch {
        failed += 1;
      }
    }
    if (candidates.length > 0) {
      logger.info('upload-session:cleanup-sweep', { scanned: candidates.length, expired, failed });
    }
    return { expired, failed };
  }

  /**
   * System lifecycle op: persist EXPIRED for a session whose clock passed
   * while active, and release its provider state (M2). Idempotent — terminal
   * sessions are returned untouched (and their storage is still released
   * best-effort, covering crash windows between transition and release).
   */
  async expireSession(id: string, storage?: MultipartStorage) {
    const updated = await prisma.uploadSession.updateMany({
      where: { id, status: { in: ['INITIATED', 'UPLOADING'] } },
      data: { status: 'EXPIRED', lastActivityAt: new Date() },
    });
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session) throw { status: 404, message: 'Upload session not found' };
    if (updated.count > 0) {
      logger.info('upload-session:expired', { uploadSessionId: id, userId: session.userId });
    }
    await this.releaseStorage(session, storage);
    return serializeUploadSession(session);
  }

  /**
   * Convergence for concurrent finalize losers: poll the session until the
   * winner leaves COMPLETING (COMPLETED → return its link; FAILED → 409).
   * Bounded (~2s; finalize is two indexed writes) so a stuck winner can
   * never hang a client forever — M2 owns COMPLETING recovery.
   */
  private async awaitFinalizeOutcome(id: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const current = await prisma.uploadSession.findUnique({ where: { id } });
      if (current?.status === 'COMPLETED') {
        return { session: serializeUploadSession(current), created: false };
      }
      if (!current || current.status !== 'COMPLETING') {
        throw {
          status: 409,
          message: `Upload session is already ${current?.status ?? 'unavailable'}`,
        };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    logger.error('upload-session:finalize-contention-timeout', { uploadSessionId: id });
    throw { status: 409, message: 'Upload session finalization timed out — retry to learn its outcome' };
  }

  /**
   * Finalize: link exactly one FileRecord to this session (M1 contract).
   *
   * Invariants (all enforced):
   * - owner-only; expired sessions rejected (410); terminal sessions rejected (409).
   * - only UPLOADING sessions finalize (INITIATED has no transferred bytes by construction).
   * - bytesUploaded must equal expectedSize (M2 transfer layer writes the offset;
   *   in M1 this can only hold in tests that simulate the transfer — the stub
   *   honesty is deliberate: no R2 bytes exist yet, so production finalize
   *   cannot succeed until M2 requires storage completion first).
   * - single winner via atomic INITIATED-claim (UPLOADING→COMPLETING updateMany);
   *   concurrent finalizes converge: losers re-read and receive the winner's
   *   link instead of creating a second FileRecord.
   * - the FileRecord create + session COMPLETED update run in ONE Prisma
   *   transaction. R2 is NOT part of any DB transaction (documented constraint).
   * - repeated finalize of a COMPLETED session returns the existing link
   *   ({ created: false }) — never a duplicate FileRecord.
   */
  async finalizeSession(id: string, userId: string | undefined) {
    if (!userId) throw { status: 401, message: 'Authentication required' };
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw { status: 404, message: 'Upload session not found' };
    }
    // Idempotent replay after a lost response: already linked, return it.
    if (session.status === 'COMPLETED') {
      return { session: serializeUploadSession(session), created: false };
    }
    ensureActive(session);
    if (session.status !== 'UPLOADING') {
      throw { status: 409, message: 'Upload session has no transferred bytes yet' };
    }
    if (session.bytesUploaded !== session.expectedSize) {
      throw {
        status: 409,
        message: `Upload incomplete (${session.bytesUploaded}/${session.expectedSize} bytes)`,
      };
    }

    // Single-winner claim: exactly one concurrent caller flips UPLOADING→COMPLETING.
    const claimed = await prisma.uploadSession.updateMany({
      where: { id, status: 'UPLOADING' },
      data: { status: 'COMPLETING', lastActivityAt: new Date() },
    });
    if (claimed.count === 0) {
      // Lost the claim race. The winner may still be inside its transaction
      // (status COMPLETING) — wait briefly for its outcome and converge on
      // the winner's link instead of failing the client's retry.
      return this.awaitFinalizeOutcome(id);
    }

    try {
      const result = await basePrisma.$transaction(async (tx) => {
        const bucket = getDefaultDocumentsBucket();
        const record = await tx.fileRecord.create({
          data: {
            originalName: session.originalFilename,
            storagePath: session.storageKey,
            storageBucket: bucket,
            purpose: session.purpose,
            mimeType: session.mimeType,
            size: session.expectedSize,
            uploadedById: session.userId,
            entityType: session.entityType ?? undefined,
            entityId: session.entityId ?? undefined,
            metadata: {
              ...((session.metadata as Record<string, unknown> | null) ?? {}),
              ...(session.roomId ? { roomId: session.roomId } : {}),
              ...(session.academicYearId ? { academicYearId: session.academicYearId } : {}),
              uploadSessionId: session.id,
            },
            publicUrl: undefined,
          },
        });
        await tx.fileRecord.update({
          where: { id: record.id },
          data: { publicUrl: buildFileServeUrl(record.id) },
        });
        const completed = await tx.uploadSession.update({
          where: { id: session.id },
          data: { status: 'COMPLETED', fileRecordId: record.id, lastActivityAt: new Date() },
        });
        return { completed, fileRecordId: record.id };
      });
      logger.info('upload-session:completed', {
        uploadSessionId: id,
        userId,
        fileRecordId: result.fileRecordId,
        expectedSize: session.expectedSize,
      });
      const fresh = await prisma.uploadSession.findUnique({ where: { id } });
      return { session: serializeUploadSession(fresh!), created: true };
    } catch (err) {
      // Do not leave the session falsely in COMPLETING: park it FAILED so the
      // failure is visible and (unlike a silent stuck state) auditable.
      // M2 recovery: a future sweeper may re-drive FAILED→(manual review).
      try {
        await prisma.uploadSession.updateMany({
          where: { id, status: 'COMPLETING' },
          data: { status: 'FAILED', lastActivityAt: new Date() },
        });
      } catch {}
      logger.error('upload-session:finalize-failed', {
        uploadSessionId: id,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

export const uploadSessionService = new UploadSessionService();

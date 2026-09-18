import type { Readable } from 'stream';
import type { UploadSession } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { basePrisma, prisma } from '../../lib/prisma';
import logger from '../../lib/logger';
import { ALLOWED_MIMES, EXT_MAP } from './media.pipeline';
import {
  classifyProviderError,
  resolveMultipartStorage,
  type MultipartPartRef,
  type MultipartStorage,
} from './storage/multipart-storage';
import {
  effectiveStatus,
  isSessionExpired,
  isTerminalStatus,
  serializeUploadSession,
  uploadSessionService,
  type SerializedUploadSession,
} from './upload-session.service';

/**
 * M2 — resumable transfer data plane (MCS-App offset protocol, NOT tus).
 *
 * Protocol:
 *   1. Client creates an UploadSession (M1).
 *   2. Client GETs the session for the authoritative bytesUploaded.
 *   3. Client PATCHes the next bytes with `Upload-Offset: <bytesUploaded>`.
 *   4. Server rejects any offset !== bytesUploaded with 409 (no side effects).
 *   5. Server streams the body into the provider multipart part whose number
 *      derives deterministically from the offset, records the part, and
 *      advances bytesUploaded — all inside one row-locked transaction.
 *   6. Client repeats until bytesUploaded === expectedSize, then POSTs complete.
 *
 * Chunk/part rule: every non-final chunk MUST be exactly TRANSFER_PART_SIZE
 * (5 MiB, the R2/S3 minimum part size); the final chunk is the remainder.
 * partNumber = offset / TRANSFER_PART_SIZE + 1, so retries overwrite the
 * same part instead of duplicating bytes.
 */

// ─── Chunk policy ───────────────────────────────────────────
// 5 MiB: the R2/S3 minimum non-final part size, small enough that a retry
// costs little on mobile networks, large enough that 1 GB needs only ~205
// requests. A whole chunk plus its R2 part upload must fit inside the 60 s
// server.requestTimeout (server.ts) — 5 MiB needs only ~85 KiB/s sustained.
export const TRANSFER_PART_SIZE = 5 * 1024 * 1024;
export const TRANSFER_MAX_CHUNK = TRANSFER_PART_SIZE;
const SNIFF_PREFIX_BYTES = 4100;
// Row-lock wait bound: concurrent PATCHes on one session serialize briefly.
const TRANSFER_LOCK_TIMEOUT_MS = 5000;

export interface ChunkRequest {
  sessionId: string;
  userId: string | undefined;
  /** Raw Upload-Offset header value. */
  offsetHeader: string | undefined;
  /** Raw Content-Length header value (required). */
  contentLengthHeader: string | undefined;
  body: Readable;
}

export interface ChunkResult {
  sessionId: string;
  bytesUploaded: number;
  expectedSize: number;
  partNumber: number;
  complete: boolean;
}

/** Header-only validation (no DB): missing/malformed offset and length. */
export function parseChunkHeaders(
  offsetHeader: string | undefined,
  contentLengthHeader: string | undefined,
): { clientOffset: number; contentLength: number } {
  if (offsetHeader == null || offsetHeader === '') {
    throw { status: 400, message: 'Upload-Offset header is required' };
  }
  const clientOffset = Number(offsetHeader);
  if (!Number.isInteger(clientOffset) || clientOffset < 0) {
    throw { status: 400, message: 'Upload-Offset must be a non-negative integer' };
  }
  if (contentLengthHeader == null || contentLengthHeader === '') {
    throw { status: 411, message: 'Content-Length is required for resumable chunks' };
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isInteger(contentLength) || contentLength < 1) {
    throw { status: 400, message: 'Content-Length must be a positive integer' };
  }
  if (contentLength > TRANSFER_MAX_CHUNK) {
    throw { status: 413, message: `Chunk too large (max ${TRANSFER_MAX_CHUNK / 1024 / 1024}MB)` };
  }
  return { clientOffset, contentLength };
}

function destroyBody(body: Readable): void {
  try {
    (body as any).destroy?.();
  } catch {}
}

export class UploadTransferService {
  constructor(private readonly storage: MultipartStorage = resolveMultipartStorage()) {}

  /**
   * Accept one chunk. Offset-then-size checks run BEFORE any provider call,
   * so a stale probe costs one indexed read and changes nothing.
   */
  async transferChunk(req: ChunkRequest): Promise<ChunkResult> {
    const { clientOffset, contentLength } = parseChunkHeaders(req.offsetHeader, req.contentLengthHeader);
    if (!req.userId) {
      destroyBody(req.body);
      throw { status: 401, message: 'Authentication required' };
    }

    const session = await prisma.uploadSession.findUnique({ where: { id: req.sessionId } });
    if (!session || session.userId !== req.userId) {
      destroyBody(req.body);
      throw { status: 404, message: 'Upload session not found' };
    }
    if (isSessionExpired(session)) {
      destroyBody(req.body);
      throw { status: 410, message: 'Upload session expired' };
    }
    if (isTerminalStatus(session.status) || session.status === 'COMPLETING') {
      destroyBody(req.body);
      throw { status: 409, message: `Upload session is already ${session.status}` };
    }
    if (session.status !== 'INITIATED' && session.status !== 'UPLOADING') {
      destroyBody(req.body);
      throw { status: 409, message: `Upload session is already ${session.status}` };
    }
    // Authoritative offset check FIRST — stale/future offsets never touch R2.
    if (clientOffset !== session.bytesUploaded) {
      destroyBody(req.body);
      throw {
        status: 409,
        message: `Stale offset (server is at ${session.bytesUploaded})`,
        bytesUploaded: session.bytesUploaded,
      };
    }
    if (clientOffset > session.expectedSize) {
      destroyBody(req.body);
      throw { status: 413, message: 'Offset exceeds expected size' };
    }
    const remaining = session.expectedSize - clientOffset;
    if (contentLength > remaining) {
      destroyBody(req.body);
      throw { status: 413, message: `Chunk exceeds remaining bytes (${remaining})` };
    }
    const isFinal = contentLength === remaining;
    if (!isFinal && contentLength !== TRANSFER_PART_SIZE) {
      destroyBody(req.body);
      throw {
        status: 400,
        message: `Non-final chunks must be exactly ${TRANSFER_PART_SIZE / 1024 / 1024}MB`,
      };
    }
    if (clientOffset % TRANSFER_PART_SIZE !== 0) {
      destroyBody(req.body);
      throw { status: 409, message: 'Session offset is not part-aligned' };
    }
    const partNumber = Math.floor(clientOffset / TRANSFER_PART_SIZE) + 1;

    const startedAt = Date.now();
    try {
      const newOffset = await basePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${TRANSFER_LOCK_TIMEOUT_MS}'`);
        // Serialize concurrent PATCHes on this session: exactly one holder
        // proceeds past this line; the other waits (briefly) or times out.
        await tx.$queryRawUnsafe(`SELECT id FROM "upload_sessions" WHERE id = $1 FOR UPDATE`, session.id);

        const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
        if (!current || current.userId !== req.userId) {
          throw { status: 404, message: 'Upload session not found' };
        }
        if (isSessionExpired(current)) throw { status: 410, message: 'Upload session expired' };
        if (current.status !== 'INITIATED' && current.status !== 'UPLOADING') {
          throw { status: 409, message: `Upload session is already ${current.status}` };
        }
        // Re-verify under the lock: a concurrent winner may have advanced.
        if (current.bytesUploaded !== clientOffset) {
          throw {
            status: 409,
            message: `Stale offset (server is at ${current.bytesUploaded})`,
            bytesUploaded: current.bytesUploaded,
          };
        }

        // Lazily start the provider multipart (once per session, in-tx so a
        // crash before commit leaves no half-persisted upload id).
        let providerUploadId = current.providerUploadId;
        if (!providerUploadId) {
          providerUploadId = await this.storage.createUpload(current.storageKey, current.mimeType);
          await tx.uploadSession.update({
            where: { id: current.id },
            data: { providerUploadId },
          });
        }

        // Stream the request body straight into the provider part — no
        // Buffer.concat, no heap proportional to the chunk, let alone the file.
        const etag = await this.storage.uploadPart(
          current.storageKey,
          providerUploadId,
          partNumber,
          req.body,
          contentLength,
        );

        // Upsert: a retry after Case C (R2 ok, commit lost) re-targets the
        // same part number and overwrites it — never a duplicate part row.
        await tx.uploadSessionPart.upsert({
          where: { sessionId_partNumber: { sessionId: current.id, partNumber } },
          create: { sessionId: current.id, partNumber, etag, size: contentLength },
          update: { etag, size: contentLength },
        });

        const updated = await tx.uploadSession.update({
          where: { id: current.id },
          data: {
            status: 'UPLOADING',
            bytesUploaded: clientOffset + contentLength,
            lastActivityAt: new Date(),
          },
        });
        return updated.bytesUploaded;
      });

      logger.info('upload-transfer:chunk', {
        uploadSessionId: session.id,
        userId: req.userId,
        oldOffset: clientOffset,
        newOffset,
        chunkSize: contentLength,
        partNumber,
        durationMs: Date.now() - startedAt,
      });
      return {
        sessionId: session.id,
        bytesUploaded: newOffset,
        expectedSize: session.expectedSize,
        partNumber,
        complete: newOffset === session.expectedSize,
      };
    } catch (err: any) {
      destroyBody(req.body);
      // A waiter that lost the row-lock race converges like a stale offset.
      if (err?.code === '55P03') {
        const fresh = await prisma.uploadSession.findUnique({ where: { id: session.id } });
        throw {
          status: 409,
          message: 'Concurrent transfer in progress — re-query the offset and retry',
          bytesUploaded: fresh?.bytesUploaded ?? session.bytesUploaded,
        };
      }
      if (err?.status) throw err;
      const classified = classifyProviderError(err);
      if (classified.retryable) {
        // Best-effort transient counter; a counter failure never masks the
        // original chunk failure (awaited so callers observe it consistently).
        try {
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: { retryCount: { increment: 1 }, lastActivityAt: new Date() },
          });
        } catch {}
      }
      logger.error('upload-transfer:chunk-failed', {
        uploadSessionId: session.id,
        userId: req.userId,
        oldOffset: clientOffset,
        chunkSize: contentLength,
        providerCode: classified.code,
        retryable: classified.retryable,
        durationMs: Date.now() - startedAt,
      });
      throw { status: 502, message: 'Chunk storage failed — retry the same offset' };
    }
  }

  /**
   * Complete a byte-full session: provider multipart completion FIRST,
   * storage verification SECOND, atomic FileRecord finalization LAST
   * (M1 single-winner). Never marks COMPLETED on byte-count alone.
   */
  async completeUploadSession(
    sessionId: string,
    userId: string | undefined,
  ): Promise<{ session: SerializedUploadSession; created: boolean; fileRecordId: string }> {
    if (!userId) throw { status: 401, message: 'Authentication required' };
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw { status: 404, message: 'Upload session not found' };
    }
    // Idempotent replay after a lost response.
    if (session.status === 'COMPLETED') {
      return {
        session: serializeUploadSession(session),
        created: false,
        fileRecordId: session.fileRecordId!,
      };
    }
    if (isSessionExpired(session)) throw { status: 410, message: 'Upload session expired' };
    if (session.status !== 'UPLOADING') {
      throw { status: 409, message: `Upload session is ${session.status} — nothing to complete` };
    }
    if (session.bytesUploaded !== session.expectedSize) {
      throw {
        status: 409,
        message: `Upload incomplete (${session.bytesUploaded}/${session.expectedSize} bytes)`,
      };
    }
    if (!session.providerUploadId) {
      throw { status: 409, message: 'No provider upload to complete' };
    }

    const parts = await prisma.uploadSessionPart.findMany({
      where: { sessionId: session.id },
      orderBy: { partNumber: 'asc' },
    });
    assertPartsCover(parts, session);

    // 1) Provider completion (idempotent on both backends).
    try {
      await this.storage.completeUpload(session.storageKey, session.providerUploadId, toRefs(parts));
    } catch (err) {
      const classified = classifyProviderError(err);
      logger.error('upload-transfer:complete-provider-failed', {
        uploadSessionId: session.id,
        userId,
        providerCode: classified.code,
        retryable: classified.retryable,
      });
      throw { status: 502, message: 'Storage completion failed — retry completion' };
    }

    // 2) Verify the assembled object exists at the expected size.
    const stat = await this.storage.statObject(session.storageKey).catch(() => null);
    if (!stat || stat.size !== session.expectedSize) {
      await this.failSession(session.id, 'assembled object verification failed');
      throw { status: 502, message: 'Assembled object verification failed' };
    }

    // 3) Magic-byte validation on a bounded prefix read (never the whole file).
    await this.validateAssembledType(session);

    // 4) Atomic single-winner FileRecord linkage (M1).
    const { session: done, created } = await uploadSessionService.finalizeSession(session.id, userId);
    // Parts served their purpose — drop the ledger rows.
    await prisma.uploadSessionPart.deleteMany({ where: { sessionId: session.id } }).catch(() => {});
    logger.info('upload-transfer:completed', {
      uploadSessionId: session.id,
      userId,
      fileRecordId: done.fileRecordId,
      expectedSize: session.expectedSize,
      partCount: parts.length,
    });
    return { session: done, created, fileRecordId: done.fileRecordId! };
  }

  /** Magic-byte gate: sniffed type must be allow-listed and consistent with declared. */
  private async validateAssembledType(session: UploadSession): Promise<void> {
    let prefix: Buffer;
    try {
      prefix = await this.storage.sniffPrefix(session.storageKey, SNIFF_PREFIX_BYTES);
    } catch {
      await this.failSession(session.id, 'could not read assembled object');
      throw { status: 502, message: 'Could not verify assembled file' };
    }
    const fail = async (message: string): Promise<never> => {
      await this.failSession(session.id, message);
      throw { status: 422, message };
    };

    const type = await fileTypeFromBuffer(prefix).catch(() => undefined);
    let mime = type?.mime;
    const fileExt = session.originalFilename.split('.').pop()?.toLowerCase();
    if (!mime || !ALLOWED_MIMES.has(mime)) {
      mime = fileExt ? EXT_MAP[fileExt] || 'application/octet-stream' : 'application/octet-stream';
    }
    if (!ALLOWED_MIMES.has(mime)) {
      await fail(`File type "${mime}" is not allowed`);
    }
    // Declared-vs-actual consistency (same rule family as the single-shot path).
    // m4a voice containers may sniff as video/mp4 — mirrors upload.service coercion.
    const declaredTop = session.mimeType.split('/')[0];
    const actualTop = mime!.split('/')[0];
    const voiceOk =
      session.purpose === 'voice_note' &&
      (mime === 'audio/mp4' || mime === 'video/mp4' || actualTop === 'audio');
    if (declaredTop !== actualTop && !voiceOk) {
      await fail(`File content (${mime}) does not match declared type (${session.mimeType})`);
    }
  }

  /** Park FAILED + best-effort provider abort (abort failure never masks the cause). */
  private async failSession(sessionId: string, reason: string): Promise<void> {
    await prisma.uploadSession
      .updateMany({
        where: { id: sessionId, status: 'UPLOADING' },
        data: { status: 'FAILED', lastActivityAt: new Date() },
      })
      .catch(() => {});
    const fresh = await prisma.uploadSession.findUnique({ where: { id: sessionId } }).catch(() => null);
    if (fresh?.providerUploadId) {
      await this.abortStorage(fresh.storageKey, fresh.providerUploadId, sessionId).catch(() => {});
    }
    await prisma.uploadSessionPart.deleteMany({ where: { sessionId } }).catch(() => {});
    logger.error('upload-transfer:failed', { uploadSessionId: sessionId, reason });
  }

  /** Best-effort provider abort with classified logging; never throws. */
  async abortStorage(storageKey: string, providerUploadId: string, sessionId: string): Promise<void> {
    try {
      await this.storage.abortUpload(storageKey, providerUploadId);
      logger.info('upload-transfer:aborted', { uploadSessionId: sessionId });
    } catch (err: any) {
      const classified = classifyProviderError(err);
      logger.error('upload-transfer:abort-failed', {
        uploadSessionId: sessionId,
        providerCode: classified.code,
        retryable: classified.retryable,
      });
    }
  }
}

/** Contiguity/size proof over the durable part ledger before completing. */
export function assertPartsCover(
  parts: Array<{ partNumber: number; size: number }>,
  session: Pick<UploadSession, 'expectedSize'>,
): void {
  if (parts.length === 0) {
    throw { status: 409, message: 'No uploaded parts to complete' };
  }
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].partNumber !== i + 1) {
      throw { status: 500, message: 'Part ledger is not contiguous' };
    }
    const last = i === parts.length - 1;
    if (!last && parts[i].size !== TRANSFER_PART_SIZE) {
      throw { status: 500, message: 'Part ledger sizes are inconsistent' };
    }
  }
  const total = parts.reduce((a, p) => a + p.size, 0);
  if (total !== session.expectedSize) {
    throw { status: 409, message: `Parts cover ${total}/${session.expectedSize} bytes` };
  }
}

function toRefs(
  parts: Array<{ partNumber: number; etag: string; size: number }>,
): MultipartPartRef[] {
  return parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size }));
}

export const uploadTransferService = new UploadTransferService();

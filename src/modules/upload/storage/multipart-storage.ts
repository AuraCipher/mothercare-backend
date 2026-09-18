import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { createR2Client } from './r2.storage';
import { getDefaultDocumentsBucket, isR2Enabled } from './index';
import { UPLOAD_ROOT } from './local.storage';

/**
 * M2 — provider multipart abstraction for resumable uploads.
 *
 * Two implementations behind one interface: R2/S3 multipart (production)
 * and local staging parts (dev/test/no-R2 stacks). The transfer layer only
 * speaks this interface, so restart recovery, completion, and abort behave
 * identically regardless of backend.
 *
 * Design rule: client resumable chunks map 1:1 onto provider parts with
 * partNumber = offset / TRANSFER_PART_SIZE + 1 (see upload-transfer.service).
 * A retry of the same range therefore targets the SAME part number and
 * safely overwrites it instead of duplicating bytes.
 */

export interface MultipartPartRef {
  partNumber: number;
  etag: string;
  size: number;
}

export interface MultipartStorage {
  readonly kind: 'r2' | 'local';
  /** Start a provider multipart upload; returns the opaque provider upload id. */
  createUpload(key: string, contentType: string): Promise<string>;
  /** Upload one part; streams the body without buffering it. Returns the part ETag. */
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    contentLength: number,
  ): Promise<string>;
  /** Complete with the exact ordered parts; throws if the provider rejects. */
  completeUpload(key: string, uploadId: string, parts: MultipartPartRef[]): Promise<void>;
  /** Abort and release provider state. Idempotent: missing uploads are success. */
  abortUpload(key: string, uploadId: string): Promise<void>;
  /** Final object size, or null when absent. */
  statObject(key: string): Promise<{ size: number } | null>;
  /** First bytes of the FINAL object (bounded read for magic-byte validation). */
  sniffPrefix(key: string, maxBytes: number): Promise<Buffer>;
}

export interface ClassifiedProviderError {
  code: string;
  retryable: boolean;
  notFound: boolean;
}

/** Classify provider failures for logging/retry decisions (never logs secrets). */
export function classifyProviderError(err: any): ClassifiedProviderError {
  const name = err?.name || err?.code || '';
  const status = err?.$metadata?.httpStatusCode as number | undefined;
  if (name === 'NoSuchUpload' || name === 'NoSuchKey' || name === 'NotFound' || status === 404) {
    return { code: String(name || 'NotFound'), retryable: false, notFound: true };
  }
  if (
    name === 'TimeoutError' ||
    name === 'NetworkingError' ||
    name === 'ECONNRESET' ||
    name === 'EPIPE' ||
    (status != null && status >= 500)
  ) {
    return { code: String(name || `HTTP_${status}`), retryable: true, notFound: false };
  }
  return { code: String(name || 'Unknown'), retryable: false, notFound: false };
}

function stripEtagQuotes(etag: string): string {
  return etag.replace(/"/g, '');
}

// ─── R2 / S3 ────────────────────────────────────────────────
export class R2MultipartStorage implements MultipartStorage {
  readonly kind = 'r2' as const;

  constructor(
    private readonly client: S3Client = createR2Client(),
    private readonly bucket?: string,
  ) {}

  private resolveBucket(): string {
    return this.bucket || getDefaultDocumentsBucket();
  }

  async createUpload(key: string, contentType: string): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.resolveBucket(),
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) throw new Error('R2 CreateMultipartUpload returned no UploadId');
    return res.UploadId;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    contentLength: number,
  ): Promise<string> {
    const res = await this.client.send(
      new UploadPartCommand({
        Bucket: this.resolveBucket(),
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body as any,
        ContentLength: contentLength,
      }),
    );
    const etag = res.ETag ? stripEtagQuotes(res.ETag) : '';
    if (!etag) throw new Error('R2 UploadPart returned no ETag');
    return etag;
  }

  async completeUpload(key: string, uploadId: string, parts: MultipartPartRef[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.resolveBucket(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
        },
      }),
    );
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.resolveBucket(),
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (err: any) {
      // Already gone (or never existed after a crash before persist) — success.
      if (classifyProviderError(err).notFound) return;
      throw err;
    }
  }

  async statObject(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.resolveBucket(), Key: key }),
      );
      return { size: res.ContentLength ?? 0 };
    } catch (err: any) {
      if (classifyProviderError(err).notFound) return null;
      throw err;
    }
  }

  async sniffPrefix(key: string, maxBytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.resolveBucket(),
        Key: key,
        Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
      }),
    );
    const chunks: Buffer[] = [];
    const body = res.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body) return Buffer.alloc(0);
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).length >= maxBytes) break;
    }
    return Buffer.concat(chunks).subarray(0, maxBytes);
  }
}

// ─── Local staging (dev/test/no-R2) ─────────────────────────
// Mirrors multipart semantics on disk: parts/<key>/part-<N> staging files,
// atomic rename per part, ordered concatenation on complete. All state
// needed for restart recovery (part files + DB rows) survives the process.
const LOCAL_PARTS_ROOT = path.join(UPLOAD_ROOT, '.resumable-parts');

function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || path.isAbsolute(key)) {
    throw new Error('Invalid storage key');
  }
}

function localPartPath(key: string, partNumber: number): string {
  assertSafeKey(key);
  return path.join(LOCAL_PARTS_ROOT, key, `part-${partNumber}`);
}

function localFinalPath(key: string): string {
  assertSafeKey(key);
  return path.join(UPLOAD_ROOT, key);
}

export class LocalMultipartStorage implements MultipartStorage {
  readonly kind = 'local' as const;

  async createUpload(key: string): Promise<string> {
    assertSafeKey(key);
    await fs.promises.mkdir(path.join(LOCAL_PARTS_ROOT, key), { recursive: true });
    // Opaque id; part files are namespaced by key so restarts reconcile.
    return `local-${crypto.randomUUID()}`;
  }

  async uploadPart(
    key: string,
    _uploadId: string,
    partNumber: number,
    body: Readable,
    contentLength: number,
  ): Promise<string> {
    const dest = localPartPath(key, partNumber);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    const hash = crypto.createHash('md5');
    let written = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > contentLength) {
          cb(new Error(`Part body exceeds declared length (${contentLength})`));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const out = fs.createWriteStream(tmp);
    try {
      await pipeline(body as Readable, counter as any, out as any);
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
      } catch {}
      throw err;
    }
    if (written !== contentLength) {
      try {
        if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
      } catch {}
      throw new Error(`Part body incomplete (got ${written}, expected ${contentLength})`);
    }
    await fs.promises.rename(tmp, dest);
    return hash.digest('hex');
  }

  async completeUpload(key: string, _uploadId: string, parts: MultipartPartRef[]): Promise<void> {
    const final = localFinalPath(key);
    // Idempotent replay: final already assembled at the right size.
    try {
      const st = await fs.promises.stat(final);
      if (st.size === parts.reduce((a, p) => a + p.size, 0)) return;
    } catch {}
    for (const p of parts) {
      try {
        await fs.promises.stat(localPartPath(key, p.partNumber));
      } catch {
        throw new Error(`Missing staged part ${p.partNumber} for ${key}`);
      }
    }
    await fs.promises.mkdir(path.dirname(final), { recursive: true });
    const tmp = `${final}.assemble-${process.pid}`;
    const out = fs.createWriteStream(tmp);
    try {
      for (const p of parts) {
        await pipeline(fs.createReadStream(localPartPath(key, p.partNumber)), out as any, {
          end: false,
        } as any);
      }
      out.end();
      await new Promise<void>((resolve, reject) => {
        out.on('finish', resolve);
        out.on('error', reject);
      });
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
      } catch {}
      throw err;
    }
    const st = await fs.promises.stat(tmp);
    if (st.size !== parts.reduce((a, p) => a + p.size, 0)) {
      await fs.promises.unlink(tmp);
      throw new Error('Assembled object size mismatch');
    }
    await fs.promises.rename(tmp, final);
    await this.abortUpload(key, _uploadId);
  }

  async abortUpload(key: string, _uploadId?: string): Promise<void> {
    assertSafeKey(key);
    await fs.promises.rm(path.join(LOCAL_PARTS_ROOT, key), { recursive: true, force: true });
  }

  async statObject(key: string): Promise<{ size: number } | null> {
    const full = localFinalPath(key); // validates before the missing-file catch
    try {
      const st = await fs.promises.stat(full);
      return { size: st.size };
    } catch {
      return null;
    }
  }

  async sniffPrefix(key: string, maxBytes: number): Promise<Buffer> {
    const fd = await fs.promises.open(localFinalPath(key), 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  }
}

/** Production resolver: R2 when configured, local staging otherwise. */
export function resolveMultipartStorage(): MultipartStorage {
  return isR2Enabled() ? new R2MultipartStorage() : new LocalMultipartStorage();
}

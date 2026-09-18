import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Readable } from 'stream';
import env from '../../../config/env';
import type { StorageOptions, StorageService } from './types';
import { DOCUMENTS_BUCKET } from './types';

function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Promise.resolve(Buffer.alloc(0));
  if (Buffer.isBuffer(body)) return Promise.resolve(body);
  if (body instanceof Uint8Array) return Promise.resolve(Buffer.from(body));

  const stream = body as AsyncIterable<Uint8Array>;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (async () => {
      try {
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        resolve(Buffer.concat(chunks));
      } catch (err) {
        reject(err);
      }
    })();
  });
}

export class R2StorageAdapter implements StorageService {
  private client: S3Client;
  private defaultBucket: string;

  constructor() {
    const accountId = env.R2_ACCOUNT_ID!;
    this.defaultBucket = env.R2_DOCUMENTS_BUCKET || DOCUMENTS_BUCKET;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      // 30s request timeout prevents hung connections from blocking the event loop.
      // Connection timeout is left at the default (3s) — Cloudflare R2 is a CDN edge.
      requestHandler: new NodeHttpHandler({
        requestTimeout: 30_000,
      }),
    });
  }

  isRemote(): boolean {
    return true;
  }

  private resolveBucket(options?: StorageOptions): string {
    return options?.bucket || this.defaultBucket;
  }

  async save(storagePath: string, body: Readable | Buffer, options?: StorageOptions): Promise<string> {
    const bucket = this.resolveBucket(options);
    if (Buffer.isBuffer(body)) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: body,
          ContentLength: body.length,
          ...(options?.contentType ? { ContentType: options.contentType } : {}),
        }),
      );
      return storagePath;
    }
    // Streaming path — use multipart Upload for Readable bodies
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: storagePath,
        Body: body as Readable,
        ...(options?.contentLength != null ? { ContentLength: options.contentLength } : {}),
        ...(options?.contentType ? { ContentType: options.contentType } : {}),
      },
      // Use 5 MB part size for efficient multipart; leave concurrency default
      partSize: 5 * 1024 * 1024,
      queueSize: 4,
    });
    await upload.done();
    return storagePath;
  }

  async get(storagePath: string, options?: StorageOptions): Promise<Buffer> {
    const result = await this.getStream(storagePath, options);
    return streamToBuffer(result.body as unknown as AsyncIterable<Uint8Array>);
  }

  async getStream(storagePath: string, options?: StorageOptions): Promise<import('./types').StorageGetResult> {
    const bucket = this.resolveBucket(options);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        ...(options?.range ? { Range: options.range } : {}),
      }),
    );
    let body: Readable;
    const rawBody: any = result.Body;
    if (!rawBody) {
      body = Readable.from(Buffer.alloc(0));
    } else if (rawBody instanceof Readable) {
      body = rawBody as Readable;
    } else if (typeof rawBody.transformToByteArray === 'function') {
      // Web ReadableStream
      body = Readable.fromWeb(rawBody as any);
    } else if (Buffer.isBuffer(rawBody)) {
      body = Readable.from(rawBody);
    } else if (typeof rawBody[Symbol.asyncIterator] === 'function') {
      body = Readable.from(rawBody as AsyncIterable<Uint8Array>);
    } else {
      // Fallback: treat as Readable
      body = rawBody as Readable;
    }
    return {
      body,
      contentLength: result.ContentLength,
      contentType: result.ContentType,
      etag: result.ETag,
      lastModified: result.LastModified,
      contentRange: (result as any).ContentRange,
      statusCode: options?.range && (result as any).ContentRange ? 206 : 200,
    };
  }

  async delete(storagePath: string, options?: StorageOptions): Promise<void> {
    const bucket = this.resolveBucket(options);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storagePath,
      }),
    );
  }
}

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    requestHandler: new NodeHttpHandler({
      requestTimeout: 30_000,
    }),
  });
}

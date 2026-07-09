import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
    });
  }

  isRemote(): boolean {
    return true;
  }

  private resolveBucket(options?: StorageOptions): string {
    return options?.bucket || this.defaultBucket;
  }

  async save(storagePath: string, buffer: Buffer, options?: StorageOptions): Promise<string> {
    const bucket = this.resolveBucket(options);
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        Body: buffer,
        ContentLength: buffer.length,
      }),
    );
    return storagePath;
  }

  async get(storagePath: string, options?: StorageOptions): Promise<Buffer> {
    const bucket = this.resolveBucket(options);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storagePath,
      }),
    );
    return streamToBuffer(result.Body);
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

  url(storagePath: string): string {
    const publicBase = env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (publicBase) {
      return `${publicBase}/${storagePath}`;
    }
    return storagePath;
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
  });
}

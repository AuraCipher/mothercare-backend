/**
 * M5 — REAL Sharp image processing tests (unmocked native module).
 *
 * Runs ONLY under jest.media.config.js (`npm run test:media-real`) because
 * the main jest config maps sharp/file-type/uuid to deterministic mocks.
 * Proves actual decode/resize/derive behavior with real PG + local storage.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const media = require('../../../src/modules/media/media-processor');

let prisma: PrismaClient;
const P = uniquePrefix();
const uid = `${P}_m5sharp`;
const createdFileIds: string[] = [];
const createdDirs: string[] = [];

function uploadsRoot(): string {
  return path.resolve(__dirname, '../../../uploads');
}

async function makeFileRow(opts: {
  id: string;
  purpose: string;
  mimeType: string;
  storageKey: string;
  size: number;
  originalName: string;
}): Promise<void> {
  await prisma.fileRecord.create({
    data: {
      id: opts.id,
      originalName: opts.originalName,
      storagePath: opts.storageKey,
      storageBucket: 'local',
      purpose: opts.purpose,
      mimeType: opts.mimeType,
      size: opts.size,
      uploadedById: uid,
      metadata: {},
      processingStatus: 'PENDING' as any,
    },
  });
  createdFileIds.push(opts.id);
}

async function writeLocalObject(storageKey: string, data: Buffer): Promise<void> {
  const full = path.join(uploadsRoot(), storageKey);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  createdDirs.push(path.join(uploadsRoot(), storageKey.split('/')[0]));
}

async function sharpPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

/** PNG with lying IHDR dimensions (valid CRC) + truncated body. */
function hugeDimPng(width: number, height: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13);
  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE((zlib as any).crc32(Buffer.concat([ihdrType, ihdrData])) >>> 0);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(10);
  const idatType = Buffer.from('IDAT');
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE((zlib as any).crc32(Buffer.concat([idatType, Buffer.alloc(10)])) >>> 0);
  return Buffer.concat([
    sig, ihdrLen, ihdrType, ihdrData, ihdrCrc,
    idatLen, idatType, Buffer.alloc(10), idatCrc,
  ]);
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uid, name: 'M5Sharp', passwordHash: 'x' } });
});

afterAll(async () => {
  await prisma.fileRecord.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.user.deleteMany({ where: { id: uid } });
  for (const dir of new Set(createdDirs)) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {}
  }
  try {
    await fs.promises.rm(path.join(uploadsRoot(), 'media'), { recursive: true, force: true });
  } catch {}
  await disconnect(prisma);
});

describe('image processing (real Sharp)', () => {
  test('4000x3000 chat png → ≤2048 webp derived object, record updated in place', async () => {
    const id = `${P}_img1`;
    const key = `${P}/m5/img1.png`;
    const original = await sharpPng(4000, 3000);
    await writeLocalObject(key, original);
    await makeFileRow({
      id, purpose: 'chat', mimeType: 'image/png', storageKey: key,
      size: original.length, originalName: 'img1.png',
    });
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
    const row: any = await prisma.fileRecord.findUnique({ where: { id } });
    expect(row.processingStatus).toBe('READY');
    expect(row.mimeType).toBe('image/webp');
    expect(row.storagePath).toMatch(new RegExp(`^media/${id}/processed-v1\\.webp$`));
    expect(row.width).toBeLessThanOrEqual(2048);
    expect(row.height).toBeLessThanOrEqual(2048);
    expect(row.metadata.originalStoragePath).toBe(key);
    expect(fs.existsSync(path.join(uploadsRoot(), row.storagePath))).toBe(true);
    expect(fs.existsSync(path.join(uploadsRoot(), key))).toBe(false);
  });

  test('idempotent re-run converges without new objects', async () => {
    const id = `${P}_img2`;
    const key = `${P}/m5/img2.png`;
    const original = await sharpPng(100, 100);
    await writeLocalObject(key, original);
    await makeFileRow({
      id, purpose: 'chat', mimeType: 'image/png', storageKey: key,
      size: original.length, originalName: 'img2.png',
    });
    const first = await media.processMediaFile(id);
    expect(first.reused).toBe(false);
    const row: any = await prisma.fileRecord.findUnique({ where: { id } });
    const second = await media.processMediaFile(id);
    expect(second).toMatchObject({ status: 'READY', reused: true });
    expect((await prisma.fileRecord.findUnique({ where: { id } }) as any).storagePath)
      .toBe(row.storagePath);
  });

  test('truncated png → REJECTED, bytes removed, row kept with reason', async () => {
    const id = `${P}_img3`;
    const key = `${P}/m5/img3.png`;
    const original = await sharpPng(200, 200);
    await writeLocalObject(key, original.subarray(0, 200));
    await makeFileRow({
      id, purpose: 'chat', mimeType: 'image/png', storageKey: key,
      size: 200, originalName: 'img3.png',
    });
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
    const row: any = await prisma.fileRecord.findUnique({ where: { id } });
    expect(row.processingStatus).toBe('REJECTED');
    expect(row.processingError).toBeTruthy();
    expect(fs.existsSync(path.join(uploadsRoot(), key))).toBe(false);
  });

  test('20000x20000 claimed dims → REJECTED from a <1 KB fixture (bounded heap)', async () => {
    const id = `${P}_img4`;
    const key = `${P}/m5/img4.png`;
    const evil = hugeDimPng(20000, 20000);
    expect(evil.length).toBeLessThan(1024);
    await writeLocalObject(key, evil);
    await makeFileRow({
      id, purpose: 'chat', mimeType: 'image/png', storageKey: key,
      size: evil.length, originalName: 'img4.png',
    });
    // Sharp rejects the truncated header before decoding (422 here); the
    // pixel-limit 413 translation itself is unit-proven below. Either way
    // the row is REJECTED and no ~1 GB allocation ever happens.
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
    expect((await prisma.fileRecord.findUnique({ where: { id } }) as any).processingStatus)
      .toBe('REJECTED');
  });

  test('pixel-limit translator maps Sharp errors to structured 413', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pipeline = require('../../../src/modules/upload/media.pipeline');
    expect(pipeline.translateSharpError(new Error('Input image exceeds pixel limit'))).toEqual({
      status: 413,
      message: expect.stringContaining('8192'),
    });
    expect(pipeline.translateSharpError(new Error('Input buffer has corrupt header'))).toBeNull();
    expect(pipeline.translateSharpError({ status: 400 })).toBeNull();
    expect(pipeline.MAX_IMAGE_DIM).toBe(8192);
  });

  test('png bytes declared as jpeg → sniff wins, READY as derived image', async () => {
    const id = `${P}_img5`;
    const key = `${P}/m5/img5.jpg`;
    const original = await sharpPng(50, 50);
    await writeLocalObject(key, original);
    await makeFileRow({
      id, purpose: 'chat', mimeType: 'image/jpeg', storageKey: key,
      size: original.length, originalName: 'img5.jpg',
    });
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
  });
});

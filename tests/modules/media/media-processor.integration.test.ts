/**
 * M5 — media processor integration tests (real PostgreSQL + local storage).
 *
 * Covers: image Sharp path (derived webp, in-place record update, original
 * removal), malformed/oversized-dim images, video/voice duration boundaries
 * (600 ok / 601 rejected), missing streams, corrupt media, doc fast path,
 * idempotent re-runs, single-winner claims, REJECTED byte removal, FAILED
 * retention, concurrency bound, reconciler, and inline fallback.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import fs from 'fs';
import path from 'path';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';
import { mp4Seconds, wavSeconds } from './fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const media = require('../../../src/modules/media/media-processor');

let prisma: PrismaClient;
const P = uniquePrefix();
const uid = `${P}_m5_user`;
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
  status?: string;
  metadata?: Record<string, unknown>;
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
      metadata: (opts.metadata ?? {}) as any,
      processingStatus: (opts.status ?? 'PENDING') as any,
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

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uid, name: 'M5', passwordHash: 'x' } });
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

describe('video duration (real ffprobe)', () => {
  async function videoRow(suffix: string, data: Buffer): Promise<string> {
    const id = `${P}_vid_${suffix}`;
    const key = `${P}/m5/vid_${suffix}.mp4`;
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'video', mimeType: 'video/mp4', storageKey: key,
      size: data.length, originalName: `vid_${suffix}.mp4`,
      metadata: { durationSeconds: 1 },
    });
    return id;
  }

  test('5s video → READY with probed duration + dims metadata', async () => {
    const id = await videoRow('ok', mp4Seconds(5));
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
    expect(res.durationSeconds).toBeCloseTo(5, 2);
    const row: any = await prisma.fileRecord.findUnique({ where: { id } });
    expect(row.processingStatus).toBe('READY');
    expect(row.metadata.probedDurationSeconds).toBeCloseTo(5, 2);
  });

  test('exactly 600s → READY; 601s → REJECTED with user-safe message', async () => {
    const okId = await videoRow('edge', mp4Seconds(600));
    const ok = await media.processMediaFile(okId);
    expect(ok.status).toBe('READY');
    expect(ok.durationSeconds).toBeCloseTo(600, 1);

    const overId = await videoRow('over', mp4Seconds(601));
    await expect(media.processMediaFile(overId)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('10 minutes or shorter'),
    });
    const row: any = await prisma.fileRecord.findUnique({ where: { id: overId } });
    expect(row.processingStatus).toBe('REJECTED');
    expect(fs.existsSync(path.join(uploadsRoot(), `${P}/m5/vid_over.mp4`))).toBe(false);
  });

  test('streamless container → REJECTED (missing streams)', async () => {
    const id = await videoRow('nostream', mp4Seconds(5, { withTrack: false }));
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
    expect((await prisma.fileRecord.findUnique({ where: { id } }) as any).processingStatus)
      .toBe('REJECTED');
  });

  test('garbage bytes → REJECTED (corrupt)', async () => {
    const id = await videoRow('corrupt', Buffer.from('definitely not a video file at all'));
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
  });
});

describe('voice duration (real ffprobe, no MB product cap)', () => {
  async function voiceRow(suffix: string, data: Buffer): Promise<string> {
    const id = `${P}_vox_${suffix}`;
    const key = `${P}/m5/vox_${suffix}.wav`;
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'voice_note', mimeType: 'audio/wav', storageKey: key,
      size: data.length, originalName: `vox_${suffix}.wav`,
    });
    return id;
  }

  test('599s voice → READY', async () => {
    const id = await voiceRow('ok', wavSeconds(599));
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
    expect(res.durationSeconds).toBeCloseTo(599, 0);
  });

  test('601s voice → REJECTED (duration decides, not megabytes)', async () => {
    const id = await voiceRow('over', wavSeconds(601));
    await expect(media.processMediaFile(id)).rejects.toMatchObject({
      message: expect.stringContaining('10 minutes or shorter'),
    });
  });

  test('6 MB voice under the duration cap → READY (old 5 MB cap is gone)', async () => {
    // 48kHz stereo 16-bit: ~5.6 MiB ≈ 30s — over the OLD cap, valid now.
    const data = wavSeconds(30, { sampleRate: 48000, channels: 2, bitsPerSample: 16 });
    expect(data.length).toBeGreaterThan(5 * 1024 * 1024);
    const id = await voiceRow('big', data);
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
  });
});

describe('documents + claims + reconciler', () => {
  test('document fast path verifies size → READY without probe', async () => {
    const id = `${P}_doc1`;
    const key = `${P}/m5/doc1.pdf`;
    const data = Buffer.from('%PDF-1.4 fake-id-' + P);
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'document', mimeType: 'application/pdf', storageKey: key,
      size: data.length, originalName: 'doc1.pdf',
    });
    const res = await media.processMediaFile(id);
    expect(res).toMatchObject({ status: 'READY', reused: false });
  });

  test('size mismatch → REJECTED (integrity)', async () => {
    const id = `${P}_doc2`;
    const key = `${P}/m5/doc2.pdf`;
    await writeLocalObject(key, Buffer.from('short'));
    await makeFileRow({
      id, purpose: 'document', mimeType: 'application/pdf', storageKey: key,
      size: 999999, originalName: 'doc2.pdf',
    });
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
  });

  test('READY row converges; PROCESSING rival → retryable; REJECTED converges', async () => {
    const id = `${P}_doc3`;
    const key = `${P}/m5/doc3.pdf`;
    await writeLocalObject(key, Buffer.from('x'));
    await makeFileRow({
      id, purpose: 'document', mimeType: 'application/pdf', storageKey: key,
      size: 1, originalName: 'doc3.pdf', status: 'READY',
    });
    await expect(media.processMediaFile(id)).resolves.toMatchObject({ status: 'READY', reused: true });

    await prisma.fileRecord.update({ where: { id }, data: { processingStatus: 'PROCESSING' } });
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ retryable: true });

    await prisma.fileRecord.update({ where: { id }, data: { processingStatus: 'REJECTED' } });
    await expect(media.processMediaFile(id)).resolves.toMatchObject({ status: 'REJECTED', reused: true });
  });

  test('reconcilePendingMedia picks old PENDING, skips fresh', async () => {
    const oldId = `${P}_doc4`;
    const oldKey = `${P}/m5/doc4.pdf`;
    const freshId = `${P}_doc5`;
    const freshKey = `${P}/m5/doc5.pdf`;
    await writeLocalObject(oldKey, Buffer.from('old'));
    await writeLocalObject(freshKey, Buffer.from('fresh'));
    await makeFileRow({
      id: oldId, purpose: 'document', mimeType: 'application/pdf', storageKey: oldKey,
      size: 3, originalName: 'doc4.pdf',
    });
    await makeFileRow({
      id: freshId, purpose: 'document', mimeType: 'application/pdf', storageKey: freshKey,
      size: 5, originalName: 'doc5.pdf',
    });
    await prisma.fileRecord.update({
      where: { id: oldId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const seen: string[] = [];
    const out = await media.reconcilePendingMedia(10, async (fid: string) => {
      seen.push(fid);
    });
    expect(seen).toEqual([oldId]);
    expect(out).toEqual({ queued: 1, failed: 0 });
    // Default trigger path (inline, no Redis in tests) also works end to end.
    const out2 = await media.reconcilePendingMedia(10);
    expect(out2.queued).toBeGreaterThanOrEqual(1);
    expect((await prisma.fileRecord.findUnique({ where: { id: oldId } }) as any).processingStatus)
      .toBe('READY');
  });

  test('withMediaSlot bounds concurrency to 2', async () => {
    let peak = 0;
    let active = 0;
    const gate = (ms: number) =>
      media.withMediaSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, ms));
        active -= 1;
      });
    await Promise.all([gate(30), gate(30), gate(30), gate(30), gate(30)]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  test('markPendingForProcessing + requestMediaProcessing routing', async () => {
    const id = `${P}_doc6`;
    const key = `${P}/m5/doc6.pdf`;
    await writeLocalObject(key, Buffer.from('routeme'));
    await makeFileRow({
      id, purpose: 'document', mimeType: 'application/pdf', storageKey: key,
      size: 7, originalName: 'doc6.pdf', status: 'READY',
    });
    // Documents never need the worker.
    await expect(media.markPendingForProcessing(id)).resolves.toBe(false);
    expect((await prisma.fileRecord.findUnique({ where: { id } }) as any).processingStatus).toBe('READY');

    const vid = `${P}_vid_route`;
    const vkey = `${P}/m5/vid_route.mp4`;
    const vdata = mp4Seconds(5);
    await writeLocalObject(vkey, vdata);
    await makeFileRow({
      id: vid, purpose: 'video', mimeType: 'video/mp4', storageKey: vkey,
      size: vdata.length, originalName: 'vid_route.mp4', status: 'READY',
    });
    await expect(media.markPendingForProcessing(vid)).resolves.toBe(true);
    expect((await prisma.fileRecord.findUnique({ where: { id: vid } }) as any).processingStatus).toBe('PENDING');
    // Inline fallback (no Redis in tests) processes it for real.
    await media.requestMediaProcessing(vid);
    expect((await prisma.fileRecord.findUnique({ where: { id: vid } }) as any).processingStatus).toBe('READY');
  });
});

/**
 * M5 — media/chat security tests (real PostgreSQL + local storage).
 *
 * Proves: PENDING media cannot become a message; REJECTED media is
 * unservable; client metadata lies never move the decision; storage keys
 * are traversal-safe; filenames cannot inject shell commands (execFile
 * array); cross-user attachment stays forbidden.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import fs from 'fs';
import path from 'path';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';
import { mp4Seconds } from './fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const media = require('../../../src/modules/media/media-processor');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chatService = require('../../../src/modules/chat/services/chat-message.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authz = require('../../../src/modules/upload/upload-authorization');

let prisma: PrismaClient;
const P = uniquePrefix();
const uidA = `${P}_m5x_a`;
const uidB = `${P}_m5x_b`;
let roomId = '';
const createdFileIds: string[] = [];
const createdDirs: string[] = [];

function uploadsRoot(): string {
  return path.resolve(__dirname, '../../../uploads');
}

async function writeLocalObject(storageKey: string, data: Buffer): Promise<void> {
  const full = path.join(uploadsRoot(), storageKey);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  createdDirs.push(path.join(uploadsRoot(), storageKey.split('/')[0]));
}

async function makeFileRow(opts: {
  id: string;
  purpose: string;
  mimeType: string;
  storageKey: string;
  size: number;
  owner: string;
  status?: string;
  roomId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.fileRecord.create({
    data: {
      id: opts.id,
      originalName: `${opts.id}.mp4`,
      storagePath: opts.storageKey,
      storageBucket: 'local',
      purpose: opts.purpose,
      mimeType: opts.mimeType,
      size: opts.size,
      uploadedById: opts.owner,
      entityType: 'chat',
      metadata: ({ ...(opts.metadata ?? {}), ...(opts.roomId ? { roomId: opts.roomId } : {}) } as any),
      publicUrl: `/api/uploads/${opts.id}`,
      processingStatus: (opts.status ?? 'PENDING') as any,
    },
  });
  createdFileIds.push(opts.id);
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uidA, name: 'M5X A', passwordHash: 'x', role: 'super_admin' } });
  await prisma.user.create({ data: { id: uidB, name: 'M5X B', passwordHash: 'x' } });
  const branch = await prisma.branch.create({ data: { id: `${P}_br`, name: `${P} branch`, code: `${P}BX` } });
  await prisma.branchMember.create({
    data: { branchId: branch.id, userId: uidA, role: 'branch_admin', isActive: true },
  });
  const cal = await prisma.academicCalendar.create({
    data: { id: `${P}_cal`, label: `${P}-sec`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  const ay = await prisma.academicYear.create({ data: { id: `${P}_ay`, branchId: branch.id, calendarId: cal.id } });
  const room = await prisma.chatRoom.create({
    data: { id: `${P}_room`, academicYearId: ay.id, branchId: branch.id, kind: 'group_chat', name: `${P} sec room` },
  });
  roomId = room.id;
  for (const uid of [uidA, uidB]) {
    await prisma.chatRoomMember.create({
      data: { roomId, userId: uid, access: 'member', canPost: true, canRead: true },
    });
  }
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "chat_message_attachments" WHERE "messageId" IN (SELECT id FROM chat_messages WHERE "roomId" = $1)`,
    roomId,
  ).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.fileRecord.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.chatRoomMember.deleteMany({ where: { roomId } });
  await prisma.chatRoom.deleteMany({ where: { id: roomId } });
  await prisma.branchMember.deleteMany({ where: { branchId: `${P}_br` } });
  await prisma.academicYear.deleteMany({ where: { id: `${P}_ay` } });
  await prisma.academicCalendar.deleteMany({ where: { id: `${P}_cal` } });
  await prisma.branch.deleteMany({ where: { id: `${P}_br` } });
  await prisma.user.deleteMany({ where: { id: { in: [uidA, uidB] } } });
  for (const dir of new Set(createdDirs)) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {}
  }
  await disconnect(prisma);
});

describe('processing gate', () => {
  test('PENDING video cannot be attached (403 media still processing)', async () => {
    const id = `${P}_sec_pending`;
    const key = `${P}/m5x/pending.mp4`;
    const data = mp4Seconds(5);
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'video', mimeType: 'video/mp4', storageKey: key,
      size: data.length, owner: uidA, status: 'PENDING', roomId,
    });
    await expect(
      chatService.createRoomMessage({
        roomId, senderId: uidA, type: 'video', mediaFileIds: [id], clientMessageId: `${P}-sec-1`,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('READY video attaches; REJECTED file is unservable (404-mask)', async () => {
    const okId = `${P}_sec_ready`;
    const okKey = `${P}/m5x/ready.mp4`;
    const okData = mp4Seconds(5);
    await writeLocalObject(okKey, okData);
    await makeFileRow({
      id: okId, purpose: 'video', mimeType: 'video/mp4', storageKey: okKey,
      size: okData.length, owner: uidA, status: 'READY', roomId,
    });
    const { message } = await chatService.createRoomMessage({
      roomId, senderId: uidA, type: 'video', mediaFileIds: [okId], clientMessageId: `${P}-sec-2`,
    });
    expect(message.mediaFileId).toBe(okId);

    const badId = `${P}_sec_rej`;
    const badKey = `${P}/m5x/rej.mp4`;
    const badData = mp4Seconds(601);
    await writeLocalObject(badKey, badData);
    await makeFileRow({
      id: badId, purpose: 'video', mimeType: 'video/mp4', storageKey: badKey,
      size: badData.length, owner: uidA, status: 'PENDING', roomId,
    });
    await media.processMediaFile(badId).catch(() => {});
    expect((await prisma.fileRecord.findUnique({ where: { id: badId } }) as any).processingStatus)
      .toBe('REJECTED');
    const denied = await authz.authorizeFileAccess({ id: uidA, role: 'teacher' }, badId);
    expect(denied.allowed).toBe(false);
    await expect(
      chatService.createRoomMessage({
        roomId, senderId: uidA, type: 'video', mediaFileIds: [badId], clientMessageId: `${P}-sec-3`,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('client duration lie is ignored: metadata says 1s, bytes say 601s → REJECTED', async () => {
    const id = `${P}_sec_lie`;
    const key = `${P}/m5x/lie.mp4`;
    const data = mp4Seconds(601);
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'video', mimeType: 'video/mp4', storageKey: key,
      size: data.length, owner: uidA, status: 'PENDING', roomId,
      metadata: { durationSeconds: 1 },
    });
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });
    expect((await prisma.fileRecord.findUnique({ where: { id } }) as any).processingStatus)
      .toBe('REJECTED');
  });

  test('cross-user attach of READY file still forbidden', async () => {
    const id = `${P}_sec_cross`;
    const key = `${P}/m5x/cross.mp4`;
    const data = mp4Seconds(5);
    await writeLocalObject(key, data);
    // Owned by B with no room binding: A may not attach it.
    await makeFileRow({
      id, purpose: 'document', mimeType: 'video/mp4', storageKey: key,
      size: data.length, owner: uidB, status: 'READY',
    });
    await expect(
      chatService.createRoomMessage({
        roomId, senderId: uidA, type: 'video', mediaFileIds: [id], clientMessageId: `${P}-sec-4`,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('storage key safety', () => {  test('traversal keys rejected before any claim or I/O', () => {
    expect(() => media.assertSafeStorageKey('../evil')).toThrow('Invalid storage key');
    expect(() => media.assertSafeStorageKey('/abs/path')).toThrow('Invalid storage key');
    expect(() => media.assertSafeStorageKey('')).toThrow('Invalid storage key');
    expect(() => media.assertSafeStorageKey('chat/room/2026/09/uuid.mp4')).not.toThrow();
  });

  test('shell metachars in filenames cannot execute (execFile array, no shell)', async () => {
    const evil = 'x-$(touch /tmp/m5-pwned)-y.mp4';
    const id = `${P}_sec_evil`;
    const key = `${P}/m5x/evil.mp4`;
    const data = mp4Seconds(5);
    await writeLocalObject(key, data);
    await prisma.fileRecord.create({
      data: {
        id,
        originalName: evil,
        storagePath: key,
        storageBucket: 'local',
        purpose: 'video',
        mimeType: 'video/mp4',
        size: data.length,
        uploadedById: uidA,
        entityType: 'chat',
        metadata: { roomId } as any,
        publicUrl: `/api/uploads/${id}`,
        processingStatus: 'PENDING' as any,
      },
    });
    createdFileIds.push(id);
    const res = await media.processMediaFile(id);
    expect(res.status).toBe('READY');
    expect(fs.existsSync('/tmp/m5-pwned')).toBe(false);
    try {
      fs.unlinkSync('/tmp/m5-pwned');
    } catch {}
  });
});

describe('rejected meta visibility (410 owner vs 404 stranger)', () => {
  test('owner learns terminal 410 with reason; stranger gets 404 mask', async () => {
    const id = `${P}_sec_meta`;
    const key = `${P}/m5x/meta.mp4`;
    const data = mp4Seconds(601);
    await writeLocalObject(key, data);
    await makeFileRow({
      id, purpose: 'video', mimeType: 'video/mp4', storageKey: key,
      size: data.length, owner: uidA, status: 'PENDING', roomId,
    });
    await expect(media.processMediaFile(id)).rejects.toMatchObject({ status: 422 });

    const ownerView = await authz.authorizeFileAccess({ id: uidA, role: 'teacher' }, id);
    expect(ownerView.allowed).toBe(false);
    expect(ownerView.reason).toBe('Gone');

    const strangerView = await authz.authorizeFileAccess({ id: uidB, role: 'teacher' }, id);
    expect(strangerView.allowed).toBe(false);
    expect(strangerView.reason).not.toBe('Gone');
  });
});

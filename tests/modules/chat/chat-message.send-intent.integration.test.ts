/**
 * M5 — send-intent durability contract (real PostgreSQL).
 *
 * Proves the server side of uncertain-send recovery:
 * - same clientMessageId + same payload → one row (duplicate:true)
 * - same clientMessageId + different payload → deterministic 409 (no merge)
 * - GET by-client-key returns the message (flat attachments) or 404
 * - non-members cannot reconcile other rooms (404/403, no oracle detail)
 * - conflict check tolerates legacy rows (mediaFileId-only comparison)
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const chatService = require('../../../src/modules/chat/services/chat-message.service');
const { createRoomMessage, findMessageByClientKey, sameLogicalSend } = chatService;

let prisma: PrismaClient;
const P = uniquePrefix();
const uidA = `${P}_m5s_a`;
const uidB = `${P}_m5s_b`;
let roomId = '';
let fileA = '';
let fileB = '';

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uidA, name: 'M5S A', passwordHash: 'x', role: 'super_admin' } });
  await prisma.user.create({ data: { id: uidB, name: 'M5S B', passwordHash: 'x' } });
  const branch = await prisma.branch.create({ data: { id: `${P}_br`, name: `${P} branch`, code: `${P}BRS` } });
  await prisma.branchMember.create({
    data: { branchId: branch.id, userId: uidA, role: 'branch_admin', isActive: true },
  });
  const cal = await prisma.academicCalendar.create({
    data: { id: `${P}_cal`, label: `${P}-send`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  const ay = await prisma.academicYear.create({ data: { id: `${P}_ay`, branchId: branch.id, calendarId: cal.id } });
  const room = await prisma.chatRoom.create({
    data: { id: `${P}_room`, academicYearId: ay.id, branchId: branch.id, kind: 'group_chat', name: `${P} send room` },
  });
  roomId = room.id;
  for (const uid of [uidA, uidB]) {
    await prisma.chatRoomMember.create({
      data: { roomId, userId: uid, access: 'member', canPost: true, canRead: true },
    });
  }
  fileA = `${P}_send_a`;
  fileB = `${P}_send_b`;
  for (const [id, owner] of [[fileA, uidA], [fileB, uidA]] as const) {
    await prisma.fileRecord.create({
      data: {
        id,
        originalName: `${id}.jpg`,
        storagePath: `${P}/m5/${id}.jpg`,
        storageBucket: 'local',
        purpose: 'chat',
        mimeType: 'image/jpeg',
        size: 100,
        uploadedById: owner,
        entityType: 'chat',
        metadata: { roomId },
        publicUrl: `/api/uploads/${id}`,
        processingStatus: 'READY',
      },
    });
  }
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "chat_message_attachments" WHERE "messageId" IN (SELECT id FROM chat_messages WHERE "roomId" = $1)`,
    roomId,
  ).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.fileRecord.deleteMany({ where: { id: { in: [fileA, fileB] } } });
  await prisma.chatRoomMember.deleteMany({ where: { roomId } });
  await prisma.chatRoom.deleteMany({ where: { id: roomId } });
  await prisma.branchMember.deleteMany({ where: { branchId: `${P}_br` } });
  await prisma.academicYear.deleteMany({ where: { id: `${P}_ay` } });
  await prisma.academicCalendar.deleteMany({ where: { id: `${P}_cal` } });
  await prisma.branch.deleteMany({ where: { id: `${P}_br` } });
  await prisma.user.deleteMany({ where: { id: { in: [uidA, uidB] } } });
  await disconnect(prisma);
});

describe('uncertain-send recovery (same key, same payload)', () => {
  test('timeout → retry same key → one row, duplicate:true, same attachments', async () => {
    const key = `${P}-uncertain-1`;
    const first = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      content: 'trip',
      mediaFileIds: [fileA, fileB],
      clientMessageId: key,
    });
    expect(first.duplicate).toBe(false);
    // Simulated client timeout: retry with the identical logical payload.
    const second = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      content: 'trip',
      mediaFileIds: [fileA, fileB],
      clientMessageId: key,
    });
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(
      await prisma.chatMessage.count({
        where: { roomId, metadata: { path: ['dedupeId'], equals: key } },
      }),
    ).toBe(1);
    expect(
      await prisma.chatMessageAttachment.count({ where: { messageId: first.message.id } }),
    ).toBe(2);
  });

  test('reconcile endpoint finds it (flat attachments, ordered)', async () => {
    const key = `${P}-uncertain-1`;
    const found = await findMessageByClientKey(roomId, uidA, key);
    expect(found).not.toBeNull();
    expect(found!.id).toBeDefined();
    expect(found!.attachments.map((a: any) => a.id)).toEqual([fileA, fileB]);
    expect(found!.attachments[0]).toMatchObject({ mimeType: 'image/jpeg' });
  });

  test('reconcile of unknown key → null (route maps to 404)', async () => {
    await expect(findMessageByClientKey(roomId, uidA, `${P}-nope-nope`)).resolves.toBeNull();
  });

  test('non-member cannot reconcile (no oracle)', async () => {
    const outsider = `${P}_outsider`;
    await prisma.user.create({ data: { id: outsider, name: 'Out', passwordHash: 'x' } });
    try {
      await expect(findMessageByClientKey(roomId, outsider, `${P}-uncertain-1`)).rejects.toBeDefined();
    } finally {
      await prisma.user.deleteMany({ where: { id: outsider } });
    }
  });
});

describe('conflict rejection (same key, different payload)', () => {
  test.each([
    ['different content', { content: 'CHANGED' }, 'image', undefined, [fileA, fileB]],
    ['different attachments', { content: 'trip' }, 'image', undefined, [fileA]],
    ['different order', { content: 'trip' }, 'image', undefined, [fileB, fileA]],
    ['different type', { content: 'trip' }, 'document', undefined, [fileA, fileB]],
  ])('%s → 409, no merge, no new row', async (_label, extra: any, type: string, _t: any, ids: string[]) => {
    const key = `${P}-conflict-1`;
    await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      content: 'trip',
      mediaFileIds: [fileA, fileB],
      clientMessageId: key,
    });
    const before = await prisma.chatMessage.count({ where: { roomId } });
    await expect(
      createRoomMessage({
        roomId,
        senderId: uidA,
        type: type as any,
        content: extra.content,
        mediaFileIds: ids,
        clientMessageId: key,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.chatMessage.count({ where: { roomId } })).toBe(before);
  });

  test('sameLogicalSend unit: legacy mediaFileId-only rows compare correctly', () => {
    expect(
      sameLogicalSend({ type: 'image', title: null, content: 'hi', mediaFileId: fileA }, 'image', undefined, 'hi', [fileA]),
    ).toBe(true);
    expect(
      sameLogicalSend({ type: 'image', title: null, content: 'hi', mediaFileId: fileA }, 'image', undefined, 'hi', [fileB]),
    ).toBe(false);
    expect(
      sameLogicalSend(
        { type: 'image', title: null, content: 'hi', attachments: [{ fileRecordId: fileA }, { fileRecordId: fileB }] },
        'image', undefined, 'hi', [fileA, fileB],
      ),
    ).toBe(true);
  });
});

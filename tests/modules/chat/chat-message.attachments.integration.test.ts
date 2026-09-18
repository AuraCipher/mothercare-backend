/**
 * M4 — multi-attachment chat messages + idempotent send (real PostgreSQL).
 *
 * Proves against the real database: ordered attachment rows, first-id
 * mirroring to legacy mediaFileId, per-file authorization atomicity (one
 * bad file aborts the whole send), legacy single-attachment compatibility,
 * clientMessageId dedupe (sequential double-send → one row), Restrict
 * protection on file delete, and the edit guard for attachment messages.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoomMessage, updateRoomMessage, toEnvelopeAttachments } =
  require('../../../src/modules/chat/services/chat-message.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uploadService } = require('../../../src/modules/upload/upload.service');

let prisma: PrismaClient;
const P = uniquePrefix();
const uidA = `${P}_m4_a`;
const uidB = `${P}_m4_b`;
let roomId = '';
let fileA = '';
let fileB = '';
let fileOther = '';

async function makeFile(id: string, owner: string, room?: string) {
  await prisma.fileRecord.create({
    data: {
      id,
      originalName: `${id}.jpg`,
      storagePath: `${P}/m4/${id}.jpg`,
      storageBucket: 'local',
      purpose: 'chat',
      mimeType: 'image/jpeg',
      size: 100,
      uploadedById: owner,
      entityType: 'chat',
      metadata: room ? { roomId: room } : {},
      publicUrl: `/api/uploads/${id}`,
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.user.create({ data: { id: uidA, name: 'M4 A', passwordHash: 'x', role: 'super_admin' } });
  await prisma.user.create({ data: { id: uidB, name: 'M4 B', passwordHash: 'x' } });
  const branch = await prisma.branch.create({ data: { id: `${P}_br`, name: `${P} branch`, code: `${P}BR` } });
  // Branch-admin posting rights for group_chat (canPostGroupChat path).
  await prisma.branchMember.create({
    data: { branchId: branch.id, userId: uidA, role: 'branch_admin', isActive: true },
  });
  const cal = await prisma.academicCalendar.create({
    data: { id: `${P}_cal`, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  const ay = await prisma.academicYear.create({
    data: { id: `${P}_ay`, branchId: branch.id, calendarId: cal.id },
  });
  const room = await prisma.chatRoom.create({
    data: { id: `${P}_room`, academicYearId: ay.id, branchId: branch.id, kind: 'group_chat', name: `${P} room` },
  });
  roomId = room.id;
  for (const uid of [uidA, uidB]) {
    await prisma.chatRoomMember.create({
      data: { roomId, userId: uid, access: 'member', canPost: true, canRead: true },
    });
  }
  fileA = `${P}_file_a`;
  fileB = `${P}_file_b`;
  fileOther = `${P}_file_other`;
  await makeFile(fileA, uidA, roomId);
  await makeFile(fileB, uidA, roomId);
  // Owned by B but uploaded to this room → attachable by A via rule 2.
  await makeFile(fileOther, uidB, roomId);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "chat_message_attachments" WHERE "messageId" IN (SELECT id FROM chat_messages WHERE "roomId" = $1)`,
    roomId,
  ).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.fileRecord.deleteMany({ where: { id: { in: [fileA, fileB, fileOther] } } });
  await prisma.chatRoomMember.deleteMany({ where: { roomId } });
  await prisma.chatRoom.deleteMany({ where: { id: roomId } });
  await prisma.branchMember.deleteMany({ where: { branchId: `${P}_br` } });
  await prisma.academicYear.deleteMany({ where: { id: `${P}_ay` } });
  await prisma.academicCalendar.deleteMany({ where: { id: `${P}_cal` } });
  await prisma.branch.deleteMany({ where: { id: `${P}_br` } });
  await prisma.user.deleteMany({ where: { id: { in: [uidA, uidB] } } });
  await disconnect(prisma);
});

describe('multi-attachment creation', () => {
  test('three files → one message, ordered rows, first mirrors to mediaFileId', async () => {
    const { message, duplicate } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      content: 'event photos',
      mediaFileIds: [fileA, fileB, fileOther],
      clientMessageId: `${P}-send-1`,
    });
    expect(duplicate).toBe(false);
    expect(message.mediaFileId).toBe(fileA);
    const rows = await prisma.chatMessageAttachment.findMany({
      where: { messageId: message.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(rows.map((r: any) => r.fileRecordId)).toEqual([fileA, fileB, fileOther]);
    expect(rows.map((r: any) => r.sortOrder)).toEqual([0, 1, 2]);
    // fileOther is owned by B but this test uses owner files only; see authz below.
  });

  test('legacy single mediaFileId still creates one attachment row', async () => {
    const { message } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileId: fileA,
      clientMessageId: `${P}-send-legacy`,
    });
    expect(message.mediaFileId).toBe(fileA);
    expect(
      await prisma.chatMessageAttachment.count({ where: { messageId: message.id } }),
    ).toBe(1);
  });

  test('envelope helper flattens ordered attachments', async () => {
    const { message } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileB, fileA],
      clientMessageId: `${P}-send-env`,
    });
    expect(toEnvelopeAttachments(message).map((a: any) => a.id)).toEqual([fileB, fileA]);
  });
});

describe('authorization atomicity (IDOR)', () => {
  test('one foreign file aborts the whole send — no partial message', async () => {
    const strangerFile = `${P}_file_stranger`;
    // Owned by B with NO room binding: A may not attach it (rules 1-3 all miss).
    await makeFile(strangerFile, uidB);
    const before = await prisma.chatMessage.count({ where: { roomId } });
    await expect(
      createRoomMessage({
        roomId,
        senderId: uidA,
        type: 'image',
        mediaFileIds: [fileA, strangerFile],
        clientMessageId: `${P}-send-idor`,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.chatMessage.count({ where: { roomId } })).toBe(before);
    await prisma.fileRecord.delete({ where: { id: strangerFile } });
  });

  test('same-room chat file by another member is attachable (existing rule 2)', async () => {
    const { message } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileOther],
      clientMessageId: `${P}-send-rule2`,
    });
    expect(message.mediaFileId).toBe(fileOther);
  });

  test('>100 attachments rejected before any write', async () => {
    const before = await prisma.chatMessage.count({ where: { roomId } });
    await expect(
      createRoomMessage({
        roomId,
        senderId: uidA,
        type: 'image',
        mediaFileIds: Array.from({ length: 101 }, (_, i) => `f-${i}`),
        clientMessageId: `${P}-send-100`,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await prisma.chatMessage.count({ where: { roomId } })).toBe(before);
  });
});

describe('idempotent send (clientMessageId)', () => {
  test('sequential double-send returns the original (duplicate:true)', async () => {
    const first = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileA, fileB],
      clientMessageId: `${P}-send-idem`,
    });
    const second = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileA, fileB],
      clientMessageId: `${P}-send-idem`,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(
      await prisma.chatMessage.count({
        where: { roomId, metadata: { path: ['dedupeId'], equals: `${P}-send-idem` } },
      }),
    ).toBe(1);
  });

  test('different keys create different messages', async () => {
    const a = await createRoomMessage({
      roomId, senderId: uidA, type: 'text', content: 'hi', clientMessageId: `${P}-k1`,
    });
    const b = await createRoomMessage({
      roomId, senderId: uidA, type: 'text', content: 'hi', clientMessageId: `${P}-k2`,
    });
    expect(a.message.id).not.toBe(b.message.id);
  });

  test('malformed clientMessageId rejected', async () => {
    await expect(
      createRoomMessage({ roomId, senderId: uidA, type: 'text', clientMessageId: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('lifecycle guards', () => {
  test('attached files cannot be deleted (409, storage untouched)', async () => {
    const { message } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileA],
      clientMessageId: `${P}-send-protect`,
    });
    expect(message).toBeDefined();
    await expect(uploadService.deleteFile(fileA)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.fileRecord.findUnique({ where: { id: fileA } })).not.toBeNull();
  });

  test('attachment messages cannot be edited', async () => {
    const { message } = await createRoomMessage({
      roomId,
      senderId: uidA,
      type: 'image',
      mediaFileIds: [fileB],
      clientMessageId: `${P}-send-noedit`,
    });
    await expect(updateRoomMessage(message.id, uidA, 'changed')).rejects.toMatchObject({
      status: 400,
    });
  });
});

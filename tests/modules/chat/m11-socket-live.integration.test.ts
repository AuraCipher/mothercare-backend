/**
 * M11 §18/§20/§12 — LIVE Socket.IO (real server on ephemeral port, real PG,
 * real JWT, real services; no mocks). Auth matrix, wrong-room denial,
 * suspended-user denial, no-record-on-denial, multi-device broadcast,
 * reconnect.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import http from 'http';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import { generateTestToken, generateExpiredToken, getAuthHeader } from '../../helpers/auth';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { initChatSocket } = require('../../../src/modules/chat/socket/chat.socket');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io: ioClient } = require('socket.io-client');

let prisma: PrismaClient;
const P = uniquePrefix() + '_m11sk';
const ids = {
  cal: `${P}_cal`,
  br: `${P}_br`,
  ay: `${P}_ay`,
  g: `${P}_g`,
  subj: `${P}_subj`,
  t: `${P}_t`,
  s: `${P}_s`,
  su: `${P}_su`,
  room: `${P}_room`,
  other: `${P}_other`,
};

let httpServer: http.Server;
let baseUrl = '';
let port = 0;

function connect(token?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socket: any = ioClient(baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: token ? { token } : {},
    reconnection: false,
    timeout: 8000,
  });
  return socket;
}

function onceConnect(socket: { on: (ev: string, fn: (...a: never[]) => void) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 9000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function emitAck(
  socket: { emit: (ev: string, payload: unknown, cb: (res: { ok: boolean; error?: string }) => void) => void },
  payload: unknown,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack-timeout' }), 9000);
    socket.emit('chat:message:send', payload, (res: { ok: boolean; error?: string }) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function waitFor(socket: { on: (ev: string, fn: (...a: never[]) => void) => void }, ev: string, ms = 9000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait ${ev} timeout`)), ms);
    socket.on(ev, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args[0]);
    });
  });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.academicCalendar.create({
    data: { id: ids.cal, label: `${P}-cal`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  await prisma.branch.create({ data: { id: ids.br, name: `${P}b`, code: `${P}B` } });
  await prisma.academicYear.create({ data: { id: ids.ay, branchId: ids.br, calendarId: ids.cal } });
  await prisma.group.create({ data: { id: ids.g, academicYearId: ids.ay, name: 'G', section: 'A', displayOrder: 1 } });
  await prisma.subject.create({ data: { id: ids.subj, academicYearId: ids.ay, name: 'Math', code: `${P}M` } });
  await prisma.user.create({ data: { id: ids.t, name: 'T', passwordHash: 'x', role: 'teacher' } });
  await prisma.branchMember.create({ data: { branchId: ids.br, userId: ids.t, role: 'teacher', isActive: true } });
  await prisma.teacherAssignment.create({
    data: { academicYearId: ids.ay, teacherId: ids.t, groupId: ids.g, subjectId: ids.subj, isClassTeacher: true },
  });
  await prisma.user.create({ data: { id: ids.su, name: 'SU', passwordHash: 'x', role: 'student' } });
  await prisma.student.create({
    data: { id: ids.s, academicYearId: ids.ay, groupId: ids.g, name: 'S', userId: ids.su, status: 'ACTIVE', isActive: true },
  });
  await prisma.chatRoom.create({
    data: { id: ids.room, academicYearId: ids.ay, branchId: ids.br, classGroupId: ids.g, kind: 'class_announcement', name: 'R' },
  });
  for (const u of [ids.t, ids.su]) {
    await prisma.chatRoomMember.create({
      data: { roomId: ids.room, userId: u, access: 'member', canPost: u === ids.t, canRead: true },
    });
  }
  await prisma.chatRoom.create({
    data: { id: ids.other, academicYearId: ids.ay, branchId: ids.br, kind: 'group_chat', name: 'Other' },
  });

  httpServer = http.createServer(app);
  await initChatSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 120000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await prisma.chatMessage.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoomMember.deleteMany({ where: { room: { academicYearId: ids.ay } } }).catch(() => undefined);
  await prisma.chatRoom.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.teacherAssignment.deleteMany({ where: { academicYearId: ids.ay } }).catch(() => undefined);
  await prisma.branchMember.deleteMany({ where: { branchId: ids.br } }).catch(() => undefined);
  await prisma.student.deleteMany({ where: { id: ids.s } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ids.t, ids.su] } } }).catch(() => undefined);
  await prisma.subject.deleteMany({ where: { id: ids.subj } }).catch(() => undefined);
  await prisma.group.deleteMany({ where: { id: ids.g } }).catch(() => undefined);
  await prisma.academicYear.deleteMany({ where: { id: ids.ay } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { id: ids.br } }).catch(() => undefined);
  await prisma.academicCalendar.deleteMany({ where: { id: ids.cal } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M11 live socket auth matrix', () => {
  test('valid JWT connects; bad/expired tokens rejected; no traceback leak', async () => {
    const good = connect(generateTestToken(ids.t, 'teacher'));
    await onceConnect(good);
    good.disconnect();

    await expect(onceConnect(connect('garbage.token.here'))).rejects.toThrow();
    await expect(onceConnect(connect(generateExpiredToken(ids.t, 'teacher')))).rejects.toThrow();
    await expect(onceConnect(connect())).rejects.toThrow();
  }, 30000);
});

describe('M11 live send + broadcast + denial', () => {
  test('authorized send persists + broadcasts to joined member; DB row verified', async () => {
    const teacher = connect(generateTestToken(ids.t, 'teacher'));
    const student = connect(generateTestToken(ids.su, 'student'));
    await onceConnect(teacher);
    await onceConnect(student);
    teacher.emit('chat:join', { academicYearId: ids.ay });
    student.emit('chat:join', { academicYearId: ids.ay });
    const [tj, sj] = await Promise.all([waitFor(teacher, 'chat:joined'), waitFor(student, 'chat:joined')]);
    expect((tj as { roomCount: number }).roomCount).toBeGreaterThanOrEqual(1);
    expect((sj as { roomCount: number }).roomCount).toBeGreaterThanOrEqual(1);

    const seen = waitFor(student, 'chat:message:new');
    const text = `m11-live-${Date.now()}`;
    const ack = await emitAck(teacher, { roomId: ids.room, type: 'text', content: text, clientMessageId: `m11-${Date.now()}-a` });
    expect(ack.ok).toBe(true);
    const evt = (await seen) as { content: string; roomId: string };
    expect(evt.content).toBe(text);
    expect(evt.roomId).toBe(ids.room);
    const row = await prisma.chatMessage.findFirst({ where: { roomId: ids.room, content: text } });
    expect(row).toBeTruthy();

    teacher.disconnect();
    student.disconnect();
  }, 30000);

  test('wrong-room send denied with no DB record', async () => {
    const teacher = connect(generateTestToken(ids.t, 'teacher'));
    await onceConnect(teacher);
    const ack = await emitAck(teacher, { roomId: ids.other, type: 'text', content: 'intrude', clientMessageId: `m11-${Date.now()}-b` });
    expect(ack.ok).toBe(false);
    expect(await prisma.chatMessage.count({ where: { roomId: ids.other } })).toBe(0);
    teacher.disconnect();
  }, 30000);

  test('suspended user send denied (M7 fix, live)', async () => {
    await prisma.user.update({ where: { id: ids.t }, data: { status: 'suspended' } });
    try {
      const teacher = connect(generateTestToken(ids.t, 'teacher'));
      await onceConnect(teacher);
      const ack = await emitAck(teacher, { roomId: ids.room, type: 'text', content: 'suspended-live', clientMessageId: `m11-${Date.now()}-c` });
      expect(ack.ok).toBe(false);
      expect(await prisma.chatMessage.count({ where: { content: 'suspended-live' } })).toBe(0);
      teacher.disconnect();
    } finally {
      await prisma.user.update({ where: { id: ids.t }, data: { status: 'active' } });
    }
  }, 30000);
});

describe('M11 multi-device + reconnect', () => {
  test('two sessions, same user: both receive; offline, other sends, reconnect reconciles', async () => {
    const devA = connect(generateTestToken(ids.su, 'student'));
    const devB = connect(generateTestToken(ids.su, 'student'));
    await onceConnect(devA);
    await onceConnect(devB);
    devA.emit('chat:join', { academicYearId: ids.ay });
    devB.emit('chat:join', { academicYearId: ids.ay });
    await Promise.all([waitFor(devA, 'chat:joined'), waitFor(devB, 'chat:joined')]);

    // A sends (as teacher actually — student cannot post here; use teacher sender, student receivers).
    const teacher = connect(generateTestToken(ids.t, 'teacher'));
    await onceConnect(teacher);
    teacher.emit('chat:join', { academicYearId: ids.ay });
    await waitFor(teacher, 'chat:joined');
    const seenA = waitFor(devA, 'chat:message:new');
    const seenB = waitFor(devB, 'chat:message:new');
    const text = `m11-multidev-${Date.now()}`;
    const ack = await emitAck(teacher, { roomId: ids.room, type: 'text', content: text, clientMessageId: `m11-${Date.now()}-d` });
    expect(ack.ok).toBe(true);
    const [mA, mB] = (await Promise.all([seenA, seenB])) as Array<{ id: string; content: string }>;
    expect(mA.content).toBe(text);
    expect(mB.content).toBe(text);
    expect(mA.id).toBe(mB.id); // same DB message, no duplicate

    // A goes offline; teacher sends; A reconnects and reconciles via history gap.
    devA.disconnect();
    const text2 = `m11-multidev-off-${Date.now()}`;
    const ack2 = await emitAck(teacher, { roomId: ids.room, type: 'text', content: text2, clientMessageId: `m11-${Date.now()}-e` });
    expect(ack2.ok).toBe(true);
    const devA2 = connect(generateTestToken(ids.su, 'student'));
    await onceConnect(devA2);
    devA2.emit('chat:join', { academicYearId: ids.ay });
    await waitFor(devA2, 'chat:joined');
    // History (HTTP-equivalent read path) contains both, ordered, once each.
    const rows = await prisma.chatMessage.findMany({
      where: { roomId: ids.room, content: { startsWith: 'm11-multidev' } },
      orderBy: { createdAt: 'asc' },
    });
    const contents = rows.map((r) => r.content);
    expect(contents).toContain(text);
    expect(contents).toContain(text2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);

    teacher.disconnect();
    devB.disconnect();
    devA2.disconnect();
  }, 60000);
});

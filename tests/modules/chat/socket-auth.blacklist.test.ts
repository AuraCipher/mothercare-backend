/**
 * 12D ISSUE 3 — Socket.IO JWT Blacklist Check
 *
 * Validates that Socket.IO authentication checks the JWT blacklist
 * before accepting a connection, matching HTTP auth middleware behavior.
 *
 * Tests:
 *  1. Valid token accepted
 *  2. Invalid token rejected
 *  3. Expired token rejected
 *  4. Blacklisted token rejected
 *  5. Blacklist service failure follows fail-closed behavior
 */

/* ─── Mocks (must be before imports) ──────────────────────── */

jest.mock('../../../src/config/redis-tcp', () => ({
  getRedisConnectionConfig: jest.fn().mockReturnValue(null),
}));

jest.mock('../../../src/modules/chat/push/fcm.service', () => ({
  sendEncryptedPushToUsers: jest.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));

jest.mock('../../../src/modules/chat/services/chat-message.service', () => ({
  createRoomMessage: jest.fn(),
  markRoomRead: jest.fn(),
  listOfflineRecipientUserIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/modules/chat/services/chat-room-access.service', () => ({
  ensureChatRoomAccess: jest.fn(),
}));

jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  assertRoomMember: jest.fn(),
  listUserRoomIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/queues/chat.queue', () => ({
  CHAT_QUEUE_NAME: 'chat',
  CHAT_PUSH_FANOUT_JOB: 'chat_push_fanout',
  enqueueChatPushFanout: jest.fn().mockResolvedValue(null),
  isChatQueueEnabled: jest.fn().mockReturnValue(false),
  getChatQueue: jest.fn().mockReturnValue(null),
  closeChatQueue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/lib/prisma', () => ({
  prisma: {},
}));

const mockVerifyToken = jest.fn();
const mockIsBlacklisted = jest.fn();

jest.mock('../../../src/lib/jwt', () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  isBlacklisted: (...args: any[]) => mockIsBlacklisted(...args),
}));

jest.mock('../../../src/config/env', () => ({
  default: {
    SOCKET_PATH: '/socket.io',
    APP_MODE: 'test',
    CHAT_QUEUE_CONCURRENCY: '5',
    MESSAGE_QUEUE_CONCURRENCY: '3',
  },
}));

/* ─── Imports after mocks ─────────────────────────────────── */

import { createServer, type Server as HttpServer } from 'http';
import { io as SocketIOClient, type Socket as ClientSocket } from 'socket.io-client';
import { initChatSocket, closeChatSocket } from '../../../src/modules/chat/socket/chat.socket';

/* ─── Helpers ─────────────────────────────────────────────── */

function createTestServer(): HttpServer {
  const server = createServer();
  server.listen(0);
  return server;
}

function getPort(server: HttpServer): number {
  return (server.address() as any).port;
}

function connectClient(server: HttpServer, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const port = getPort(server);
    const opts: any = { reconnection: false, forceNew: true };
    if (token) opts.auth = { token };
    const client = SocketIOClient(`http://localhost:${port}`, opts);
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('connection timeout'));
    }, 3000);

    client.on('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });
    client.on('connect_error', (err: any) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });
  });
}

function connectExpectError(server: HttpServer, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const port = getPort(server);
    const opts: any = { reconnection: false, forceNew: true };
    if (token) opts.auth = { token };
    const client = SocketIOClient(`http://localhost:${port}`, opts);
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('should have failed'));
    }, 3000);

    client.on('connect', () => {
      clearTimeout(timeout);
      client.close();
      reject(new Error('should not have connected'));
    });
    client.on('connect_error', (err: any) => {
      clearTimeout(timeout);
      client.close();
      resolve(err);
    });
  });
}

/* ─── Tests ───────────────────────────────────────────────── */

describe('12D ISSUE 3 — Socket.IO JWT blacklist check', () => {
  afterEach(async () => {
    await closeChatSocket();
  });

  test('valid token accepted', async () => {
    const server = createTestServer();
    try {
      mockVerifyToken.mockReturnValue({ id: 'u1', role: 'management', name: 'Test' });
      mockIsBlacklisted.mockResolvedValue(false);

      await initChatSocket(server);
      const client = await connectClient(server, 'valid-token-abc123');
      expect(client.connected).toBe(true);
      client.close();

      expect(mockVerifyToken).toHaveBeenCalledWith('valid-token-abc123');
      expect(mockIsBlacklisted).toHaveBeenCalledWith('valid-token-abc123');
    } finally {
      server.close();
    }
  });

  test('invalid token rejected', async () => {
    const server = createTestServer();
    try {
      mockIsBlacklisted.mockResolvedValue(false);
      mockVerifyToken.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await initChatSocket(server);
      const err = await connectExpectError(server, 'bad-token');
      expect(err).toBeDefined();
      // Blacklist checked first (matches HTTP middleware convention)
      expect(mockIsBlacklisted).toHaveBeenCalledWith('bad-token');
      expect(mockVerifyToken).toHaveBeenCalledWith('bad-token');
    } finally {
      server.close();
    }
  });

  test('expired token rejected', async () => {
    const server = createTestServer();
    try {
      const expiredErr = new Error('jwt expired');
      (expiredErr as any).name = 'TokenExpiredError';
      mockIsBlacklisted.mockResolvedValue(false);
      mockVerifyToken.mockImplementation(() => {
        throw expiredErr;
      });

      await initChatSocket(server);
      const err = await connectExpectError(server, 'expired-token');
      expect(err).toBeDefined();
      // Blacklist checked first (matches HTTP middleware convention)
      expect(mockIsBlacklisted).toHaveBeenCalledWith('expired-token');
      expect(mockVerifyToken).toHaveBeenCalledWith('expired-token');
    } finally {
      server.close();
    }
  });

  test('blacklisted token rejected', async () => {
    const server = createTestServer();
    try {
      mockVerifyToken.mockReturnValue({ id: 'u1', role: 'management', name: 'Test' });
      mockIsBlacklisted.mockResolvedValue(true);

      await initChatSocket(server);
      const err = await connectExpectError(server, 'revoked-token');
      expect(err).toBeDefined();
      // verifyToken should NOT be called if blacklist check fails first
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockIsBlacklisted).toHaveBeenCalledWith('revoked-token');
    } finally {
      server.close();
    }
  });

  test('blacklist service failure rejects connection (fail-closed)', async () => {
    const server = createTestServer();
    try {
      mockIsBlacklisted.mockRejectedValue(new Error('Redis connection refused'));
      mockVerifyToken.mockReturnValue({ id: 'u1', role: 'management', name: 'Test' });

      await initChatSocket(server);
      const err = await connectExpectError(server, 'any-token');
      expect(err).toBeDefined();
      // Fail-closed: error from isBlacklisted causes rejection
      expect(mockIsBlacklisted).toHaveBeenCalledWith('any-token');
      expect(mockVerifyToken).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  test('no token rejected', async () => {
    const server = createTestServer();
    try {
      await initChatSocket(server);
      const err = await connectExpectError(server, undefined);
      expect(err).toBeDefined();
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockIsBlacklisted).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  test('blacklist check happens before token verification', async () => {
    const server = createTestServer();
    try {
      const order: string[] = [];
      mockIsBlacklisted.mockImplementation(async () => {
        order.push('blacklist');
        return false;
      });
      mockVerifyToken.mockImplementation(() => {
        order.push('verify');
        return { id: 'u1', role: 'management', name: 'Test' };
      });

      await initChatSocket(server);
      const client = await connectClient(server, 'order-test-token');
      expect(order).toEqual(['blacklist', 'verify']);
      client.close();
    } finally {
      server.close();
    }
  });
});

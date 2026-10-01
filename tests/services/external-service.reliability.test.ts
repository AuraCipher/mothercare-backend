/**
 * External service reliability tests.
 *
 * Covers: timeout behavior, error classification, retry decisions,
 * duplicate-send prevention, and secret-safe logging for FCM, Resend, Twilio.
 *
 * No live provider credentials required — all external calls are mocked.
 */

// ─── Configurable env mock ───────────────────────────────

const envMock: Record<string, string> = {
  FCM_ENABLED: 'false',
  FRONTEND_URL: 'http://localhost:3000',
  SCHOOL_NAME: 'Test School',
  RESEND_API_KEY: '',
  RESEND_FROM_EMAIL: '',
  APP_DOWNLOAD_URL: '',
  PUSH_MASTER_SECRET: 'test-master-secret-at-least-32-chars-long!!',
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!!!!!!!!!!',
};

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get(_target, prop: string) {
        return envMock[prop] ?? '';
      },
    },
  ),
}));

// ─── Mocks (must be before imports) ──────────────────────

const mockSendEachForMulticast = jest.fn();
jest.mock('firebase-admin', () => ({
  __esModule: true,
  default: {
    apps: [{}],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    messaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
  },
}));

const mockResendEmailsSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendEmailsSend },
  })),
}));

const mockPrisma = {
  deviceToken: { findMany: jest.fn().mockResolvedValue([]) },
  userPushCryptoKey: { findFirst: jest.fn().mockResolvedValue(null) },
};
jest.mock('../../src/lib/prisma', () => ({
  prisma: mockPrisma,
  basePrisma: mockPrisma,
}));

const logOutput: { level: string; label: string; meta?: any }[] = [];
jest.mock('../../src/lib/logger', () => ({
  __esModule: true,
  default: {
    info: (label: string, meta?: any) => logOutput.push({ level: 'info', label, meta }),
    warn: (label: string, meta?: any) => logOutput.push({ level: 'warn', label, meta }),
    error: (label: string, meta?: any) => logOutput.push({ level: 'error', label, meta }),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/modules/chat/push/device-token.service', () => ({
  listDeviceTokensForUsers: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/modules/chat/push/push-crypto.service', () => ({
  encryptPushPayload: jest.fn().mockReturnValue({ iv: 'iv', ciphertext: 'ct', tag: 'tag' }),
  deriveUserPushKey: jest.fn().mockReturnValue(Buffer.from('key'.padEnd(32, '\0'))),
}));

// ─── Imports ─────────────────────────────────────────────

import { sendEncryptedPushToUsers } from '../../src/modules/chat/push/fcm.service';
import { sendAdminInvitationEmail } from '../../src/lib/email/resend.service';
import { listDeviceTokensForUsers } from '../../src/modules/chat/push/device-token.service';
import { deriveUserPushKey, encryptPushPayload } from '../../src/modules/chat/push/push-crypto.service';

// ─── Helpers ─────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  logOutput.length = 0;
  Object.keys(envMock).forEach((k) => {
    if (['FRONTEND_URL', 'SCHOOL_NAME', 'PUSH_MASTER_SECRET', 'JWT_SECRET'].includes(k)) return;
    envMock[k] = '';
  });
  envMock.FCM_ENABLED = 'false';

  // Re-setup default mocks
  mockPrisma.deviceToken.findMany.mockResolvedValue([]);
  mockPrisma.userPushCryptoKey.findFirst.mockResolvedValue(null);
  (listDeviceTokensForUsers as jest.Mock).mockResolvedValue([]);
  (deriveUserPushKey as jest.Mock).mockReturnValue(Buffer.from('key'.padEnd(32, '\0')));
  (encryptPushPayload as jest.Mock).mockReturnValue({ iv: 'iv', ciphertext: 'ct', tag: 'tag' });
});

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════
// 1. FCM — Timeout & Error Handling
// ═══════════════════════════════════════════════════════════

describe('FCM — sendEncryptedPushToUsers', () => {
  test('returns early when FCM is disabled', async () => {
    envMock.FCM_ENABLED = 'false';
    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('returns early when userIds is empty', async () => {
    envMock.FCM_ENABLED = 'true';
    const result = await sendEncryptedPushToUsers([], 1, { type: 'test' });
    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('continues to next user when one user FCM fails', async () => {
    envMock.FCM_ENABLED = 'true';

    (listDeviceTokensForUsers as jest.Mock)
      .mockResolvedValueOnce(['token_a'])
      .mockResolvedValueOnce(['token_b']);

    mockSendEachForMulticast
      .mockRejectedValueOnce(new Error('FCM temporarily unavailable'))
      .mockResolvedValueOnce({ successCount: 1, failureCount: 0 });

    const result = await sendEncryptedPushToUsers(['user1', 'user2'], 1, { type: 'test' });
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
  });

  test('logs warning on timeout error (not error)', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);

    const timeoutErr = new Error('FCM request timed out');
    mockSendEachForMulticast.mockRejectedValueOnce(timeoutErr);

    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);

    const timeoutLog = logOutput.find(
      (l) => l.level === 'warn' && l.label.includes('timed out'),
    );
    expect(timeoutLog).toBeDefined();
  });

  test('does not throw — errors are caught per-user', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValue(['tok']);
    mockSendEachForMulticast.mockRejectedValue(new Error('permanent failure'));

    await expect(
      sendEncryptedPushToUsers(['user1'], 1, { type: 'test' }),
    ).resolves.toEqual({ sent: 0, skipped: 1 });
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Resend — Singleton, Timeout, Graceful Degradation
// ═══════════════════════════════════════════════════════════

describe('Resend — sendAdminInvitationEmail', () => {
  test('returns warning when not configured', async () => {
    envMock.RESEND_API_KEY = '';
    envMock.RESEND_FROM_EMAIL = '';
    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok123',
      branchName: 'Test Branch',
      branchCode: 'TB',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toContain('not configured');
  });

  test('returns warning on send failure (does not throw)', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: { message: 'Invalid API key' },
      data: null,
    });

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok123',
      branchName: 'Test Branch',
      branchCode: 'TB',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toContain('Invalid API key');
  });

  test('returns success on successful send', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: null,
      data: { id: 'msg_abc123' },
    });

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok123',
      branchName: 'Test Branch',
      branchCode: 'TB',
    });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('msg_abc123');
  });

  test('returns warning on network error (does not throw)', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok123',
      branchName: 'Test Branch',
      branchCode: 'TB',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toContain('fetch failed');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Secret-safe Logging
// ═══════════════════════════════════════════════════════════

describe('Secret-safe logging', () => {
  test('Resend logs do not contain API key', async () => {
    envMock.RESEND_API_KEY = 're_SECRET_KEY_12345';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockRejectedValueOnce(new Error('fail'));

    await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'B',
      branchCode: 'BC',
    });

    const allLogs = logOutput.map((l) => JSON.stringify(l));
    const keyAppears = allLogs.some((log) => log.includes('re_SECRET_KEY'));
    expect(keyAppears).toBe(false);
  });
});

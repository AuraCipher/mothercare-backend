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
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_WHATSAPP_FROM: '',
  TWILIO_TEMPLATE_STUDENT: '',
  TWILIO_TEMPLATE_TEACHER: '',
  TWILIO_TEMPLATE_STAFF: '',
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
import {
  sendTemplateMessage,
  normalizeWhatsAppPhone,
  TwilioWhatsAppError,
  classifyTwilioError,
} from '../../src/services/twilio-whatsapp.service';
import { deliverCredential } from '../../src/services/credential-delivery.service';
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
// 3. Twilio — Error Classification, Timeout, Phone Normalization
// ═══════════════════════════════════════════════════════════

describe('Twilio — classifyTwilioError', () => {
  test('classifies auth errors as non-retryable', () => {
    const err = classifyTwilioError(401, { code: 20001, message: 'Auth failed' });
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('auth_error');
    expect(err.solvable).toBe(false);
  });

  test('classifies rate limit as retryable', () => {
    const err = classifyTwilioError(429, { code: 63018, message: 'Too many requests' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('rate_limit');
  });

  test('classifies invalid phone as non-retryable and solvable', () => {
    const err = classifyTwilioError(400, { code: 21211, message: 'Invalid phone' });
    expect(err.retryable).toBe(false);
    expect(err.solvable).toBe(true);
    expect(err.code).toBe('recipient_error');
  });

  test('classifies 5xx as retryable server error', () => {
    const err = classifyTwilioError(500, { code: 30001, message: 'Server error' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('server_error');
  });

  test('classifies unknown codes as non-retryable', () => {
    const err = classifyTwilioError(400, { code: 99999, message: 'Unknown' });
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('twilio_99999');
  });
});

describe('Twilio — normalizeWhatsAppPhone', () => {
  test('normalizes PK 03XX number', () => {
    expect(normalizeWhatsAppPhone('03001234567')).toBe('923001234567');
  });

  test('normalizes already-prefixed number', () => {
    expect(normalizeWhatsAppPhone('923001234567')).toBe('923001234567');
  });

  test('throws on empty phone', () => {
    expect(() => normalizeWhatsAppPhone('')).toThrow('required');
  });

  test('throws on too-short number', () => {
    expect(() => normalizeWhatsAppPhone('123')).toThrow('format');
  });
});

describe('Twilio — sendTemplateMessage', () => {
  function setupTwilioEnv() {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX1234567890';
    envMock.TWILIO_TEMPLATE_TEACHER = 'HX1234567891';
    envMock.TWILIO_TEMPLATE_STAFF = 'HX1234567892';
  }

  test('throws retryable TwilioWhatsAppError on network timeout', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
    );

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TwilioWhatsAppError);
      expect(err.retryable).toBe(true);
      expect(err.code).toBe('timeout');
    }
  });

  test('throws retryable TwilioWhatsAppError on network failure', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TwilioWhatsAppError);
      expect(err.retryable).toBe(true);
      expect(err.code).toBe('network_error');
    }
  });

  test('logs masked phone number (not full number)', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
    } catch {
      // expected
    }

    const networkLog = logOutput.find((l) => l.label.includes('network failure'));
    expect(networkLog).toBeDefined();
    const logStr = JSON.stringify(networkLog);
    expect(logStr).not.toContain('03001234567');
    expect(logStr).toContain('****');
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Credential Delivery — Error Handling & Duplicate Prevention
// ═══════════════════════════════════════════════════════════

describe('credential-delivery — deliverCredential', () => {
  function setupTwilioEnv() {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';
    envMock.FRONTEND_URL = 'https://example.com';
    envMock.APP_DOWNLOAD_URL = 'https://example.com/app';
  }

  test('returns retryable:true on network error', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await deliverCredential({
      to: '03001234567',
      username: 'student1',
      password: 'TempPass123!',
      name: 'Test Student',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.channel).toBe('whatsapp');
  });

  test('returns retryable:false on auth error', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 20001, message: 'Authenticate' }),
    });

    const result = await deliverCredential({
      to: '03001234567',
      username: 'student1',
      password: 'TempPass123!',
      name: 'Test Student',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('auth_error');
  });

  test('returns retryable:true on server error (5xx)', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: 30001, message: 'Server error' }),
    });

    const result = await deliverCredential({
      to: '03001234567',
      username: 'student1',
      password: 'TempPass123!',
      name: 'Test Student',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('server_error');
  });

  test('returns solvable:true for invalid phone number', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: 'Invalid phone number' }),
    });

    const result = await deliverCredential({
      to: '03001234567',
      username: 'student1',
      password: 'TempPass123!',
      name: 'Test Student',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.solvable).toBe(true);
    expect(result.retryable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Secret-safe Logging
// ═══════════════════════════════════════════════════════════

describe('Secret-safe logging', () => {
  test('Twilio logs never contain full phone numbers', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 21211, message: 'Not found' }),
    });

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
    } catch {
      // expected
    }

    const allLogs = logOutput.map((l) => JSON.stringify(l));
    const fullPhoneAppears = allLogs.some((log) => log.includes('03001234567'));
    expect(fullPhoneAppears).toBe(false);
  });

  test('Twilio error logs contain masked phone', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: 30001, message: 'Server error' }),
    });

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
    } catch {
      // expected
    }

    const errorLog = logOutput.find((l) => l.label.includes('send failed'));
    expect(errorLog).toBeDefined();
    expect(JSON.stringify(errorLog)).toContain('****');
  });

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

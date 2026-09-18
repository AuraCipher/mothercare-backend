/**
 * R2-12c — FCM Adapter Boundary Tests
 *
 * Validates the FCM boundary without credentials:
 *  - Configuration validation (FCM_ENABLED, service account presence)
 *  - Timeout/failure classification
 *  - Malformed provider responses handled safely
 *  - Application does not crash when provider is unavailable
 *  - Error isolation per user
 */

// ─── Fake service account for initFirebase ─────────────────
const FAKE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'key-id',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB\n-----END RSA PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
});

// ─── Env mock ──────────────────────────────────────────────
const envMock: Record<string, string> = {
  FCM_ENABLED: 'false',
  PUSH_MASTER_SECRET: 'test-master-secret-at-least-32-chars-long!!',
  FIREBASE_SERVICE_ACCOUNT_PATH: '',
  FIREBASE_SERVICE_ACCOUNT_JSON: FAKE_SERVICE_ACCOUNT,
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!!!!!!!!',
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

// ─── Mocks ─────────────────────────────────────────────────
const mockSendEachForMulticast = jest.fn();
jest.mock('firebase-admin', () => ({
  __esModule: true,
  default: {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    messaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
  },
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

// ─── Imports ───────────────────────────────────────────────
import { sendEncryptedPushToUsers, isFcmEnabled } from '../../src/modules/chat/push/fcm.service';
import { listDeviceTokensForUsers } from '../../src/modules/chat/push/device-token.service';
import { deriveUserPushKey, encryptPushPayload } from '../../src/modules/chat/push/push-crypto.service';

beforeEach(() => {
  jest.clearAllMocks();
  logOutput.length = 0;
  envMock.FCM_ENABLED = 'false';
  envMock.FIREBASE_SERVICE_ACCOUNT_PATH = '';
  envMock.FIREBASE_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT;
  mockPrisma.deviceToken.findMany.mockResolvedValue([]);
  mockPrisma.userPushCryptoKey.findFirst.mockResolvedValue(null);
  (listDeviceTokensForUsers as jest.Mock).mockResolvedValue([]);
  (deriveUserPushKey as jest.Mock).mockReturnValue(Buffer.from('key'.padEnd(32, '\0')));
  (encryptPushPayload as jest.Mock).mockReturnValue({ iv: 'iv', ciphertext: 'ct', tag: 'tag' });
});

// ─── Configuration validation ──────────────────────────────

describe('R2-12c — FCM configuration validation', () => {
  test('isFcmEnabled returns false when FCM_ENABLED is "false"', async () => {
    envMock.FCM_ENABLED = 'false';
    expect(isFcmEnabled()).toBe(false);
  });

  test('isFcmEnabled returns false when FCM_ENABLED is "" (unset)', async () => {
    envMock.FCM_ENABLED = '';
    expect(isFcmEnabled()).toBe(false);
  });

  test('isFcmEnabled returns false when enabled but no service account', async () => {
    envMock.FCM_ENABLED = 'true';
    envMock.FIREBASE_SERVICE_ACCOUNT_PATH = '';
    envMock.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    // initFirebase will warn and return false
    const result = isFcmEnabled();
    expect(result).toBe(false);
  });

  test('sendEncryptedPushToUsers returns early with skipped count when FCM disabled', async () => {
    envMock.FCM_ENABLED = 'false';
    const result = await sendEncryptedPushToUsers(['user1', 'user2'], 1, { type: 'test' });
    expect(result).toEqual({ sent: 0, skipped: 2 });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('sendEncryptedPushToUsers returns skipped:0 when empty userIds and FCM disabled', async () => {
    envMock.FCM_ENABLED = 'false';
    const result = await sendEncryptedPushToUsers([], 1, { type: 'test' });
    expect(result).toEqual({ sent: 0, skipped: 0 });
  });
});

// ─── Timeout / failure classification ──────────────────────

describe('R2-12c — FCM timeout and failure handling', () => {
  test('FCM source defines FCM_SEND_TIMEOUT_MS = 30_000', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/chat/push/fcm.service.ts'),
      'utf8',
    );
    expect(src).toContain('FCM_SEND_TIMEOUT_MS = 30_000');
  });

  test('timeout error is classified as warning (not error)', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);
    mockSendEachForMulticast.mockRejectedValueOnce(new Error('FCM request timed out'));

    await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });

    const timeoutLog = logOutput.find(
      (l) => l.level === 'warn' && l.label.includes('timed out'),
    );
    expect(timeoutLog).toBeDefined();
  });

  test('non-timeout error is classified as error', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);
    mockSendEachForMulticast.mockRejectedValueOnce(new Error('Permission denied'));

    await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });

    const errorLog = logOutput.find(
      (l) => l.level === 'error' && l.label.includes('FCM send failed'),
    );
    expect(errorLog).toBeDefined();
  });

  test('TimeoutError name is classified as timeout', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);

    const timeoutErr = new Error('FCM request timed out');
    timeoutErr.name = 'TimeoutError';
    mockSendEachForMulticast.mockRejectedValueOnce(timeoutErr);

    await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });

    const timeoutLog = logOutput.find(
      (l) => l.level === 'warn' && l.label.includes('timed out'),
    );
    expect(timeoutLog).toBeDefined();
  });
});

// ─── Malformed provider responses ──────────────────────────

describe('R2-12c — FCM malformed response handling', () => {
  test('handles successCount=0 and failureCount=1 without crash', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: 'messaging/invalid-registration-token' } }],
    });

    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('handles empty response object without crash', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);
    mockSendEachForMulticast.mockResolvedValueOnce({});

    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    // successCount defaults to 0 when missing
    expect(result.sent).toBe(0);
  });

  test('handles null response without crash', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce(['tok']);
    mockSendEachForMulticast.mockResolvedValueOnce(null);

    // Should not throw
    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    expect(result).toBeDefined();
  });
});

// ─── Crash safety ──────────────────────────────────────────

describe('R2-12c — FCM crash safety', () => {
  test('never throws — errors are caught per-user', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValue(['tok']);
    mockSendEachForMulticast.mockRejectedValue(new Error('permanent failure'));

    await expect(
      sendEncryptedPushToUsers(['user1'], 1, { type: 'test' }),
    ).resolves.toEqual({ sent: 0, skipped: 1 });
  });

  test('continues to next user after first user fails', async () => {
    envMock.FCM_ENABLED = 'true';

    let callCount = 0;
    (listDeviceTokensForUsers as jest.Mock).mockImplementation(async (ids: string[]) => {
      callCount++;
      if (callCount === 1) return ['token_a'];
      return ['token_b'];
    });

    mockSendEachForMulticast
      .mockRejectedValueOnce(new Error('FCM unavailable'))
      .mockResolvedValueOnce({ successCount: 1, failureCount: 0 });

    const result = await sendEncryptedPushToUsers(['user1', 'user2'], 1, { type: 'test' });
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
  });

  test('handles user with no device tokens gracefully', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValueOnce([]);

    const result = await sendEncryptedPushToUsers(['user1'], 1, { type: 'test' });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('handles multiple users all failing gracefully', async () => {
    envMock.FCM_ENABLED = 'true';
    (listDeviceTokensForUsers as jest.Mock).mockResolvedValue(['tok']);
    mockSendEachForMulticast.mockRejectedValue(new Error('fail'));

    const result = await sendEncryptedPushToUsers(['u1', 'u2', 'u3'], 1, { type: 'test' });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(3);
  });
});

// ─── Source code structure ─────────────────────────────────

describe('R2-12c — FCM source structure', () => {
  test('FCM uses Promise.race for timeout enforcement', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/chat/push/fcm.service.ts'),
      'utf8',
    );
    expect(src).toContain('Promise.race');
    expect(src).toContain('setTimeout');
  });

  test('FCM sends encrypted payload (data-only, no notification)', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/chat/push/fcm.service.ts'),
      'utf8',
    );
    // data-only message (no notification key)
    expect(src).toContain('data:');
    expect(src).toContain('iv:');
    expect(src).toContain('ciphertext');
    expect(src).toContain('AES-256-GCM');
  });

  test('FCM sets high priority for Android and APNs', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/chat/push/fcm.service.ts'),
      'utf8',
    );
    expect(src).toContain("priority: 'high'");
    expect(src).toContain("'apns-priority': '10'");
    expect(src).toContain('contentAvailable: true');
  });
});

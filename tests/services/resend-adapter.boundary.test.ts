/**
 * R2-12c — Resend Adapter Boundary Tests
 *
 * Validates the Resend email boundary without credentials:
 *  - Client reuse / singleton behavior
 *  - Configuration validation (missing API key, missing from email)
 *  - Timeout/error classification
 *  - Provider failure does not crash request handling
 *  - No secrets appear in logs
 */

// ─── Env mock ──────────────────────────────────────────────
const envMock: Record<string, string> = {
  RESEND_API_KEY: '',
  RESEND_FROM_EMAIL: '',
  FRONTEND_URL: 'http://localhost:3000',
  SCHOOL_NAME: 'Test School',
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
const mockResendEmailsSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendEmailsSend },
  })),
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

// ─── Imports ───────────────────────────────────────────────
import { sendAdminInvitationEmail, isEmailDeliveryConfigured } from '../../src/lib/email/resend.service';
import { Resend } from 'resend';

beforeEach(() => {
  jest.clearAllMocks();
  logOutput.length = 0;
  envMock.RESEND_API_KEY = '';
  envMock.RESEND_FROM_EMAIL = '';
});

// ─── Configuration validation ──────────────────────────────

describe('R2-12c — Resend configuration validation', () => {
  test('isEmailDeliveryConfigured returns false when API key is empty', () => {
    envMock.RESEND_API_KEY = '';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';
    expect(isEmailDeliveryConfigured()).toBe(false);
  });

  test('isEmailDeliveryConfigured returns false when from email is empty', () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = '';
    expect(isEmailDeliveryConfigured()).toBe(false);
  });

  test('isEmailDeliveryConfigured returns false when both are empty', () => {
    envMock.RESEND_API_KEY = '';
    envMock.RESEND_FROM_EMAIL = '';
    expect(isEmailDeliveryConfigured()).toBe(false);
  });

  test('isEmailDeliveryConfigured returns true when both are set', () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';
    expect(isEmailDeliveryConfigured()).toBe(true);
  });

  test('isEmailDeliveryConfigured returns false when API key is whitespace only', () => {
    envMock.RESEND_API_KEY = '   ';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';
    expect(isEmailDeliveryConfigured()).toBe(false);
  });

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
});

// ─── Client reuse / singleton ──────────────────────────────

describe('R2-12c — Resend singleton client', () => {
  test('Resend constructor is called only once across multiple sends', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend
      .mockResolvedValueOnce({ error: null, data: { id: 'msg_1' } })
      .mockResolvedValueOnce({ error: null, data: { id: 'msg_2' } });

    await sendAdminInvitationEmail({
      to: 'admin1@test.com',
      token: 'tok1',
      branchName: 'Branch 1',
      branchCode: 'B1',
    });
    await sendAdminInvitationEmail({
      to: 'admin2@test.com',
      token: 'tok2',
      branchName: 'Branch 2',
      branchCode: 'B2',
    });

    // Resend constructor should be called once (singleton)
    expect(Resend).toHaveBeenCalledTimes(1);
    expect(mockResendEmailsSend).toHaveBeenCalledTimes(2);
  });

  test('returns warning when client cannot be initialized', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    // Make Resend constructor throw
    (Resend as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Invalid API key format');
    });

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toBeDefined();
  });
});

// ─── Timeout / error classification ────────────────────────

describe('R2-12c — Resend timeout and error handling', () => {
  test('Resend source defines RESEND_SEND_TIMEOUT_MS = 30_000', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/lib/email/resend.service.ts'),
      'utf8',
    );
    expect(src).toContain('RESEND_SEND_TIMEOUT_MS = 30_000');
  });

  test('uses AbortSignal.timeout for request timeout', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/lib/email/resend.service.ts'),
      'utf8',
    );
    expect(src).toContain('AbortSignal.timeout');
    expect(src).toContain('RESEND_SEND_TIMEOUT_MS');
  });

  test('returns warning on API error response (does not throw)', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: { message: 'Invalid API key' },
      data: null,
    });

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toContain('Invalid API key');
  });

  test('returns warning on network error (does not throw)', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toContain('fetch failed');
  });

  test('returns warning on abort/timeout error (does not throw)', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockResendEmailsSend.mockRejectedValueOnce(abortErr);

    const result = await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(false);
    expect(result.warning).toBeDefined();
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
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('msg_abc123');
  });
});

// ─── Crash safety ──────────────────────────────────────────

describe('R2-12c — Resend crash safety', () => {
  test('never throws — all errors return sent:false with warning', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    // Simulate various failure modes
    const failures = [
      new Error('network error'),
      new Error('timeout'),
      Object.assign(new Error('abort'), { name: 'AbortError' }),
      { message: 'API error' }, // non-Error throw
    ];

    for (const err of failures) {
      mockResendEmailsSend.mockRejectedValueOnce(err);
      const result = await sendAdminInvitationEmail({
        to: 'admin@test.com',
        token: 'tok',
        branchName: 'Branch',
        branchCode: 'BC',
      });
      expect(result.sent).toBe(false);
      expect(result.warning).toBeDefined();
    }
  });

  test('does not crash when called with invalid email format', async () => {
    envMock.RESEND_API_KEY = 're_test_key';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: { message: 'Invalid to email' },
      data: null,
    });

    const result = await sendAdminInvitationEmail({
      to: 'not-an-email',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });
    expect(result.sent).toBe(false);
  });
});

// ─── Secret-safe logging ───────────────────────────────────

describe('R2-12c — Resend secret-safe logging', () => {
  test('logs do not contain API key on success', async () => {
    envMock.RESEND_API_KEY = 're_SECRET_KEY_12345';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: null,
      data: { id: 'msg_123' },
    });

    await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });

    const allLogs = logOutput.map((l) => JSON.stringify(l));
    const keyAppears = allLogs.some((log) => log.includes('re_SECRET_KEY'));
    expect(keyAppears).toBe(false);
  });

  test('logs do not contain API key on failure', async () => {
    envMock.RESEND_API_KEY = 're_SECRET_KEY_12345';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockRejectedValueOnce(new Error('fail'));

    await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });

    const allLogs = logOutput.map((l) => JSON.stringify(l));
    const keyAppears = allLogs.some((log) => log.includes('re_SECRET_KEY'));
    expect(keyAppears).toBe(false);
  });

  test('success log contains messageId but not API key', async () => {
    envMock.RESEND_API_KEY = 're_SECRET_KEY_12345';
    envMock.RESEND_FROM_EMAIL = 'test@example.com';

    mockResendEmailsSend.mockResolvedValueOnce({
      error: null,
      data: { id: 'msg_abc123' },
    });

    await sendAdminInvitationEmail({
      to: 'admin@test.com',
      token: 'tok',
      branchName: 'Branch',
      branchCode: 'BC',
    });

    const infoLog = logOutput.find((l) => l.label.includes('sent'));
    expect(infoLog).toBeDefined();
    expect(infoLog!.meta).toHaveProperty('messageId', 'msg_abc123');
    expect(JSON.stringify(infoLog)).not.toContain('re_SECRET_KEY');
  });
});

// ─── Source structure ──────────────────────────────────────

describe('R2-12c — Resend source structure', () => {
  test('Resend client is a module-level singleton', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/lib/email/resend.service.ts'),
      'utf8',
    );
    expect(src).toContain('let resendClient: Resend | null = null');
    expect(src).toContain('function getResendClient()');
  });

  test('email sending uses resend.emails.send', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/lib/email/resend.service.ts'),
      'utf8',
    );
    expect(src).toContain('resend.emails.send');
  });
});

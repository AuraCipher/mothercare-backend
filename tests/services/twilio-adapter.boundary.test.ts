/**
 * R2-12c — Twilio Adapter Boundary Tests
 *
 * Validates the Twilio WhatsApp boundary without credentials:
 *  - Client configuration (missing SID, auth token, placeholder detection)
 *  - Timeout/failure classification
 *  - Provider errors are correctly classified
 *  - Phone number normalization edge cases
 *  - Template SID validation
 *  - BullMQ retry boundary (retryable flag propagation)
 */

// ─── Env mock ──────────────────────────────────────────────
const envMock: Record<string, string> = {
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_WHATSAPP_FROM: '',
  TWILIO_TEMPLATE_STUDENT: '',
  TWILIO_TEMPLATE_TEACHER: '',
  TWILIO_TEMPLATE_STAFF: '',
  FRONTEND_URL: 'https://example.com',
  APP_DOWNLOAD_URL: 'https://example.com/app',
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
import {
  sendTemplateMessage,
  normalizeWhatsAppPhone,
  classifyTwilioError,
  TwilioWhatsAppError,
  templateNameForRecipient,
  buildCredentialParameters,
} from '../../src/services/twilio-whatsapp.service';
import { deliverCredential } from '../../src/services/credential-delivery.service';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  logOutput.length = 0;
  envMock.TWILIO_ACCOUNT_SID = '';
  envMock.TWILIO_AUTH_TOKEN = '';
  envMock.TWILIO_WHATSAPP_FROM = '';
  envMock.TWILIO_TEMPLATE_STUDENT = '';
  envMock.TWILIO_TEMPLATE_TEACHER = '';
  envMock.TWILIO_TEMPLATE_STAFF = '';
  global.fetch = originalFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Configuration validation ──────────────────────────────

describe('R2-12c — Twilio configuration validation', () => {
  test('getTwilioConfig throws config_missing when SID is empty', async () => {
    envMock.TWILIO_ACCOUNT_SID = '';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      }),
    ).rejects.toMatchObject({ code: 'config_missing', retryable: false });
  });

  test('getTwilioConfig throws config_missing when auth token is empty', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = '';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      }),
    ).rejects.toMatchObject({ code: 'config_missing', retryable: false });
  });

  test('getTwilioConfig throws config_missing when SID starts with <', async () => {
    envMock.TWILIO_ACCOUNT_SID = '<your_account_sid>';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      }),
    ).rejects.toMatchObject({ code: 'config_missing' });
  });

  test('getTwilioConfig throws config_missing when auth token starts with <', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = '<your_auth_token>';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';

    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      }),
    ).rejects.toMatchObject({ code: 'config_missing' });
  });

  test('throws config_missing when template SID is not set', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token';
    envMock.TWILIO_TEMPLATE_STUDENT = '';

    await expect(
      sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      }),
    ).rejects.toMatchObject({ code: 'config_missing', retryable: false });
  });

  test('throws config_missing with correct template type in message', async () => {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token';
    envMock.TWILIO_TEMPLATE_TEACHER = '';

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'teacher',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('config_missing');
      expect(err.message).toContain('teacher');
    }
  });
});

// ─── Phone normalization edge cases ────────────────────────

describe('R2-12c — Phone normalization edge cases', () => {
  test('normalizes PK 03XX number', () => {
    expect(normalizeWhatsAppPhone('03001234567')).toBe('923001234567');
  });

  test('normalizes already-prefixed number', () => {
    expect(normalizeWhatsAppPhone('923001234567')).toBe('923001234567');
  });

  test('normalizes 10-digit number by prepending 92', () => {
    expect(normalizeWhatsAppPhone('3001234567')).toBe('923001234567');
  });

  test('throws on empty phone', () => {
    expect(() => normalizeWhatsAppPhone('')).toThrow('required');
  });

  test('throws on whitespace-only phone', () => {
    expect(() => normalizeWhatsAppPhone('   ')).toThrow('required');
  });

  test('throws on too-short number', () => {
    expect(() => normalizeWhatsAppPhone('123')).toThrow('format');
  });

  test('throws on too-long number', () => {
    expect(() => normalizeWhatsAppPhone('1234567890123456')).toThrow('format');
  });

  test('strips non-digit characters before validation', () => {
    expect(normalizeWhatsAppPhone('+92 300 123 4567')).toBe('923001234567');
  });

  test('handles phone with dashes', () => {
    expect(normalizeWhatsAppPhone('0300-123-4567')).toBe('923001234567');
  });

  test('handles phone with parentheses', () => {
    expect(normalizeWhatsAppPhone('(0300)1234567')).toBe('923001234567');
  });
});

// ─── Error classification edge cases ───────────────────────

describe('R2-12c — Twilio error classification edge cases', () => {
  test('classifies 401 as auth_error non-retryable', () => {
    const err = classifyTwilioError(401, { code: 20001, message: 'Auth failed' });
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('auth_error');
    expect(err.solvable).toBe(false);
  });

  test('classifies 403 as auth_error', () => {
    const err = classifyTwilioError(403, { code: 0, message: 'Forbidden' });
    expect(err.code).toBe('auth_error');
    expect(err.retryable).toBe(false);
  });

  test('classifies error code 21614 as auth_error (unverified sender)', () => {
    const err = classifyTwilioError(400, { code: 21614, message: 'Unverified' });
    expect(err.code).toBe('auth_error');
    expect(err.retryable).toBe(false);
  });

  test('classifies 429 as rate_limit retryable', () => {
    const err = classifyTwilioError(429, { code: 63018, message: 'Too many' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('rate_limit');
  });

  test('classifies error code 63019 as rate_limit', () => {
    const err = classifyTwilioError(429, { code: 63019, message: 'Rate limited' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('rate_limit');
  });

  test('classifies 21211 as recipient_error solvable', () => {
    const err = classifyTwilioError(400, { code: 21211, message: 'Invalid phone' });
    expect(err.retryable).toBe(false);
    expect(err.solvable).toBe(true);
    expect(err.code).toBe('recipient_error');
  });

  test('classifies 21212 as recipient_error', () => {
    const err = classifyTwilioError(400, { code: 21212, message: 'Invalid format' });
    expect(err.code).toBe('recipient_error');
    expect(err.solvable).toBe(true);
  });

  test('classifies 21214 as recipient_error', () => {
    const err = classifyTwilioError(400, { code: 21214, message: 'Too many segments' });
    expect(err.code).toBe('recipient_error');
    expect(err.solvable).toBe(true);
  });

  test('classifies 500 as server_error retryable', () => {
    const err = classifyTwilioError(500, { code: 30001, message: 'Server error' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('server_error');
  });

  test('classifies 502 as server_error', () => {
    const err = classifyTwilioError(502, { code: 0, message: 'Bad gateway' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('server_error');
  });

  test('classifies 503 as server_error', () => {
    const err = classifyTwilioError(503, { code: 0, message: 'Service unavailable' });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('server_error');
  });

  test('classifies 30001-30007 as server_error', () => {
    for (let code = 30001; code <= 30007; code++) {
      const err = classifyTwilioError(500, { code, message: `Error ${code}` });
      expect(err.retryable).toBe(true);
      expect(err.code).toBe('server_error');
    }
  });

  test('classifies unknown codes as twilio_<code> non-retryable', () => {
    const err = classifyTwilioError(400, { code: 99999, message: 'Unknown' });
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('twilio_99999');
  });

  test('classifies missing body gracefully', () => {
    const err = classifyTwilioError(500, null);
    // statusCode 500 >= 500 → server_error (statusCode takes priority over body)
    expect(err.code).toBe('server_error');
    expect(err.retryable).toBe(true);
  });

  test('classifies empty body gracefully', () => {
    const err = classifyTwilioError(400, {});
    // No code in body → errCode='unknown', statusCode 400 doesn't match specific rules
    expect(err.code).toBe('twilio_unknown');
    expect(err.retryable).toBe(false);
  });

  test('TwilioWhatsAppError has all required properties', () => {
    const err = new TwilioWhatsAppError('test', 'test_code', true, false, 500, { raw: true });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TwilioWhatsAppError);
    expect(err.name).toBe('TwilioWhatsAppError');
    expect(err.code).toBe('test_code');
    expect(err.retryable).toBe(true);
    expect(err.solvable).toBe(false);
    expect(err.statusCode).toBe(500);
    expect(err.raw).toEqual({ raw: true });
  });
});

// ─── Template and parameter builders ───────────────────────

describe('R2-12c — Template and parameter builders', () => {
  test('templateNameForRecipient returns recipientType', () => {
    expect(templateNameForRecipient('student')).toBe('student');
    expect(templateNameForRecipient('teacher')).toBe('teacher');
    expect(templateNameForRecipient('staff')).toBe('staff');
  });

  test('buildCredentialParameters returns 5 text parameters', () => {
    const params = buildCredentialParameters({
      name: 'Test User',
      username: 'user1',
      password: 'pass123',
      frontendUrl: 'https://example.com',
      appDownloadUrl: 'https://example.com/app',
    });
    expect(params).toHaveLength(5);
    expect(params[0].text).toBe('Test User');
    expect(params[1].text).toBe('user1');
    expect(params[2].text).toBe('pass123');
    expect(params[3].text).toBe('https://example.com');
    expect(params[4].text).toBe('https://example.com/app');
  });

  test('all parameters have type "text"', () => {
    const params = buildCredentialParameters({
      name: 'A',
      username: 'B',
      password: 'C',
      frontendUrl: 'D',
      appDownloadUrl: 'E',
    });
    params.forEach((p) => expect(p.type).toBe('text'));
  });
});

// ─── Network timeout / error handling ──────────────────────

describe('R2-12c — Twilio network error handling', () => {
  function setupTwilioEnv() {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX1234567890';
  }

  test('throws retryable on network timeout', async () => {
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

  test('throws retryable on network failure', async () => {
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

  test('Twilio source has TWILIO_FETCH_TIMEOUT_MS = 15_000', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain('TWILIO_FETCH_TIMEOUT_MS = 15_000');
  });

  test('uses AbortSignal.timeout for request timeout', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain('AbortSignal.timeout');
    expect(src).toContain('TWILIO_FETCH_TIMEOUT_MS');
  });

  test('logs masked phone number on network failure', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
    } catch {}

    const networkLog = logOutput.find((l) => l.label.includes('network failure'));
    expect(networkLog).toBeDefined();
    const logStr = JSON.stringify(networkLog);
    expect(logStr).not.toContain('03001234567');
    expect(logStr).toContain('****');
  });

  test('logs masked phone on timeout', async () => {
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
    } catch {}

    const timeoutLog = logOutput.find((l) => l.label.includes('timed out'));
    expect(timeoutLog).toBeDefined();
    expect(JSON.stringify(timeoutLog)).not.toContain('03001234567');
  });

  test('throws non-retryable on auth error response', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 20001, message: 'Authenticate' }),
    });

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.retryable).toBe(false);
      expect(err.code).toBe('auth_error');
    }
  });

  test('throws retryable on 5xx response', async () => {
    setupTwilioEnv();
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
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.retryable).toBe(true);
      expect(err.code).toBe('server_error');
    }
  });

  test('throws on missing SID in response', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'sent' }), // no sid
    });

    try {
      await sendTemplateMessage({
        to: '03001234567',
        recipientType: 'student',
        bodyParameters: [{ type: 'text', text: 'Test' }],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('invalid_response');
      expect(err.retryable).toBe(true);
    }
  });
});

// ─── Credential delivery — retryable propagation ───────────

describe('R2-12c — Credential delivery retryable propagation', () => {
  function setupTwilioEnv() {
    envMock.TWILIO_ACCOUNT_SID = 'AC123';
    envMock.TWILIO_AUTH_TOKEN = 'auth_token_123';
    envMock.TWILIO_WHATSAPP_FROM = '14155551234';
    envMock.TWILIO_TEMPLATE_STUDENT = 'HX123';
    envMock.FRONTEND_URL = 'https://example.com';
    envMock.APP_DOWNLOAD_URL = 'https://example.com/app';
  }

  test('retryable:true propagated from TwilioWhatsAppError on network error', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await deliverCredential({
      to: '03001234567',
      username: 'user1',
      password: 'pass',
      name: 'Test',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.channel).toBe('whatsapp');
  });

  test('retryable:false propagated on auth error', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 20001, message: 'Auth' }),
    });

    const result = await deliverCredential({
      to: '03001234567',
      username: 'user1',
      password: 'pass',
      name: 'Test',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('auth_error');
  });

  test('solvable:true propagated for invalid phone', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: 'Invalid phone' }),
    });

    const result = await deliverCredential({
      to: '03001234567',
      username: 'user1',
      password: 'pass',
      name: 'Test',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.solvable).toBe(true);
    expect(result.retryable).toBe(false);
  });

  test('unknown errors classified as retryable:true', async () => {
    setupTwilioEnv();
    // sendTemplateMessage wraps non-Error throws as TwilioWhatsAppError with code 'network_error'
    // deliverCredential then propagates that classification
    global.fetch = jest.fn().mockRejectedValue('string error');

    const result = await deliverCredential({
      to: '03001234567',
      username: 'user1',
      password: 'pass',
      name: 'Test',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    // Non-Error throws are classified as network_error by sendTemplateMessage
    expect(result.errorCode).toBe('network_error');
  });

  test('logs masked phone on delivery failure', async () => {
    setupTwilioEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error('fail'));

    await deliverCredential({
      to: '03001234567',
      username: 'user1',
      password: 'pass',
      name: 'Test',
      recipientType: 'student',
    });

    const allLogs = logOutput.map((l) => JSON.stringify(l));
    const fullPhoneAppears = allLogs.some((log) => log.includes('03001234567'));
    expect(fullPhoneAppears).toBe(false);
  });
});

// ─── Source structure ──────────────────────────────────────

describe('R2-12c — Twilio source structure', () => {
  test('sendTemplateMessage uses fetch with Basic Auth', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain('Authorization: authHeader');
    expect(src).toContain('Basic');
    expect(src).toContain('Buffer.from');
  });

  test('sendTemplateMessage targets correct Twilio API endpoint', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain('api.twilio.com');
    expect(src).toContain('Messages.json');
  });

  test('sends ContentSid and ContentVariables in payload', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain('ContentSid');
    expect(src).toContain('ContentVariables');
    expect(src).toContain('URLSearchParams');
  });
});

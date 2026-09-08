jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    TWILIO_ACCOUNT_SID: 'ACtest1234567890abcdef1234567890',
    TWILIO_AUTH_TOKEN: 'test_auth_token_abcdef1234567890',
    TWILIO_WHATSAPP_FROM: '14155238886',
    TWILIO_TEMPLATE_STUDENT: 'HXstudent1234567890abcdef12345678',
    TWILIO_TEMPLATE_TEACHER: 'HXteacher1234567890abcdef12345678',
    TWILIO_TEMPLATE_STAFF: 'HXstaff1234567890abcdef1234567890',
    FRONTEND_URL: 'https://mothercare.pk',
    APP_DOWNLOAD_URL: 'https://example.com/app',
  },
}));

import {
  TwilioWhatsAppError,
  normalizeWhatsAppPhone,
  sendTemplateMessage,
  templateNameForRecipient,
} from '../../src/services/twilio-whatsapp.service';

describe('normalizeWhatsAppPhone', () => {
  test('normalizes +92 format', () => {
    expect(normalizeWhatsAppPhone('+92 300 4444444')).toBe('923004444444');
  });

  test('normalizes leading zero local format', () => {
    expect(normalizeWhatsAppPhone('03004444444')).toBe('923004444444');
  });

  test('rejects empty phone', () => {
    expect(() => normalizeWhatsAppPhone('')).toThrow(TwilioWhatsAppError);
  });

  test('rejects too-short phone', () => {
    expect(() => normalizeWhatsAppPhone('123')).toThrow(TwilioWhatsAppError);
  });
});

describe('templateNameForRecipient', () => {
  test('returns recipient type as template name', () => {
    expect(templateNameForRecipient('student')).toBe('student');
    expect(templateNameForRecipient('teacher')).toBe('teacher');
    expect(templateNameForRecipient('staff')).toBe('staff');
  });
});

describe('sendTemplateMessage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns message sid on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMxxxxxxxxxxxxxx', status: 'queued' }),
    }) as any;

    const result = await sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [{ type: 'text', text: 'Test' }],
    });

    expect(result.messageId).toBe('SMxxxxxxxxxxxxxx');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/ACtest1234567890abcdef1234567890/Messages.json',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends correct Authorization header (Basic Auth)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMtest123', status: 'queued' }),
    }) as any;

    await sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [{ type: 'text', text: 'Ali' }],
    });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const authHeader = callArgs[1].headers.Authorization;
    expect(authHeader).toMatch(/^Basic /);
    // Decode and verify it matches AccountSid:AuthToken
    const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('ACtest1234567890abcdef1234567890:test_auth_token_abcdef1234567890');
  });

  test('sends ContentSid and ContentVariables in body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMtest123', status: 'queued' }),
    }) as any;

    await sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [
        { type: 'text', text: 'Ali' },
        { type: 'text', text: 'ali_student' },
        { type: 'text', text: 'Temp123!' },
      ],
    });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const body = callArgs[1].body;
    expect(body).toContain('ContentSid=HXstudent1234567890abcdef12345678');
    expect(body).toContain('ContentVariables=');
    const rawVars = body.split('ContentVariables=')[1].split('&')[0];
    const vars = JSON.parse(decodeURIComponent(rawVars));
    expect(vars['1']).toBe('Ali');
    expect(vars['2']).toBe('ali_student');
    expect(vars['3']).toBe('Temp123!');
  });

  test('formats To with whatsapp: prefix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMtest123', status: 'queued' }),
    }) as any;

    await sendTemplateMessage({
      to: '03001234567',
      recipientType: 'teacher',
      bodyParameters: [],
    });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[1].body).toContain('To=whatsapp%3A%2B923001234567');
  });

  test('uses correct template SID for teacher', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMtest123', status: 'queued' }),
    }) as any;

    await sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'teacher',
      bodyParameters: [],
    });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[1].body).toContain('ContentSid=HXteacher1234567890abcdef12345678');
  });

  test('uses correct template SID for staff', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMtest123', status: 'queued' }),
    }) as any;

    await sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'staff',
      bodyParameters: [],
    });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[1].body).toContain('ContentSid=HXstaff1234567890abcdef1234567890');
  });

  test('throws classified error on auth failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 20001, message: 'Authenticate' }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'auth_error',
      retryable: false,
    });
  });

  test('throws retryable error on rate limit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 63018, message: 'Rate limit exceeded' }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
    });
  });

  test('throws retryable error on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });
  });

  test('throws recipient_error on invalid phone', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: "The 'To' phone number is not valid." }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'recipient_error',
      solvable: true,
    });
  });

  test('throws config_missing if template SID not set', async () => {
    // Override env to have empty template SIDs
    const env = require('../../src/config/env').default;
    const orig = env.TWILIO_TEMPLATE_STUDENT;
    env.TWILIO_TEMPLATE_STUDENT = '';

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'config_missing',
    });

    env.TWILIO_TEMPLATE_STUDENT = orig;
  });

  test('throws if no message SID in response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'queued' }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      recipientType: 'student',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

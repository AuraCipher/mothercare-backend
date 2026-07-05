jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789',
    META_WHATSAPP_ACCESS_TOKEN: 'test-token',
    META_WHATSAPP_API_VERSION: 'v21.0',
    FRONTEND_URL: 'https://mothercare.pk',
    APP_DOWNLOAD_URL: 'https://example.com/app',
  },
}));

import {
  MetaWhatsAppError,
  normalizeWhatsAppPhone,
  sendTemplateMessage,
  templateNameForRecipient,
} from '../../src/services/meta-whatsapp.service';

describe('normalizeWhatsAppPhone', () => {
  test('normalizes +92 format', () => {
    expect(normalizeWhatsAppPhone('+92 300 4444444')).toBe('923004444444');
  });

  test('normalizes leading zero local format', () => {
    expect(normalizeWhatsAppPhone('03004444444')).toBe('923004444444');
  });

  test('rejects empty phone', () => {
    expect(() => normalizeWhatsAppPhone('')).toThrow(MetaWhatsAppError);
  });

  test('rejects too-short phone', () => {
    expect(() => normalizeWhatsAppPhone('123')).toThrow(MetaWhatsAppError);
  });
});

describe('templateNameForRecipient', () => {
  test('maps recipient types to placeholder template names', () => {
    expect(templateNameForRecipient('student')).toBe('credential_send');
    expect(templateNameForRecipient('teacher')).toBe('credential_send_teacher');
    expect(templateNameForRecipient('staff')).toBe('credential_send_staff');
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

  test('returns message id on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test123' }] }),
    }) as any;

    const result = await sendTemplateMessage({
      to: '+923001234567',
      templateName: 'credential_send',
      bodyParameters: [{ type: 'text', text: 'Test' }],
    });

    expect(result.messageId).toBe('wamid.test123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456789/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('throws classified error on template rejection', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Template name does not exist', code: 132001 },
      }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      templateName: 'missing_template',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'template_error',
      retryable: false,
    });
  });

  test('throws retryable error on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      templateName: 'credential_send',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });
  });

  test('throws auth error on 401', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }),
    }) as any;

    await expect(sendTemplateMessage({
      to: '+923001234567',
      templateName: 'credential_send',
      bodyParameters: [],
    })).rejects.toMatchObject({
      code: 'auth_error',
      retryable: false,
    });
  });
});

import env from '../config/env';
import logger from '../lib/logger';

export type MetaTemplateParameter = { type: 'text'; text: string };

export class MetaWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly solvable: boolean,
    public readonly statusCode?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'MetaWhatsAppError';
  }
}

const TEMPLATE_NAMES = {
  student: 'credential_send',
  teacher: 'credential_send_teacher',
  staff: 'credential_send_staff',
} as const;

export type CredentialRecipientType = keyof typeof TEMPLATE_NAMES;

export function normalizeWhatsAppPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    throw new MetaWhatsAppError('Phone number is required', 'missing_phone', false, true);
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  if (digits.length === 10) digits = `92${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new MetaWhatsAppError('Invalid phone number format', 'invalid_phone', false, true);
  }
  return digits;
}

function getMetaConfig() {
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const apiVersion = env.META_WHATSAPP_API_VERSION?.trim() || 'v21.0';

  if (!phoneNumberId || !accessToken || phoneNumberId.startsWith('<') || accessToken.startsWith('<')) {
    throw new MetaWhatsAppError(
      'Meta WhatsApp is not configured. Set META_WHATSAPP_PHONE_NUMBER_ID and META_WHATSAPP_ACCESS_TOKEN.',
      'config_missing',
      false,
      false,
    );
  }

  return { phoneNumberId, accessToken, apiVersion };
}

function classifyMetaError(statusCode: number, body: any): MetaWhatsAppError {
  const err = body?.error;
  const metaCode = err?.code != null ? String(err.code) : 'unknown';
  const message = err?.message || `Meta WhatsApp API error (${statusCode})`;

  if (statusCode === 401 || statusCode === 403 || metaCode === '190') {
    return new MetaWhatsAppError(message, 'auth_error', false, false, statusCode, body);
  }
  if (statusCode === 429 || metaCode === '130429' || metaCode === '80007') {
    return new MetaWhatsAppError(message, 'rate_limit', true, false, statusCode, body);
  }
  if (metaCode === '132001' || metaCode === '132000' || metaCode === '132015') {
    return new MetaWhatsAppError(message, 'template_error', false, false, statusCode, body);
  }
  if (metaCode === '131026' || metaCode === '131047' || metaCode === '131051') {
    return new MetaWhatsAppError(message, 'recipient_error', false, true, statusCode, body);
  }
  if (statusCode >= 500) {
    return new MetaWhatsAppError(message, 'server_error', true, false, statusCode, body);
  }
  return new MetaWhatsAppError(message, `meta_${metaCode}`, false, false, statusCode, body);
}

export async function sendTemplateMessage(params: {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParameters: MetaTemplateParameter[];
}): Promise<{ messageId: string }> {
  const { phoneNumberId, accessToken, apiVersion } = getMetaConfig();
  const to = normalizeWhatsAppPhone(params.to);

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.languageCode || 'en' },
      components: params.bodyParameters.length
        ? [{ type: 'body', parameters: params.bodyParameters }]
        : undefined,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    logger.error('Meta WhatsApp network failure', { to: to.slice(0, 6) + '****', msg });
    throw new MetaWhatsAppError(msg, 'network_error', true, false);
  }

  const body = await res.json().catch(() => ({})) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; code?: number | string };
  };
  if (!res.ok) {
    const classified = classifyMetaError(res.status, body);
    logger.error('Meta WhatsApp send failed', {
      to: to.slice(0, 6) + '****',
      code: classified.code,
      status: res.status,
      body,
    });
    throw classified;
  }

  const messageId = body?.messages?.[0]?.id;
  if (!messageId) {
    throw new MetaWhatsAppError('Meta API returned success without a message ID', 'invalid_response', true, false, res.status, body);
  }

  return { messageId };
}

export function templateNameForRecipient(recipientType: CredentialRecipientType): string {
  return TEMPLATE_NAMES[recipientType];
}

export function buildCredentialParameters(params: {
  name: string;
  username: string;
  password: string;
  frontendUrl: string;
  appDownloadUrl: string;
}): MetaTemplateParameter[] {
  return [
    { type: 'text', text: params.name },
    { type: 'text', text: params.username },
    { type: 'text', text: params.password },
    { type: 'text', text: params.frontendUrl },
    { type: 'text', text: params.appDownloadUrl },
  ];
}

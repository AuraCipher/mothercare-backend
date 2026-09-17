import env from '../config/env';
import logger from '../lib/logger';

export type TwilioTemplateParameter = { type: 'text'; text: string };

export class TwilioWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly solvable: boolean,
    public readonly statusCode?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'TwilioWhatsAppError';
  }
}

/** Timeout for a single Twilio REST API fetch call (ms). */
const TWILIO_FETCH_TIMEOUT_MS = 15_000;

export type CredentialRecipientType = 'student' | 'teacher' | 'staff';

const TEMPLATE_SIDS: Record<CredentialRecipientType, string | undefined> = {
  student: undefined,
  teacher: undefined,
  staff: undefined,
};

function getTemplateSid(type: CredentialRecipientType): string | undefined {
  if (TEMPLATE_SIDS[type]) return TEMPLATE_SIDS[type];
  switch (type) {
    case 'student': return env.TWILIO_TEMPLATE_STUDENT?.trim();
    case 'teacher': return env.TWILIO_TEMPLATE_TEACHER?.trim();
    case 'staff': return env.TWILIO_TEMPLATE_STAFF?.trim();
  }
}

export function normalizeWhatsAppPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    throw new TwilioWhatsAppError('Phone number is required', 'missing_phone', false, true);
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  if (digits.length === 10) digits = `92${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new TwilioWhatsAppError('Invalid phone number format', 'invalid_phone', false, true);
  }
  return digits;
}

function getTwilioConfig() {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_WHATSAPP_FROM?.trim();

  if (!accountSid || !authToken || accountSid.startsWith('<') || authToken.startsWith('<')) {
    throw new TwilioWhatsAppError(
      'Twilio WhatsApp is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      'config_missing',
      false,
      false,
    );
  }

  return { accountSid, authToken, from };
}

export function classifyTwilioError(statusCode: number, body: any): TwilioWhatsAppError {
  const errCode = body?.code != null ? String(body.code) : 'unknown';
  const message = body?.message || `Twilio API error (${statusCode})`;

  if (statusCode === 401 || statusCode === 403 || errCode === '20001' || errCode === '20003' || errCode === '21408' || errCode === '21614') {
    return new TwilioWhatsAppError(message, 'auth_error', false, false, statusCode, body);
  }
  if (statusCode === 429 || errCode === '63018' || errCode === '63019') {
    return new TwilioWhatsAppError(message, 'rate_limit', true, false, statusCode, body);
  }
  if (errCode === '21211' || errCode === '21212' || errCode === '21214') {
    return new TwilioWhatsAppError(message, 'recipient_error', false, true, statusCode, body);
  }
  if (statusCode >= 500 || errCode === '30001' || errCode === '30002' || errCode === '30003' || errCode === '30004' || errCode === '30005' || errCode === '30006' || errCode === '30007') {
    return new TwilioWhatsAppError(message, 'server_error', true, false, statusCode, body);
  }
  return new TwilioWhatsAppError(message, `twilio_${errCode}`, false, false, statusCode, body);
}

export async function sendTemplateMessage(params: {
  to: string;
  recipientType: CredentialRecipientType;
  languageCode?: string;
  bodyParameters: TwilioTemplateParameter[];
}): Promise<{ messageId: string }> {
  const { accountSid, authToken, from } = getTwilioConfig();
  const to = normalizeWhatsAppPhone(params.to);

  const templateSid = getTemplateSid(params.recipientType);
  if (!templateSid) {
    throw new TwilioWhatsAppError(
      `No template SID configured for ${params.recipientType}. Set TWILIO_TEMPLATE_${params.recipientType.toUpperCase()} in env.`,
      'config_missing',
      false,
      false,
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const contentVariables: Record<string, string> = {};
  params.bodyParameters.forEach((p, i) => {
    contentVariables[String(i + 1)] = p.text;
  });

  const payload = new URLSearchParams();
  if (from) payload.append('From', `whatsapp:+${from}`);
  payload.append('To', `whatsapp:+${to}`);
  payload.append('ContentSid', templateSid);
  payload.append('ContentVariables', JSON.stringify(contentVariables));

  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
      signal: AbortSignal.timeout(TWILIO_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || msg.includes('timeout') || msg.includes('abort')) {
      logger.error('Twilio WhatsApp request timed out', { to: to.slice(0, 6) + '****', timeoutMs: TWILIO_FETCH_TIMEOUT_MS });
      throw new TwilioWhatsAppError(`Twilio request timed out after ${TWILIO_FETCH_TIMEOUT_MS}ms`, 'timeout', true, false);
    }
    logger.error('Twilio WhatsApp network failure', { to: to.slice(0, 6) + '****', msg });
    throw new TwilioWhatsAppError(msg, 'network_error', true, false);
  }

  const body = await res.json().catch(() => ({})) as {
    sid?: string;
    status?: string;
    code?: number;
    message?: string;
    error_code?: string;
    error_message?: string;
  };

  if (!res.ok) {
    const classified = classifyTwilioError(res.status, body);
    logger.error('Twilio WhatsApp send failed', {
      to: to.slice(0, 6) + '****',
      code: classified.code,
      status: res.status,
      body,
    });
    throw classified;
  }

  const messageId = body?.sid;
  if (!messageId) {
    throw new TwilioWhatsAppError('Twilio API returned success without a message SID', 'invalid_response', true, false, res.status, body);
  }

  return { messageId };
}

export function templateNameForRecipient(recipientType: CredentialRecipientType): string {
  return recipientType;
}

export function buildCredentialParameters(params: {
  name: string;
  username: string;
  password: string;
  frontendUrl: string;
  appDownloadUrl: string;
}): TwilioTemplateParameter[] {
  return [
    { type: 'text', text: params.name },
    { type: 'text', text: params.username },
    { type: 'text', text: params.password },
    { type: 'text', text: params.frontendUrl },
    { type: 'text', text: params.appDownloadUrl },
  ];
}

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

// ─── Approved WhatsApp template contracts (M19/M19.1) ──────
// These layouts mirror the currently approved provider templates:
//   teacher_wc → 4 vars: [teacherName, website, username, password]
//   staff_wc   → 5 vars: [designation, staffName, website, username, password]
//   student_wc → 5 vars: [studentName, class, website, username, password]
// The counts below are enforced in sendTemplateMessage — a mismatch
// fails closed BEFORE any provider request. Never truncate/append/reorder.
export const TEMPLATE_VARIABLE_COUNTS: Record<CredentialRecipientType, number> = {
  teacher: 4,
  staff: 5,
  student: 5,
};

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

  if (!from) {
    throw new TwilioWhatsAppError(
      'Twilio WhatsApp sender is not configured. Set TWILIO_WHATSAPP_FROM in env.',
      'config_missing',
      false,
      false,
    );
  }

  // M19.1 — fail closed on template/variable mismatch. Never truncate,
  // append, or reorder variables to fit; the caller must build the exact
  // approved layout for this recipient type.
  const expectedCount = TEMPLATE_VARIABLE_COUNTS[params.recipientType];
  if (params.bodyParameters.length !== expectedCount) {
    throw new TwilioWhatsAppError(
      `Template variable count mismatch for ${params.recipientType}: expected ${expectedCount}, got ${params.bodyParameters.length}.`,
      'template_mismatch',
      false,
      true,
    );
  }
  if (params.bodyParameters.some((p) => !p || typeof p.text !== 'string' || !p.text.trim())) {
    throw new TwilioWhatsAppError(
      `Template variable missing/empty for ${params.recipientType}: all ${expectedCount} variables are required.`,
      'template_mismatch',
      false,
      true,
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const contentVariables: Record<string, string> = {};
  params.bodyParameters.forEach((p, i) => {
    contentVariables[String(i + 1)] = p.text;
  });

  const payload = new URLSearchParams();
  payload.append('From', `whatsapp:+${from}`);
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

/**
 * student_wc {{2}} renders inside the sentence "admission in Class {{2}}",
 * so the template already supplies the word "Class". Group names in this
 * app usually repeat it ("Class 3", "Class 10"), which would render as
 * "Class Class 3". Strip one leading "Class" word (case-insensitive) to
 * keep the parent-facing sentence clean. Names without the prefix
 * ("Playgroup") pass through untouched.
 */
export function formatClassLabel(groupName: string, section?: string | null): string {
  const name = groupName.trim().replace(/^class\s+/i, '').trim();
  const label = section?.trim() ? `${name} - ${section.trim()}` : name;
  return label;
}

function toTextParam(text: string): TwilioTemplateParameter {
  return { type: 'text', text };
}

/**
 * teacher_wc — approved layout (exactly 4 variables):
 *   {{1}} teacher name, {{2}} website, {{3}} username, {{4}} password.
 * Never append a fifth variable (e.g. app download URL).
 */
export function buildTeacherParameters(params: {
  name: string;
  website: string;
  username: string;
  password: string;
}): TwilioTemplateParameter[] {
  return [toTextParam(params.name), toTextParam(params.website), toTextParam(params.username), toTextParam(params.password)];
}

/**
 * staff_wc — approved layout (exactly 5 variables):
 *   {{1}} designation, {{2}} staff name, {{3}} website,
 *   {{4}} username, {{5}} password.
 * Designation must be the real StaffProfile.workRole (BranchMember.role
 * fallback) — never hardcoded. A missing designation fails closed here so
 * no provider request is attempted with a shifted payload.
 */
export function buildStaffParameters(params: {
  designation: string;
  name: string;
  website: string;
  username: string;
  password: string;
}): TwilioTemplateParameter[] {
  if (!params.designation?.trim()) {
    throw new TwilioWhatsAppError(
      'Staff designation is required for staff_wc ({{1}}). Add a work role/designation first.',
      'template_mismatch',
      false,
      true,
    );
  }
  return [
    toTextParam(params.designation),
    toTextParam(params.name),
    toTextParam(params.website),
    toTextParam(params.username),
    toTextParam(params.password),
  ];
}

/**
 * student_wc — approved layout (exactly 5 variables):
 *   {{1}} student name, {{2}} class, {{3}} website,
 *   {{4}} username, {{5}} password.
 * Class must be the authoritative Student.group label — never hardcoded.
 * A missing class fails closed here so no incorrect value is ever sent.
 */
export function buildStudentParameters(params: {
  name: string;
  className: string;
  website: string;
  username: string;
  password: string;
}): TwilioTemplateParameter[] {
  if (!params.className?.trim()) {
    throw new TwilioWhatsAppError(
      'Student class is required for student_wc ({{2}}). Assign a class first.',
      'template_mismatch',
      false,
      true,
    );
  }
  return [
    toTextParam(params.name),
    toTextParam(params.className),
    toTextParam(params.website),
    toTextParam(params.username),
    toTextParam(params.password),
  ];
}

import { Resend } from 'resend';
import env from '../../config/env';
import { adminInvitationEmailHtml } from '../../emails/templates';
import logger from '../logger';

export interface AdminInvitationEmailParams {
  to: string;
  token: string;
  branchName: string;
  branchCode: string;
}

export interface SendEmailResult {
  sent: boolean;
  warning?: string;
  messageId?: string;
}

function isResendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM_EMAIL?.trim());
}

/**
 * Send CEO admin invitation email via Resend.
 * When Resend is not configured or send fails, returns sent:false with a warning
 * so the API can still return the registration link for manual sharing.
 */
export async function sendAdminInvitationEmail(
  params: AdminInvitationEmailParams,
): Promise<SendEmailResult> {
  if (!isResendConfigured()) {
    const warning =
      'Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL). Invitation link created but email was not sent.';
    logger.warn(warning);
    return { sent: false, warning };
  }

  const frontendUrl = env.FRONTEND_URL || 'http://localhost:3000';
  const schoolName = env.SCHOOL_NAME || 'Mother Care School';
  const html = adminInvitationEmailHtml(
    params.token,
    params.to,
    params.branchName,
    params.branchCode,
    { frontendUrl, schoolName },
  );
  const subject = `You're invited to manage ${params.branchName} — ${schoolName}`;

  try {
    const resend = new Resend(env.RESEND_API_KEY!);
    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL!,
      to: params.to,
      subject,
      html,
    });

    if (result.error) {
      const warning = `Failed to send invitation email: ${result.error.message}`;
      logger.warn(warning, { error: result.error });
      return { sent: false, warning };
    }

    logger.info('Admin invitation email sent', { to: params.to, messageId: result.data?.id });
    return { sent: true, messageId: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const warning = `Failed to send invitation email: ${message}`;
    logger.warn(warning, { err });
    return { sent: false, warning };
  }
}

export function isEmailDeliveryConfigured(): boolean {
  return isResendConfigured();
}

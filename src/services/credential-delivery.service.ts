import env from '../config/env';
import logger from '../lib/logger';
import {
  buildStaffParameters,
  buildStudentParameters,
  buildTeacherParameters,
  TwilioWhatsAppError,
  sendTemplateMessage,
  type CredentialRecipientType,
} from './twilio-whatsapp.service';

export type SendCredentialResult = {
  success: boolean;
  channel: 'whatsapp';
  messageId?: string;
  messageStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  solvable?: boolean;
};

export type CredentialDeliveryParams = {
  to: string;
  username: string;
  password: string;
  name: string;
  recipientType: CredentialRecipientType;
  /** Staff only — authoritative StaffProfile.workRole (BranchMember.role fallback). Required for staff_wc {{1}}. */
  designation?: string;
  /** Student only — authoritative Student.group label. Required for student_wc {{2}}. */
  className?: string;
  /** Website slot ({{2}} teacher / {{3}} staff+student). Defaults to FRONTEND_URL. */
  website?: string;
};

export async function deliverCredential(params: CredentialDeliveryParams): Promise<SendCredentialResult> {
  const website = params.website || env.FRONTEND_URL || 'https://mothercareschool.pk';

  // M19.1 — per-template approved layouts. Builders throw
  // TwilioWhatsAppError (template_mismatch) on missing designation/class,
  // which is caught below and returned as a failure — no provider call.
  try {
    const bodyParameters =
      params.recipientType === 'teacher'
        ? buildTeacherParameters({ name: params.name, website, username: params.username, password: params.password })
        : params.recipientType === 'staff'
          ? buildStaffParameters({
              designation: params.designation ?? '',
              name: params.name,
              website,
              username: params.username,
              password: params.password,
            })
          : buildStudentParameters({
              name: params.name,
              className: params.className ?? '',
              website,
              username: params.username,
              password: params.password,
            });

    const { messageId } = await sendTemplateMessage({
      to: params.to,
      recipientType: params.recipientType,
      languageCode: 'en',
      bodyParameters,
    });

    logger.info('Credential WhatsApp sent', {
      recipientType: params.recipientType,
      to: params.to.slice(0, 6) + '****',
      messageId,
    });

    return {
      success: true,
      channel: 'whatsapp',
      messageId,
      messageStatus: 'sent',
    };
  } catch (error: unknown) {
    if (error instanceof TwilioWhatsAppError) {
      logger.error('Credential WhatsApp failed', {
        recipientType: params.recipientType,
        to: params.to.slice(0, 6) + '****',
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        solvable: error.solvable,
      });
      return {
        success: false,
        channel: 'whatsapp',
        messageStatus: 'failed',
        errorCode: error.code,
        errorMessage: error.message,
        retryable: error.retryable,
        solvable: error.solvable,
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Credential WhatsApp unexpected failure', {
      recipientType: params.recipientType,
      message,
    });
    return {
      success: false,
      channel: 'whatsapp',
      messageStatus: 'failed',
      errorCode: 'unknown_error',
      errorMessage: message,
      retryable: true,
      solvable: false,
    };
  }
}

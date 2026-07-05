import env from '../config/env';
import logger from '../lib/logger';
import {
  buildCredentialParameters,
  MetaWhatsAppError,
  sendTemplateMessage,
  templateNameForRecipient,
  type CredentialRecipientType,
} from './meta-whatsapp.service';

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
};

export async function deliverCredential(params: CredentialDeliveryParams): Promise<SendCredentialResult> {
  const frontendUrl = env.FRONTEND_URL || 'https://mothercare.pk';
  const appDownloadUrl = env.APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.mothercare.app';
  const templateName = templateNameForRecipient(params.recipientType);

  try {
    const { messageId } = await sendTemplateMessage({
      to: params.to,
      templateName,
      languageCode: 'en',
      bodyParameters: buildCredentialParameters({
        name: params.name,
        username: params.username,
        password: params.password,
        frontendUrl,
        appDownloadUrl,
      }),
    });

    logger.info('Credential WhatsApp sent', {
      recipientType: params.recipientType,
      templateName,
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
    if (error instanceof MetaWhatsAppError) {
      logger.error('Credential WhatsApp failed', {
        recipientType: params.recipientType,
        templateName,
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

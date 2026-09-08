jest.mock('../../src/services/twilio-whatsapp.service', () => ({
  ...jest.requireActual('../../src/services/twilio-whatsapp.service'),
  sendTemplateMessage: jest.fn(),
  templateNameForRecipient: jest.requireActual('../../src/services/twilio-whatsapp.service').templateNameForRecipient,
  buildCredentialParameters: jest.requireActual('../../src/services/twilio-whatsapp.service').buildCredentialParameters,
}));

jest.mock('../../src/queues/message.queue', () => ({
  enqueueCredentialSend: jest.fn(async (data: any) => {
    const { deliverCredential } = jest.requireActual('../../src/services/credential-delivery.service');
    return deliverCredential(data);
  }),
}));

import notificationService from '../../src/services/notification.service';
import { TwilioWhatsAppError, sendTemplateMessage } from '../../src/services/twilio-whatsapp.service';

const mockedSend = sendTemplateMessage as jest.MockedFunction<typeof sendTemplateMessage>;

describe('notification.service sendCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'https://mothercare.pk';
    process.env.APP_DOWNLOAD_URL = 'https://example.com/app';
  });

  test('uses student template and returns success without retry hints on failure path opposite', async () => {
    mockedSend.mockResolvedValue({ messageId: 'SM.abc123' });

    const result = await notificationService.sendCredential({
      to: '+923001234567',
      name: 'Ali',
      username: 'ali_student',
      password: 'Temp123!',
      recipientType: 'student',
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe('whatsapp');
    expect(result.messageId).toBe('SM.abc123');
    expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({
      recipientType: 'student',
    }));
  });

  test('uses teacher template for teacher recipient type', async () => {
    mockedSend.mockResolvedValue({ messageId: 'SM.teacher123' });

    await notificationService.sendCredential({
      to: '+923001234567',
      name: 'Rubina',
      username: 'rubina_t',
      password: 'Temp123!',
      recipientType: 'teacher',
    });

    expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({
      recipientType: 'teacher',
    }));
  });

  test('returns structured failure when Twilio send fails', async () => {
    mockedSend.mockRejectedValue(
      new TwilioWhatsAppError('Invalid phone', 'recipient_error', false, true),
    );

    const result = await notificationService.sendCredential({
      to: '+923001234567',
      name: 'Ali',
      username: 'ali_student',
      password: 'Temp123!',
      recipientType: 'student',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('recipient_error');
    expect(result.solvable).toBe(true);
    expect(result.retryable).toBe(false);
  });
});

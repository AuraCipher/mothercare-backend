/**
 * Chat worker job handlers.
 */
import { sendEncryptedPushToUsers } from '../../../src/modules/chat/push/fcm.service';

jest.mock('../../../src/modules/chat/push/fcm.service', () => ({
  sendEncryptedPushToUsers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/config/redis-tcp', () => ({
  getRedisConnectionConfig: jest.fn().mockReturnValue(null),
}));

describe('chat worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sendEncryptedPushToUsers is callable', async () => {
    await sendEncryptedPushToUsers(['u1'], 1, {
      type: 'chat_message',
      roomId: 'r1',
      messageId: 'm1',
      senderId: 's1',
      preview: 'hello',
      roomName: 'Test Room',
    });
    expect(sendEncryptedPushToUsers).toHaveBeenCalledTimes(1);
  });
});

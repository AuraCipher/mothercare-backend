import { deleteRoomMessage, updateRoomMessage } from '../../../src/modules/chat/services/chat-message.service';
import { prisma } from '../../../src/lib/prisma';

jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    chatMessage: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  assertRoomMember: jest.fn(),
  assertCanPost: jest.fn(),
}));

jest.mock('../../../src/modules/chat/services/chat-student-room-access.service', () => ({
  ensureStudentSystemRoomAccess: jest.fn(),
}));

import { assertCanPost, assertRoomMember } from '../../../src/modules/chat/services/chat-access.service';
import { ensureStudentSystemRoomAccess } from '../../../src/modules/chat/services/chat-student-room-access.service';

const baseMessage = {
  id: 'msg-1',
  roomId: 'room-1',
  senderId: 'user-1',
  type: 'text',
  content: 'Hello',
  mediaFileId: null,
  isDeleted: false,
};

describe('chat-message delete/update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deleteRoomMessage soft-deletes for sender', async () => {
    (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(baseMessage);
    (prisma.chatMessage.update as jest.Mock).mockResolvedValue({
      ...baseMessage,
      isDeleted: true,
      sender: { id: 'user-1', name: 'Ali', role: 'teacher' },
      mediaFile: null,
    });

    const result = await deleteRoomMessage('msg-1', 'user-1');

    expect(ensureStudentSystemRoomAccess).toHaveBeenCalledWith('room-1', 'user-1');
    expect(assertRoomMember).toHaveBeenCalledWith('room-1', 'user-1');
    expect(prisma.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ isDeleted: true }),
      }),
    );
    expect(result.isDeleted).toBe(true);
  });

  test('deleteRoomMessage rejects non-sender', async () => {
    (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(baseMessage);

    await expect(deleteRoomMessage('msg-1', 'other-user')).rejects.toMatchObject({
      status: 403,
    });
  });

  test('updateRoomMessage updates text for sender', async () => {
    (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(baseMessage);
    (prisma.chatMessage.update as jest.Mock).mockResolvedValue({
      ...baseMessage,
      content: 'Updated',
      sender: { id: 'user-1', name: 'Ali', role: 'teacher' },
      mediaFile: null,
    });

    const result = await updateRoomMessage('msg-1', 'user-1', 'Updated');

    expect(assertCanPost).toHaveBeenCalledWith('room-1', 'user-1');
    expect(result.content).toBe('Updated');
  });

  test('updateRoomMessage rejects media messages', async () => {
    (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
      ...baseMessage,
      type: 'image',
      mediaFileId: 'file-1',
    });

    await expect(updateRoomMessage('msg-1', 'user-1', 'Nope')).rejects.toMatchObject({
      status: 400,
    });
  });
});

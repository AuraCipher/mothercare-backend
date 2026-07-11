/**
 * Shared chat HTTP routes — rooms, messages, device tokens.
 */
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { TEST_AY_ID } from '../../helpers/integration';

jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  listRoomsForUser: jest.fn(),
}));

jest.mock('../../../src/modules/chat/services/chat-message.service', () => ({
  listRoomMessages: jest.fn(),
}));

jest.mock('../../../src/modules/chat/push/device-token.service', () => ({
  registerDeviceToken: jest.fn(),
  removeDeviceToken: jest.fn(),
}));

import { listRoomsForUser } from '../../../src/modules/chat/services/chat-access.service';
import { listRoomMessages } from '../../../src/modules/chat/services/chat-message.service';
import {
  registerDeviceToken,
  removeDeviceToken,
} from '../../../src/modules/chat/push/device-token.service';

const studentToken = getAuthHeader(
  generateTestToken('student-u1', 'student', { name: 'Ali Student', branchIds: [] }),
);

describe('Chat HTTP routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listRoomsForUser as jest.Mock).mockResolvedValue([
      { id: 'room-1', name: 'School Announcement', kind: 'school_announcement' },
    ]);
    (listRoomMessages as jest.Mock).mockResolvedValue({
      messages: [{ id: 'msg-1', content: 'Hello' }],
      nextCursor: null,
    });
    (registerDeviceToken as jest.Mock).mockResolvedValue({ id: 'dt-1', platform: 'android' });
    (removeDeviceToken as jest.Mock).mockResolvedValue(undefined);
  });

  test('GET /chat/rooms 401 without token', async () => {
    const res = await request(app).get('/chat/rooms').query({ academicYearId: TEST_AY_ID });
    expect(res.status).toBe(401);
  });

  test('GET /chat/rooms 400 without academicYearId', async () => {
    const res = await request(app).get('/chat/rooms').set(studentToken);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/academicYearId/i);
  });

  test('GET /chat/rooms returns user rooms', async () => {
    const res = await request(app)
      .get('/chat/rooms')
      .query({ academicYearId: TEST_AY_ID })
      .set(studentToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(listRoomsForUser).toHaveBeenCalledWith('student-u1', TEST_AY_ID);
  });

  test('GET /chat/rooms/:roomId/messages returns paginated messages', async () => {
    const res = await request(app)
      .get('/chat/rooms/room-1/messages')
      .query({ limit: '20' })
      .set(studentToken);

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(1);
    expect(listRoomMessages).toHaveBeenCalledWith('room-1', 'student-u1', {
      cursor: undefined,
      limit: 20,
    });
  });

  test('POST /chat/devices registers push token', async () => {
    const res = await request(app)
      .post('/chat/devices')
      .set(studentToken)
      .send({ token: 'fcm-token-abc', platform: 'android' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('dt-1');
    expect(registerDeviceToken).toHaveBeenCalledWith('student-u1', 'fcm-token-abc', 'android');
  });

  test('DELETE /chat/devices removes push token', async () => {
    const res = await request(app)
      .delete('/chat/devices')
      .set(studentToken)
      .send({ token: 'fcm-token-abc' });

    expect(res.status).toBe(200);
    expect(removeDeviceToken).toHaveBeenCalledWith('student-u1', 'fcm-token-abc');
  });
});

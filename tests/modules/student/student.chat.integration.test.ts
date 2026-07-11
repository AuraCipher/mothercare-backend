/**
 * Student portal chat API — landing, contacts, DM routes.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import {
  mockStudentPortalReady,
  mockStudentRecord,
  studentToken,
  teacherToken,
} from './student.helpers';
import { scopeQuery, TEST_AY_ID } from '../../helpers/integration';

jest.mock('../../../src/modules/student/services/student-chat.service', () => ({
  getStudentChatLanding: jest.fn(),
  getStudentChatContacts: jest.fn(),
  openStudentDirectMessage: jest.fn(),
}));

import {
  getStudentChatLanding,
  getStudentChatContacts,
  openStudentDirectMessage,
} from '../../../src/modules/student/services/student-chat.service';

const mockLanding = {
  sections: [
    { key: 'school', title: 'School Announcement', rooms: [{ id: 'r-school', kind: 'school_announcement' }] },
    { key: 'system', title: 'My Records', rooms: [] },
    { key: 'classes', title: 'My Class', communities: [{ groupId: 'g1', groupLabel: 'Class 5 — A' }] },
  ],
  rooms: [],
  communities: [],
};

const mockContacts = {
  sections: [
    {
      key: 'teachers',
      title: 'Teachers',
      contacts: [{ userId: 'teacher-u1', name: 'Ms. Sarah', roleLabel: 'Class teacher' }],
    },
  ],
};

describe('Student portal — chat routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getStudentChatLanding as jest.Mock).mockResolvedValue(mockLanding);
    (getStudentChatContacts as jest.Mock).mockResolvedValue(mockContacts);
    (openStudentDirectMessage as jest.Mock).mockResolvedValue({
      roomId: 'dm-1',
      name: 'Ms. Sarah',
    });
  });

  test('GET /student/chat/landing 401 without token', async () => {
    const res = await request(app).get('/student/chat/landing').query(scopeQuery);
    expect(res.status).toBe(401);
  });

  test('GET /student/chat/landing 403 for teacher', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'teacher-u1',
      role: 'teacher',
      status: 'active',
    });
    const res = await request(app)
      .get('/student/chat/landing')
      .query(scopeQuery)
      .set(teacherToken);
    expect(res.status).toBe(403);
  });

  test('GET /student/chat/landing returns landing payload', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .get('/student/chat/landing')
      .query(scopeQuery)
      .set(studentToken);

    expect(res.status).toBe(200);
    expect(res.body.data.sections[0].title).toBe('School Announcement');
    expect(getStudentChatLanding).toHaveBeenCalled();
  });

  test('GET /student/chat/contacts returns sectioned picker', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .get('/student/chat/contacts')
      .query(scopeQuery)
      .set(studentToken);

    expect(res.status).toBe(200);
    expect(res.body.data.sections[0].contacts).toHaveLength(1);
    expect(getStudentChatContacts).toHaveBeenCalled();
  });

  test('POST /student/chat/dm 400 without participantUserId', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .post('/student/chat/dm')
      .query(scopeQuery)
      .set(studentToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/participantUserId/i);
  });

  test('POST /student/fees still blocked by read-only guard', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .post('/student/fees')
      .query(scopeQuery)
      .set(studentToken)
      .send({});

    expect(res.status).toBe(405);
    expect(res.body.message).toMatch(/read-only/i);
  });

  test('POST /student/chat/dm opens direct message', async () => {
    mockStudentPortalReady();
    const res = await request(app)
      .post('/student/chat/dm')
      .query(scopeQuery)
      .set(studentToken)
      .send({ participantUserId: 'teacher-u1' });

    expect(res.status).toBe(201);
    expect(res.body.data.roomId).toBe('dm-1');
    expect(openStudentDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: mockStudentRecord.id }),
      'teacher-u1',
    );
  });
});

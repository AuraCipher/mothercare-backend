/**
 * M1 — UploadSession HTTP contract tests (supertest + mocked Prisma).
 *
 * Covers: create 201 / idempotent-reuse 200, validation 400s,
 * get + cancel happy paths, cross-user IDOR (404), terminal/expired
 * guards (409/410), and unauthenticated 401s. The normal single-shot
 * POST /api/upload path is untouched (see upload regression suite).
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

jest.mock(
  '../../../src/modules/chat/services/teacher-app-chat-permissions.service',
  () => ({ teacherAppChatAllowsAttachments: jest.fn().mockResolvedValue(true) }),
);

const ownerToken = getAuthHeader(generateTestToken('user-owner', 'super_admin'));
const strangerToken = getAuthHeader(generateTestToken('user-stranger', 'super_admin'));

const BODY = {
  purpose: 'document',
  originalFilename: 'report.pdf',
  mimeType: 'application/pdf',
  expectedSize: 1024,
  idempotencyKey: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

function sessionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'sess-1',
    userId: 'user-owner',
    idempotencyKey: BODY.idempotencyKey,
    status: 'INITIATED',
    purpose: 'document',
    originalFilename: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 1024,
    bytesUploaded: 0,
    storageKey: 'documents/general/2026/09/uuid.pdf',
    providerUploadId: null,
    providerState: null,
    checksum: null,
    fileRecordId: null,
    entityType: null,
    entityId: null,
    roomId: null,
    academicYearId: null,
    metadata: null,
    retryCount: 0,
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

describe('POST /api/upload-sessions', () => {
  beforeEach(() => {
    (prismaMock.uploadSession.create as jest.Mock).mockResolvedValue(sessionRow());
  });

  test('creates a session (201) without provider internals', async () => {
    const res = await request(app).post('/api/upload-sessions').set(ownerToken).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'sess-1', status: 'INITIATED', expectedSize: 1024 });
    expect(res.body.data.providerUploadId).toBeUndefined();
    expect(res.body.data.providerState).toBeUndefined();
    expect(res.body.data.storageKey).toBeUndefined();
  });

  test('idempotent replay returns 200 with created:false', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['userId', 'idempotencyKey'] },
    });
    (prismaMock.uploadSession.create as jest.Mock).mockRejectedValueOnce(p2002);
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValueOnce(sessionRow());
    const res = await request(app).post('/api/upload-sessions').set(ownerToken).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.data.id).toBe('sess-1');
  });

  test('validation failures are 400', async () => {
    const res = await request(app)
      .post('/api/upload-sessions')
      .set(ownerToken)
      .send({ ...BODY, purpose: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('oversize is rejected with the purpose cap message', async () => {
    const res = await request(app)
      .post('/api/upload-sessions')
      .set(ownerToken)
      .send({ ...BODY, expectedSize: 21 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/max 20MB/i);
  });

  test('unauthenticated create is 401', async () => {
    const res = await request(app).post('/api/upload-sessions').send(BODY);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/upload-sessions/:id', () => {
  test('owner reads authoritative state', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'UPLOADING', bytesUploaded: 512 }),
    );
    const res = await request(app).get('/api/upload-sessions/sess-1').set(ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'UPLOADING', bytesUploaded: 512 });
  });

  test('stranger gets 404 (no existence oracle)', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    const res = await request(app).get('/api/upload-sessions/sess-1').set(strangerToken);
    expect(res.status).toBe(404);
  });

  test('unauthenticated read is 401', async () => {
    const res = await request(app).get('/api/upload-sessions/sess-1');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/upload-sessions/:id', () => {
  test('owner cancels an active session', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock)
      .mockResolvedValueOnce(sessionRow({ status: 'UPLOADING' }))
      .mockResolvedValueOnce(sessionRow({ status: 'CANCELLED' }));
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const res = await request(app).delete('/api/upload-sessions/sess-1').set(ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  test('stranger cannot cancel (404)', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    const res = await request(app).delete('/api/upload-sessions/sess-1').set(strangerToken);
    expect(res.status).toBe(404);
  });

  test('cancelling a completed session is 409', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }),
    );
    const res = await request(app).delete('/api/upload-sessions/sess-1').set(ownerToken);
    expect(res.status).toBe(409);
  });

  test('cancelling an expired session is 410', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'INITIATED', expiresAt: new Date('2020-01-01T00:00:00Z') }),
    );
    const res = await request(app).delete('/api/upload-sessions/sess-1').set(ownerToken);
    expect(res.status).toBe(410);
  });
});

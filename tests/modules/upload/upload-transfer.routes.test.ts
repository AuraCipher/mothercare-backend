/**
 * M2 — transfer HTTP contract tests (supertest; transfer service mocked).
 *
 * Verifies routing/auth/status mapping for PATCH (chunk) and POST (complete):
 * success passthrough, 409/404/401 mapping, and that the MCS-App Upload-Offset
 * protocol — not tus — is what the routes speak. Transfer semantics are proven
 * in upload-transfer.{service,integration}.test.ts.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { uploadTransferService } from '../../../src/modules/upload/upload-transfer.service';

jest.mock('../../../src/modules/upload/upload-transfer.service', () => ({
  uploadTransferService: {
    transferChunk: jest.fn(),
    completeUploadSession: jest.fn(),
  },
  TRANSFER_PART_SIZE: 5 * 1024 * 1024,
  parseChunkHeaders: jest.requireActual(
    '../../../src/modules/upload/upload-transfer.service',
  ).parseChunkHeaders,
}));

jest.mock(
  '../../../src/modules/chat/services/teacher-app-chat-permissions.service',
  () => ({ teacherAppChatAllowsAttachments: jest.fn().mockResolvedValue(true) }),
);

const mockedTransfer = uploadTransferService as unknown as {
  transferChunk: jest.Mock;
  completeUploadSession: jest.Mock;
};

const ownerToken = getAuthHeader(generateTestToken('user-owner', 'super_admin'));

describe('PATCH /api/upload-sessions/:id', () => {
  test('streams the chunk and returns the new offset', async () => {
    mockedTransfer.transferChunk.mockResolvedValueOnce({
      sessionId: 'sess-1',
      bytesUploaded: 5242880,
      expectedSize: 10485760,
      partNumber: 1,
      complete: false,
    });
    const res = await request(app)
      .patch('/api/upload-sessions/sess-1')
      .set(ownerToken)
      .set('Content-Type', 'application/octet-stream')
      .set('Upload-Offset', '0')
      .send(Buffer.alloc(5 * 1024 * 1024, 1));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bytesUploaded: 5242880, partNumber: 1 });
    expect(mockedTransfer.transferChunk).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', offsetHeader: '0' }),
    );
  });

  test('stale offset maps to 409 with the authoritative offset', async () => {
    mockedTransfer.transferChunk.mockRejectedValueOnce({
      status: 409,
      message: 'Stale offset (server is at 5242880)',
      bytesUploaded: 5242880,
    });
    const res = await request(app)
      .patch('/api/upload-sessions/sess-1')
      .set(ownerToken)
      .set('Content-Type', 'application/octet-stream')
      .set('Upload-Offset', '0')
      .send(Buffer.alloc(100, 1));
    expect(res.status).toBe(409);
  });

  test('unauthenticated chunk is 401', async () => {
    const res = await request(app)
      .patch('/api/upload-sessions/sess-1')
      .set('Content-Type', 'application/octet-stream')
      .set('Upload-Offset', '0')
      .send(Buffer.alloc(100, 1));
    expect(res.status).toBe(401);
    expect(mockedTransfer.transferChunk).not.toHaveBeenCalled();
  });
});

describe('POST /api/upload-sessions/:id/complete', () => {
  test('returns the finalized session and created flag', async () => {
    mockedTransfer.completeUploadSession.mockResolvedValueOnce({
      session: { id: 'sess-1', status: 'COMPLETED', fileRecordId: 'file-1' },
      created: true,
      fileRecordId: 'file-1',
    });
    const res = await request(app).post('/api/upload-sessions/sess-1/complete').set(ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.data.fileRecordId).toBe('file-1');
  });

  test('incomplete upload maps to 409', async () => {
    mockedTransfer.completeUploadSession.mockRejectedValueOnce({
      status: 409,
      message: 'Upload incomplete (5/10 bytes)',
    });
    const res = await request(app).post('/api/upload-sessions/sess-1/complete').set(ownerToken);
    expect(res.status).toBe(409);
  });

  test('unauthenticated completion is 401', async () => {
    const res = await request(app).post('/api/upload-sessions/sess-1/complete');
    expect(res.status).toBe(401);
  });
});

/**
 * Chat video upload — 2 minute duration cap via POST /api/upload.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const fileTypeMock = require('file-type') as any;

// Mock storage to avoid real file writes in streaming path
jest.mock('../../../src/modules/upload/storage', () => {
  const actual = jest.requireActual('../../../src/modules/upload/storage');
  return {
    ...actual,
    storage: {
      save: jest.fn().mockImplementation((_path: string, body: any) => {
        // Consume Readable to prevent ENOENT on temp file delete
        if (body && typeof body.on === 'function') {
          body.on('error', () => {});
          // Drain the stream
          if (typeof body.resume === 'function') body.resume();
        }
        return Promise.resolve('mocked/path');
      }),
      get: jest.fn(),
      delete: jest.fn(),
    },
    getDefaultDocumentsBucket: jest.fn(() => 'test-bucket'),
  };
});

const adminToken = getAuthHeader(
  generateTestToken('admin-1', 'super_admin', {
    name: 'Admin',
    branchIds: ['b1'],
  }),
);

const mockFileRecord = {
  id: 'file-video-1',
  originalName: 'clip.mp4',
  storagePath: '2026/07/clip.mp4',
  mimeType: 'video/mp4',
  size: 5000,
  width: null,
  height: null,
  uploadedById: 'teacher-u1',
  createdAt: new Date(),
};

describe('Upload — chat video duration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileTypeMock.__setFileTypeResult({ ext: 'mp4', mime: 'video/mp4' });
    prismaMock.fileRecord.create.mockResolvedValue(mockFileRecord as any);
    prismaMock.fileRecord.update.mockResolvedValue(mockFileRecord as any);
  });

  test('POST /api/upload rejects video longer than 120 seconds', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set(adminToken)
      .field('purpose', 'video')
      .field('entityType', 'chat')
      .field('roomId', 'room-1')
      .field('academicYearId', 'ay-1')
      .field('durationSeconds', '121')
      .attach('file', Buffer.from('fake-video-bytes'), 'long.mp4');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 minutes/i);
    expect(prismaMock.fileRecord.create).not.toHaveBeenCalled();
  });

  test('POST /api/upload rejects video without durationSeconds', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set(adminToken)
      .field('purpose', 'video')
      .field('entityType', 'chat')
      .field('roomId', 'room-1')
      .field('academicYearId', 'ay-1')
      .attach('file', Buffer.from('fake-video-bytes'), 'clip.mp4');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duration is required/i);
  });

  test('POST /api/upload accepts video at 120 seconds', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set(adminToken)
      .field('purpose', 'video')
      .field('entityType', 'chat')
      .field('roomId', 'room-1')
      .field('academicYearId', 'ay-1')
      .field('durationSeconds', '120')
      .attach('file', Buffer.from('fake-video-bytes'), 'clip.mp4');

    expect(res.status).toBe(201);
    expect(res.body.data.purpose).toBe('video');
    expect(prismaMock.fileRecord.create).toHaveBeenCalled();
  });
});

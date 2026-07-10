/**
 * Chat video upload — 2 minute duration cap via POST /api/upload.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const multerMock = require('multer') as any;
const fileTypeMock = require('file-type') as any;

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
    multerMock.__resetMockFile();
    fileTypeMock.__setFileTypeResult({ ext: 'mp4', mime: 'video/mp4' });
    prismaMock.fileRecord.create.mockResolvedValue(mockFileRecord as any);
    prismaMock.fileRecord.update.mockResolvedValue(mockFileRecord as any);
  });

  test('POST /api/upload rejects video longer than 120 seconds', async () => {
    multerMock.__setMockFile(
      {
        buffer: Buffer.from('fake-video-bytes'),
        originalname: 'long.mp4',
        mimetype: 'video/mp4',
        size: 50_000_000,
      },
      {
        purpose: 'video',
        entityType: 'chat',
        roomId: 'room-1',
        academicYearId: 'ay-1',
        durationSeconds: '121',
      },
    );

    const res = await request(app).post('/api/upload').set(adminToken);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 minutes/i);
    expect(prismaMock.fileRecord.create).not.toHaveBeenCalled();
  });

  test('POST /api/upload rejects video without durationSeconds', async () => {
    multerMock.__setMockFile(
      {
        buffer: Buffer.from('fake-video-bytes'),
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        size: 1000,
      },
      {
        purpose: 'video',
        entityType: 'chat',
        roomId: 'room-1',
        academicYearId: 'ay-1',
      },
    );

    const res = await request(app).post('/api/upload').set(adminToken);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duration is required/i);
  });

  test('POST /api/upload accepts video at 120 seconds', async () => {
    multerMock.__setMockFile(
      {
        buffer: Buffer.from('fake-video-bytes'),
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        size: 1000,
      },
      {
        purpose: 'video',
        entityType: 'chat',
        roomId: 'room-1',
        academicYearId: 'ay-1',
        durationSeconds: '120',
      },
    );

    const res = await request(app).post('/api/upload').set(adminToken);

    expect(res.status).toBe(201);
    expect(res.body.data.purpose).toBe('video');
    expect(prismaMock.fileRecord.create).toHaveBeenCalled();
  });
});

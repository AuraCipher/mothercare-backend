import { prismaMock } from '../../mocks/prisma';
import { UploadService } from '../../../src/modules/upload/upload.service';

jest.mock('../../../src/modules/upload/media.pipeline', () => ({
  processUploadBuffer: jest.fn(),
  normalizePurpose: jest.fn((purpose?: string) => purpose || 'document'),
}));

jest.mock('../../../src/modules/upload/storage', () => ({
  getDefaultDocumentsBucket: jest.fn(() => 'test-bucket'),
  storage: {
    save: jest.fn().mockResolvedValue(undefined),
  },
}));

import { processUploadBuffer } from '../../../src/modules/upload/media.pipeline';
import { storage } from '../../../src/modules/upload/storage';

const mockProcessUpload = processUploadBuffer as jest.MockedFunction<typeof processUploadBuffer>;

describe('UploadService — chat video duration', () => {
  const service = new UploadService();
  const videoBuffer = Buffer.from('fake-video');

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessUpload.mockResolvedValue({
      buffer: videoBuffer,
      mimeType: 'video/mp4',
      ext: 'mp4',
      width: null,
      height: null,
    });
    (prismaMock.fileRecord.create as jest.Mock).mockResolvedValue({
      id: 'file-v1',
      originalName: 'clip.mp4',
    });
    (prismaMock.fileRecord.update as jest.Mock).mockResolvedValue({});
  });

  test('rejects video without durationSeconds', async () => {
    await expect(
      service.uploadFile(videoBuffer, 'clip.mp4', { purpose: 'video' }),
    ).rejects.toMatchObject({ status: 400, message: 'Video duration is required' });

    expect(mockProcessUpload).not.toHaveBeenCalled();
  });

  test('rejects video longer than 120 seconds', async () => {
    await expect(
      service.uploadFile(videoBuffer, 'clip.mp4', {
        purpose: 'video',
        durationSeconds: 120.1,
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Videos must be 2 minutes or shorter' });

    expect(mockProcessUpload).not.toHaveBeenCalled();
  });

  test('accepts video at exactly 120 seconds', async () => {
    const result = await service.uploadFile(videoBuffer, 'clip.mp4', {
      purpose: 'video',
      durationSeconds: 120,
      roomId: 'room-1',
      academicYearId: 'ay-1',
    });

    expect(result.purpose).toBe('video');
    expect(mockProcessUpload).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 1024 * 1024 * 1024 }),
    );
    expect(storage.save).toHaveBeenCalled();
    expect(prismaMock.fileRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ durationSeconds: 120 }),
        }),
      }),
    );
  });

  test('accepts short video under 120 seconds', async () => {
    const result = await service.uploadFile(videoBuffer, 'clip.mp4', {
      purpose: 'video',
      durationSeconds: 45.5,
    });

    expect(result.mimeType).toBe('video/mp4');
    expect(prismaMock.fileRecord.create).toHaveBeenCalled();
  });

  test('chat image still uses 20MB limit', async () => {
    await service.uploadFile(Buffer.from('img'), 'photo.jpg', { purpose: 'chat' });

    expect(mockProcessUpload).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 20 * 1024 * 1024 }),
    );
  });
});

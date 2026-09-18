/**
 * M1 — UploadSession service unit tests (mocked Prisma).
 *
 * Covers: creation validation matrix, state-machine transitions,
 * owner-vs-stranger authorization, idempotent create reuse (P2002),
 * cancel/finalize guards, expiry derivation, and serialization
 * (provider internals never leak).
 */
import { prismaMock } from '../../mocks/prisma';
import {
  assertValidTransition,
  effectiveStatus,
  isSessionExpired,
  isTerminalStatus,
  serializeUploadSession,
  uploadSessionService,
} from '../../../src/modules/upload/upload-session.service';

jest.mock(
  '../../../src/modules/chat/services/teacher-app-chat-permissions.service',
  () => ({ teacherAppChatAllowsAttachments: jest.fn().mockResolvedValue(true) }),
);

const BASE_INPUT = {
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
    idempotencyKey: BASE_INPUT.idempotencyKey,
    status: 'INITIATED',
    purpose: 'document',
    originalFilename: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 1024,
    bytesUploaded: 0,
    storageKey: 'documents/general/2026/09/uuid.pdf',
    providerUploadId: 'r2-internal-id',
    providerState: { parts: [] },
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

describe('UploadSession — state machine (pure)', () => {
  test('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    for (const s of ['INITIATED', 'UPLOADING', 'COMPLETING'] as const) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });

  test('valid transitions pass', () => {
    expect(() => assertValidTransition('INITIATED', 'UPLOADING')).not.toThrow();
    expect(() => assertValidTransition('UPLOADING', 'COMPLETING')).not.toThrow();
    expect(() => assertValidTransition('COMPLETING', 'COMPLETED')).not.toThrow();
    expect(() => assertValidTransition('INITIATED', 'CANCELLED')).not.toThrow();
    expect(() => assertValidTransition('UPLOADING', 'EXPIRED')).not.toThrow();
  });

  test('invalid transitions throw 409', () => {
    expect(() => assertValidTransition('COMPLETED', 'UPLOADING')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => assertValidTransition('CANCELLED', 'UPLOADING')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => assertValidTransition('EXPIRED', 'UPLOADING')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => assertValidTransition('FAILED', 'UPLOADING')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    // No regression out of COMPLETED, and no cancel during finalize window.
    expect(() => assertValidTransition('COMPLETING', 'CANCELLED')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => assertValidTransition('INITIATED', 'COMPLETED')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  test('expiry is derived deterministically from the clock', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const active = sessionRow({ status: 'UPLOADING', expiresAt: new Date('2026-09-19T12:00:00Z') });
    expect(isSessionExpired(active, now)).toBe(false);
    expect(effectiveStatus(active, now)).toBe('UPLOADING');

    const stale = sessionRow({ status: 'UPLOADING', expiresAt: new Date('2026-09-18T11:59:59Z') });
    expect(isSessionExpired(stale, now)).toBe(true);
    expect(effectiveStatus(stale, now)).toBe('EXPIRED');

    // Terminal rows never derive EXPIRED.
    const done = sessionRow({ status: 'COMPLETED', expiresAt: new Date('2020-01-01T00:00:00Z') });
    expect(isSessionExpired(done, now)).toBe(false);
    expect(effectiveStatus(done, now)).toBe('COMPLETED');
  });
});

describe('UploadSession — serialization', () => {
  test('never exposes provider internals', () => {
    const out = serializeUploadSession(sessionRow()) as unknown as Record<string, unknown>;
    expect(out.providerUploadId).toBeUndefined();
    expect(out.providerState).toBeUndefined();
    expect(out.storageKey).toBeUndefined();
    expect(out.checksum).toBeUndefined();
    expect(out.userId).toBeUndefined();
    expect(out.idempotencyKey).toBeUndefined();
    expect(out.id).toBe('sess-1');
    expect(out.status).toBe('INITIATED');
    expect(out.expectedSize).toBe(1024);
    expect(out.bytesUploaded).toBe(0);
    expect(out.fileUrl).toBeNull();
  });

  test('completed session exposes the FileRecord link', () => {
    const out = serializeUploadSession(sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }));
    expect(out.status).toBe('COMPLETED');
    expect(out.fileRecordId).toBe('file-9');
    expect(out.fileUrl).toBe('/api/uploads/file-9');
  });
});

describe('UploadSession — creation validation', () => {
  beforeEach(() => {
    (prismaMock.uploadSession.create as jest.Mock).mockResolvedValue(sessionRow());
  });

  test('accepts a valid session', async () => {
    const { session, created } = await uploadSessionService.createSession('user-owner', BASE_INPUT);
    expect(created).toBe(true);
    expect(session.status).toBe('INITIATED');
    expect(prismaMock.uploadSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-owner',
          purpose: 'document',
          expectedSize: 1024,
          bytesUploaded: 0,
        }),
      }),
    );
  });

  test('rejects unauthenticated creation', async () => {
    await expect(uploadSessionService.createSession(undefined, BASE_INPUT)).rejects.toMatchObject({
      status: 401,
    });
  });

  test.each([
    [{ ...BASE_INPUT, purpose: 'nope' }, 'purpose must be one of'],
    [{ ...BASE_INPUT, purpose: undefined }, 'purpose must be one of'],
    [{ ...BASE_INPUT, originalFilename: '   ' }, 'originalFilename is required'],
    [{ ...BASE_INPUT, originalFilename: 'a'.repeat(256) }, 'at most 255'],
    [{ ...BASE_INPUT, mimeType: '' }, 'mimeType is required'],
    [{ ...BASE_INPUT, mimeType: 'not-a-mime' }, 'type/subtype'],
    [{ ...BASE_INPUT, expectedSize: 0 }, 'positive integer'],
    [{ ...BASE_INPUT, expectedSize: 21 * 1024 * 1024 }, 'max 20MB'],
    [{ ...BASE_INPUT, expectedSize: 1.5 }, 'positive integer'],
    [{ ...BASE_INPUT, idempotencyKey: '' }, 'idempotencyKey is required'],
    [{ ...BASE_INPUT, idempotencyKey: 'short' }, '8-64'],
    [{ ...BASE_INPUT, checksum: 'zz' }, 'sha256'],
    [{ ...BASE_INPUT, entityType: 'nope' }, 'entityType must be one of'],
    [{ ...BASE_INPUT, entityId: 'x1' }, 'entityType is required when entityId'],
    [{ ...BASE_INPUT, metadata: [1, 2] }, 'must be a JSON object'],
    [{ ...BASE_INPUT, purpose: 'video' }, 'Video duration is required'],
    [
      { ...BASE_INPUT, purpose: 'video', metadata: { durationSeconds: 601 } },
      '10 minutes or shorter',
    ],
  ])('rejects invalid input: %p', async (input, message) => {
    await expect(uploadSessionService.createSession('user-owner', input as any)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(message),
    });
    expect(prismaMock.uploadSession.create).not.toHaveBeenCalled();
  });

  test('video with valid duration passes validation', async () => {
    (prismaMock.uploadSession.create as jest.Mock).mockResolvedValue(
      sessionRow({ purpose: 'video', expectedSize: 100 }),
    );
    await uploadSessionService.createSession('user-owner', {
      ...BASE_INPUT,
      purpose: 'video',
      expectedSize: 100,
      metadata: { durationSeconds: 45.5 },
    });
    expect(prismaMock.uploadSession.create).toHaveBeenCalled();
  });

  test('unknown room is 404', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      uploadSessionService.createSession('user-owner', { ...BASE_INPUT, roomId: 'room-x' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.uploadSession.create).not.toHaveBeenCalled();
  });

  test('non-member of an existing room is 403', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-x',
      branchId: null,
      academicYearId: 'ay-1',
    });
    (prismaMock.chatRoomMember.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      uploadSessionService.createSession('user-owner', { ...BASE_INPUT, roomId: 'room-x' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.uploadSession.create).not.toHaveBeenCalled();
  });

  test('academicYear mismatch with the room is 400', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-x',
      branchId: null,
      academicYearId: 'ay-1',
    });
    await expect(
      uploadSessionService.createSession('user-owner', {
        ...BASE_INPUT,
        roomId: 'room-x',
        academicYearId: 'ay-other',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.uploadSession.create).not.toHaveBeenCalled();
  });

  test('idempotent replay on P2002 returns the existing session', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['userId', 'idempotencyKey'] },
    });
    (prismaMock.uploadSession.create as jest.Mock).mockRejectedValueOnce(p2002);
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValueOnce(
      sessionRow({ status: 'UPLOADING', bytesUploaded: 512 }),
    );
    const { session, created } = await uploadSessionService.createSession('user-owner', BASE_INPUT);
    expect(created).toBe(false);
    expect(session.status).toBe('UPLOADING');
    expect(session.bytesUploaded).toBe(512);
  });
});

describe('UploadSession — authorization', () => {
  test('owner can retrieve; stranger gets 404 (no oracle)', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    await expect(uploadSessionService.getSession('sess-1', 'user-owner')).resolves.toMatchObject({
      id: 'sess-1',
    });
    await expect(uploadSessionService.getSession('sess-1', 'user-stranger')).rejects.toMatchObject({
      status: 404,
    });
    await expect(uploadSessionService.getSession('sess-1', undefined)).rejects.toMatchObject({
      status: 401,
    });
  });

  test('missing session is 404', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(uploadSessionService.getSession('nope', 'user-owner')).rejects.toMatchObject({
      status: 404,
    });
  });

  test('stranger cannot cancel', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    await expect(
      uploadSessionService.cancelSession('sess-1', 'user-stranger'),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.uploadSession.updateMany).not.toHaveBeenCalled();
  });

  test('cancel of terminal session is 409 and writes nothing', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }),
    );
    await expect(uploadSessionService.cancelSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 409,
    });
    expect(prismaMock.uploadSession.updateMany).not.toHaveBeenCalled();
  });

  test('cancel of expired session is 410', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'INITIATED', expiresAt: new Date('2020-01-01T00:00:00Z') }),
    );
    await expect(uploadSessionService.cancelSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 410,
    });
    expect(prismaMock.uploadSession.updateMany).not.toHaveBeenCalled();
  });

  test('owner cancel flips state atomically', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock)
      .mockResolvedValueOnce(sessionRow({ status: 'UPLOADING' }))
      .mockResolvedValueOnce(sessionRow({ status: 'CANCELLED' }));
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const out = await uploadSessionService.cancelSession('sess-1', 'user-owner');
    expect(out.status).toBe('CANCELLED');
    expect(prismaMock.uploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});

describe('UploadSession — finalize guards', () => {
  function mockTx() {
    const tx = {
      fileRecord: { create: jest.fn(), update: jest.fn() },
      uploadSession: { update: jest.fn() },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
    return tx;
  }

  test('finalize requires transferred bytes (INITIATED cannot finalize)', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(sessionRow());
    await expect(uploadSessionService.finalizeSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 409,
    });
  });

  test('finalize requires bytesUploaded == expectedSize', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'UPLOADING', bytesUploaded: 100, expectedSize: 1024 }),
    );
    await expect(uploadSessionService.finalizeSession('sess-1', 'user-owner')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('incomplete'),
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('repeated finalize of COMPLETED returns the link without new writes', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }),
    );
    const { session, created } = await uploadSessionService.finalizeSession('sess-1', 'user-owner');
    expect(created).toBe(false);
    expect(session.fileRecordId).toBe('file-9');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('successful finalize creates one FileRecord and links it in-transaction', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock)
      .mockResolvedValueOnce(sessionRow({ status: 'UPLOADING', bytesUploaded: 1024 }))
      .mockResolvedValueOnce(sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }));
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const tx = mockTx();
    tx.fileRecord.create.mockResolvedValue({ id: 'file-9' });
    tx.fileRecord.update.mockResolvedValue({});
    tx.uploadSession.update.mockResolvedValue(sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }));

    const { session, created } = await uploadSessionService.finalizeSession('sess-1', 'user-owner');
    expect(created).toBe(true);
    expect(session.fileRecordId).toBe('file-9');
    expect(tx.fileRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.fileRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storagePath: 'documents/general/2026/09/uuid.pdf', size: 1024 }),
      }),
    );
    expect(tx.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', fileRecordId: 'file-9' }) }),
    );
  });

  test('claim loser converges on the winner link after COMPLETING', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock)
      .mockResolvedValueOnce(sessionRow({ status: 'UPLOADING', bytesUploaded: 1024 }))
      .mockResolvedValueOnce(sessionRow({ status: 'COMPLETING' }))
      .mockResolvedValueOnce(sessionRow({ status: 'COMPLETED', fileRecordId: 'file-9' }));
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const { session, created } = await uploadSessionService.finalizeSession('sess-1', 'user-owner');
    expect(created).toBe(false);
    expect(session.fileRecordId).toBe('file-9');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('finalize parks FAILED on transaction error (never falsely COMPLETED)', async () => {
    (prismaMock.uploadSession.findUnique as jest.Mock).mockResolvedValue(
      sessionRow({ status: 'UPLOADING', bytesUploaded: 1024 }),
    );
    (prismaMock.uploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prismaMock.$transaction as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(uploadSessionService.finalizeSession('sess-1', 'user-owner')).rejects.toThrow('db down');
    expect(prismaMock.uploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
});

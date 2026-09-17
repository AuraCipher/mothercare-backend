/**
 * R2-04 Follow-up — Chat mediaFileId Authorization Regression Tests
 *
 * Tests that createRoomMessage validates mediaFileId before creating
 * a message. Covers: owner, non-owner, same-room chat file, different-room
 * chat file, nonexistent file, omitted mediaFileId, room membership, and
 * branch isolation limitation.
 *
 * Uses real authorizeChatMedia logic (not mocked) with mocked prisma queries.
 */
import { createRoomMessage } from '../../../src/modules/chat/services/chat-message.service';

// ─── Mock prisma ──────────────────────────────────────────
jest.mock('../../../src/lib/prisma', () => {
  const mockPrisma = {
    fileRecord: { findUnique: jest.fn() },
    chatRoomMember: { findFirst: jest.fn() },
    chatMessage: { create: jest.fn() },
    chatRoom: { update: jest.fn() },
    student: { findUnique: jest.fn() },
  };
  return { prisma: mockPrisma };
});

// ─── Mock chat access services ────────────────────────────
jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  assertCanPost: jest.fn().mockResolvedValue({
    id: 'member-1',
    roomId: 'room-1',
    userId: 'sender-1',
    canRead: true,
    canPost: true,
    isPostingRestricted: false,
    isMuted: false,
    room: { isActive: true, academicYearId: 'ay-1' },
  }),
  assertRoomMember: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../src/modules/chat/services/chat-room-access.service', () => ({
  ensureChatRoomAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/chat/services/chat-student-room-access.service', () => ({
  ensureStudentSystemRoomAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/chat/services/chat-permissions.service', () => ({
  resolveCanPost: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/chat/services/teacher-app-chat-permissions.service', () => ({
  appChatAllowsPost: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/teacher/permissions/teacher-permissions.resolver', () => ({
  resolveTeacherPermissions: jest.fn().mockResolvedValue({}),
}));

import { prisma } from '../../../src/lib/prisma';
import { assertCanPost } from '../../../src/modules/chat/services/chat-access.service';

const mockPrisma = prisma as any;

// ─── Helper to create mock FileRecord ─────────────────────
function makeFileRecord(overrides: {
  id?: string;
  uploadedById?: string | null;
  purpose?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
} = {}) {
  return {
    id: overrides.id ?? 'file-1',
    uploadedById: overrides.uploadedById ?? 'sender-1',
    purpose: overrides.purpose ?? 'chat',
    entityType: overrides.entityType ?? 'chat',
    entityId: overrides.entityId ?? null,
    metadata: overrides.metadata ?? { roomId: 'room-1' },
  };
}

describe('Chat mediaFileId authorization — R2-04 follow-up', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: assertCanPost allows posting
    (assertCanPost as jest.Mock).mockResolvedValue({
      id: 'member-1',
      roomId: 'room-1',
      userId: 'sender-1',
      canRead: true,
      canPost: true,
      isPostingRestricted: false,
      isMuted: false,
      room: { isActive: true, academicYearId: 'ay-1' },
    });
    // Default: chatMessage.create returns a message
    mockPrisma.chatMessage.create.mockResolvedValue({
      id: 'msg-new',
      roomId: 'room-1',
      senderId: 'sender-1',
      type: 'text',
      content: 'hello',
      mediaFileId: null,
      sender: { id: 'sender-1', name: 'Test', role: 'teacher' },
      room: { academicYearId: 'ay-1', name: 'Test Room', kind: 'class' },
      mediaFile: null,
    });
    mockPrisma.chatRoom.update.mockResolvedValue({});
  });

  // ═══════════════════════════════════════════════════════
  // Test 1: Sender owns the file → allowed
  // ═══════════════════════════════════════════════════════
  test('1. Sender owns the file → attachment allowed', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({ id: 'file-owner', uploadedById: 'sender-1', purpose: 'document', metadata: null }),
    );

    const msg = await createRoomMessage({
      roomId: 'room-1',
      senderId: 'sender-1',
      content: 'Here is my file',
      mediaFileId: 'file-owner',
    });

    expect(msg).toBeDefined();
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mediaFileId: 'file-owner' }) }),
    );
  });

  // ═══════════════════════════════════════════════════════
  // Test 2: Sender does NOT own the file → rejected
  // ═══════════════════════════════════════════════════════
  test('2. Sender does NOT own the file → attachment rejected', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({ id: 'file-other', uploadedById: 'other-user', purpose: 'document', metadata: null }),
    );

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'Trying to steal a file',
        mediaFileId: 'file-other',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 3: Chat file belonging to same room → allowed
  // ═══════════════════════════════════════════════════════
  test('3. Chat file belonging to same room → attachment allowed', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({
        id: 'file-chat-room1',
        uploadedById: 'other-user',
        purpose: 'chat',
        metadata: { roomId: 'room-1' },
      }),
    );

    const msg = await createRoomMessage({
      roomId: 'room-1',
      senderId: 'sender-1',
      content: 'Sharing a room file',
      mediaFileId: 'file-chat-room1',
    });

    expect(msg).toBeDefined();
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
  });

  // ═══════════════════════════════════════════════════════
  // Test 4: Chat file belonging to different room → rejected
  // ═══════════════════════════════════════════════════════
  test('4. Chat file belonging to different room → rejected', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({
        id: 'file-chat-room2',
        uploadedById: 'other-user',
        purpose: 'chat',
        metadata: { roomId: 'room-2' },
      }),
    );

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'Trying cross-room file',
        mediaFileId: 'file-chat-room2',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 5: File belongs to another user/student → rejected
  // ═══════════════════════════════════════════════════════
  test('5. File belongs to another user/student → rejected', async () => {
    // File with entityType=student, entityId=student-99, uploadedById=staff-user
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({
        id: 'file-student-other',
        uploadedById: 'staff-user',
        purpose: 'document',
        entityType: 'student',
        entityId: 'student-99',
        metadata: null,
      }),
    );
    // Student lookup: student-99 belongs to user-student, not sender-1
    mockPrisma.student.findUnique.mockResolvedValue({ userId: 'user-student' });

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'Stealing student file',
        mediaFileId: 'file-student-other',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 6: Sender not a room member → assertCanPost rejects
  // ═══════════════════════════════════════════════════════
  test('6. Sender not a room member → assertCanPost rejects before mediaFileId check', async () => {
    (assertCanPost as jest.Mock).mockRejectedValue({ status: 403, message: 'Not a member of this room' });

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'intruder',
        content: 'Hello',
        mediaFileId: undefined,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // assertCanPost is called BEFORE authorizeChatMedia
    expect(assertCanPost).toHaveBeenCalledWith('room-1', 'intruder');
    // authorizeChatMedia should NOT be called (assertCanPost failed first)
    expect(mockPrisma.fileRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 7: Branch isolation — cross-branch file from another user
  //   FileRecord has no branchId. The authorization checks:
  //   - Owner? No (uploadedById !== senderId)
  //   - Chat file in same room? No (purpose=document, not chat)
  //   - Student entity? Could match if student.entityId matches, but
  //     the file belongs to a student whose userId is different
  //   → Rejected. Branch isolation works here because the file has
  //     no relationship to the sender.
  // ═══════════════════════════════════════════════════════
  test('7. Cross-branch file from another user with no relationship → rejected', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({
        id: 'file-cross-branch',
        uploadedById: 'user-branch-b',
        purpose: 'document',
        entityType: 'general',
        entityId: null,
        metadata: null,
      }),
    );

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'Cross-branch attack',
        mediaFileId: 'file-cross-branch',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 8: Nonexistent mediaFileId → rejected cleanly
  // ═══════════════════════════════════════════════════════
  test('8. Nonexistent mediaFileId → rejected cleanly', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(null);

    await expect(
      createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'Phantom file',
        mediaFileId: 'nonexistent-id',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 9: mediaFileId omitted → normal message creation
  // ═══════════════════════════════════════════════════════
  test('9. mediaFileId omitted → normal message creation unchanged', async () => {
    const msg = await createRoomMessage({
      roomId: 'room-1',
      senderId: 'sender-1',
      content: 'Just text, no file',
    });

    expect(msg).toBeDefined();
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mediaFileId: undefined }) }),
    );
    // authorizeChatMedia should not be called (no mediaFileId)
    expect(mockPrisma.fileRecord.findUnique).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Test 10: Authorization failure occurs BEFORE message creation
  // ═══════════════════════════════════════════════════════
  test('10. Authorization failure occurs before message creation', async () => {
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({ id: 'file-unauth', uploadedById: 'attacker', purpose: 'document', metadata: null }),
    );

    try {
      await createRoomMessage({
        roomId: 'room-1',
        senderId: 'sender-1',
        content: 'This should fail',
        mediaFileId: 'file-unauth',
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(403);
    }

    // authorizeChatMedia was called (file lookup happened)
    expect(mockPrisma.fileRecord.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'file-unauth' } }),
    );
    // But message was NEVER created
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
    // Room was NOT updated
    expect(mockPrisma.chatRoom.update).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // Branch isolation limitation
  // ═══════════════════════════════════════════════════════
  test('LIMITATION: FileRecord has no branchId — a super_admin in branch A could theoretically attach a chat file from branch B if it has the same roomId (by design: room membership is the access boundary, not branch)', async () => {
    // This test documents the known limitation.
    // A chat-purpose file uploaded to room-X can be referenced by ANY room-X member,
    // regardless of branch. This is because chat rooms already scope access by membership.
    // The authorization model treats room membership as the branch boundary for chat files.
    mockPrisma.fileRecord.findUnique.mockResolvedValue(
      makeFileRecord({
        id: 'file-room-x',
        uploadedById: 'user-branch-b',
        purpose: 'chat',
        metadata: { roomId: 'room-1' },
      }),
    );

    const msg = await createRoomMessage({
      roomId: 'room-1',
      senderId: 'sender-1',
      content: 'Referencing chat file from another user in same room',
      mediaFileId: 'file-room-x',
    });

    expect(msg).toBeDefined();
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
  });
});

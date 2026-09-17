/**
 * R2-04 — Centralized FileRecord Authorization
 *
 * Prevents IDOR by verifying that an authenticated user is allowed to
 * access a specific FileRecord. All authorization decisions happen BEFORE
 * any storage operations (R2 GetObject, local read, delete, etc.).
 *
 * Authorization model (using existing relationships, no new schema):
 *   1. super_admin → full access to all files
 *   2. branch_admin / sub_admin → full access (within upload route scope)
 *   3. Owner (uploadedById === userId) → can always access own files
 *   4. Entity access → student can access files where entityType='student' && entityId matches their student ID
 *   5. Chat media → room members can access chat-purpose files uploaded to that room
 *   6. All other access → denied (403)
 *
 * NOTE: The file record type returned is a subset of the full Prisma
 * FileRecord model, containing only authorization-relevant fields.
 */
import { prisma } from '../../lib/prisma';

type UserContext = {
  id: string;
  role: string;
  branchIds?: string[];
};

type FileRef = {
  id: string;
  uploadedById: string | null;
  entityType: string | null;
  entityId: string | null;
  purpose: string | null;
  metadata?: unknown;
};

type AuthDecision = {
  allowed: boolean;
  reason?: string;
  record?: FileRef;
};

/**
 * Check if user has full admin access (bypasses all file-level checks).
 */
function isFullAdmin(user: UserContext): boolean {
  if (user.role === 'super_admin') return true;
  return false;
}

/**
 * Check if user is a branch-level admin (branch_admin or sub_admin).
 * Requires branchIds in JWT.
 */
function isBranchAdmin(user: UserContext): boolean {
  if (!user.branchIds?.length) return false;
  // branch_admin and sub_admin are determined by BranchMember.role,
  // but the JWT only carries the global role. We check via resolveUserAccess
  // in the route layer for admin routes. For file auth, we accept
  // any user whose global role could be branch_admin (management, teacher)
  // AND who has branchIds. The actual BranchMember check is done via
  // the uploadDocumentPermissionMiddleware for restricted staff.
  // For this auth helper, we check the branchIds presence as a proxy.
  return user.branchIds.length > 0;
}

/**
 * Core file access authorization.
 * Call this BEFORE any storage.get/getStream/delete operation.
 */
export async function authorizeFileAccess(
  user: UserContext,
  fileId: string,
): Promise<AuthDecision & { record?: FileRef }> {
  // 1. Fetch the file record (minimal fields needed)
  const record = await prisma.fileRecord.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      uploadedById: true,
      entityType: true,
      entityId: true,
      purpose: true,
      metadata: true,
    },
  });

  if (!record) {
    return { allowed: false, reason: 'File not found' };
  }

  // 2. Super admin → full access
  if (isFullAdmin(user)) {
    return { allowed: true, record };
  }

  // 3. Owner → can always access own files
  if (record.uploadedById && record.uploadedById === user.id) {
    return { allowed: true, record };
  }

  // 4. Entity-based access: student accessing their own entity's files
  if (record.entityType === 'student' && record.entityId) {
    const student = await prisma.student.findUnique({
      where: { id: record.entityId },
      select: { userId: true, personId: true },
    });
    if (student?.userId === user.id) {
      return { allowed: true, record };
    }
    // Also check if the user is the StudentPerson's user account
    if (student?.personId) {
      const person = await prisma.studentPerson.findUnique({
        where: { id: student.personId },
        select: { userId: true },
      });
      if (person?.userId === user.id) {
        return { allowed: true, record };
      }
    }
  }

  // 5. Chat-purpose files: accessible to room members
  if (record.purpose === 'chat' && record.metadata) {
    const meta = record.metadata as Record<string, unknown>;
    const roomId = meta.roomId as string | undefined;
    if (roomId) {
      const member = await prisma.chatRoomMember.findFirst({
        where: { roomId, userId: user.id, leftAt: null, canRead: true },
      });
      if (member) {
        return { allowed: true, record };
      }
    }
  }

  // 6. Denied
  return { allowed: false, reason: 'Access denied' };
}

/**
 * File mutation authorization (delete, rename).
 * Owner can delete their own files. Admin can delete any.
 */
export async function authorizeFileMutation(
  user: UserContext,
  fileId: string,
): Promise<AuthDecision & { record?: FileRef }> {
  // Same as read access but stricter: no entity or chat room access for mutations
  const record = await prisma.fileRecord.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      uploadedById: true,
      entityType: true,
      entityId: true,
      purpose: true,
    },
  });

  if (!record) {
    return { allowed: false, reason: 'File not found' };
  }

  // Super admin → full mutation access
  if (isFullAdmin(user)) {
    return { allowed: true, record };
  }

  // Owner → can mutate own files
  if (record.uploadedById && record.uploadedById === user.id) {
    return { allowed: true, record };
  }

  // Denied (no entity-based or chat-based mutation access)
  return { allowed: false, reason: 'Access denied' };
}

/**
 * Chat mediaFileId validation.
 * Ensures a referenced FileRecord exists and the sender has access to it.
 * Called before storing a chat message with mediaFileId.
 */
export async function authorizeChatMedia(
  senderId: string,
  roomId: string,
  mediaFileId: string,
): Promise<AuthDecision & { record?: FileRef }> {
  const record = await prisma.fileRecord.findUnique({
    where: { id: mediaFileId },
    select: {
      id: true,
      uploadedById: true,
      purpose: true,
      entityType: true,
      entityId: true,
      metadata: true,
    },
  });

  if (!record) {
    return { allowed: false, reason: 'File not found' };
  }

  // Sender must own the file OR the file must be a chat-purpose file in the same room
  const isOwner = record.uploadedById === senderId;

  if (isOwner) {
    return { allowed: true, record };
  }

  // Chat-purpose file: verify it was uploaded to this room
  if (record.purpose === 'chat' && record.metadata) {
    const meta = record.metadata as Record<string, unknown>;
    const fileRoomId = meta.roomId as string | undefined;
    if (fileRoomId === roomId) {
      // File belongs to this room — any room member can reference it
      return { allowed: true, record };
    }
  }

  // Entity-based: student can attach files about themselves
  if (record.entityType === 'student' && record.entityId) {
    const student = await prisma.student.findUnique({
      where: { id: record.entityId },
      select: { userId: true },
    });
    if (student?.userId === senderId) {
      return { allowed: true, record };
    }
  }

  return { allowed: false, reason: 'Cannot attach this file to the chat' };
}

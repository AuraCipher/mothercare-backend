-- Mobile chat: communities, dynamic rooms, DMs, class roles, system feeds.
-- Replaces legacy `messages` table with `chat_messages`.

-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('school_announcement', 'class_announcement', 'group_chat', 'direct_message', 'system_attendance', 'system_payment');
CREATE TYPE "ChatRoomSource" AS ENUM ('manual', 'subject_assignment', 'system_bootstrap');
CREATE TYPE "ChatMemberAccess" AS ENUM ('owner', 'moderator', 'poster', 'member', 'observer');
CREATE TYPE "ChatMessageType" AS ENUM ('text', 'image', 'video', 'audio', 'voice_note', 'document', 'system', 'announcement');

-- Drop legacy group messages (unused by application code)
DROP TABLE IF EXISTS "messages";

-- Announcements → chat mirror link
ALTER TABLE "announcements" ADD COLUMN "chatMessageId" TEXT;

-- Chat communities (1:1 with academic class Group)
CREATE TABLE "chat_communities" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "chat_communities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_communities_groupId_key" ON "chat_communities"("groupId");
CREATE INDEX "chat_communities_academicYearId_idx" ON "chat_communities"("academicYearId");

-- Chat rooms (all channel types)
CREATE TABLE "chat_rooms" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "branchId" TEXT,
    "communityId" TEXT,
    "classGroupId" TEXT,
    "studentId" TEXT,
    "subjectId" TEXT,
    "teacherAssignmentId" TEXT,
    "kind" "ChatRoomKind" NOT NULL,
    "source" "ChatRoomSource" NOT NULL DEFAULT 'manual',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "singletonKey" TEXT,
    "onlyStaffCanPost" BOOLEAN NOT NULL DEFAULT false,
    "studentsCanPost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_rooms_teacherAssignmentId_key" ON "chat_rooms"("teacherAssignmentId");
CREATE UNIQUE INDEX "chat_rooms_singletonKey_key" ON "chat_rooms"("singletonKey");
CREATE INDEX "chat_rooms_academicYearId_kind_idx" ON "chat_rooms"("academicYearId", "kind");
CREATE INDEX "chat_rooms_communityId_kind_idx" ON "chat_rooms"("communityId", "kind");
CREATE INDEX "chat_rooms_classGroupId_idx" ON "chat_rooms"("classGroupId");
CREATE INDEX "chat_rooms_studentId_kind_idx" ON "chat_rooms"("studentId", "kind");

CREATE TABLE "chat_room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "access" "ChatMemberAccess" NOT NULL DEFAULT 'observer',
    "canPost" BOOLEAN NOT NULL DEFAULT false,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isPostingRestricted" BOOLEAN NOT NULL DEFAULT false,
    "displayTitle" TEXT,
    "classRoleAssignmentId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_room_members_roomId_userId_key" ON "chat_room_members"("roomId", "userId");
CREATE INDEX "chat_room_members_userId_leftAt_idx" ON "chat_room_members"("userId", "leftAt");

CREATE TABLE "chat_dm_threads" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "participantAId" TEXT NOT NULL,
    "participantBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_dm_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_dm_threads_roomId_key" ON "chat_dm_threads"("roomId");
CREATE UNIQUE INDEX "chat_dm_threads_academicYearId_participantAId_participantBId_key" ON "chat_dm_threads"("academicYearId", "participantAId", "participantBId");
CREATE INDEX "chat_dm_threads_participantAId_idx" ON "chat_dm_threads"("participantAId");
CREATE INDEX "chat_dm_threads_participantBId_idx" ON "chat_dm_threads"("participantBId");

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT,
    "type" "ChatMessageType" NOT NULL DEFAULT 'text',
    "title" TEXT,
    "content" TEXT,
    "mediaFileId" TEXT,
    "replyToId" TEXT,
    "metadata" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId", "createdAt");
CREATE INDEX "chat_messages_senderId_createdAt_idx" ON "chat_messages"("senderId", "createdAt");

CREATE TABLE "chat_message_read_states" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_read_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_read_states_roomId_userId_key" ON "chat_message_read_states"("roomId", "userId");

CREATE TABLE "class_role_definitions" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "canPostInGroups" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveDms" BOOLEAN NOT NULL DEFAULT true,
    "canInitiateDms" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_role_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "class_role_definitions_communityId_name_key" ON "class_role_definitions"("communityId", "name");

CREATE TABLE "class_role_assignments" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "roleDefinitionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "userId" TEXT,
    "publicDisplayName" TEXT NOT NULL,
    "isMessagingRestricted" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "class_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "class_role_assignments_roleDefinitionId_studentId_key" ON "class_role_assignments"("roleDefinitionId", "studentId");
CREATE INDEX "class_role_assignments_communityId_removedAt_idx" ON "class_role_assignments"("communityId", "removedAt");
CREATE INDEX "class_role_assignments_userId_idx" ON "class_role_assignments"("userId");

CREATE TABLE "user_push_crypto_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "user_push_crypto_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_push_crypto_keys_userId_keyVersion_key" ON "user_push_crypto_keys"("userId", "keyVersion");
CREATE INDEX "user_push_crypto_keys_userId_createdAt_idx" ON "user_push_crypto_keys"("userId", "createdAt");

CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "roomId" TEXT,
    "chatMessageId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "amountPaise" INTEGER,
    "receiptNumber" TEXT,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_notifications_studentId_createdAt_idx" ON "payment_notifications"("studentId", "createdAt");
CREATE INDEX "payment_notifications_sent_idx" ON "payment_notifications"("sent");

ALTER TABLE "attendance_notifications" ADD COLUMN "roomId" TEXT;
ALTER TABLE "attendance_notifications" ADD COLUMN "chatMessageId" TEXT;
DROP INDEX IF EXISTS "attendance_notifications_studentId_idx";
CREATE INDEX "attendance_notifications_studentId_date_idx" ON "attendance_notifications"("studentId", "date");

-- Foreign keys
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "announcements_chatMessageId_key" ON "announcements"("chatMessageId");

ALTER TABLE "chat_communities" ADD CONSTRAINT "chat_communities_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_communities" ADD CONSTRAINT "chat_communities_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_teacherAssignmentId_fkey" FOREIGN KEY ("teacherAssignmentId") REFERENCES "teacher_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_classRoleAssignmentId_fkey" FOREIGN KEY ("classRoleAssignmentId") REFERENCES "class_role_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_participantAId_fkey" FOREIGN KEY ("participantAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_dm_threads" ADD CONSTRAINT "chat_dm_threads_participantBId_fkey" FOREIGN KEY ("participantBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_message_read_states" ADD CONSTRAINT "chat_message_read_states_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_read_states" ADD CONSTRAINT "chat_message_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_role_definitions" ADD CONSTRAINT "class_role_definitions_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_role_definitions" ADD CONSTRAINT "class_role_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "chat_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "class_role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "class_role_assignments" ADD CONSTRAINT "class_role_assignments_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_push_crypto_keys" ADD CONSTRAINT "user_push_crypto_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_notifications" ADD CONSTRAINT "attendance_notifications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_notifications" ADD CONSTRAINT "attendance_notifications_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

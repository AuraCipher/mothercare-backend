-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('INITIATED', 'UPLOADING', 'COMPLETING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "purpose" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "bytesUploaded" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT NOT NULL,
    "providerUploadId" TEXT,
    "providerState" JSONB,
    "checksum" TEXT,
    "fileRecordId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "roomId" TEXT,
    "academicYearId" TEXT,
    "metadata" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_storageKey_key" ON "upload_sessions"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_fileRecordId_key" ON "upload_sessions"("fileRecordId");

-- CreateIndex
CREATE INDEX "upload_sessions_userId_status_idx" ON "upload_sessions"("userId", "status");

-- CreateIndex
CREATE INDEX "upload_sessions_status_expiresAt_idx" ON "upload_sessions"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_userId_idempotencyKey_key" ON "upload_sessions"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_fileRecordId_fkey" FOREIGN KEY ("fileRecordId") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

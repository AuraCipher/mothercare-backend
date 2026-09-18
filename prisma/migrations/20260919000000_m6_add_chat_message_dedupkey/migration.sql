-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "dedupeKey" TEXT;

-- Backfill keys written as metadata.dedupeId by M4 sends (idempotent: only
-- rows whose column is still NULL).
UPDATE "chat_messages" SET "dedupeKey" = metadata->>'dedupeId'
WHERE "dedupeKey" IS NULL AND metadata->>'dedupeId' IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_roomId_dedupeKey_key" ON "chat_messages"("roomId", "dedupeKey");

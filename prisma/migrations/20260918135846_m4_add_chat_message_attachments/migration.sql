-- CreateTable
CREATE TABLE "chat_message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileRecordId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_attachments_messageId_sortOrder_idx" ON "chat_message_attachments"("messageId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_attachments_messageId_fileRecordId_key" ON "chat_message_attachments"("messageId", "fileRecordId");

-- AddForeignKey
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_fileRecordId_fkey" FOREIGN KEY ("fileRecordId") REFERENCES "file_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

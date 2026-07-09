-- FileRecord: R2 bucket metadata + canonical URL (Postgres stores metadata only).

ALTER TABLE "file_records" ADD COLUMN "storageBucket" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "file_records" ADD COLUMN "purpose" TEXT;
ALTER TABLE "file_records" ADD COLUMN "publicUrl" TEXT;
ALTER TABLE "file_records" ADD COLUMN "metadata" JSONB;

CREATE INDEX "file_records_storageBucket_idx" ON "file_records"("storageBucket");
CREATE INDEX "file_records_purpose_entityType_entityId_idx" ON "file_records"("purpose", "entityType", "entityId");

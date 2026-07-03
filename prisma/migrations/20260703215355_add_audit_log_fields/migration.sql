-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "module" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_module_entity_entityId_idx" ON "audit_logs"("module", "entity", "entityId");

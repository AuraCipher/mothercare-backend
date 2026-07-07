CREATE TYPE "AcademicYearAuditAction" AS ENUM ('CREATED', 'PUBLISHED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'PAUSED', 'RESUMED');

CREATE TABLE IF NOT EXISTS "academic_year_audit_logs" (
  "id" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "action" "AcademicYearAuditAction" NOT NULL,
  "fromStatus" "AcademicYearStatus",
  "toStatus" "AcademicYearStatus",
  "note" TEXT,
  "performedById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "academic_year_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "academic_year_audit_logs_branchId_createdAt_idx" ON "academic_year_audit_logs"("branchId", "createdAt");
CREATE INDEX IF NOT EXISTS "academic_year_audit_logs_academicYearId_createdAt_idx" ON "academic_year_audit_logs"("academicYearId", "createdAt");

ALTER TABLE "academic_year_audit_logs" DROP CONSTRAINT IF EXISTS "academic_year_audit_logs_academicYearId_fkey";
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_year_audit_logs" DROP CONSTRAINT IF EXISTS "academic_year_audit_logs_branchId_fkey";
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_year_audit_logs" DROP CONSTRAINT IF EXISTS "academic_year_audit_logs_performedById_fkey";
ALTER TABLE "academic_year_audit_logs" ADD CONSTRAINT "academic_year_audit_logs_performedById_fkey"
  FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

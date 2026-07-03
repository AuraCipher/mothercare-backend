-- AlterTable: make userId nullable, drop FK first then re-add
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_userId_fkey",
ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;

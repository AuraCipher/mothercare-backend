CREATE TABLE IF NOT EXISTS "payroll_bulk_runs" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "salaryMonth" TEXT NOT NULL,
  "paymentMethod" "OutgoingPaymentMethod" NOT NULL,
  "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "successCount" INT NOT NULL,
  "failCount" INT NOT NULL,
  "note" TEXT,
  "recordedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_bulk_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payroll_bulk_runs_branchId_salaryMonth_idx" ON "payroll_bulk_runs"("branchId", "salaryMonth");
CREATE INDEX IF NOT EXISTS "payroll_bulk_runs_createdAt_idx" ON "payroll_bulk_runs"("createdAt");

ALTER TABLE "payroll_bulk_runs" DROP CONSTRAINT IF EXISTS "payroll_bulk_runs_branchId_fkey";
ALTER TABLE "payroll_bulk_runs" ADD CONSTRAINT "payroll_bulk_runs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_bulk_runs" DROP CONSTRAINT IF EXISTS "payroll_bulk_runs_recordedById_fkey";
ALTER TABLE "payroll_bulk_runs" ADD CONSTRAINT "payroll_bulk_runs_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "branch_outgoing_payments" ADD COLUMN IF NOT EXISTS "bulkRunId" TEXT;
CREATE INDEX IF NOT EXISTS "branch_outgoing_payments_bulkRunId_idx" ON "branch_outgoing_payments"("bulkRunId");
ALTER TABLE "branch_outgoing_payments" DROP CONSTRAINT IF EXISTS "branch_outgoing_payments_bulkRunId_fkey";
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_bulkRunId_fkey"
  FOREIGN KEY ("bulkRunId") REFERENCES "payroll_bulk_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

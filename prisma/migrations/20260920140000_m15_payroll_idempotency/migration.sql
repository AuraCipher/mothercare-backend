-- M15: request-scoped idempotency for payroll (single + bulk). Nullable
-- unique: legacy rows keep NULL and never conflict.
ALTER TABLE "branch_outgoing_payments" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "branch_outgoing_payments_idempotencyKey_key" ON "branch_outgoing_payments"("idempotencyKey");
ALTER TABLE "payroll_bulk_runs" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "payroll_bulk_runs_idempotencyKey_key" ON "payroll_bulk_runs"("idempotencyKey");

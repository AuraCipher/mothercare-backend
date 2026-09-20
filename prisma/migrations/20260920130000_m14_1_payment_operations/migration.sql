-- M14.1: request-scoped idempotency ledger for batch payment operations.
CREATE TABLE "payment_operations" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "studentId" TEXT,
  "familyId" TEXT,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_operations_idempotencyKey_key" ON "payment_operations"("idempotencyKey");
CREATE INDEX "payment_operations_studentId_idx" ON "payment_operations"("studentId");

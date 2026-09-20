-- M14: request-scoped idempotency for family payments (lost-response retries
-- must not duplicate the financial effect). Nullable unique: legacy rows keep
-- NULL and never conflict.
ALTER TABLE "family_payments" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "family_payments_idempotencyKey_key" ON "family_payments"("idempotencyKey");

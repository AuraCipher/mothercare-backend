-- M18: request-scoped idempotency for student creation. Nullable unique:
-- legacy rows keep NULL and never conflict. Replays of the same logical
-- create converge on the first committed student instead of duplicating.
ALTER TABLE "students" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "students_idempotencyKey_key" ON "students"("idempotencyKey");

-- M7: distinguish recorded vs reverted payment notifications so a revert is
-- never swallowed as a duplicate of the recorded event (and vice versa).
ALTER TABLE "payment_notifications" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'recorded';

ALTER TABLE "utility_providers" ADD COLUMN IF NOT EXISTS "reminderDayOfMonth" INTEGER;
ALTER TABLE "utility_providers" ADD COLUMN IF NOT EXISTS "typicalAmount" DECIMAL(12,2);

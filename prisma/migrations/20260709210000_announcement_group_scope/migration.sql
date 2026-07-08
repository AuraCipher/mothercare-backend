-- Class-targeted announcements: null group_id = school-wide.
ALTER TABLE "announcements" ADD COLUMN "group_id" TEXT;

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "announcements_academic_year_id_created_at_idx";

CREATE INDEX "announcements_academic_year_id_group_id_created_at_idx"
  ON "announcements"("academic_year_id", "group_id", "created_at");

-- Class-targeted announcements: null groupId = school-wide.
ALTER TABLE "announcements" ADD COLUMN "groupId" TEXT;

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "announcements_academicYearId_createdAt_idx";

CREATE INDEX "announcements_academicYearId_groupId_createdAt_idx"
  ON "announcements"("academicYearId", "groupId", "createdAt");

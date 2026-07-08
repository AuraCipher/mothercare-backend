-- Teacher portal access control (Phase D)
CREATE TYPE "TeacherPortalAccess" AS ENUM ('FULL', 'READ_ONLY', 'FROZEN');

ALTER TABLE "teacher_profiles"
  ADD COLUMN "portalAccess" "TeacherPortalAccess" NOT NULL DEFAULT 'FULL';

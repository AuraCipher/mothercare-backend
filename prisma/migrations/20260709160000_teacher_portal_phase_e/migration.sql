-- CreateEnum
CREATE TYPE "HodParentContactScope" AS ENUM ('ASSIGNED_ONLY', 'DEPARTMENT_ALL');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "teacherParentContactEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branches" ADD COLUMN "teachersCanMarkAttendance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branches" ADD COLUMN "teachersCanEnterMarks" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "teacher_profiles" ADD COLUMN "canViewParentContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "teacher_profiles" ADD COLUMN "hodParentContactScope" "HodParentContactScope" NOT NULL DEFAULT 'ASSIGNED_ONLY';

/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "enrollments_academicYearId_idx" ON "enrollments"("academicYearId");

-- CreateIndex
CREATE INDEX "enrollments_groupId_idx" ON "enrollments"("groupId");

-- CreateIndex
CREATE INDEX "groups_academicYearId_idx" ON "groups"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "subjects_academicYearId_idx" ON "subjects"("academicYearId");

-- CreateIndex
CREATE INDEX "teacher_assignments_teacherId_idx" ON "teacher_assignments"("teacherId");

-- CreateIndex
CREATE INDEX "teacher_assignments_academicYearId_idx" ON "teacher_assignments"("academicYearId");

-- CreateIndex
CREATE INDEX "timetable_entries_teacherId_idx" ON "timetable_entries"("teacherId");

-- CreateIndex
CREATE INDEX "timetable_entries_groupId_idx" ON "timetable_entries"("groupId");

-- Batch promotion, tenure history, archived RBAC, StudentPerson

CREATE TYPE "BatchPromotionRunPhase" AS ENUM ('DRAFT', 'SNAPSHOT_DONE', 'APPLIED', 'PUBLISHED', 'FAILED');
CREATE TYPE "StudentCredentialTag" AS ENUM ('CRED_NONE', 'CRED_CARRIED', 'CRED_NEW', 'CRED_RESEND', 'NO_LOGIN');
CREATE TYPE "TenureEndReason" AS ENUM ('RESIGNED', 'TERMINATED', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'DECEASED', 'LEAVE', 'REJOINED', 'OTHER');

ALTER TABLE "staff_module_permissions"
  ADD COLUMN "archivedCanRead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedCanCreate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedCanUpdate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedCanDelete" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "teacher_assignments"
  ADD COLUMN "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "validTo" TIMESTAMP(3);

CREATE TABLE "branch_tenures" (
  "id" TEXT NOT NULL,
  "branchMemberId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL,
  "leftAt" TIMESTAMP(3),
  "endReason" "TenureEndReason",
  "notes" TEXT,
  "previousTenureId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  CONSTRAINT "branch_tenures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_persons" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "userId" TEXT,
  "admissionNumber" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_persons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_school_tenures" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL,
  "leftAt" TIMESTAMP(3),
  "endReason" "TenureEndReason",
  "notes" TEXT,
  "previousTenureId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  CONSTRAINT "student_school_tenures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_class_movements" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "fromGroupId" TEXT,
  "toGroupId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_class_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "students"
  ADD COLUMN "personId" TEXT,
  ADD COLUMN "credentialTag" "StudentCredentialTag" NOT NULL DEFAULT 'CRED_NONE';

CREATE TABLE "batch_promotion_runs" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "sourceAcademicYearId" TEXT NOT NULL,
  "targetAcademicYearId" TEXT NOT NULL,
  "phase" "BatchPromotionRunPhase" NOT NULL DEFAULT 'DRAFT',
  "carryOptions" JSONB NOT NULL,
  "snapshotId" TEXT,
  "promotedById" TEXT NOT NULL,
  "notes" TEXT,
  "errorMessage" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "batch_promotion_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teacher_ay_snapshots" (
  "id" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "assignments" JSONB NOT NULL,
  "firstAssignedAt" TIMESTAMP(3),
  "lastAssignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teacher_ay_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_carry_forwards" (
  "id" TEXT NOT NULL,
  "fromStudentFeeId" TEXT NOT NULL,
  "toStudentFeeId" TEXT NOT NULL,
  "fromStudentId" TEXT,
  "toStudentId" TEXT,
  "amount" INTEGER NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_carry_forwards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_tenures_branchMemberId_sequence_key" ON "branch_tenures"("branchMemberId", "sequence");
CREATE INDEX "branch_tenures_branchMemberId_joinedAt_idx" ON "branch_tenures"("branchMemberId", "joinedAt");

CREATE UNIQUE INDEX "student_persons_userId_key" ON "student_persons"("userId");
CREATE UNIQUE INDEX "student_persons_admissionNumber_key" ON "student_persons"("admissionNumber");
CREATE INDEX "student_persons_branchId_idx" ON "student_persons"("branchId");

CREATE UNIQUE INDEX "student_school_tenures_personId_sequence_key" ON "student_school_tenures"("personId", "sequence");
CREATE INDEX "student_school_tenures_branchId_joinedAt_idx" ON "student_school_tenures"("branchId", "joinedAt");

CREATE UNIQUE INDEX "student_class_movements_studentId_sequence_key" ON "student_class_movements"("studentId", "sequence");
CREATE INDEX "student_class_movements_academicYearId_effectiveAt_idx" ON "student_class_movements"("academicYearId", "effectiveAt");

CREATE INDEX "students_personId_idx" ON "students"("personId");

CREATE INDEX "batch_promotion_runs_branchId_phase_idx" ON "batch_promotion_runs"("branchId", "phase");
CREATE INDEX "batch_promotion_runs_sourceAcademicYearId_idx" ON "batch_promotion_runs"("sourceAcademicYearId");
CREATE INDEX "batch_promotion_runs_targetAcademicYearId_idx" ON "batch_promotion_runs"("targetAcademicYearId");

CREATE UNIQUE INDEX "teacher_ay_snapshots_academicYearId_teacherId_key" ON "teacher_ay_snapshots"("academicYearId", "teacherId");

CREATE INDEX "fee_carry_forwards_fromStudentFeeId_idx" ON "fee_carry_forwards"("fromStudentFeeId");
CREATE INDEX "fee_carry_forwards_toStudentFeeId_idx" ON "fee_carry_forwards"("toStudentFeeId");

ALTER TABLE "branch_tenures" ADD CONSTRAINT "branch_tenures_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_tenures" ADD CONSTRAINT "branch_tenures_previousTenureId_fkey" FOREIGN KEY ("previousTenureId") REFERENCES "branch_tenures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_persons" ADD CONSTRAINT "student_persons_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_persons" ADD CONSTRAINT "student_persons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_school_tenures" ADD CONSTRAINT "student_school_tenures_personId_fkey" FOREIGN KEY ("personId") REFERENCES "student_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_school_tenures" ADD CONSTRAINT "student_school_tenures_previousTenureId_fkey" FOREIGN KEY ("previousTenureId") REFERENCES "student_school_tenures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_class_movements" ADD CONSTRAINT "student_class_movements_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "students" ADD CONSTRAINT "students_personId_fkey" FOREIGN KEY ("personId") REFERENCES "student_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_sourceAcademicYearId_fkey" FOREIGN KEY ("sourceAcademicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_targetAcademicYearId_fkey" FOREIGN KEY ("targetAcademicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "academic_year_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "batch_promotion_runs" ADD CONSTRAINT "batch_promotion_runs_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_ay_snapshots" ADD CONSTRAINT "teacher_ay_snapshots_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_fromStudentFeeId_fkey" FOREIGN KEY ("fromStudentFeeId") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_toStudentFeeId_fkey" FOREIGN KEY ("toStudentFeeId") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_fromStudentId_fkey" FOREIGN KEY ("fromStudentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_carry_forwards" ADD CONSTRAINT "fee_carry_forwards_toStudentId_fkey" FOREIGN KEY ("toStudentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill StudentPerson from existing students (one person per student row initially)
INSERT INTO "student_persons" ("id", "branchId", "userId", "admissionNumber", "name", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  ay."branchId",
  s."userId",
  s."admissionNumber",
  s."name",
  s."createdAt",
  s."updatedAt"
FROM "students" s
JOIN "academic_years" ay ON ay."id" = s."academicYearId"
WHERE s."personId" IS NULL;

UPDATE "students" s
SET "personId" = sp."id"
FROM "student_persons" sp
WHERE s."personId" IS NULL
  AND (
    (s."userId" IS NOT NULL AND sp."userId" = s."userId")
    OR (s."admissionNumber" IS NOT NULL AND sp."admissionNumber" = s."admissionNumber")
    OR (sp."name" = s."name" AND sp."userId" IS NULL AND s."userId" IS NULL)
  );

-- Credential tag backfill for students with sent credentials
UPDATE "students"
SET "credentialTag" = 'CRED_CARRIED'
WHERE "credentialSentAt" IS NOT NULL AND "credentialTag" = 'CRED_NONE';

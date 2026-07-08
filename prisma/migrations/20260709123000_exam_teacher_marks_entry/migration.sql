-- Allow admin to control whether teachers can enter marks while exam is in DRAFT (build stage).
ALTER TABLE "exams" ADD COLUMN "teacherMarksEntry" BOOLEAN NOT NULL DEFAULT true;

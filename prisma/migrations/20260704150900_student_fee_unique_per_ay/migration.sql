-- DropIndex
DROP INDEX IF EXISTS "student_fees_studentId_month_year_key";

-- CreateIndex
CREATE UNIQUE INDEX "student_fees_studentId_month_year_academicYearId_key" ON "student_fees"("studentId", "month", "year", "academicYearId");

-- DropIndex
DROP INDEX "teacher_assignments_groupId_subjectId_teacherId_key";

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "hodId" TEXT;

-- AlterTable
ALTER TABLE "teacher_assignments" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'primary';

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_hodId_fkey" FOREIGN KEY ("hodId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

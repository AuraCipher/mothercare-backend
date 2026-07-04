-- AlterTable: add examSessionId to exam_types, remove global unique
DROP INDEX IF EXISTS "exam_types_name_key";
ALTER TABLE "exam_types" ADD COLUMN "examSessionId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE "exam_types" ALTER COLUMN "examSessionId" DROP DEFAULT;

-- CreateIndex: per-session unique constraint
CREATE UNIQUE INDEX "exam_types_examSessionId_name_key" ON "exam_types"("examSessionId", "name");
CREATE INDEX "exam_types_examSessionId_idx" ON "exam_types"("examSessionId");

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

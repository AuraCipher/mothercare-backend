/*
  Warnings:

  - Added the required column `updatedAt` to the `branch_members` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BranchRole" AS ENUM ('branch_admin', 'sub_admin', 'management', 'teacher', 'parent');

-- AlterTable
ALTER TABLE "branch_members" ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "keepTeacherRole" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "resignedAt" TIMESTAMP(3),
ADD COLUMN     "resignedInFavorOfId" TEXT,
ADD COLUMN     "role" "BranchRole" NOT NULL DEFAULT 'teacher',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "branch_members_userId_idx" ON "branch_members"("userId");

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_resignedInFavorOfId_fkey" FOREIGN KEY ("resignedInFavorOfId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

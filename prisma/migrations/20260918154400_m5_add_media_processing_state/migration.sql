-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "file_records" ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'READY',
ADD COLUMN     "processingVersion" INTEGER NOT NULL DEFAULT 0;

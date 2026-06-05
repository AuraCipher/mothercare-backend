-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('publishable', 'secret');

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "type" "ApiKeyType" NOT NULL DEFAULT 'publishable';

-- CreateIndex
CREATE INDEX "api_keys_type_idx" ON "api_keys"("type");

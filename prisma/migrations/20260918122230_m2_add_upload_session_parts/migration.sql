-- CreateTable
CREATE TABLE "upload_session_parts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_session_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_session_parts_sessionId_partNumber_key" ON "upload_session_parts"("sessionId", "partNumber");

-- AddForeignKey
ALTER TABLE "upload_session_parts" ADD CONSTRAINT "upload_session_parts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

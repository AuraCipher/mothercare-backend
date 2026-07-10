-- Branch-level chat permission settings (Phase 1: school announcement posters)
CREATE TABLE "branch_chat_settings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "schoolAnnouncementPosterUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teacherAnnouncementPosterUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowAllTeachersTeacherAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_chat_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_chat_settings_branchId_key" ON "branch_chat_settings"("branchId");

ALTER TABLE "branch_chat_settings" ADD CONSTRAINT "branch_chat_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

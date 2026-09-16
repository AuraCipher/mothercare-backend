-- CreateIndex
CREATE INDEX "branch_members_branchId_role_isActive_idx" ON "branch_members"("branchId", "role", "isActive");

-- CreateIndex
CREATE INDEX "students_academicYearId_groupId_idx" ON "students"("academicYearId", "groupId");

-- CreateIndex
CREATE INDEX "students_academicYearId_status_idx" ON "students"("academicYearId", "status");

-- CreateIndex
CREATE INDEX "teacher_assignments_academicYearId_groupId_idx" ON "teacher_assignments"("academicYearId", "groupId");

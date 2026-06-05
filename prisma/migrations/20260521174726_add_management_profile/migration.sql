-- CreateTable
CREATE TABLE "management_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "department" TEXT,
    "designation" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joiningDate" TIMESTAMP(3),
    "salary" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "management_profiles_userId_key" ON "management_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "management_profiles_employeeId_key" ON "management_profiles"("employeeId");

-- AddForeignKey
ALTER TABLE "management_profiles" ADD CONSTRAINT "management_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

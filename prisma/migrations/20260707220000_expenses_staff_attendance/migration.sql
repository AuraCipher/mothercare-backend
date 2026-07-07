-- Branch expenses module + staff attendance + worker branch role
ALTER TYPE "BranchRole" ADD VALUE IF NOT EXISTS 'worker';
ALTER TYPE "StaffModule" ADD VALUE IF NOT EXISTS 'EXPENSES';

DO $$ BEGIN
  CREATE TYPE "OutgoingPaymentType" AS ENUM ('PAYROLL', 'UTILITY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OutgoingPaymentStatus" AS ENUM ('PAID', 'VOID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OutgoingPaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollPayeeType" AS ENUM ('TEACHER', 'STAFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollPaymentKind" AS ENUM ('REGULAR', 'EXTRA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ExpenseCategoryKind" AS ENUM ('UTILITY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "staff_attendances" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "markedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_attendances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_attendances_staffUserId_date_key" ON "staff_attendances"("staffUserId", "date");
CREATE INDEX IF NOT EXISTS "staff_attendances_academicYearId_date_idx" ON "staff_attendances"("academicYearId", "date");

ALTER TABLE "staff_attendances" DROP CONSTRAINT IF EXISTS "staff_attendances_staffUserId_fkey";
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_staffUserId_fkey"
  FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_attendances" DROP CONSTRAINT IF EXISTS "staff_attendances_academicYearId_fkey";
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_attendances" DROP CONSTRAINT IF EXISTS "staff_attendances_markedById_fkey";
ALTER TABLE "staff_attendances" ADD CONSTRAINT "staff_attendances_markedById_fkey"
  FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "branch_expense_categories" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "kind" "ExpenseCategoryKind" NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branch_expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_expense_categories_branchId_kind_name_key"
  ON "branch_expense_categories"("branchId", "kind", "name");
CREATE INDEX IF NOT EXISTS "branch_expense_categories_branchId_kind_idx"
  ON "branch_expense_categories"("branchId", "kind");

ALTER TABLE "branch_expense_categories" DROP CONSTRAINT IF EXISTS "branch_expense_categories_branchId_fkey";
ALTER TABLE "branch_expense_categories" ADD CONSTRAINT "branch_expense_categories_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "utility_providers" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "consumerNumber" TEXT,
  "contactNumber" TEXT,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "utility_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "utility_providers_branchId_name_key" ON "utility_providers"("branchId", "name");
CREATE INDEX IF NOT EXISTS "utility_providers_branchId_idx" ON "utility_providers"("branchId");
CREATE INDEX IF NOT EXISTS "utility_providers_categoryId_idx" ON "utility_providers"("categoryId");

ALTER TABLE "utility_providers" DROP CONSTRAINT IF EXISTS "utility_providers_branchId_fkey";
ALTER TABLE "utility_providers" ADD CONSTRAINT "utility_providers_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "utility_providers" DROP CONSTRAINT IF EXISTS "utility_providers_categoryId_fkey";
ALTER TABLE "utility_providers" ADD CONSTRAINT "utility_providers_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "branch_outgoing_payments" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "type" "OutgoingPaymentType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "OutgoingPaymentMethod" NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reference" TEXT,
  "note" TEXT,
  "voucherNumber" TEXT NOT NULL,
  "status" "OutgoingPaymentStatus" NOT NULL DEFAULT 'PAID',
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedById" TEXT,
  "recordedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branch_outgoing_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_outgoing_payments_branchId_voucherNumber_key"
  ON "branch_outgoing_payments"("branchId", "voucherNumber");
CREATE INDEX IF NOT EXISTS "branch_outgoing_payments_branchId_type_paidAt_idx"
  ON "branch_outgoing_payments"("branchId", "type", "paidAt");
CREATE INDEX IF NOT EXISTS "branch_outgoing_payments_branchId_status_idx"
  ON "branch_outgoing_payments"("branchId", "status");

ALTER TABLE "branch_outgoing_payments" DROP CONSTRAINT IF EXISTS "branch_outgoing_payments_branchId_fkey";
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_outgoing_payments" DROP CONSTRAINT IF EXISTS "branch_outgoing_payments_recordedById_fkey";
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_outgoing_payments" DROP CONSTRAINT IF EXISTS "branch_outgoing_payments_voidedById_fkey";
ALTER TABLE "branch_outgoing_payments" ADD CONSTRAINT "branch_outgoing_payments_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "payroll_payment_details" (
  "id" TEXT NOT NULL,
  "outgoingPaymentId" TEXT NOT NULL,
  "payeeUserId" TEXT NOT NULL,
  "payeeType" "PayrollPayeeType" NOT NULL,
  "salaryMonth" TEXT NOT NULL,
  "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
  "profileSalary" DECIMAL(12,2) NOT NULL,
  "attendanceEarned" DECIMAL(12,2),
  "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_payment_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_payment_details_outgoingPaymentId_key"
  ON "payroll_payment_details"("outgoingPaymentId");
CREATE INDEX IF NOT EXISTS "payroll_payment_details_payeeUserId_salaryMonth_idx"
  ON "payroll_payment_details"("payeeUserId", "salaryMonth");
CREATE INDEX IF NOT EXISTS "payroll_payment_details_salaryMonth_idx" ON "payroll_payment_details"("salaryMonth");

ALTER TABLE "payroll_payment_details" DROP CONSTRAINT IF EXISTS "payroll_payment_details_outgoingPaymentId_fkey";
ALTER TABLE "payroll_payment_details" ADD CONSTRAINT "payroll_payment_details_outgoingPaymentId_fkey"
  FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_details" DROP CONSTRAINT IF EXISTS "payroll_payment_details_payeeUserId_fkey";
ALTER TABLE "payroll_payment_details" ADD CONSTRAINT "payroll_payment_details_payeeUserId_fkey"
  FOREIGN KEY ("payeeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "payroll_month_balances" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "payeeUserId" TEXT NOT NULL,
  "payeeType" "PayrollPayeeType" NOT NULL,
  "salaryMonth" TEXT NOT NULL,
  "profileSalary" DECIMAL(12,2) NOT NULL,
  "attendanceEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "extraDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "closingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "presentDays" INTEGER NOT NULL DEFAULT 0,
  "absentDays" INTEGER NOT NULL DEFAULT 0,
  "lateDays" INTEGER NOT NULL DEFAULT 0,
  "leaveDays" INTEGER NOT NULL DEFAULT 0,
  "unmarkedDays" INTEGER NOT NULL DEFAULT 0,
  "workingDays" INTEGER NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_month_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_month_balances_branchId_payeeUserId_salaryMonth_key"
  ON "payroll_month_balances"("branchId", "payeeUserId", "salaryMonth");
CREATE INDEX IF NOT EXISTS "payroll_month_balances_branchId_salaryMonth_idx"
  ON "payroll_month_balances"("branchId", "salaryMonth");

ALTER TABLE "payroll_month_balances" DROP CONSTRAINT IF EXISTS "payroll_month_balances_branchId_fkey";
ALTER TABLE "payroll_month_balances" ADD CONSTRAINT "payroll_month_balances_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "utility_bill_details" (
  "id" TEXT NOT NULL,
  "outgoingPaymentId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "providerId" TEXT,
  "providerName" TEXT NOT NULL,
  "consumerNumber" TEXT,
  "billReference" TEXT,
  "periodStart" DATE,
  "periodEnd" DATE,
  "dueDate" DATE,
  "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "utility_bill_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "utility_bill_details_outgoingPaymentId_key"
  ON "utility_bill_details"("outgoingPaymentId");
CREATE INDEX IF NOT EXISTS "utility_bill_details_categoryId_idx" ON "utility_bill_details"("categoryId");
CREATE INDEX IF NOT EXISTS "utility_bill_details_providerId_idx" ON "utility_bill_details"("providerId");

ALTER TABLE "utility_bill_details" DROP CONSTRAINT IF EXISTS "utility_bill_details_outgoingPaymentId_fkey";
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_outgoingPaymentId_fkey"
  FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "utility_bill_details" DROP CONSTRAINT IF EXISTS "utility_bill_details_categoryId_fkey";
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "utility_bill_details" DROP CONSTRAINT IF EXISTS "utility_bill_details_providerId_fkey";
ALTER TABLE "utility_bill_details" ADD CONSTRAINT "utility_bill_details_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "utility_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "other_payment_details" (
  "id" TEXT NOT NULL,
  "outgoingPaymentId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "payeeName" TEXT NOT NULL,
  "description" TEXT,
  "paymentKind" "PayrollPaymentKind" NOT NULL DEFAULT 'REGULAR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "other_payment_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "other_payment_details_outgoingPaymentId_key"
  ON "other_payment_details"("outgoingPaymentId");
CREATE INDEX IF NOT EXISTS "other_payment_details_categoryId_idx" ON "other_payment_details"("categoryId");

ALTER TABLE "other_payment_details" DROP CONSTRAINT IF EXISTS "other_payment_details_outgoingPaymentId_fkey";
ALTER TABLE "other_payment_details" ADD CONSTRAINT "other_payment_details_outgoingPaymentId_fkey"
  FOREIGN KEY ("outgoingPaymentId") REFERENCES "branch_outgoing_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "other_payment_details" DROP CONSTRAINT IF EXISTS "other_payment_details_categoryId_fkey";
ALTER TABLE "other_payment_details" ADD CONSTRAINT "other_payment_details_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "branch_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

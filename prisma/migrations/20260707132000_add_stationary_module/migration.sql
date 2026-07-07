CREATE TYPE "StationaryStockMovementType" AS ENUM ('STOCK_IN', 'ADJUSTMENT', 'STUDENT_ASSIGNED');
ALTER TYPE "StaffModule" ADD VALUE IF NOT EXISTS 'STATIONARY';

ALTER TABLE "fee_extra_items"
  ADD COLUMN "sourceType" TEXT DEFAULT 'EXTRA_DUE',
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "stationaryRecordItemId" TEXT;

CREATE TABLE "stationary_categories" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stationary_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stationary_suppliers" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactNumber" TEXT,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stationary_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stationary_products" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "supplierId" TEXT,
  "name" TEXT NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "bundlePrice" INTEGER,
  "unitsPerBundle" INTEGER,
  "stockBundles" INTEGER NOT NULL DEFAULT 0,
  "stockUnits" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stationary_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_stationary_records" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "studentFeeId" TEXT,
  "academicYearId" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_stationary_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_stationary_record_items" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "categoryName" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_stationary_record_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stationary_stock_movements" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "movementType" "StationaryStockMovementType" NOT NULL,
  "quantityBundles" INTEGER NOT NULL DEFAULT 0,
  "quantityUnits" INTEGER NOT NULL DEFAULT 0,
  "unitPriceSnapshot" INTEGER,
  "note" TEXT,
  "studentRecordItemId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stationary_stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stationary_categories_branchId_name_key" ON "stationary_categories"("branchId", "name");
CREATE INDEX "stationary_categories_branchId_idx" ON "stationary_categories"("branchId");

CREATE UNIQUE INDEX "stationary_suppliers_branchId_name_key" ON "stationary_suppliers"("branchId", "name");
CREATE UNIQUE INDEX "stationary_suppliers_id_branchId_key" ON "stationary_suppliers"("id", "branchId");
CREATE INDEX "stationary_suppliers_branchId_idx" ON "stationary_suppliers"("branchId");

CREATE UNIQUE INDEX "stationary_products_branchId_categoryId_name_key" ON "stationary_products"("branchId", "categoryId", "name");
CREATE UNIQUE INDEX "stationary_products_id_branchId_key" ON "stationary_products"("id", "branchId");
CREATE INDEX "stationary_products_branchId_idx" ON "stationary_products"("branchId");
CREATE INDEX "stationary_products_categoryId_idx" ON "stationary_products"("categoryId");
CREATE INDEX "stationary_products_supplierId_idx" ON "stationary_products"("supplierId");

CREATE INDEX "student_stationary_records_branchId_createdAt_idx" ON "student_stationary_records"("branchId", "createdAt");
CREATE INDEX "student_stationary_records_studentId_createdAt_idx" ON "student_stationary_records"("studentId", "createdAt");
CREATE INDEX "student_stationary_records_studentFeeId_idx" ON "student_stationary_records"("studentFeeId");
CREATE INDEX "student_stationary_records_academicYearId_idx" ON "student_stationary_records"("academicYearId");

CREATE INDEX "student_stationary_record_items_recordId_idx" ON "student_stationary_record_items"("recordId");
CREATE INDEX "student_stationary_record_items_productId_idx" ON "student_stationary_record_items"("productId");

CREATE INDEX "stationary_stock_movements_branchId_createdAt_idx" ON "stationary_stock_movements"("branchId", "createdAt");
CREATE INDEX "stationary_stock_movements_productId_createdAt_idx" ON "stationary_stock_movements"("productId", "createdAt");
CREATE INDEX "stationary_stock_movements_movementType_idx" ON "stationary_stock_movements"("movementType");

CREATE INDEX "fee_extra_items_sourceType_idx" ON "fee_extra_items"("sourceType");
CREATE INDEX "fee_extra_items_stationaryRecordItemId_idx" ON "fee_extra_items"("stationaryRecordItemId");

ALTER TABLE "stationary_categories" ADD CONSTRAINT "stationary_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stationary_suppliers" ADD CONSTRAINT "stationary_suppliers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "stationary_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stationary_products" ADD CONSTRAINT "stationary_products_supplierId_branchId_fkey" FOREIGN KEY ("supplierId", "branchId") REFERENCES "stationary_suppliers"("id", "branchId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_stationary_records" ADD CONSTRAINT "student_stationary_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_stationary_record_items" ADD CONSTRAINT "student_stationary_record_items_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "student_stationary_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_stationary_record_items" ADD CONSTRAINT "student_stationary_record_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "stationary_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_productId_branchId_fkey" FOREIGN KEY ("productId", "branchId") REFERENCES "stationary_products"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_studentRecordItemId_fkey" FOREIGN KEY ("studentRecordItemId") REFERENCES "student_stationary_record_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stationary_stock_movements" ADD CONSTRAINT "stationary_stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fee_extra_items" ADD CONSTRAINT "fee_extra_items_stationaryRecordItemId_fkey" FOREIGN KEY ("stationaryRecordItemId") REFERENCES "student_stationary_record_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

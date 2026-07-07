-- Stationary supplier ledger parity with canteen supplier module

DO $$ BEGIN
  CREATE TYPE "StationarySupplierPaymentDirection" AS ENUM ('WE_PAID_SUPPLIER', 'SUPPLIER_PAID_US');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "stationary_suppliers"
  ADD COLUMN IF NOT EXISTS "balanceOwedToSupplier" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balanceSupplierOwesUs" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "stationary_supplier_payments" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "direction" "StationarySupplierPaymentDirection" NOT NULL,
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "stationary_supplier_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stationary_restock_purchases" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalCost" DECIMAL(12,2) NOT NULL,
  "note" TEXT,
  "createdById" TEXT,
  CONSTRAINT "stationary_restock_purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stationary_purchase_items" (
  "id" TEXT NOT NULL,
  "restockPurchaseId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCost" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "stationary_purchase_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stationary_supplier_payments_supplierId_paidAt_idx"
  ON "stationary_supplier_payments"("supplierId", "paidAt");
CREATE INDEX IF NOT EXISTS "stationary_restock_purchases_branchId_purchaseDate_idx"
  ON "stationary_restock_purchases"("branchId", "purchaseDate");
CREATE INDEX IF NOT EXISTS "stationary_restock_purchases_supplierId_idx"
  ON "stationary_restock_purchases"("supplierId");
CREATE INDEX IF NOT EXISTS "stationary_purchase_items_productId_idx"
  ON "stationary_purchase_items"("productId");
CREATE INDEX IF NOT EXISTS "stationary_purchase_items_restockPurchaseId_idx"
  ON "stationary_purchase_items"("restockPurchaseId");

DO $$ BEGIN
  ALTER TABLE "stationary_supplier_payments"
    ADD CONSTRAINT "stationary_supplier_payments_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "stationary_suppliers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_supplier_payments"
    ADD CONSTRAINT "stationary_supplier_payments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_restock_purchases"
    ADD CONSTRAINT "stationary_restock_purchases_supplierId_branchId_fkey"
    FOREIGN KEY ("supplierId", "branchId") REFERENCES "stationary_suppliers"("id", "branchId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_restock_purchases"
    ADD CONSTRAINT "stationary_restock_purchases_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_restock_purchases"
    ADD CONSTRAINT "stationary_restock_purchases_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_purchase_items"
    ADD CONSTRAINT "stationary_purchase_items_restockPurchaseId_fkey"
    FOREIGN KEY ("restockPurchaseId") REFERENCES "stationary_restock_purchases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "stationary_purchase_items"
    ADD CONSTRAINT "stationary_purchase_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "stationary_products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Box + unit stock split (replaces stockQuantity)
ALTER TABLE "canteen_products" ADD COLUMN IF NOT EXISTS "stockBoxes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "canteen_products" ADD COLUMN IF NOT EXISTS "stockUnits" INTEGER NOT NULL DEFAULT 0;

UPDATE "canteen_products"
SET
  "stockBoxes" = CASE
    WHEN COALESCE("unitsPerBox", 0) > 0 THEN "stockQuantity" / "unitsPerBox"
    ELSE 0
  END,
  "stockUnits" = CASE
    WHEN COALESCE("unitsPerBox", 0) > 0 THEN "stockQuantity" % "unitsPerBox"
    ELSE "stockQuantity"
  END
WHERE "stockQuantity" IS NOT NULL;

ALTER TABLE "canteen_products" DROP COLUMN IF EXISTS "stockQuantity";

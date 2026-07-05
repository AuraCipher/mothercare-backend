-- Canteen: enforce linked credit accounts (no walk-in) and cash/credit sale rules

ALTER TABLE "canteen_accounts"
  ADD CONSTRAINT "canteen_accounts_person_link_check"
  CHECK (
    (
      "personType" = 'STUDENT'
      AND "studentId" IS NOT NULL
      AND "userId" IS NULL
    )
    OR (
      "personType" IN ('TEACHER', 'STAFF')
      AND "userId" IS NOT NULL
      AND "studentId" IS NULL
    )
  );

ALTER TABLE "canteen_sales"
  ADD CONSTRAINT "canteen_sales_payment_account_check"
  CHECK (
    (
      "paymentType" = 'CASH'
      AND "canteenAccountId" IS NULL
    )
    OR (
      "paymentType" = 'CREDIT'
      AND "canteenAccountId" IS NOT NULL
    )
  );

-- Add orderNumber column to orders table
CREATE SEQUENCE IF NOT EXISTS orders_order_number_seq;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "orderNumber" INTEGER NOT NULL DEFAULT nextval('orders_order_number_seq');

-- Set sequence start after any existing rows
SELECT setval('orders_order_number_seq', COALESCE((SELECT MAX("orderNumber") FROM "orders"), 0) + 1, false);

-- Unique constraint (drop first if somehow partial state exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_orderNumber_key'
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_orderNumber_key" UNIQUE ("orderNumber");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_orderNumber_idx" ON "orders"("orderNumber");

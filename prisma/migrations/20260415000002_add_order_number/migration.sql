-- Add orderNumber column to orders table
-- Uses a sequence so autoincrement works on existing rows too

CREATE SEQUENCE IF NOT EXISTS orders_order_number_seq;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "orderNumber" INTEGER NOT NULL DEFAULT nextval('orders_order_number_seq');

-- Set the sequence to start after the max existing value (safe if table is empty)
SELECT setval('orders_order_number_seq', COALESCE((SELECT MAX("orderNumber") FROM "orders"), 0) + 1, false);

-- Unique constraint + index
ALTER TABLE "orders" ADD CONSTRAINT IF NOT EXISTS "orders_orderNumber_key" UNIQUE ("orderNumber");
CREATE INDEX IF NOT EXISTS "orders_orderNumber_idx" ON "orders"("orderNumber");

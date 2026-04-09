-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAGO_MOVIL', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED', 'COMBO');

-- CreateEnum
CREATE TYPE "LlmPurpose" AS ENUM ('ORDER_EXTRACTION', 'FREE_RESPONSE', 'INTENT_CLASSIFICATION');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conversationState" JSONB NOT NULL DEFAULT '{"state":"IDLE"}',
    "sessionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_stats" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpentUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "totalSpentBs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "avgOrderValueUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "firstOrderAt" TIMESTAMP(3),
    "favoriteItemId" TEXT,
    "favoriteItemName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🍽️',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceUsd" DECIMAL(8,4) NOT NULL,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "deliveryType" "DeliveryType",
    "deliveryAddress" TEXT,
    "totalUsd" DECIMAL(10,4) NOT NULL,
    "totalBs" DECIMAL(12,2) NOT NULL,
    "exchangeRateUsed" DECIMAL(10,4) NOT NULL,
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "paymentImageUrl" TEXT,
    "notes" TEXT,
    "discountUsd" DECIMAL(10,4),
    "discountBs" DECIMAL(12,2),
    "promotionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceUsd" DECIMAL(8,4) NOT NULL,
    "unitPriceBs" DECIMAL(10,2) NOT NULL,
    "subtotalBs" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(8,4) NOT NULL,
    "applicableItemIds" JSONB NOT NULL DEFAULT '[]',
    "activeDays" JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "startTime" TEXT,
    "endTime" TEXT,
    "isManuallyActive" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "result" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_logs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "orderId" TEXT,
    "purpose" "LlmPurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "tokensInput" INTEGER NOT NULL,
    "tokensOutput" INTEGER NOT NULL,
    "tokensCacheRead" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheWrite" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,8) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_idempotency" (
    "messageId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_idempotency_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_deletedAt_idx" ON "customers"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_stats_customerId_key" ON "customer_stats"("customerId");

-- CreateIndex
CREATE INDEX "customer_stats_totalSpentUsd_idx" ON "customer_stats"("totalSpentUsd" DESC);

-- CreateIndex
CREATE INDEX "menu_items_categoryId_idx" ON "menu_items"("categoryId");

-- CreateIndex
CREATE INDEX "menu_items_isAvailable_idx" ON "menu_items"("isAvailable");

-- CreateIndex
CREATE INDEX "menu_items_deletedAt_idx" ON "menu_items"("deletedAt");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_customerId_status_idx" ON "orders"("customerId", "status");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_menuItemId_idx" ON "order_items"("menuItemId");

-- CreateIndex
CREATE INDEX "promotions_isActive_idx" ON "promotions"("isActive");

-- CreateIndex
CREATE INDEX "admin_sessions_phone_idx" ON "admin_sessions"("phone");

-- CreateIndex
CREATE INDEX "admin_sessions_createdAt_idx" ON "admin_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "llm_usage_logs_createdAt_idx" ON "llm_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "llm_usage_logs_purpose_idx" ON "llm_usage_logs"("purpose");

-- AddForeignKey
ALTER TABLE "customer_stats" ADD CONSTRAINT "customer_stats_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

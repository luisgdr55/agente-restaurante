-- AlterTable: add completedAt to orders
ALTER TABLE "orders" ADD COLUMN "completedAt" TIMESTAMP(3);

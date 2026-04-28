-- AlterEnum: add POS payment method
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'POS';

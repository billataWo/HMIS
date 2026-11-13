-- Receipts (clinic TIN, reprints marked COPY) and discount categories (exemptions) for reporting.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountCategory" TEXT,
ADD COLUMN     "receiptPrints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "tin" TEXT;


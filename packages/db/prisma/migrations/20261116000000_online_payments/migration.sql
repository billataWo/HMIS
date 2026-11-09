-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "autoInvoice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceDaysBefore" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "PlatformCheckout" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" "PlatformPaymentMethod" NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "checkoutUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "lastError" TEXT,

    CONSTRAINT "PlatformCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCheckout_reference_key" ON "PlatformCheckout"("reference");

-- CreateIndex
CREATE INDEX "PlatformCheckout_status_createdAt_idx" ON "PlatformCheckout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformCheckout_tenantId_createdAt_idx" ON "PlatformCheckout"("tenantId", "createdAt");


-- Online checkouts are the platform's own bookkeeping: the application role never touches them
-- (the API reads a clinic's checkouts through the owner connection, filtered by clinic), and they
-- are not sent between clinic servers and the cloud (NOT_SYNCED).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "PlatformCheckout" FROM hmis_app;
  END IF;
END
$$;

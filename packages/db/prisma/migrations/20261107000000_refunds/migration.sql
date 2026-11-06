-- A charge removed from its invoice because the service was never delivered.
ALTER TABLE "Charge" ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3);

-- Refunds are payments with a negative amount and a reason.
ALTER TABLE "Payment" ADD COLUMN "note" TEXT;

-- Cash shifts (several closings a day, opening float, float left, handover) and payment reversals.
-- DropIndex
DROP INDEX "CashClosing_tenantId_cashierId_day_key";

-- AlterTable
ALTER TABLE "CashClosing" ADD COLUMN     "floatLeft" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "handedTo" TEXT,
ADD COLUMN     "openingFloat" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reversalOfId" TEXT;

-- CreateIndex
CREATE INDEX "CashClosing_tenantId_cashierId_day_idx" ON "CashClosing"("tenantId", "cashierId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");


-- Closings made before shifts covered the whole clinic day (midnight in Addis Ababa, UTC+3).
UPDATE "CashClosing" SET "periodStart" = "day"::timestamp - interval '3 hours';

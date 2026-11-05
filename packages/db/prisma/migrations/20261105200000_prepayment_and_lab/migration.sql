-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "collectedById" TEXT,
ADD COLUMN     "resultedById" TEXT,
ADD COLUMN     "sampleCollectedAt" TIMESTAMP(3),
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "resultOptions" TEXT[];

-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "billedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "requirePrepayment" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "LabOrder_tenantId_status_idx" ON "LabOrder"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_resultedById_fkey" FOREIGN KEY ("resultedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Items dispensed before this migration were charged at dispensing time.
UPDATE "PrescriptionItem" SET "billedQty" = "dispensedQty";
UPDATE "LabTest" SET "resultOptions" = '{}' WHERE "resultOptions" IS NULL;

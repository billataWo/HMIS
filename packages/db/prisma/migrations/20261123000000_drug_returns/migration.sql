-- Drugs a patient brings back to the pharmacy.
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN';

ALTER TABLE "PrescriptionItem"
  ADD COLUMN "returnedQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DrugReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DrugReturn_tenantId_createdAt_idx" ON "DrugReturn"("tenantId", "createdAt");
CREATE INDEX "DrugReturn_prescriptionItemId_idx" ON "DrugReturn"("prescriptionItemId");

ALTER TABLE "DrugReturn" ADD CONSTRAINT "DrugReturn_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One clinic's returns are invisible to every other clinic.
ALTER TABLE "DrugReturn" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DrugReturn"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud like the prescriptions.
SELECT hmis_sync_attach('DrugReturn');

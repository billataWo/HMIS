-- AlterTable
ALTER TABLE "Drug" ADD COLUMN     "drugClass" TEXT;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "alerts" JSONB,
ADD COLUMN     "dispensedAt" TIMESTAMP(3),
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Prescription_tenantId_status_idx" ON "Prescription"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


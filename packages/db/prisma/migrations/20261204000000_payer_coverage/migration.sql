-- Credit and insurance coverage: the patient's sponsor (member number), the payer's tariff and
-- co-payment, charges covered by the payer, and the patient's share on the payer's invoice.
-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "payerId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "patientPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "patientShare" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payer" ADD COLUMN     "coPayPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "requiresAuthorization" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "byPayer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "authorizationNo" TEXT,
ADD COLUMN     "coPayPercent" DECIMAL(5,2),
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "payerId" TEXT;

-- CreateTable
CREATE TABLE "PatientCoverage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "memberId" TEXT,
    "holder" TEXT,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerTariff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "excluded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PayerTariff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientCoverage_patientId_idx" ON "PatientCoverage"("patientId");

-- CreateIndex
CREATE INDEX "PatientCoverage_tenantId_payerId_idx" ON "PatientCoverage"("tenantId", "payerId");

-- CreateIndex
CREATE INDEX "PayerTariff_tenantId_idx" ON "PayerTariff"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PayerTariff_payerId_itemType_itemId_key" ON "PayerTariff"("payerId", "itemType", "itemId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCoverage" ADD CONSTRAINT "PatientCoverage_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerTariff" ADD CONSTRAINT "PayerTariff_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One clinic's coverage and tariffs are invisible to every other clinic.
ALTER TABLE "PatientCoverage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientCoverage"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "PayerTariff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayerTariff"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('PatientCoverage');
SELECT hmis_sync_attach('PayerTariff');

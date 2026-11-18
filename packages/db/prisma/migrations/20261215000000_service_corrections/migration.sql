-- AlterTable: an antenatal contact recorded by mistake is voided with a reason, never deleted.
ALTER TABLE "AncContact" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable: a certificate or referral letter issued with a mistake is voided and issued again.
ALTER TABLE "ClinicalDocument" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateTable: adverse events following immunization (AEFI).
CREATE TABLE "ImmunizationAefi" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doseId" TEXT,
    "onsetOn" DATE NOT NULL,
    "signs" TEXT[],
    "serious" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL,
    "reportedTo" TEXT,
    "reportedOn" DATE,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImmunizationAefi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImmunizationAefi_patientId_idx" ON "ImmunizationAefi"("patientId");

-- CreateIndex
CREATE INDEX "ImmunizationAefi_tenantId_onsetOn_idx" ON "ImmunizationAefi"("tenantId", "onsetOn");

-- AddForeignKey
ALTER TABLE "ImmunizationAefi" ADD CONSTRAINT "ImmunizationAefi_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmunizationAefi" ADD CONSTRAINT "ImmunizationAefi_doseId_fkey" FOREIGN KEY ("doseId") REFERENCES "ImmunizationDose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One clinic's AEFI reports are invisible to every other clinic.
ALTER TABLE "ImmunizationAefi" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImmunizationAefi"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('ImmunizationAefi');

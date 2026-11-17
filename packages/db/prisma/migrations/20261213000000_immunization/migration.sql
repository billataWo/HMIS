-- CreateTable
CREATE TABLE "ImmunizationDose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "doseNo" INTEGER NOT NULL,
    "givenOn" DATE NOT NULL,
    "lotNo" TEXT,
    "site" TEXT,
    "elsewhere" BOOLEAN NOT NULL DEFAULT false,
    "facility" TEXT,
    "note" TEXT,
    "givenById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,

    CONSTRAINT "ImmunizationDose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmunizationFollowUp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImmunizationFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImmunizationDose_patientId_idx" ON "ImmunizationDose"("patientId");

-- CreateIndex
CREATE INDEX "ImmunizationDose_tenantId_givenOn_idx" ON "ImmunizationDose"("tenantId", "givenOn");

-- CreateIndex
CREATE INDEX "ImmunizationFollowUp_patientId_idx" ON "ImmunizationFollowUp"("patientId");

-- AddForeignKey
ALTER TABLE "ImmunizationDose" ADD CONSTRAINT "ImmunizationDose_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmunizationFollowUp" ADD CONSTRAINT "ImmunizationFollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- One clinic's immunization records are invisible to every other clinic.
ALTER TABLE "ImmunizationDose" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImmunizationDose"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "ImmunizationFollowUp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImmunizationFollowUp"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Follow-up calls are a record of what was done: never changed or deleted (sync replay and erasing
-- a clinic excepted, as for the stock ledger).
CREATE TRIGGER "ImmunizationFollowUp_append_only"
  BEFORE UPDATE OR DELETE ON "ImmunizationFollowUp"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('ImmunizationDose');
SELECT hmis_sync_attach('ImmunizationFollowUp');

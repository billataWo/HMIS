
-- CreateTable
CREATE TABLE "DiseaseNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "disease" TEXT NOT NULL,
    "reportedTo" TEXT NOT NULL,
    "note" TEXT,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiseaseNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralFollowUp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiseaseNotification_tenantId_reportedAt_idx" ON "DiseaseNotification"("tenantId", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiseaseNotification_visitId_disease_key" ON "DiseaseNotification"("visitId", "disease");

-- CreateIndex
CREATE INDEX "ReferralFollowUp_documentId_idx" ON "ReferralFollowUp"("documentId");

-- AddForeignKey
ALTER TABLE "DiseaseNotification" ADD CONSTRAINT "DiseaseNotification_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralFollowUp" ADD CONSTRAINT "ReferralFollowUp_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClinicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One clinic's notifications and referral follow-ups are invisible to every other clinic.
ALTER TABLE "DiseaseNotification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiseaseNotification"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "ReferralFollowUp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReferralFollowUp"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Both are records of what was done: never changed or deleted (sync replay and erasing a clinic
-- excepted, as for the stock ledger).
CREATE TRIGGER "DiseaseNotification_append_only"
  BEFORE UPDATE OR DELETE ON "DiseaseNotification"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();
CREATE TRIGGER "ReferralFollowUp_append_only"
  BEFORE UPDATE OR DELETE ON "ReferralFollowUp"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('DiseaseNotification');
SELECT hmis_sync_attach('ReferralFollowUp');

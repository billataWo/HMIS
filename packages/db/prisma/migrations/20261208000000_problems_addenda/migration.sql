-- The patient's problem list, addenda to visits (never edited) and advice printed for the patient.
-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "patientAdvice" TEXT;

-- CreateTable
CREATE TABLE "PatientProblem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "icd11Code" TEXT,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "since" DATE,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PatientProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitAddendum" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientProblem_patientId_idx" ON "PatientProblem"("patientId");

-- CreateIndex
CREATE INDEX "PatientProblem_tenantId_status_idx" ON "PatientProblem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "VisitAddendum_visitId_idx" ON "VisitAddendum"("visitId");

-- AddForeignKey
ALTER TABLE "PatientProblem" ADD CONSTRAINT "PatientProblem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitAddendum" ADD CONSTRAINT "VisitAddendum_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One clinic's problem lists and addenda are invisible to every other clinic.
ALTER TABLE "PatientProblem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientProblem"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "VisitAddendum" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitAddendum"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Addenda are part of the medical record: never changed or deleted (sync replay and erasing a
-- clinic excepted, as for the stock ledger).
CREATE TRIGGER "VisitAddendum_append_only"
  BEFORE UPDATE OR DELETE ON "VisitAddendum"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('PatientProblem');
SELECT hmis_sync_attach('VisitAddendum');

-- Lab results that are right and acted on: critical (panic) limits, reference ranges for men,
-- women and age groups, corrections to released results (with history), and rejected samples.


-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "alert" TEXT,
ADD COLUMN     "alertSeenAt" TIMESTAMP(3),
ADD COLUMN     "alertSeenById" TEXT,
ADD COLUMN     "amendedAt" TIMESTAMP(3),
ADD COLUMN     "critical" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "criticalNotified" TEXT,
ADD COLUMN     "criticalNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "rangeText" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejections" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LabResultValue" ADD COLUMN     "rangeText" TEXT;

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "critHigh" DECIMAL(12,3),
ADD COLUMN     "critLow" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "LabTestComponent" ADD COLUMN     "critHigh" DECIMAL(12,3),
ADD COLUMN     "critLow" DECIMAL(12,3);

-- CreateTable
CREATE TABLE "LabRange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labTestId" TEXT,
    "componentId" TEXT,
    "sex" "Sex",
    "ageFromDays" INTEGER NOT NULL DEFAULT 0,
    "ageToDays" INTEGER,
    "refLow" DECIMAL(12,3),
    "refHigh" DECIMAL(12,3),
    "critLow" DECIMAL(12,3),
    "critHigh" DECIMAL(12,3),

    CONSTRAINT "LabRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAmendment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "previousValue" TEXT,
    "previousFlag" TEXT,
    "previousValues" JSONB,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabSampleRejection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "sampleId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabSampleRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabRange_labTestId_idx" ON "LabRange"("labTestId");

-- CreateIndex
CREATE INDEX "LabRange_componentId_idx" ON "LabRange"("componentId");

-- CreateIndex
CREATE INDEX "LabAmendment_labOrderId_idx" ON "LabAmendment"("labOrderId");

-- CreateIndex
CREATE INDEX "LabSampleRejection_labOrderId_idx" ON "LabSampleRejection"("labOrderId");

-- CreateIndex
CREATE INDEX "LabSampleRejection_tenantId_createdAt_idx" ON "LabSampleRejection"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "LabRange" ADD CONSTRAINT "LabRange_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRange" ADD CONSTRAINT "LabRange_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabTestComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAmendment" ADD CONSTRAINT "LabAmendment_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabSampleRejection" ADD CONSTRAINT "LabSampleRejection_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One clinic's ranges, amendments and rejections are invisible to every other clinic.
ALTER TABLE "LabRange" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabRange"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabAmendment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabAmendment"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabSampleRejection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabSampleRejection"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('LabRange');
SELECT hmis_sync_attach('LabAmendment');
SELECT hmis_sync_attach('LabSampleRejection');

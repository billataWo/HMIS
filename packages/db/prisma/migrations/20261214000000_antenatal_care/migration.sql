-- CreateTable
CREATE TABLE "Pregnancy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "lmp" DATE NOT NULL,
    "edd" DATE NOT NULL,
    "eddSource" TEXT NOT NULL DEFAULT 'LMP',
    "gravida" INTEGER NOT NULL,
    "para" INTEGER NOT NULL,
    "riskFactors" TEXT[],
    "bloodGroup" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outcome" TEXT,
    "endedOn" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pregnancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AncContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pregnancyId" TEXT NOT NULL,
    "visitId" TEXT,
    "contactNo" INTEGER NOT NULL,
    "contactOn" DATE NOT NULL,
    "gaWeeks" INTEGER NOT NULL,
    "gaDays" INTEGER NOT NULL,
    "weightKg" DECIMAL(5,2),
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "fundalHeightCm" INTEGER,
    "fetalHeartRate" INTEGER,
    "presentation" TEXT,
    "urineProtein" TEXT,
    "hb" DECIMAL(4,1),
    "syphilis" TEXT,
    "hiv" TEXT,
    "hbsag" TEXT,
    "dangerSigns" TEXT[],
    "ifaTablets" INTEGER,
    "dewormed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "nextContactOn" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AncContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pregnancy_patientId_idx" ON "Pregnancy"("patientId");

-- CreateIndex
CREATE INDEX "Pregnancy_tenantId_status_idx" ON "Pregnancy"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AncContact_pregnancyId_idx" ON "AncContact"("pregnancyId");

-- CreateIndex
CREATE INDEX "AncContact_tenantId_contactOn_idx" ON "AncContact"("tenantId", "contactOn");

-- AddForeignKey
ALTER TABLE "Pregnancy" ADD CONSTRAINT "Pregnancy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AncContact" ADD CONSTRAINT "AncContact_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "Pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One clinic's antenatal records are invisible to every other clinic.
ALTER TABLE "Pregnancy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Pregnancy"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "AncContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AncContact"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('Pregnancy');
SELECT hmis_sync_attach('AncContact');

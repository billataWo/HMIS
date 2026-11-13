-- Lab quality control (controls, runs judged by the Westgard rules) and reagent stock (lots, a
-- movement ledger that is never edited, and what each test uses).
-- CreateTable
CREATE TABLE "LabQcControl" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lot" TEXT,
    "expiresAt" TIMESTAMP(3),
    "mean" DECIMAL(12,3),
    "sd" DECIMAL(12,3),
    "expected" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabQcControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabQcResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "z" DECIMAL(8,3),
    "status" TEXT NOT NULL,
    "rule" TEXT,
    "note" TEXT,
    "action" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabQcResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReagent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReagent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReagentLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reagentId" TEXT NOT NULL,
    "lot" TEXT,
    "expiresAt" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReagentLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReagentMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reagentId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "labOrderId" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReagentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTestReagent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "reagentId" TEXT NOT NULL,
    "perTest" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LabTestReagent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabQcControl_tenantId_labTestId_idx" ON "LabQcControl"("tenantId", "labTestId");

-- CreateIndex
CREATE INDEX "LabQcResult_controlId_createdAt_idx" ON "LabQcResult"("controlId", "createdAt");

-- CreateIndex
CREATE INDEX "LabQcResult_tenantId_createdAt_idx" ON "LabQcResult"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabReagent_tenantId_name_key" ON "LabReagent"("tenantId", "name");

-- CreateIndex
CREATE INDEX "LabReagentLot_reagentId_idx" ON "LabReagentLot"("reagentId");

-- CreateIndex
CREATE INDEX "LabReagentMovement_reagentId_createdAt_idx" ON "LabReagentMovement"("reagentId", "createdAt");

-- CreateIndex
CREATE INDEX "LabReagentMovement_tenantId_createdAt_idx" ON "LabReagentMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "LabTestReagent_reagentId_idx" ON "LabTestReagent"("reagentId");

-- CreateIndex
CREATE UNIQUE INDEX "LabTestReagent_labTestId_reagentId_key" ON "LabTestReagent"("labTestId", "reagentId");

-- AddForeignKey
ALTER TABLE "LabQcControl" ADD CONSTRAINT "LabQcControl_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabQcResult" ADD CONSTRAINT "LabQcResult_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "LabQcControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReagentLot" ADD CONSTRAINT "LabReagentLot_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "LabReagent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReagentMovement" ADD CONSTRAINT "LabReagentMovement_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "LabReagent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReagentMovement" ADD CONSTRAINT "LabReagentMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LabReagentLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTestReagent" ADD CONSTRAINT "LabTestReagent_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTestReagent" ADD CONSTRAINT "LabTestReagent_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "LabReagent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One clinic's QC and reagents are invisible to every other clinic.
ALTER TABLE "LabQcControl" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabQcControl"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabQcResult" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabQcResult"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabReagent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabReagent"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabReagentLot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabReagentLot"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabReagentMovement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabReagentMovement"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LabTestReagent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LabTestReagent"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Reagent movements are a permanent record, like the pharmacy's stock ledger (same guard: sync
-- replay and erasing a clinic may still write them).
CREATE TRIGGER "LabReagentMovement_append_only"
  BEFORE UPDATE OR DELETE ON "LabReagentMovement"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('LabQcControl');
SELECT hmis_sync_attach('LabQcResult');
SELECT hmis_sync_attach('LabReagent');
SELECT hmis_sync_attach('LabReagentLot');
SELECT hmis_sync_attach('LabReagentMovement');
SELECT hmis_sync_attach('LabTestReagent');

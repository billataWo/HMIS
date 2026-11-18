-- CreateTable: family planning services (a method started, resupplied, removed or stopped).
CREATE TABLE "FpRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "givenOn" DATE NOT NULL,
    "service" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "clientType" TEXT,
    "quantity" INTEGER,
    "nextDueOn" DATE,
    "reason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,

    CONSTRAINT "FpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FpRecord_patientId_idx" ON "FpRecord"("patientId");

-- CreateIndex
CREATE INDEX "FpRecord_tenantId_givenOn_idx" ON "FpRecord"("tenantId", "givenOn");

-- AddForeignKey
ALTER TABLE "FpRecord" ADD CONSTRAINT "FpRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One clinic's family planning records are invisible to every other clinic.
ALTER TABLE "FpRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FpRecord"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('FpRecord');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('CONSULTATION', 'PROCEDURE');

-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('OPD', 'WALK_IN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClinicalDocumentType" AS ENUM ('MEDICAL_CERTIFICATE', 'REFERRAL');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "payerId" TEXT;

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "kind" "ServiceKind" NOT NULL DEFAULT 'CONSULTATION';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "nextPo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "kind" "VisitKind" NOT NULL DEFAULT 'OPD';

-- CreateTable
CREATE TABLE "LabTestComponent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "refLow" DECIMAL(12,3),
    "refHigh" DECIMAL(12,3),
    "resultOptions" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LabTestComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResultValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "flag" TEXT,

    CONSTRAINT "LabResultValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "PayerType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "contactPerson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "receivedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" "ClinicalDocumentType" NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabTestComponent_labTestId_idx" ON "LabTestComponent"("labTestId");

-- CreateIndex
CREATE UNIQUE INDEX "LabResultValue_labOrderId_componentId_key" ON "LabResultValue"("labOrderId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payer_tenantId_name_key" ON "Payer"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ClinicalDocument_visitId_idx" ON "ClinicalDocument"("visitId");

-- AddForeignKey
ALTER TABLE "LabTestComponent" ADD CONSTRAINT "LabTestComponent_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultValue" ADD CONSTRAINT "LabResultValue_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultValue" ADD CONSTRAINT "LabResultValue_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "LabTestComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Payers already named on invoices become payer records, and those invoices link to them.
INSERT INTO "Payer" ("id", "tenantId", "type", "name")
SELECT gen_random_uuid()::text, "tenantId", (min("payerType"::text))::"PayerType", "payerName"
FROM "Invoice" WHERE "payerType" <> 'SELF' AND "payerName" IS NOT NULL
GROUP BY "tenantId", "payerName"
ON CONFLICT DO NOTHING;
UPDATE "Invoice" i SET "payerId" = p."id"
FROM "Payer" p WHERE p."tenantId" = i."tenantId" AND p."name" = i."payerName" AND i."payerType" <> 'SELF';
-- Clinic isolation (row-level security) for the new tables, like every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LabTestComponent', 'LabResultValue', 'Payer', 'PurchaseOrder', 'PurchaseOrderLine', 'ClinicalDocument'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
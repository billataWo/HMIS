-- More than one place to keep stock (a main store and a dispensary), switched on per clinic, and
-- transfers between them. A clinic with the switch off keeps one store (batches without a store).
ALTER TABLE "Tenant"
  ADD COLUMN "multiStore" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextTransfer" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dispensary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Store_tenantId_name_key" ON "Store"("tenantId", "name");

ALTER TABLE "StockBatch" ADD COLUMN "storeId" TEXT;
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StockBatch_storeId_idx" ON "StockBatch"("storeId");

CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockTransfer_tenantId_number_key" ON "StockTransfer"("tenantId", "number");
CREATE INDEX "StockTransfer_tenantId_createdAt_idx" ON "StockTransfer"("tenantId", "createdAt");

-- One clinic's stores and transfers are invisible to every other clinic.
ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Store"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockTransfer"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Part of the clinic's record: sent from clinic servers to the cloud.
SELECT hmis_sync_attach('Store');
SELECT hmis_sync_attach('StockTransfer');

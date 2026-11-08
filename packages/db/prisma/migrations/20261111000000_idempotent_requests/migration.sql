-- Replies to requests replayed from the browser's offline queue (Idempotency-Key header).
CREATE TABLE "IdempotentRequest" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotentRequest_pkey" PRIMARY KEY ("tenantId","key")
);
CREATE INDEX "IdempotentRequest_createdAt_idx" ON "IdempotentRequest"("createdAt");

-- One clinic's stored replies are invisible to every other clinic.
ALTER TABLE "IdempotentRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IdempotentRequest"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Server bookkeeping, not clinic data: not sent from clinic servers to the cloud (no
-- hmis_sync_attach; listed in NOT_SYNCED in apps/api/src/sync/engine.ts).

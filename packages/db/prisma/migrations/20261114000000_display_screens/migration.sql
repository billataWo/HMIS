-- Waiting-room screens with their own display-only key.
CREATE TABLE "DisplayScreen" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DisplayScreen_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisplayScreen_tokenHash_key" ON "DisplayScreen"("tokenHash");
CREATE UNIQUE INDEX "DisplayScreen_pairingCodeHash_key" ON "DisplayScreen"("pairingCodeHash");
CREATE INDEX "DisplayScreen_tenantId_idx" ON "DisplayScreen"("tenantId");

-- One clinic's screens are invisible to every other clinic.
ALTER TABLE "DisplayScreen" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DisplayScreen"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Screens belong to the server they were paired with: not sent from clinic servers to the cloud
-- (listed in NOT_SYNCED in apps/api/src/sync/engine.ts, no capture trigger).

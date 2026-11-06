-- Clinic server → cloud sync. See apps/api/src/sync/README.md.

CREATE TABLE "SyncOutbox" (
    "seq" BIGSERIAL NOT NULL,
    "xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "tableName" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "key" JSONB NOT NULL,
    "row" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("seq")
);

CREATE TABLE "SyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "pushedRows" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);
INSERT INTO "SyncState" ("id", "enabled") VALUES (1, false);

CREATE TABLE "SyncClient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSeq" BIGINT,
    "appliedRows" BIGINT NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "edgeVersion" TEXT,

    CONSTRAINT "SyncClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncClient_tokenHash_key" ON "SyncClient"("tokenHash");
CREATE INDEX "SyncClient_tenantId_idx" ON "SyncClient"("tenantId");

-- Sync bookkeeping is for the server itself (the sync agent and the cloud's sync endpoint use the
-- owner connection), never for the application role.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "SyncOutbox", "SyncState", "SyncClient" FROM hmis_app;
  END IF;
END
$$;

-- Capture: one row in SyncOutbox per changed row, in the writing transaction, while capture is on.
-- SECURITY DEFINER so writes made by the restricted application role are captured too. The trigger
-- arguments are the table's primary-key columns.
CREATE OR REPLACE FUNCTION hmis_sync_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb;
  k jsonb := '{}';
  c text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SyncState" WHERE "id" = 1 AND "enabled") THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  FOREACH c IN ARRAY TG_ARGV LOOP
    k := k || jsonb_build_object(c, r -> c);
  END LOOP;
  INSERT INTO "SyncOutbox" ("tableName", "op", "key", "row")
  VALUES (TG_TABLE_NAME, CASE WHEN TG_OP = 'DELETE' THEN 'D' ELSE 'U' END, k, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE r END);
  RETURN NULL;
END
$$;

-- Attaches the capture trigger to a clinic table. New clinic tables must call this in their
-- migration (test/sync.e2e-spec.ts fails for any table left out).
CREATE OR REPLACE FUNCTION hmis_sync_attach(tbl text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  pk text;
BEGIN
  SELECT string_agg(quote_literal(a.attname), ', ' ORDER BY array_position(i.indkey, a.attnum))
    INTO pk
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = format('public.%I', tbl)::regclass AND i.indisprimary;
  EXECUTE format('DROP TRIGGER IF EXISTS hmis_sync_capture ON %I', tbl);
  EXECUTE format('CREATE TRIGGER hmis_sync_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hmis_sync_capture(%s)', tbl, pk);
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('_prisma_migrations', 'BackupEvent', 'SyncOutbox', 'SyncState', 'SyncClient')
  LOOP
    PERFORM hmis_sync_attach(t);
  END LOOP;
END
$$;

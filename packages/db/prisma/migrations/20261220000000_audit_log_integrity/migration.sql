-- The audit log, made tamper-evident and append-only, with where each action came from.

-- Where the action came from: the computer's address and its browser.
ALTER TABLE "AuditLog" ADD COLUMN "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userAgent" TEXT;

-- The seal: each entry's hash covers its content and the hash of the entry before it, so changing
-- or deleting an entry breaks the chain. Entries from before this migration have no seal.
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
CREATE INDEX "AuditLog_tenantId_hash_idx" ON "AuditLog"("tenantId", "hash");
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog"("tenantId", "userId", "createdAt");

-- The latest link of each clinic's chain. Kept by this copy only (not synced): entries that arrive
-- already sealed (from the clinic server) keep their seal.
CREATE TABLE "AuditChainHead" (
    "tenantId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "AuditChainHead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditChainHead"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- The hash of one entry: every field, separated by a character that never appears in them.
CREATE OR REPLACE FUNCTION hmis_audit_hash(a "AuditLog") RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
    coalesce(a."prevHash", ''), a."id", a."tenantId", coalesce(a."userId", ''), a."action", a."entity",
    coalesce(a."entityId", ''), coalesce(a."data"::text, ''), to_char(a."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    coalesce(a."ip", ''), coalesce(a."userAgent", '')
  ), 'UTF8')), 'hex')
$$;

-- Seals each new entry onto its clinic's chain. The head row's lock puts a clinic's entries in one
-- line even when several are written at once. Runs as the table owner, so the chain head is kept
-- whichever role writes the entry.
CREATE OR REPLACE FUNCTION hmis_audit_seal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prev text;
BEGIN
  IF NEW."hash" IS NOT NULL THEN
    RETURN NEW; -- arrived sealed (sync from the clinic server, a data import)
  END IF;
  INSERT INTO "AuditChainHead" ("tenantId", "hash") VALUES (NEW."tenantId", '') ON CONFLICT ("tenantId") DO NOTHING;
  SELECT "hash" INTO prev FROM "AuditChainHead" WHERE "tenantId" = NEW."tenantId" FOR UPDATE;
  NEW."prevHash" := NULLIF(prev, '');
  NEW."hash" := hmis_audit_hash(NEW);
  UPDATE "AuditChainHead" SET "hash" = NEW."hash", "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = NEW."tenantId";
  RETURN NEW;
END
$$;

CREATE TRIGGER "AuditLog_seal"
  BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION hmis_audit_seal();

-- A permanent record: added to, never changed or deleted. The same two exceptions as the stock
-- ledger, each for its own transaction: replaying another copy's changes, and erasing a clinic.
CREATE OR REPLACE FUNCTION hmis_audit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.replaying', true) = 'on' OR current_setting('app.erasing_clinic', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The audit log is a permanent record and cannot be changed or deleted'
    USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION hmis_audit_guard();

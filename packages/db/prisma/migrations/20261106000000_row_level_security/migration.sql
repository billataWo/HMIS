-- Row-level security: a second wall between clinics, behind the API's own tenant filters.
--
-- The API connects as hmis_app, which does not own the tables, so these policies apply to it.
-- Every connection it uses is stamped with SET app.tenant_id = '<clinic id>' at checkout; an
-- unset or empty value matches no rows. The owner role (migrations, seed, tests, sign-in lookup)
-- bypasses RLS because it owns the tables and FORCE ROW LEVEL SECURITY is not set.
--
-- hmis_app is created without a password; give it one with `pnpm db:app-role`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    CREATE ROLE hmis_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hmis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hmis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hmis_app;
REVOKE ALL ON "_prisma_migrations" FROM hmis_app;

-- The tenant itself
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = current_setting('app.tenant_id', true))
  WITH CHECK ("id" = current_setting('app.tenant_id', true));

-- Tables with their own tenantId column
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'AuditLog', 'Patient', 'Appointment', 'QueueCounter', 'Visit', 'Drug', 'Supplier',
    'Prescription', 'LabTest', 'LabOrder', 'ServiceItem', 'Invoice', 'Payment', 'CashClosing'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END
$$;

-- Child tables: visible only when their parent row is visible (the parent's policy applies inside
-- the sub-query for hmis_app).
ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Charge"
  USING (EXISTS (SELECT 1 FROM "Visit" v WHERE v."id" = "Charge"."visitId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Visit" v WHERE v."id" = "Charge"."visitId"));

ALTER TABLE "Diagnosis" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Diagnosis"
  USING (EXISTS (SELECT 1 FROM "Visit" v WHERE v."id" = "Diagnosis"."visitId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Visit" v WHERE v."id" = "Diagnosis"."visitId"));

ALTER TABLE "PrescriptionItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrescriptionItem"
  USING (EXISTS (SELECT 1 FROM "Prescription" p WHERE p."id" = "PrescriptionItem"."prescriptionId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Prescription" p WHERE p."id" = "PrescriptionItem"."prescriptionId"));

ALTER TABLE "StockBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockBatch"
  USING (EXISTS (SELECT 1 FROM "Drug" d WHERE d."id" = "StockBatch"."drugId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Drug" d WHERE d."id" = "StockBatch"."drugId"));

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockMovement"
  USING (EXISTS (SELECT 1 FROM "StockBatch" b WHERE b."id" = "StockMovement"."batchId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "StockBatch" b WHERE b."id" = "StockMovement"."batchId"));

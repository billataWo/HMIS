-- Narcotic and psychotropic drugs: marked on the drug, and kept in a register built from the
-- stock movements (receipts, dispensing, returns, adjustments, write-offs).
CREATE TYPE "ControlledClass" AS ENUM ('NARCOTIC', 'PSYCHOTROPIC');
ALTER TABLE "Drug" ADD COLUMN "controlled" "ControlledClass";

-- The stock movements are the register: a permanent record, added to but never changed or
-- deleted. Two deliberate exceptions, each marked for its own transaction only: replaying another
-- copy's changes (sync, data import), and erasing a whole clinic on request.
CREATE OR REPLACE FUNCTION hmis_stock_ledger_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.replaying', true) = 'on' OR current_setting('app.erasing_clinic', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Stock movements are a permanent record and cannot be changed or deleted; record a correction instead'
    USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER "StockMovement_append_only"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION hmis_stock_ledger_guard();

-- The pharmacist may give an equivalent brand (same generic, strength and form) when the one
-- prescribed is out of stock: the item keeps what was prescribed and why it changed.
ALTER TABLE "PrescriptionItem" ADD COLUMN "substitutedFrom" TEXT, ADD COLUMN "substitutionReason" TEXT;

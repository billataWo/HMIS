-- Lab-only visits: tests for a patient who did not see a doctor here (a request from another
-- clinic, or their own), with who asked for them.
ALTER TYPE "VisitKind" ADD VALUE 'LAB';
ALTER TABLE "LabOrder" ADD COLUMN "requestedBy" TEXT;

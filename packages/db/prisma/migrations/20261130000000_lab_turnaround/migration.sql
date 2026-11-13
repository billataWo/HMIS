-- Urgent lab tests and turnaround targets.
ALTER TABLE "Tenant" ADD COLUMN "labUrgentMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "LabTest" ADD COLUMN "tatMinutes" INTEGER;
ALTER TABLE "LabOrder" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

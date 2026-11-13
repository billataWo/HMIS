-- Tests sent to a reference lab.
ALTER TABLE "LabTest" ADD COLUMN "sendOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LabTest" ADD COLUMN "referenceLab" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN "sentTo" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN "sentRef" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN "sentAt" TIMESTAMP(3);
ALTER TABLE "LabOrder" ADD COLUMN "sentById" TEXT;

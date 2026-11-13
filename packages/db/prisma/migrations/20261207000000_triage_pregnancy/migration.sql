-- Triage priority, pregnancy and breastfeeding status, and MUAC on the visit.
-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "breastfeeding" BOOLEAN,
ADD COLUMN     "lmpDate" DATE,
ADD COLUMN     "muacMm" INTEGER,
ADD COLUMN     "pregnancyStatus" TEXT,
ADD COLUMN     "triageLevel" TEXT,
ADD COLUMN     "triagedAt" TIMESTAMP(3),
ADD COLUMN     "triagedById" TEXT;


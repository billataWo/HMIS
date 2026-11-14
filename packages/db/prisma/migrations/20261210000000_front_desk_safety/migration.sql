-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "dobEstimated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "cancelReason" TEXT;


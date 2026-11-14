-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderById" TEXT,
ADD COLUMN     "reminderOutcome" TEXT,
ADD COLUMN     "traceNote" TEXT,
ADD COLUMN     "traceOutcome" TEXT,
ADD COLUMN     "tracedAt" TIMESTAMP(3),
ADD COLUMN     "tracedById" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "referredFrom" TEXT;


-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "dataRetentionDays" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "dataDeletedAt" TIMESTAMP(3);


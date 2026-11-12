-- How a drug is bought: units per pack and what the pack is called (stock stays in units).
ALTER TABLE "Drug" ADD COLUMN "packSize" INTEGER, ADD COLUMN "packName" TEXT;
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_packSize_check" CHECK ("packSize" IS NULL OR "packSize" >= 2);

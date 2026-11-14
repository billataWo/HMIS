-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "houseNo" TEXT,
ADD COLUMN     "kebele" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "nationalId" TEXT,
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT,
ADD COLUMN     "nextOfKinRelation" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "woreda" TEXT,
ADD COLUMN     "zone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Patient_tenantId_nationalId_key" ON "Patient"("tenantId", "nationalId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "calledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QueueCounter" (
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "QueueCounter_pkey" PRIMARY KEY ("tenantId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Visit_appointmentId_key" ON "Visit"("appointmentId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


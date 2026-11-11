-- Which version of the Terms of Service and Privacy Policy a clinic accepted when it asked to use HMIS.
ALTER TABLE "ClinicRequest" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "ClinicRequest" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

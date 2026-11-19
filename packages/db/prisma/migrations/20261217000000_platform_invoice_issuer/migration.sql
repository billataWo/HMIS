-- The seller on HMIS's invoices to clinics: legal name, TIN and address (a tax invoice needs them).
ALTER TABLE "PlatformSetting" ADD COLUMN "companyName" TEXT;
ALTER TABLE "PlatformSetting" ADD COLUMN "companyTin" TEXT;
ALTER TABLE "PlatformSetting" ADD COLUMN "companyAddress" TEXT;

-- Admin setting: also let doctors register new patients (off by default: the front desk registers).
ALTER TABLE "Tenant" ADD COLUMN "doctorsCanRegister" BOOLEAN NOT NULL DEFAULT false;

-- A clinic can turn off the browser's offline mode (Settings): staff PCs then keep no patient data.
ALTER TABLE "Tenant" ADD COLUMN "offlineMode" BOOLEAN NOT NULL DEFAULT true;

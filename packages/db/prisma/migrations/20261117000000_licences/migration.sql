-- CreateTable
CREATE TABLE "InstalledLicence" (
    "tenantId" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalledLicence_pkey" PRIMARY KEY ("tenantId")
);


-- Only the API's owner connection reads and writes the installed licence; it is never sent
-- between clinic servers and the cloud (NOT_SYNCED): each server holds its own.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "InstalledLicence" FROM hmis_app;
  END IF;
END
$$;

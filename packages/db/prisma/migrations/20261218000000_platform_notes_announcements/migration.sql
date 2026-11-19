-- HMIS's own notes on clinics (calls, promises to pay, follow-ups) and its announcements to clinics.
CREATE TABLE "PlatformNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "followUpOn" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformNote_tenantId_createdAt_idx" ON "PlatformNote"("tenantId", "createdAt");
CREATE INDEX "PlatformNote_followUpOn_idx" ON "PlatformNote"("followUpOn");

CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "titleAm" TEXT,
    "body" TEXT,
    "bodyAm" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformAnnouncement_startsAt_idx" ON "PlatformAnnouncement"("startsAt");

-- Platform tables: read and written through the owner connection only (the clinic app's
-- announcements are looked up there too, by tenant). Never synced to clinic servers (NOT_SYNCED).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "PlatformNote", "PlatformAnnouncement" FROM hmis_app;
  END IF;
END
$$;

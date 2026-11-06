-- Backup events, written by the backup worker (deploy/postgres/scripts) as the owner role.
CREATE TYPE "BackupEventKind" AS ENUM ('BACKUP', 'OFFSITE_SYNC', 'CHECK', 'RESTORE_TEST', 'VERIFY', 'ARCHIVE', 'RESTORE');
CREATE TYPE "BackupEventStatus" AS ENUM ('OK', 'WARNING', 'FAILED');

CREATE TABLE "BackupEvent" (
    "id" TEXT NOT NULL,
    "kind" "BackupEventKind" NOT NULL,
    "status" "BackupEventStatus" NOT NULL,
    "detail" TEXT,
    "message" TEXT,
    "sizeBytes" BIGINT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "site" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupEvent_kind_finishedAt_idx" ON "BackupEvent"("kind", "finishedAt");
CREATE INDEX "BackupEvent_finishedAt_idx" ON "BackupEvent"("finishedAt");

-- The record of backups and restores must not be editable from the application: the API's
-- restricted role can read it, nothing more. (No tenant column: it covers the whole server.)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "BackupEvent" FROM hmis_app;
    GRANT SELECT ON "BackupEvent" TO hmis_app;
  END IF;
END
$$;

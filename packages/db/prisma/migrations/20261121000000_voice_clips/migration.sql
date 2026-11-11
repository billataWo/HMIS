-- The voice that calls patients on the waiting-room TVs (one recording per word, per language).
CREATE TABLE "VoiceClip" (
    "lang" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceClip_pkey" PRIMARY KEY ("lang","key")
);

-- Platform data, read and written through the owner connection only (the platform console and the
-- screens' board). Not clinic data: never sent between clinic servers and the cloud (NOT_SYNCED).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "VoiceClip" FROM hmis_app;
  END IF;
END
$$;

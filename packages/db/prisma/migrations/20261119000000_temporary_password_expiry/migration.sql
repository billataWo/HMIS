-- Temporary passwords (set by an admin or HMIS, replaced at the first sign-in) expire.
ALTER TABLE "User" ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);
ALTER TABLE "PlatformUser" ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);

-- Temporary passwords already handed out get the same 72 hours, from now.
UPDATE "User" SET "temporaryPasswordExpiresAt" = now() + interval '72 hours' WHERE "mustChangePassword";
UPDATE "PlatformUser" SET "temporaryPasswordExpiresAt" = now() + interval '72 hours' WHERE "mustChangePassword";

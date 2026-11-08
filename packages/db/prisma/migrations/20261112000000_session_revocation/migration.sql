-- Tokens issued before this moment are refused (password changed or reset).
ALTER TABLE "User" ADD COLUMN "sessionsValidAfter" TIMESTAMP(3);

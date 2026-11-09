#!/bin/sh
# Starts the HMIS API on AletCloud app hosting (the root package.json "start" script).
# AletCloud gives no shell into the app, so the one-off server steps happen here, on every start:
#   1. apply the database migrations (owner connection, DATABASE_URL);
#   2. let the restricted hmis_app role log in with the password in APP_DATABASE_URL;
#   3. if HMIS_FIRST_CLINIC_NAME is set and there are no clinics yet, create the first clinic and
#      its admin (the temporary password appears once in the app logs);
#   4. run the API.
# Each step is safe to repeat. Only the files from the build are used: no pnpm at runtime.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)

cd "$root/packages/db"
./node_modules/.bin/prisma migrate deploy
if [ -n "${APP_DATABASE_URL:-}" ]; then
  ./node_modules/.bin/tsx prisma/app-role.ts
fi

cd "$root/apps/api"
if [ -n "${HMIS_FIRST_CLINIC_NAME:-}" ] && node dist/clinic/cli.js list | grep -q '^No clinics yet'; then
  node dist/clinic/cli.js create \
    --name "$HMIS_FIRST_CLINIC_NAME" \
    --admin-name "${HMIS_FIRST_ADMIN_NAME:?Set HMIS_FIRST_ADMIN_NAME}" \
    --admin-phone "${HMIS_FIRST_ADMIN_PHONE:?Set HMIS_FIRST_ADMIN_PHONE}"
fi

exec node dist/main.js

#!/bin/sh
# Starts the HMIS API on AletCloud app hosting (the root package.json "start" script).
# AletCloud gives no shell into the app, so the one-off server steps happen here, on every start:
#   1. apply the database migrations (owner connection, DATABASE_URL);
#   2. let the restricted hmis_app role log in with the password in APP_DATABASE_URL;
#   3. if HMIS_FIRST_CLINIC_NAME is set and there are no clinics yet, create the first clinic and
#      its admin (the temporary password appears once in the app logs);
#   4. on the HMIS cloud (HMIS_PLATFORM=1), if HMIS_FIRST_OPERATOR_EMAIL is set and there are no
#      operators yet, create the first one, owner of the platform console (its temporary password
#      also appears once in the app logs);
#   5. run the API.
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

if [ "${HMIS_PLATFORM:-}" = "1" ] && [ -n "${HMIS_FIRST_OPERATOR_EMAIL:-}" ] && node dist/platform/cli.js list | grep -q '^No operators yet'; then
  node dist/platform/cli.js add-operator \
    --name "${HMIS_FIRST_OPERATOR_NAME:-HMIS owner}" \
    --email "$HMIS_FIRST_OPERATOR_EMAIL" \
    --role OWNER
fi

exec node dist/main.js

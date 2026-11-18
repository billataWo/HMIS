#!/bin/sh
# Starts the HMIS API on AletCloud app hosting (the root package.json "start" script).
# AletCloud gives no shell into the app, so the one-off server steps happen here, on every start:
#   1. apply the database migrations (owner connection, DATABASE_URL);
#   2. let the restricted hmis_app role log in with the password in APP_DATABASE_URL;
#   3. if HMIS_FIRST_CLINIC_NAME is set and there are no clinics yet, create the first clinic and
#      its admin (the temporary password appears once in the app logs);
#   4. on the HMIS cloud (HMIS_PLATFORM=1) with HMIS_FIRST_OPERATOR_EMAIL set: the first owner of
#      the platform console. With no operators it is created; until it has signed in, every start
#      logs a new temporary password (search the app logs for "FIRST SIGN-IN");
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

if [ "${HMIS_PLATFORM:-}" = "1" ] && [ -n "${HMIS_FIRST_OPERATOR_EMAIL:-}" ]; then
  # A problem here must not keep the API from starting.
  node dist/platform/cli.js first-owner --email "$HMIS_FIRST_OPERATOR_EMAIL" --name "${HMIS_FIRST_OPERATOR_NAME:-HMIS owner}" || true
fi
# A forgotten operator password, with no shell to run `reset`: set HMIS_RESET_OPERATOR_EMAIL, read
# the temporary password in the app logs ("PASSWORD RESET"), sign in, then remove the variable.
if [ "${HMIS_PLATFORM:-}" = "1" ] && [ -n "${HMIS_RESET_OPERATOR_EMAIL:-}" ]; then
  node dist/platform/cli.js reset-at-start "$HMIS_RESET_OPERATOR_EMAIL" || true
fi
# The same for a locked-out clinic admin: HMIS_RESET_CLINIC_ADMIN = their phone, or the clinic's
# name if it has one admin; the logs show "CLINIC ADMIN: PASSWORD RESET" (or the admins to choose).
if [ -n "${HMIS_RESET_CLINIC_ADMIN:-}" ]; then
  node dist/clinic/cli.js reset-admin-at-start "$HMIS_RESET_CLINIC_ADMIN" || true
fi

exec node dist/main.js

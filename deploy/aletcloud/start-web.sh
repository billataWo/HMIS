#!/bin/sh
# Starts the HMIS web app on AletCloud app hosting (root package.json "start" with HMIS_SERVICE=web).
# API_URL: where this server reaches the API, e.g. https://<project>.app.aletcloud.com/api.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
: "${API_URL:?Set API_URL to the API address, e.g. https://hmis.app.aletcloud.com/api}"
cd "$root/apps/web"
exec ./node_modules/.bin/next start -p "${PORT:-3000}"

#!/bin/sh
# Runs the HMIS API and web app together in one AletCloud app (the free tier allows one app).
# The web app takes the public port ($PORT); the API listens only inside the container, on
# API_PORT (4000), and the web server reaches it at http://127.0.0.1:4000 — as on our own servers,
# the API is never exposed. Both share the app's memory, so each Node heap is capped
# (HMIS_API_HEAP_MB / HMIS_WEB_HEAP_MB). If either process stops, the app exits and is restarted.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

export API_PORT="${API_PORT:-4000}"
unset API_BASE_PATH
NODE_OPTIONS="--max-old-space-size=${HMIS_API_HEAP_MB:-96}" sh "$here/start-api.sh" &
api=$!

export API_URL="http://127.0.0.1:$API_PORT"
NODE_OPTIONS="--max-old-space-size=${HMIS_WEB_HEAP_MB:-112}" sh "$here/start-web.sh" &
web=$!

trap 'kill $api $web 2>/dev/null; exit 0' TERM INT
while kill -0 $api 2>/dev/null && kill -0 $web 2>/dev/null; do
  sleep 5
done
echo "HMIS: the $(kill -0 $api 2>/dev/null && echo web app || echo API) stopped; exiting." >&2
kill $api $web 2>/dev/null || true
exit 1

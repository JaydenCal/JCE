#!/usr/bin/env bash
# One command e2e run. Prerequisites (see docs/22 section 9): python deps of the backend, `npm ci` in frontend/, Chromium under PLAYWRIGHT_BROWSERS_PATH (no download is done here).
#   1. build the frontend once:  cd frontend && NEXT_DIST=.next-e2e NEXT_PUBLIC_API_BASE=http://127.0.0.1:8765 NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<stub.js> npx next build
#      (the stub is only needed without internet: a JS file exporting the Google Fonts CSS answers; keep it outside the repository)
#   2. run this script; it starts the frontend (next start :3100) and a FRESH backend harness (:8765, new temp folder, so no design is left over), runs the browser, stops both.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
cleanup() { [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null; [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT
python3 "$ROOT/e2e/make_fixtures.py" >/dev/null
( cd "$ROOT/frontend" && NEXT_DIST=.next-e2e NEXT_TELEMETRY_DISABLED=1 exec npx next start -p 3100 -H 127.0.0.1 >"$WORK/web.log" 2>&1 ) & WEB_PID=$!
env -u ANTHROPIC_API_KEY python3 "$ROOT/e2e/harness.py" --work "$WORK/api" >"$WORK/api.log" 2>&1 & API_PID=$!
for i in $(seq 1 60); do grep -q READY "$WORK/api.log" 2>/dev/null && curl -s -o /dev/null http://127.0.0.1:3100/legal/terms && break; sleep 1; done
node "$ROOT/e2e/run_e2e.mjs"
CODE=$?
grep -v "^READY" "$WORK/api.log" | head -50 > "$ROOT/test-runs/e2e/backend.log" 2>/dev/null; [ -s "$ROOT/test-runs/e2e/backend.log" ] || rm -f "$ROOT/test-runs/e2e/backend.log"
exit $CODE

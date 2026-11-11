#!/bin/sh
# Usage: sh run.sh      (starts the Worker in Miniflare behind a proxy that serves site/ on 8820/8822, runs e2e.py, stops the stack)
# Reuses ../e2e-pay/stack.mjs (D1 + R2 in Miniflare, schema and every migration applied, friends code PA-FRIENDS-TEST).
cd "$(dirname "$0")"; export SCRATCH="${SCRATCH:-/tmp}" STACK_PORT=8820 MF_PORT=8822; mkdir -p ../../../qa/share/logs; L=../../../qa/share/logs
node ../e2e-pay/stack.mjs > $L/stack.log 2>&1 & S=$!
for i in $(seq 1 60); do curl -sf localhost:8820/api/health >/dev/null && break; sleep 0.5; done
python3 e2e.py; RC=$?
kill $S 2>/dev/null; wait 2>/dev/null; exit $RC

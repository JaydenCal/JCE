#!/bin/sh
# Usage: sh run.sh e2e.py|stress.py   (starts a fresh mock Stripe + Miniflare stack on 8810/8811/8812, runs the driver, stops the stack)
cd "$(dirname "$0")"; export PATCH_APP="${PATCH_APP:-0}" SCRATCH="${SCRATCH:-/tmp}"; mkdir -p ../../../qa/payments/logs; L=../../../qa/payments/logs
node mock-stripe.mjs > $L/mock.log 2>&1 & M=$!
node stack.mjs > $L/stack.log 2>&1 & S=$!
for i in $(seq 1 40); do curl -sf localhost:8810/api/health >/dev/null && break; sleep 0.5; done
case "${1:-e2e.py}" in *.mjs) node "${1}";; *) python3 "${1:-e2e.py}";; esac; RC=$?
kill $M $S 2>/dev/null; wait 2>/dev/null; exit $RC

#!/bin/bash
# Full pipeline. Run from anywhere.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
python3 -I -B "$D/build_rules.py"
python3 -I -B "$D/merge_research.py"
python3 -I -B "$D/make_report.py"

#!/usr/bin/env python3
"""Regenerate the Lot 2 DP227508 site report with NO network access.

Runs scripts/run_site.py in ``--offline lot2`` mode (saved cadastre, 5 m DEM spot levels and aerials: app/offline/lot2.py) and swaps the
SA9 ArcGIS loader for the fake layer loader in app/offline/lot2_layers.py, so the 18 constraint layers give a realistic result
(4 mapped or within buffer, 2 NOT CHECKED, the rest clear) instead of 16 failed network queries.

    python scripts/offline_lot2_report.py --out /home/claude/work/out/report_lot2 --rules-json /home/claude/work/out/rules/R2_dwelling_house.json

All outputs are TEST DATA ONLY: indicative, not a survey, not a planning certificate.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _load_run_site():
    spec = importlib.util.spec_from_file_location("run_site_offline", BACKEND / "scripts" / "run_site.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["run_site_offline"] = mod
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str] | None = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="out/report_lot2")
    ap.add_argument("--rules-json", help="user-entered setback rules JSON (see scripts/rules_from_knowledge.py)")
    ap.add_argument("--development-type", default="dwelling_house")
    ap.add_argument("--title", default="OFFLINE FIXTURE: Lot 2 DP227508 (not live data)")
    a = ap.parse_args(argv)
    from app.offline.lot2_layers import Lot2LayerLoader
    rs = _load_run_site()
    rs.Sa9ArcGisLoader = Lot2LayerLoader               # no network: the fake loader answers every SA9 layer query
    args = ["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", a.development_type, "--levels", "nsw",
            "--acknowledge", "--report", "--title", a.title, "--out", a.out]
    if a.rules_json:
        args += ["--rules-json", a.rules_json]
    return rs.main(args)


if __name__ == "__main__":
    sys.exit(main())

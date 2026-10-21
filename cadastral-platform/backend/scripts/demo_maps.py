#!/usr/bin/env python3
"""SYNTHETIC DEMO DATA variant of the planning maps: the site report (and, with --soee-from-run, the SoEE appendix) built from invented data.

    python scripts/demo_maps.py --out /home/claude/work/out/stage7/maps/demo [--soee-from-run <run dir of scripts/run_soee.py>]

Every page and figure is stamped SYNTHETIC DEMO DATA.  The SoEE variant reuses the text of an offline run and swaps its map appendix for the demo maps, so it
exercises the SoEE figure layout only: its statements are not about the demo lot.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="out/demo_maps")
    ap.add_argument("--soee-from-run", help="run directory holding soee_inputs.json, constraints_report.json and run_steps.json")
    a = ap.parse_args(argv)
    from app.report import build_site_report
    from app.report.demo import demo_inputs
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    pdf, js = build_site_report(demo_inputs(), maps_dir=out / "planning_maps")
    (out / "site_report_demo.pdf").write_bytes(pdf)
    (out / "site_report_demo.json").write_text(json.dumps(js, indent=1, default=str))
    print("wrote", out / "site_report_demo.pdf")
    if a.soee_from_run:
        from datetime import date
        from app.pack import soee_site as S, soee_site_out as O
        rd = Path(a.soee_from_run)
        cache = json.loads((rd / "soee_inputs.json").read_text())
        inp = S.SoeeSiteInputs(constraints=json.loads((rd / "constraints_report.json").read_text()), run=json.loads((rd / "run_steps.json").read_text()), works=cache["works"],
                               requirements=S.load_requirement_set(), sources=S.load_sources(), today=date.today(), maps=js["planning_maps"],
                               maps_dir=out / "planning_maps", synthetic_demo=True)
        doc = S.build_site_soee(inp)
        print(json.dumps(O.write_all(doc, out / "soee", png=False), indent=1)[:400])
    return 0


if __name__ == "__main__":
    sys.exit(main())

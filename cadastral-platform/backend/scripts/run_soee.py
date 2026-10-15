#!/usr/bin/env python3
"""Build the JCESITE Statement of Environmental Effects (site works only) for a run.

JCESITE is a platform product and is NOT affiliated with JCE Infrastructure.  The output is an AI GENERATED DRAFT.

Default: the OFFLINE Lot 2 DP227508 fixture (no network), with the same inputs as

    python3 scripts/run_site.py --offline lot2 --lotplan 2//DP227508 --development-type dwelling_house --levels nsw \
        --rules-json /home/claude/work/out/rules/R2_dwelling_house.json --acknowledge --report --planset --planset-style ref

The SA9 ArcGIS loader is swapped for the saved-run fixture loader (app/offline/lot2_layers.py), as in scripts/offline_lot2_report.py, so the
constraint layers are a reconstruction with approximate geometry.  ``--variant all_not_checked`` keeps the real SA9 loader instead: with no
network every layer is NOT CHECKED, which is the honest result for an unqueried layer.

    python3 scripts/run_soee.py --out /home/claude/work/out/stage5/soee
    python3 scripts/run_soee.py --out /home/claude/work/out/stage5/soee/variants/all_not_checked --variant all_not_checked
    python3 scripts/run_soee.py --out DIR --from-run DIR/run        # rebuild documents from a previous run's cached inputs (no pipeline)

run_site.py gives SA10 the DEM levels the plans use (terrain_points) and no building footprint (no dwelling is drawn), so the ESC layout follows the DEM fall and the
stabilised access is 15.0 m.  This script reads the same run: the plan set input and result, the Site the plan set was drawn from (generate.LAST_SITE, so the SoEE reads the
same levels, fall and discharge note as sheets C300 and C500), the project name printed on the title blocks, the SA10 output files and the plan set PDF (gap markers).

Writes soee.pdf, soee.docx, soee.json (sidecar: every statement with its source), page PNGs (pages/) and docx_check/ (the DOCX rendered by LibreOffice).
Does not edit run_site.py, app/report or the plan set package.  The SoEE text is assembled by software (no language model writes it); the requirement values in the
knowledge files were extracted by an AI model from the cited documents (quotes and pages validated, not verified by a person).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

DEFAULT_RULES = "/home/claude/work/out/rules/R2_dwelling_house.json"


def _load_run_site():
    spec = importlib.util.spec_from_file_location("run_site_soee", BACKEND / "scripts" / "run_site.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["run_site_soee"] = mod
    spec.loader.exec_module(mod)
    return mod


def run_pipeline(run_dir: Path, rules_json: str, variant: str, development_type: str = "dwelling_house", site_data: str | None = None, lotplan: str | None = None,
                 run_date: str | None = None, use_site_boundary: bool = False) -> dict:
    """Run the pipeline into ``run_dir`` and return the cached inputs (works dict, constraints, run steps).  Default: the offline Lot 2 fixture.  With
    ``site_data`` (a collector folder, docs/14-site-data-import.md) the same run_site.py flags are used as for scripts/run_site.py --site-data DIR and nothing is offline."""
    import app.agents.sa5_cad_dxf.planset as PS
    from app.pack.soee_site import extract_site_works

    rs = _load_run_site()
    if variant == "fixture":
        from app.offline.lot2_layers import Lot2LayerLoader
        rs.Sa9ArcGisLoader = Lot2LayerLoader
    cap: dict = {}
    orig = PS.build_planset

    def wrap(inp, *a, **k):
        res = orig(inp, *a, **k)
        cap["inp"], cap["res"] = inp, res
        return res

    PS.build_planset = wrap
    try:
        if site_data:
            args = ["--site-data", site_data, "--development-type", development_type, "--acknowledge", "--report", "--planset", "--planset-style", "ref", "--out", str(run_dir)]
            if lotplan:
                args += ["--lotplan", lotplan]
            if run_date:
                args += ["--run-date", run_date]
            if use_site_boundary:
                args += ["--use-site-boundary"]
        else:
            args = ["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", development_type, "--levels", "nsw", "--acknowledge", "--report",
                    "--planset", "--planset-style", "ref", "--out", str(run_dir)]
        if rules_json:
            args += ["--rules-json", rules_json]
        rc = rs.main(args)
    finally:
        PS.build_planset = orig
    if "inp" not in cap:
        raise SystemExit(f"the plan set was not built (run_site exit code {rc}); see {run_dir}/run_steps.json")
    from app.agents.sa5_cad_dxf.planset import generate as G
    proj = getattr(G.LAST_PROJ, "title", None)
    works = extract_site_works(cap["inp"], cap["res"], esc_dir=run_dir, plan_pdf=run_dir / "planset.pdf", site=G.LAST_SITE, project_name=proj)
    cache = {"works": works, "variant": variant}
    (run_dir / "soee_inputs.json").write_text(json.dumps(cache, indent=2, default=str))
    return cache


def load_cache(run_dir: Path) -> dict:
    return json.loads((run_dir / "soee_inputs.json").read_text())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="out/soee")
    ap.add_argument("--rules-json", default=None, help="user entered setback rules JSON (default for the offline Lot 2 fixture only; never defaulted for a site data run)")
    ap.add_argument("--variant", choices=["fixture", "all_not_checked"], default="fixture")
    ap.add_argument("--from-run", help="reuse the cached inputs (soee_inputs.json, constraints_report.json, run_steps.json) of an earlier run directory")
    ap.add_argument("--job", default="", help="job number for the document and drawing numbers (default XXX)")
    ap.add_argument("--revision", default="A")
    ap.add_argument("--date", help="document date YYYY-MM-DD (default today)")
    ap.add_argument("--no-png", action="store_true")
    ap.add_argument("--site-data", help="site data folder written by the data collector (docs/14-site-data-import.md); runs the real pipeline on it instead of the offline Lot 2 fixture")
    ap.add_argument("--lotplan", help="lot//plan for a site data run (for example 143//DP753851)")
    ap.add_argument("--development-type", default="dwelling_house")
    ap.add_argument("--run-date", help="run date DD/MM/YYYY or YYYY-MM-DD for a site data run (BYDA validity is compared with it); default today")
    ap.add_argument("--use-site-boundary", action="store_true", help="use the site data boundary as the subject lot even when the cadastre returns a lot")
    a = ap.parse_args(argv)
    if a.rules_json is None and not a.site_data and Path(DEFAULT_RULES).exists():
        a.rules_json = DEFAULT_RULES

    from app.pack import soee_site as S
    from app.pack import soee_site_out as O

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    run_dir = Path(a.from_run) if a.from_run else out / "run"
    if not a.from_run:
        run_dir.mkdir(parents=True, exist_ok=True)
        cache = run_pipeline(run_dir, a.rules_json, a.variant, a.development_type, a.site_data, a.lotplan, a.run_date, a.use_site_boundary)
    else:
        cache = load_cache(run_dir)
    cp = run_dir / "constraints_report.json"
    constraints = json.loads(cp.read_text()) if cp.exists() else None
    rp = run_dir / "run_steps.json"
    run = json.loads(rp.read_text()) if rp.exists() else {}
    inp = S.SoeeSiteInputs(constraints=constraints, run=run, works=cache["works"], requirements=S.load_requirement_set(), sources=S.load_sources(),
                           today=date.fromisoformat(a.date) if a.date else date.today(), job=a.job, revision=a.revision)
    doc = S.build_site_soee(inp)
    paths = O.write_all(doc, out, png=not a.no_png)
    print(json.dumps({"counts": doc.meta["counts"], "layers_not_checked": doc.meta["layers_not_checked"], "statements": len(doc.statements()), **paths}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

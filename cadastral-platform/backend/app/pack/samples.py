"""Build an application pack from a test-run folder (cadastral-platform/test-runs/<run>): real SA1/SA5/SA9 outputs only.

    python -m app.pack.samples lot2_dwelling quia_granny      (run from backend/)

Nothing is invented: inputs the run did not produce (setbacks, heights, floor areas, owner, address ...) stay None and appear as
UNRESOLVED / TO BE COMPLETED in the compliance table, SoEE and checklist.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from app.agents.sa11_pathway import assess_pathway, make_input
from app.agents.sa11_pathway.models import PathwayResult

from .assemble import PackDoc, PackProject, PackResult, assemble_pack
from .compliance import ProposalFacts, build_compliance_table
from .soee import SoeeInputs, build_soee, write_docx, write_pdf

ROOT = Path(__file__).resolve().parents[3] / "test-runs"
LGA = {"lot2_dwelling": "Gunnedah", "quia_granny": "Gunnedah", "quia_shed": "Gunnedah"}   # SA1 run summaries leave lga blank; both lots are in Gunnedah Shire (knowledge/gunnedah/README.md)


def load_run(run: str, root: Path | None = None) -> dict:
    d = (root or ROOT) / run
    steps = json.loads((d / "run_steps.json").read_text())["facts"]
    rep = json.loads((d / "constraints_report.json").read_text()) if (d / "constraints_report.json").exists() else None
    return dict(dir=d, facts=steps, report=rep)


def pathway_for_run(run: str, root: Path | None = None, **extra) -> tuple[PathwayResult, dict]:
    r = load_run(run, root)
    f = r["facts"]
    inp = make_input(f["development_type"], r["report"], lga=LGA.get(run), zone=f["zone"], lot_area_m2=f["area_m2"], **extra)
    return assess_pathway(inp), r


def build_sample_pack(run: str, out_dir: str | Path, root: Path | None = None) -> PackResult:
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    pr, r = pathway_for_run(run, root)
    f = r["facts"]; rep = r["report"]; d = r["dir"]
    flags = {x["key"]: x["status"] for x in (rep or {}).get("layers", [])}
    facts = ProposalFacts(dev_type=f["development_type"], zone=f["zone"], lga=LGA.get(run), lot_area_m2=f["area_m2"], constraints=rep,
                          bushfire_prone=(flags.get("nsw_bushfire") == "affected") if "nsw_bushfire" in flags and flags["nsw_bushfire"] != "not_checked" else None,
                          flood_affected=(flags.get("nsw_flood") == "affected") if flags.get("nsw_flood") in ("affected", "not_affected") else None)
    pathway = pr.suggested_pathway or "da"
    table = build_compliance_table(facts, pathway if pathway == "da" else "da", pathway_result=pr)
    soee = build_soee(SoeeInputs(facts=facts, pathway_result=pr, compliance=table, constraints=rep, lotplan=f["lotplan"], council_name="Gunnedah Shire Council"))
    dx = write_docx(soee, out / "SoEE_draft.docx"); pf = write_pdf(soee, out / "SoEE_draft.pdf")
    docs = [PackDoc(kind="soee", title="Statement of Environmental Effects (DRAFT, DOCX)", path=str(dx)), PackDoc(kind="soee", title="Statement of Environmental Effects (DRAFT, PDF)", path=str(pf))]
    for fn, kind, title in (("plan.pdf", "site_plan", "Site plan (SA5)"), ("plan.dxf", "plan_dxf", "Site plan CAD (SA5, DXF)"), ("constraints_report.pdf", "constraints_report", "Constraints report (SA9)"),
                            ("escp.pdf", "escp", "Erosion and sediment control plan (SA10)")):
        if (d / fn).exists():
            docs.append(PackDoc(kind=kind, title=title, path=str(d / fn)))
    proj = PackProject(project_name=f"{run} ({f['lotplan']})", lotplan=f["lotplan"], council="Gunnedah Shire Council", pathway="da", dev_type=f["development_type"],
                       flood_affected=facts.flood_affected, bushfire_prone=facts.bushfire_prone, docs=docs, compliance=table, pathway_result=pr)
    return assemble_pack(proj, out)


if __name__ == "__main__":
    for run in sys.argv[1:]:
        res = build_sample_pack(run, ROOT / f"pack_{run}")
        print(run, res.zip_path, res.counts)

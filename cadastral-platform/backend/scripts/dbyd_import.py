#!/usr/bin/env python3
"""DBYD Phase 0 command line (stage 8): import a project's BYDA folder, and record, verify or reject traced services.  JCESITE is NOT affiliated with JCE Infrastructure.

    # import <project>/BYDA (combined BYDA responses PDF and/or <owner>/ folders and byda_status.md) into <project>/dbyd
    python3 scripts/dbyd_import.py import --project <project>
    python3 scripts/dbyd_import.py import --project <project> --dry-run      # read and report, store nothing

    # a person traces a service over an owner plan (always a DRAFT), then verifies or rejects it
    python3 scripts/dbyd_import.py trace  --project P --owner "Essential Energy" --service electricity --pts "238460,6569500;238470,6569510" --by "J Smith" --page 87
    python3 scripts/dbyd_import.py verify --project P --id <id> --by "J Smith"
    python3 scripts/dbyd_import.py reject --project P --id <id> --by "J Smith" --reason "not on the plan"
    python3 scripts/dbyd_import.py list   --project P

Then run the plan set with ``scripts/run_site.py ... --dbyd-project P`` so C100 and C310 draw the VERIFIED services only and C310 carries the services status table.

THE PLANS STAY IN THE PROJECT.  Split owner plans are written to <project>/dbyd/plans only (project private); nothing is copied to the outputs, the repository or another site.
Tracing is never automatic: ``trace`` creates a draft, and only ``verify`` with a person's name makes a service drawable.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _summary(reg: dict) -> str:
    out = [f"BYDA job {reg.get('job_number')}  ({reg.get('responses_text') or 'responses not stated'};  plans valid until {reg.get('enquiry_valid_until') or 'NOT STATED'})"]
    for s in reg.get("sources", []):
        out.append(f"  source: {s['file']}  {s['pages']} pages  sha256 {s['sha256'][:12]}...  ({s['kind']}, {s['split_by']})")
    for o in reg["owners"]:
        out.append(f"\n  {o['owner']}  [{o.get('response_status')}]  referral {o.get('referral')}  response {o.get('response_received')}  section pages {o.get('section_pages')}")
        out.append(f"    valid {o.get('valid_days')} days from the plan date -> {o.get('valid_until')}  (effective with the enquiry: {o.get('effective_valid_until')})  pages: {o.get('page_counts')}")
        for st in o.get("validity_statements", [])[:4]:
            out.append(f"      validity statement p{st['page']}: {st['days']} days  \"{st['text'][:80]}\"")
        for f in o["files"]:
            if f.get("excluded"):
                out.append(f"    - {f['name']}: EXCLUDED BY BYDA (not in the download)")
                continue
            geo = f"  GEOREFERENCED ({f['georef']['pages']} page(s), {f['georef']['gcs_wkt_head'][:30]!r})" if f.get("georef") else ""
            out.append(f"    - {f['name'][:58]:58} pages {f.get('pages')}  {f.get('content'):7}  map pages {f.get('map_page_kinds')}  {'PLAN' if f.get('plan_candidate') else 'info'}{geo}")
    for m in reg.get("messages", []):
        out.append(f"  note: {m}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    pi = sub.add_parser("import")
    pi.add_argument("--project", required=True)
    pi.add_argument("--byda-dir")
    pi.add_argument("--dry-run", action="store_true")
    pi.add_argument("--json", action="store_true", help="print the registry as JSON")
    pt = sub.add_parser("trace")
    pt.add_argument("--project", required=True)
    pt.add_argument("--owner", required=True)
    pt.add_argument("--service", required=True)
    pt.add_argument("--pts", required=True, help='"E,N" for a point or "E,N;E,N;..." for a line (project CRS, MGA)')
    pt.add_argument("--by", required=True)
    pt.add_argument("--page", type=int)
    pt.add_argument("--plan-id")
    pt.add_argument("--srid", type=int)
    pt.add_argument("--note")
    for name in ("verify", "reject"):
        q = sub.add_parser(name)
        q.add_argument("--project", required=True)
        q.add_argument("--id", required=True)
        q.add_argument("--by", required=True)
        if name == "reject":
            q.add_argument("--reason", required=True)
        else:
            q.add_argument("--note")
    pl = sub.add_parser("list")
    pl.add_argument("--project", required=True)
    a = ap.parse_args(argv)

    from app.integrations.byda import folder_import as FI
    from app.integrations.byda.traces import TraceError, TraceStore
    from app.integrations.byda.view import load_view

    if a.cmd == "import":
        res = FI.import_folder(a.project, byda_dir=a.byda_dir, today=date.today(), write=not a.dry_run)
        if not res.registry:
            print("; ".join(res.messages) or "nothing imported")
            return 1
        print(json.dumps(res.registry, indent=1) if a.json else _summary(res.registry))
        print(f"\n{'DRY RUN: nothing stored' if a.dry_run else 'stored'}: {res.created_plans} plan file(s) written to {Path(a.project) / 'dbyd' / 'plans'}, {res.skipped_plans} already stored")
        print("All traced services are DRAFT until a person verifies them. No service is drawn from an import.")
        return 0
    ts = TraceStore(a.project)
    try:
        if a.cmd == "trace":
            pts = [[float(x) for x in p.split(",")] for p in a.pts.split(";") if p.strip()]
            reg = FI.load_registry(a.project) or {}
            od = next((o for o in reg.get("owners", []) if o["owner"].lower() == a.owner.lower()), None)
            rec = ts.add_draft(owner=od["owner"] if od else a.owner, service=a.service, kind="point" if len(pts) == 1 else "polyline", pts=pts, traced_by=a.by, plan_id=a.plan_id or (od or {}).get("plan_ids", [None])[0],
                               page=a.page, plan_date=(od or {}).get("plan_date"), srid=a.srid, note=a.note)
            print(f"DRAFT {rec['id']}  {rec['owner']} {rec['service']}: not drawn until verified")
        elif a.cmd == "verify":
            r = ts.verify(a.id, a.by, a.note)
            print(f"VERIFIED {r['id']} by {r['verified_by']} at {r['verified_at']}")
        elif a.cmd == "reject":
            r = ts.reject(a.id, a.by, a.reason)
            print(f"REJECTED {r['id']} by {r['rejected_by']}: {r['reject_reason']}")
        else:
            v = load_view(a.project)
            if v is None:
                print("no BYDA registry in this project: EXISTING SERVICES NOT CONFIRMED")
                return 1
            print("\n".join(v.summary_lines()))
            print("\t".join(v.status_header()))
            for r in v.status_rows():
                print("\t".join(r))
            for f in ts.features():
                print(f"  {f['id'][:8]} {f['status']:9} {f['owner']} {f['service']} traced by {f['traced_by']}" + (f", verified by {f['verified_by']}" if f.get("verified_by") else ""))
    except TraceError as ex:
        print(f"REFUSED: {ex}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

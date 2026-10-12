"""Convert cited requirements (knowledge/<council>/requirements.json) into the --rules-json list for run_site.py.

Only plain setback keys `setback.<dwelling_type>.<element>_m` for the requested zone are emitted, each carrying its
source document, page and exact quote. Variant keys (unsealed road, farm building, ...) are listed in `skipped`
so nothing is silently applied."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ELEMENTS = {"front_m": "front", "side_m": "side", "rear_m": "rear", "secondary_frontage_m": "secondary_frontage"}


def convert(reqs: list[dict], zone: str, dwelling_type: str) -> dict:
    rules, skipped = [], []
    for r in reqs:
        parts = r["key"].split(".")
        if parts[0] != "setback" or len(parts) < 3 or parts[1] != dwelling_type:
            continue
        z = (r.get("applies_to") or {}).get("zone")
        if z not in (zone, None):
            continue
        if len(parts) > 3 or parts[2] not in ELEMENTS or r.get("value") is None:
            skipped.append(r["key"])
            continue
        s = r["source"]
        rules.append({"element": ELEMENTS[parts[2]], "value_numeric": float(r["value"]), "unit": r.get("unit") or "m",
                      "dwelling_type": dwelling_type, "requirement_key": r["key"], "zone": z,
                      "source_doc": s.get("document_title"), "source_page": s.get("page"), "section_ref": s.get("section_ref"),
                      "quote": s.get("quote"), "confidence": r.get("confidence"), "rule_text": (r.get("value_struct") or {}).get("rule")})
    return {"zone": zone, "dwelling_type": dwelling_type, "rules": rules, "skipped": skipped}


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--knowledge", default="knowledge/gunnedah/requirements.json")
    p.add_argument("--zone", required=True)
    p.add_argument("--dwelling-type", required=True, choices=["dwelling_house", "secondary_dwelling", "outbuilding", "farm_building"])
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    d = json.loads(Path(a.knowledge).read_text())
    out = convert(d if isinstance(d, list) else d["requirements"], a.zone, a.dwelling_type)
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(f"{len(out['rules'])} cited rule(s) -> {a.out}; skipped variants: {out['skipped']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

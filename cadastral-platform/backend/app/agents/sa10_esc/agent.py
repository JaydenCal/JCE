"""Sub-Agent 10: proposed erosion and sediment control plan (ESCP) generator."""
from __future__ import annotations

import hashlib
import re
from datetime import date
from pathlib import Path

from app.agents.base import AgentError

from . import outputs
from .layers import insert_sql
from .layout import build_layout
from .models import (AGENT_CODE_NAME, SCHEMA_IN, SCHEMA_OUT, Sa10EscInput, Sa10EscOutput)
from .render_pdf import render_pdf
from .reqs import ReqView, load_requirements


class Sa10Esc:
    code = AGENT_CODE_NAME          # AgentCode has no SA10 member (contracts.py untouched); orchestrator wiring is out of scope
    version = "0.1.0"
    input_schema = SCHEMA_IN
    output_schema = SCHEMA_OUT
    input_model = Sa10EscInput

    def run(self, p: Sa10EscInput) -> Sa10EscOutput:
        if p.lot.jurisdiction != "NSW":
            raise AgentError("SA10_JURISDICTION_UNSUPPORTED", "Only the NSW ESC standards (Blue Book, Building Sites 2024) are ingested; QLD later.")
        rs, unresolved_db = load_requirements(p.requirements_path)
        rq = ReqView(rs, unresolved_db, selectors={k: v for k, v in dict(jurisdiction=p.lot.jurisdiction, lga=p.lot.lga_name).items() if v})
        L = build_layout(p, rq)
        out_dir = Path(p.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = p.file_stem or "escp_" + re.sub(r"[^A-Za-z0-9]+", "_", p.lot.lotplan).strip("_")
        warnings = list(L.warnings)
        if p.lot.jurisdiction == "NSW" and p.lot.lga_name and "gunnedah" not in p.lot.lga_name.lower():
            warnings.append("Council-specific ESC requirements were ingested for Gunnedah only; for other councils the council DCP must be checked.")
        files: dict[str, str] = {}
        info = render_pdf(p, L, rq, {"warnings": warnings}, out_dir / f"{stem}.pdf")
        files["pdf"] = str(out_dir / f"{stem}.pdf")
        d = outputs.write_dxf(p, L, out_dir / f"{stem}.dxf")
        if d["audit_errors"]:
            raise AgentError("DXF_AUDIT_FAILED", "; ".join(d["audit_errors"][:5]))
        files["dxf"] = str(out_dir / f"{stem}.dxf")
        gj, parts = outputs.build_parts_and_geojson(p, L, out_dir, stem)
        files.update(geojson=str(gj), scene_parts=str(parts))
        sql = out_dir / "005_esc_layers.sql"
        sql.write_text(insert_sql())
        unresolved = [{"key": k, "prompt": msg, "used_by": [i for i, ks in L.elem_used.items() if k in ks]} for k, msg in sorted(rq.missing.items())]
        out = Sa10EscOutput(elements=L.elements, flow=L.flow, quantities={**L.quantities, "sheet_scale": info["scale"]},
                            resolved_keys=sorted(rq.used), unresolved=unresolved, assumptions=L.assumptions, warnings=warnings, not_placed=list(L.not_placed), files=files)
        rpt = out_dir / f"{stem}_report.md"
        out.files["report"] = str(rpt)
        outputs.write_report(p, L, rq, out, rpt)
        return out

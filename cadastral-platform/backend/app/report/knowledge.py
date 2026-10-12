"""Load cited council requirements for the report from backend/knowledge/<lga>/ (lazy, optional)."""
from __future__ import annotations

import json
import re
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).parents[2] / "knowledge"


def derive_lga(lga_name: str | None, results) -> str:
    """lga_name if SA1 gave one, else the council named in a mapped LEP ('Gunnedah Local Environmental Plan 2012')."""
    if lga_name and lga_name.strip():
        return lga_name.strip()
    for r in results:
        for a in getattr(r, "attributes", []) or []:
            m = re.match(r"^(.*?) Local Environmental Plan\b", str(a.get("EPI_NAME", "")))
            if m:
                return m[1].strip()
    return ""


def load_requirements(lga: str | None, knowledge_dir: Path | None = None) -> tuple[list[dict], list[dict]]:
    if not lga:
        return [], []
    d = (knowledge_dir or KNOWLEDGE_DIR) / lga.strip().lower().replace(" ", "_")
    reqs: list[dict] = []
    unres: list[dict] = []
    try:
        reqs = json.loads((d / "requirements.json").read_text(encoding="utf-8")).get("requirements", [])
    except (OSError, ValueError):
        pass
    try:
        u = json.loads((d / "unresolved.json").read_text(encoding="utf-8"))
        unres = u if isinstance(u, list) else u.get("unresolved", [])
    except (OSError, ValueError):
        pass
    return reqs, unres

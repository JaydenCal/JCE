"""Access to the cited ESC requirements (knowledge/esc/requirements.json)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.agents.requirements.models import Requirement, RequirementSet, UnresolvedRequirement

KNOW = Path(__file__).resolve().parents[3] / "knowledge" / "esc"


def doc_tag(r: Requirement) -> str:
    t = r.source.document_title if r.source else ""
    short = ("Building Sites 2024" if "building sites" in t.lower() else "Blue Book v1" if "Soils and Construction" in t
             else "Gunnedah Eng. Std 2025" if "Engineering" in t else t[:30])
    return f"{short} p.{r.source.page}" if r.source else short


def load_requirements(path: str | Path | None = None) -> tuple[RequirementSet, dict[str, dict]]:
    p = Path(path) if path else KNOW / "requirements.json"
    rs = RequirementSet(requirements=[Requirement.model_validate(r) for r in json.loads(p.read_text())["requirements"]])
    unresolved = {u["key"]: u for u in json.loads((p.parent / "unresolved.json").read_text())} if (p.parent / "unresolved.json").exists() else {}
    return rs, unresolved


@dataclass
class Resolved:
    key: str
    value: Any
    cite: str
    tag: str
    req: Requirement


@dataclass
class ReqView:
    """Looks keys up; records which were resolved and which were not (nothing defaults)."""
    rs: RequirementSet
    unresolved_db: dict[str, dict]
    used: dict[str, Resolved] = field(default_factory=dict)
    missing: dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> Resolved | None:
        try:
            r = self.rs.get_requirement(key)
        except UnresolvedRequirement as ex:
            self.missing[key] = (self.unresolved_db.get(key) or {}).get("prompt") or ex.prompt
            return None
        res = Resolved(key, r.value, r.citation(), doc_tag(r), r)
        self.used[key] = res
        return res

    def value(self, key: str):
        r = self.get(key)
        return None if r is None else r.value

    def miss(self, key: str) -> None:
        """Key known to be unresolved from the knowledge base (unresolved.json)."""
        self.missing[key] = (self.unresolved_db.get(key) or {}).get("prompt") or f"{key}: not stated in the governing documents; to be confirmed by the designer/certifier."

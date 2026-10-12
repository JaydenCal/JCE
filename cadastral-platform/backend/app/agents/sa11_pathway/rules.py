"""Data-driven rule set (knowledge/pathway/rules.json). Citation validator: a resolved rule without a full citation is rejected."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.agents.requirements.models import Source

RULES_PATH = Path(__file__).resolve().parents[3] / "knowledge" / "pathway" / "rules.json"


class Rule(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    code: str
    pathway: str
    label: str
    category: str
    dev_types: list[str]
    zones: list[str] | None = None
    field: str | None = None
    op: str | None = None
    value: Any = None
    unit: str | None = None
    bands: list[dict] | None = None
    band_field: str | None = None
    applies_if: list[dict] = Field(default_factory=list)
    assumes: dict[str, str] = Field(default_factory=dict)
    note: str | None = None
    confidence: float = 0.0
    verify_current: bool = True
    status: str
    else_unresolved: bool = False
    prompt: str | None = None
    citation: Source | None = None

    @model_validator(mode="after")
    def _cited(self) -> "Rule":
        if self.status == "resolved":
            c = self.citation
            if c is None or not (c.quote and c.sha256 and c.document_title and c.page):
                raise ValueError(f"rule {self.id}: resolved rule needs a full citation (document, page, quote, sha256)")
        elif not self.prompt:
            raise ValueError(f"rule {self.id}: unresolved rule needs a prompt")
        return self


class RuleSet(BaseModel):
    rules: list[Rule]
    inland_lgas: list[str]
    inland_citation: Source
    built_at: str | None = None
    currency_warning: str | None = None
    blocked: list[dict] = Field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "RuleSet":
        p = Path(path or RULES_PATH)
        d = json.loads(p.read_text())
        blocked = []
        up = p.with_name("unresolved.json")
        if up.exists():
            blocked = json.loads(up.read_text()).get("blocked_documents", [])
        return cls(rules=[Rule(**r) for r in d["rules"]], inland_lgas=d["inland_code_lgas"]["lgas"],
                   inland_citation=Source(**d["inland_code_lgas"]["citation"]), built_at=d.get("built_at"),
                   currency_warning=d.get("currency_warning"), blocked=blocked)

    def by_id(self, rid: str) -> Rule:
        return next(r for r in self.rules if r.id == rid)

    def is_inland(self, lga: str | None) -> bool | None:
        if not lga:
            return None
        n = lga.casefold().replace(" shire council", "").replace(" council", "").replace(" city", "").replace(" regional", "").strip()
        for x in self.inland_lgas:
            if x.casefold().replace(" shire", "").replace(" city", "").replace(" regional", "").strip() == n:
                return True
        return False

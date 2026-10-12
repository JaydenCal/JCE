"""Requirement models. No value exists here without a citation or an explicit user entry (decision #8)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PLACEHOLDER_STAMP = "PLACEHOLDER, NOT A REQUIREMENT"


class RequirementKey(str, Enum):
    RWT_MIN_TANK_VOLUME_L = "rwt.min_tank_volume_l"
    RWT_ROOF_CONNECTION_PCT = "rwt.roof_connection_pct"
    RWT_DEMAND_CONNECTIONS = "rwt.demand_connections"
    RWT_WATER_TARGET_PCT = "rwt.water_target_pct"
    UTIL_CLEARANCE_M = "util.clearance_m"
    UTIL_BUILD_OVER_ALLOWED = "util.build_over_allowed"
    UTIL_MIN_COVER_M = "util.min_cover_m"
    SEWER_MIN_GRADE_PCT = "sewer.min_grade_pct"
    WATER_MIN_COVER_M = "water.min_cover_m"
    DRIVEWAY_MAX_GRADE_PCT = "driveway.max_grade_pct"
    DRIVEWAY_MAX_GRADE_CHANGE_PCT = "driveway.max_grade_change_pct"
    DRIVEWAY_MIN_WIDTH_M = "driveway.min_width_m"
    DRIVEWAY_MAX_WIDTH_M = "driveway.max_width_m"
    DRIVEWAY_MIN_SEPARATION_M = "driveway.min_separation_m"
    # setback.<element> values come from SA2's SetbackRule pipeline (not duplicated here)


KEY_HELP = {
    RequirementKey.RWT_MIN_TANK_VOLUME_L: "minimum rainwater tank volume (L)",
    RequirementKey.RWT_ROOF_CONNECTION_PCT: "minimum % of roof area connected to the tank",
    RequirementKey.RWT_DEMAND_CONNECTIONS: "number of demand connections (toilets/laundry/etc) required",
    RequirementKey.RWT_WATER_TARGET_PCT: "water-saving / reliability target (%)",
    RequirementKey.UTIL_CLEARANCE_M: "horizontal clearance (m) from a utility of this service/diameter",
    RequirementKey.UTIL_BUILD_OVER_ALLOWED: "whether building over this service is permitted",
    RequirementKey.UTIL_MIN_COVER_M: "minimum cover (m) over this utility",
    RequirementKey.SEWER_MIN_GRADE_PCT: "minimum sewer grade (%) for this diameter",
    RequirementKey.WATER_MIN_COVER_M: "minimum water service cover (m)",
    RequirementKey.DRIVEWAY_MAX_GRADE_PCT: "maximum driveway grade (%)",
    RequirementKey.DRIVEWAY_MAX_GRADE_CHANGE_PCT: "maximum change of grade (%)",
    RequirementKey.DRIVEWAY_MIN_WIDTH_M: "minimum crossover/driveway width (m)",
    RequirementKey.DRIVEWAY_MAX_WIDTH_M: "maximum crossover/driveway width (m)",
    RequirementKey.DRIVEWAY_MIN_SEPARATION_M: "minimum crossover separation from corner/intersection (m)",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Selectors(M):
    jurisdiction: str | None = None
    authority: str | None = None
    lga: str | None = None
    zone: str | None = None
    service: str | None = None
    dia_min_mm: int | None = None
    dia_max_mm: int | None = None

    def specificity(self) -> int:
        return sum(v is not None for v in self.model_dump().values())

    def canon(self) -> str:
        return "|".join(f"{k}={str(v).casefold()}" for k, v in sorted(self.model_dump().items()) if v is not None)


class Source(M):
    document_title: str = ""
    authority: str = ""
    version: str | None = None
    effective_date: date | None = None
    page: int | None = None
    section_ref: str | None = None
    quote: str = ""
    source_url: str | None = None
    retrieved_at: datetime = Field(default_factory=_now)
    sha256: str = ""
    chunk_id: str | None = None
    entered_by: str | None = None      # user_entered only
    entered_at: datetime | None = None

    def cite(self) -> str:
        if self.entered_by:
            return f"user-entered by {self.entered_by}"
        return f"{self.document_title} ({self.authority}) p.{self.page} s.{self.section_ref}: \"{self.quote}\""


class Requirement(M):
    key: str
    applies_to: Selectors = Field(default_factory=Selectors)
    value: float | bool | str | None = None
    value_struct: dict[str, Any] | None = None
    unit: str | None = None
    source: Source | None = None
    extraction_method: Literal["table", "llm", "user_entered", "regex"] | None = None
    confidence: float = 0.0
    status: Literal["resolved", "unresolved", "user_confirmed", "conflict"] = "unresolved"
    prompt: str | None = None                      # what to ask the user when unresolved/conflict
    alternatives: list["Requirement"] = Field(default_factory=list)   # conflict: the competing citations
    verified_by: str | None = None

    @property
    def usable(self) -> bool:
        return self.status in ("resolved", "user_confirmed") and self.value is not None

    def citation(self) -> str:
        return self.source.cite() if self.source else ""

    def to_db_row(self) -> dict[str, Any]:
        s = self.source or Source()
        return {"requirement_key": self.key, "applies_to": self.applies_to.model_dump(mode="json"),
                "value_json": self.value if self.value_struct is None else self.value_struct, "unit": self.unit,
                "status": self.status, "extraction_method": self.extraction_method, "confidence": self.confidence,
                "doc_title": s.document_title, "authority": s.authority, "version_label": s.version,
                "effective_date": s.effective_date, "page": s.page, "section_ref": s.section_ref, "quote": s.quote,
                "source_url": s.source_url, "retrieved_at": s.retrieved_at, "file_sha256": s.sha256,
                "entered_by": s.entered_by, "entered_at": s.entered_at, "verified_by": self.verified_by,
                "prompt": self.prompt}


class UnresolvedRequirement(Exception):
    def __init__(self, key: str, selectors: dict[str, Any], prompt: str, conflict: "Requirement | None" = None):
        super().__init__(f"{key} unresolved for {selectors}: {prompt}")
        self.key, self.selectors, self.prompt, self.conflict = key, selectors, prompt, conflict


class UnresolvedItem(M):
    """Reported by agents in place of a defaulted value."""
    key: str
    selectors: dict[str, Any] = Field(default_factory=dict)
    prompt: str
    conflict: bool = False


def to_item(e: UnresolvedRequirement) -> UnresolvedItem:
    return UnresolvedItem(key=e.key, selectors=e.selectors, prompt=e.prompt, conflict=e.conflict is not None)


def _ci(a: str | None, b: str | None) -> bool:
    return (a or "").casefold() == (b or "").casefold()


CONTEXT_SEL = ("jurisdiction", "authority", "lga", "zone")


class RequirementSet(M):
    requirements: list[Requirement] = Field(default_factory=list)

    def add(self, r: Requirement) -> None:
        self.requirements.append(r)

    def _match(self, r: Requirement, key: str, q: dict[str, Any]) -> bool:
        if r.key != key:
            return False
        a = r.applies_to
        for f in CONTEXT_SEL:                      # context selectors: checked only when the caller supplies them
            if getattr(a, f) is not None and q.get(f) is not None and not _ci(getattr(a, f), str(q[f])):
                return False
        if a.service is not None and not _ci(a.service, q.get("service")):
            return False
        if a.dia_min_mm is not None or a.dia_max_mm is not None:
            d = q.get("dia_mm")
            if d is None or d < (a.dia_min_mm or 0) or (a.dia_max_mm is not None and d > a.dia_max_mm):
                return False
        return True

    def get_requirement(self, key: "str | RequirementKey", **sel: Any) -> Requirement:
        k = key.value if isinstance(key, RequirementKey) else key
        shown = {a: b for a, b in sel.items() if b is not None}
        hits = [r for r in self.requirements if r.status != "unresolved" and self._match(r, k, shown)]
        confirmed = [r for r in hits if r.status == "user_confirmed"]
        pool = confirmed or hits
        if pool:
            top = max(r.applies_to.specificity() for r in pool)
            best = [r for r in pool if r.applies_to.specificity() == top]
            conf = [r for r in best if r.status == "conflict"]
            if conf:
                raise UnresolvedRequirement(k, shown, conf[0].prompt or "conflicting sources; confirm which applies", conf[0])
            vals = {str(r.value) for r in best}
            if len(vals) > 1:
                raise UnresolvedRequirement(k, shown, "conflicting values at equal specificity; confirm which applies")
            return best[0]
        try:
            base = RequirementKey(k)
            help_ = KEY_HELP.get(base, k)
        except ValueError:
            help_ = k
        pr = next((r.prompt for r in self.requirements if r.key == k and r.status == "unresolved" and r.prompt), None)
        raise UnresolvedRequirement(k, shown, pr or f"Not found in the governing documents: please supply {help_} "
                                    f"with its source, for {shown or 'this lot'}.")

    def get(self, key: "str | RequirementKey", **sel: Any) -> Any:
        return self.get_requirement(key, **sel).value

    def unresolved(self) -> list[Requirement]:
        return [r for r in self.requirements if r.status in ("unresolved", "conflict")]

    def citations(self) -> list[Requirement]:
        return [r for r in self.requirements if r.usable]

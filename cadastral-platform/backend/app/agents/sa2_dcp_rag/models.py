from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ELEMENTS = ("front", "secondary_frontage", "side", "rear", "side_upper", "rear_upper", "garage_front",
            "site_cover_max", "landscape_min", "private_open_space_min", "height_max", "storeys_max",
            "floor_space_ratio_max")
DWELLING_TYPES = ("dwelling_house", "dual_occupancy", "secondary_dwelling", "multi_dwelling", "attached",
                  "garage", "outbuilding")
UNITS = ("m", "percent", "m2", "ratio", "count")


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Chunk(M):
    chunk_id: str
    doc_id: str = "doc"
    page_from: int
    page_to: int
    section_ref: str | None = None
    kind: Literal["text", "table", "figure_caption"] = "text"
    content: str
    token_count: int = 0
    embedding: list[float] | None = None


class SetbackRule(M):
    zone_code: str
    dwelling_type: str = "dwelling_house"
    element: str
    lot_condition: dict[str, Any] = Field(default_factory=dict)
    value_numeric: float
    unit: str
    is_performance_outcome: bool = False
    extraction_confidence: float = Field(ge=0, le=1)
    source_chunk_id: str
    source_page: int
    quote: str = ""
    method: Literal["table", "llm"] = "table"


class Citation(M):
    chunk_id: str
    page_from: int
    page_to: int
    section_ref: str | None = None
    doc_title: str | None = None


class Sa2Input(M):
    lga: str
    zone_code: str
    corner_lot: bool = False
    area_m2: float | None = None
    frontage_m: float | None = None
    dwelling_type: str = "dwelling_house"


class SetbackRuleset(M):
    rules: list[SetbackRule] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class Sa2Output(M):
    status: Literal["unverified"] = "unverified"
    setback_ruleset: SetbackRuleset
    used_llm: bool = False


class DocMeta(M):
    doc_id: str
    title: str
    lga: str
    effective_date: date | None = None
    chunks: list[Chunk] = Field(default_factory=list)

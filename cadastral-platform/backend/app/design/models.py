"""Pydantic models for the design module."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ModelKind = Literal["real", "proxy_box"]
Anchor = Literal["floor", "ground", "wall", "ceiling"]
Severity = Literal["info", "warning", "blocking"]


class CatalogueItemIn(BaseModel):
    retailer: str
    source_url: str
    sku: str | None = None
    title: str
    brand: str | None = None
    price_aud: float | None = Field(default=None, ge=0)
    price_captured_at: datetime | None = None
    width_m: float | None = Field(default=None, gt=0)
    depth_m: float | None = Field(default=None, gt=0)
    height_m: float | None = Field(default=None, gt=0)
    category: str | None = None
    image_uri: str | None = None
    model_uri: str | None = None
    model_kind: ModelKind = "proxy_box"
    licence_note: str | None = None

    @property
    def has_dimensions(self) -> bool:
        return all(v for v in (self.width_m, self.depth_m, self.height_m))


class ImportResult(BaseModel):
    status: Literal["ok", "dimensions_required"]
    item: CatalogueItemIn | None = None          # present on ok; partial draft on dimensions_required
    missing: list[str] = []
    notes: list[str] = []


class ImportRequest(BaseModel):
    url: str
    width_m: float | None = Field(default=None, gt=0)    # user-supplied after dimensions_required
    depth_m: float | None = Field(default=None, gt=0)
    height_m: float | None = Field(default=None, gt=0)


class PlacedItemIn(BaseModel):
    catalogue_item_id: UUID
    x: float
    y: float
    z: float | None = None                    # omitted -> snapped from terrain / level floor
    yaw_deg: float = 0
    pitch_deg: float = 0
    roll_deg: float = 0
    scale: float = Field(default=1.0, gt=0)
    scale_locked: bool = True
    anchor: Anchor = "ground"
    level_id: UUID | None = None
    room_id: UUID | None = None
    locked: bool = False

    @field_validator("scale")
    @classmethod
    def _finite(cls, v: float) -> float:
        if v > 100:
            raise ValueError("scale too large")
        return v


class PlacedItemPatch(BaseModel):
    x: float | None = None
    y: float | None = None
    z: float | None = None
    yaw_deg: float | None = None
    pitch_deg: float | None = None
    roll_deg: float | None = None
    scale: float | None = Field(default=None, gt=0)
    scale_locked: bool | None = None
    anchor: Anchor | None = None
    level_id: UUID | None = None
    room_id: UUID | None = None
    locked: bool | None = None


class Issue(BaseModel):
    kind: Literal["envelope", "boundary", "dbyd_buffer", "driveway", "collision", "terrain", "dimensions"]
    severity: Severity
    message: str
    ref_id: str | None = None


class PlacementResult(BaseModel):
    x: float
    y: float
    z: float
    yaw_deg: float
    scale: float
    issues: list[Issue] = []

    @property
    def blocked(self) -> bool:
        return any(i.severity == "blocking" for i in self.issues)

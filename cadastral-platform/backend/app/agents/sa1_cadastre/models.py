from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.agents.base import AgentError
from app.common.contracts import LotContext

NSW_PLANS = ("DP", "SP", "CP", "BUP", "SL", "PS", "GTP")
QLD_PLANS = ("RP", "SP", "CP", "BUP", "SL", "AP", "CSH")
_NSW3 = re.compile(r"^(?P<lot>[A-Z0-9]{1,6})/(?P<sec>[A-Z0-9]*|-)/(?P<plan>[A-Z]{2,4})(?P<num>\d{1,7})$")
_NSW2 = re.compile(r"^(?P<lot>[A-Z0-9]{1,6})/(?P<plan>[A-Z]{2,4})(?P<num>\d{1,7})$")
_QLD = re.compile(r"^(?P<lot>\d{1,5})/?(?P<plan>[A-Z]{2,3})(?P<num>\d{1,7})$")


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LotIdentifier(Model):
    jurisdiction: Literal["NSW", "QLD", "CUSTOM"]
    lot: str
    section: str | None = None
    plan_type: str
    plan_number: str

    @property
    def lotplan(self) -> str:
        if self.jurisdiction == "QLD":
            return f"{self.lot}{self.plan_type}{self.plan_number}"
        return f"{self.lot}/{self.section or ''}/{self.plan_type}{self.plan_number}"

    @classmethod
    def parse(cls, text: str, jurisdiction: str) -> "LotIdentifier":
        s = re.sub(r"\s+", "", text or "").upper()
        if jurisdiction == "NSW":
            m = _NSW3.match(s) or _NSW2.match(s)
            if not m:
                raise AgentError("SA1_BAD_IDENTIFIER", f"NSW lot/plan {text!r} not like '12//DP345678', '12/DP345678' or '12/-/DP345678'")
            sec = m.groupdict().get("sec")
            sec = None if sec in (None, "", "-") else sec
            if m["plan"] not in NSW_PLANS:
                raise AgentError("SA1_BAD_IDENTIFIER", f"unknown NSW plan type {m['plan']!r}")
            return cls(jurisdiction="NSW", lot=m["lot"], section=sec, plan_type=m["plan"], plan_number=m["num"])
        if jurisdiction == "QLD":
            m = _QLD.match(s)
            if not m or m["plan"] not in QLD_PLANS:
                raise AgentError("SA1_BAD_IDENTIFIER", f"QLD lot/plan {text!r} not like '1RP12345' (plans {QLD_PLANS})")
            return cls(jurisdiction="QLD", lot=m["lot"], plan_type=m["plan"], plan_number=m["num"])
        raise AgentError("SA1_BAD_JURISDICTION", f"unsupported jurisdiction {jurisdiction!r}")


class Sa1Request(Model):
    jurisdiction: Literal["NSW", "QLD"]
    lot_identifier: str | None = None
    address: str | None = None
    point: tuple[float, float] | None = None  # (lon, lat) GDA2020

    @model_validator(mode="after")
    def _one(self):
        if sum(x is not None for x in (self.lot_identifier, self.address, self.point)) != 1:
            raise ValueError("provide exactly one of lot_identifier, address, point")
        return self


class Snapshot(Model):
    jurisdiction: Literal["NSW", "QLD", "CUSTOM"]
    provider: str
    service_url: str
    layer_name: str
    query_params: dict
    response_sha256: str  # hex
    http_etag: str | None = None
    licence: str = "CC BY 4.0"
    attribution: str
    fetched_at: datetime


class ZoneShare(Model):
    zone_code: str
    zone_name: str
    instrument: str
    is_residential: bool
    overlap_area_m2: float
    overlap_fraction: float
    is_dominant: bool
    geom_wkt_gda2020: str = ""


class ZonePolygon(Model):
    """A zoning polygon kept so a land zoning map can be drawn: MGA metres, clipped to a window around the lot (never repaired, never invented)."""
    zone_code: str
    zone_name: str
    instrument: str
    geom_wkt_mga: str
    on_lot: bool                 # True when the polygon overlaps the lot


class Overlay(Model):
    overlay_type: str
    overlay_label: str
    attributes: dict = {}


class SegmentDetail(Model):
    polygon_index: int
    ring_index: int
    seq_in_ring: int
    seq: int


class Sa1Result(Model):
    lot: LotContext
    identifier: LotIdentifier
    segment_details: list[SegmentDetail]
    zones: list[ZoneShare] = []
    overlays: list[Overlay] = []
    multi_zone: bool = False
    is_residential: bool | None = None
    area_mismatch: bool = False
    flags: list[str] = []
    snapshots: list[Snapshot] = []
    boundary_wkt_gda2020: str = ""
    attributes: dict = {}
    zone_polygons: list[ZonePolygon] = []      # zoning polygons in a window around the lot (MGA), on the lot or not; [] when the run kept none
    zone_source: Snapshot | None = None        # the zoning query snapshot (service, layer name, attribution, fetch time); None when none was made

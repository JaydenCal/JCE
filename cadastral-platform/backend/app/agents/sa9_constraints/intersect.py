"""Intersect lot / footprint with constraint layer features (shapely, MGA metres)."""
from __future__ import annotations

import hashlib
import json
from typing import Literal, Protocol

from pydantic import BaseModel
from shapely import wkt
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.agents.sa9_constraints.layers import LayerType


class Feature(BaseModel):
    geometry_wkt: str
    attrs: dict = {}


class LayerData(BaseModel):
    features: list[Feature]
    currency: str | None = None            # data currency / last-updated string from the source


class LayerLoader(Protocol):
    def load(self, layer: LayerType, bbox: tuple[float, float, float, float]) -> LayerData: ...


class LayerResult(BaseModel):
    key: str
    label: str
    status: Literal["affected", "not_affected", "not_checked"]
    overlap_area_m2: float = 0.0
    pct_of_lot: float = 0.0
    footprint_affected: bool | None = None
    nearest_distance_m: float | None = None
    attributes: list[dict] = []            # attrs of affecting features
    data_currency: str | None = None
    snapshot_sha256: str | None = None
    endpoint_verified: bool = False
    error: str | None = None
    geometries_wkt: list[str] = []         # affecting feature geometries (for maps/geojson)


def _snapshot(data: LayerData) -> str:
    return hashlib.sha256(json.dumps(data.model_dump(), sort_keys=True).encode()).hexdigest()


def check_layer(layer: LayerType, lot: BaseGeometry, footprint: BaseGeometry | None, loader: LayerLoader | None,
                margin: float = 150.0) -> LayerResult:
    base = dict(key=layer.key, label=layer.label, endpoint_verified=layer.verified)
    if loader is None or not layer.endpoint:
        return LayerResult(status="not_checked", error="no endpoint configured", **base)
    try:
        minx, miny, maxx, maxy = lot.bounds
        data = loader.load(layer, (minx - margin, miny - margin, maxx + margin, maxy + margin))
        feats = [(wkt.loads(f.geometry_wkt), f.attrs) for f in data.features]
    except Exception as e:  # never report a failed load as clear
        return LayerResult(status="not_checked", error=f"{type(e).__name__}: {e}", **base)
    base.update(data_currency=data.currency, snapshot_sha256=_snapshot(data))
    hits, attrs, near = [], [], None
    for g, a in feats:
        d = lot.distance(g)
        near = d if near is None else min(near, d)
        if d <= layer.buffer_m and (d == 0 or layer.buffer_m > 0):
            hits.append((g, a))
    geoms = [g for g, _ in hits]
    inter = unary_union([g.intersection(lot) for g in geoms]) if geoms else None
    area = round(inter.area, 3) if inter is not None else 0.0
    fp = None
    if footprint is not None:
        fp = any(footprint.distance(g) <= layer.buffer_m for g in geoms)
    attrs = [{k: v for k, v in a.items() if not layer.attr_fields or k in layer.attr_fields} for _, a in hits]
    return LayerResult(status="affected" if hits else "not_affected", overlap_area_m2=area,
                       pct_of_lot=round(100 * area / lot.area, 2) if lot.area else 0.0, footprint_affected=fp,
                       nearest_distance_m=None if near is None else round(near, 2), attributes=attrs,
                       geometries_wkt=[g.wkt for g in geoms], **base)

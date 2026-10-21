"""Intersect lot / footprint with constraint layer features (shapely, MGA metres)."""
from __future__ import annotations

import hashlib
import json
from typing import Literal, Protocol

from pydantic import BaseModel
from shapely import wkt
from shapely.geometry.base import BaseGeometry
from shapely.geometry import box
from shapely.ops import unary_union

from app.agents.sa9_constraints.layers import LayerType

MAP_FEATURE_CAP = 400            # most features kept per layer for the planning map extracts (more sets map_features_truncated)


class Feature(BaseModel):
    geometry_wkt: str
    attrs: dict = {}


class LayerData(BaseModel):
    features: list[Feature]
    currency: str | None = None            # data currency / last-updated string from the source


class LayerLoader(Protocol):
    def load(self, layer: LayerType, bbox: tuple[float, float, float, float]) -> LayerData: ...


class MapFeature(BaseModel):
    """A feature of the layer inside the search window, clipped to that window, kept so the planning map extracts can draw it."""
    geometry_wkt: str
    attrs: dict = {}


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
    map_features: list[MapFeature] = []    # every feature the service returned inside the search window (clipped to it), for planning map extracts
    map_window: list[float] | None = None  # (minx, miny, maxx, maxy) MGA metres of the search window the service was asked for
    map_features_truncated: bool = False   # more than MAP_FEATURE_CAP features: the extract shows only the first ones


def _snapshot(data: LayerData) -> str:
    return hashlib.sha256(json.dumps(data.model_dump(), sort_keys=True).encode()).hexdigest()


def _scalar_attrs(layer: LayerType, a: dict) -> dict:
    """The attributes the layer registry names (all of them when it names none), scalar values only, long strings cut."""
    out = {}
    for k, v in a.items():
        if layer.attr_fields and k not in layer.attr_fields:
            continue
        if v is None or isinstance(v, (int, float, bool)):
            out[k] = v
        elif isinstance(v, str):
            out[k] = v[:160]
    return out


def _map_features(layer: LayerType, feats: list, win: BaseGeometry) -> tuple[list[MapFeature], bool]:
    """Features meeting the search window, clipped to it (a statewide polygon is not stored whole). Geometry is never invented: a polygon that
    cannot be clipped is kept as returned, and the figure code repairs it for drawing only."""
    out: list[MapFeature] = []
    for g, a in feats:
        try:
            if not g.intersects(win):
                continue
            c = g.intersection(win)
        except Exception:  # noqa: BLE001  an invalid third-party polygon
            c = g
        if c.is_empty:
            continue
        if len(out) >= MAP_FEATURE_CAP:
            return out, True
        out.append(MapFeature(geometry_wkt=c.wkt, attrs=_scalar_attrs(layer, a)))
    return out, False


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
    mf, truncated = _map_features(layer, feats, box(minx - margin, miny - margin, maxx + margin, maxy + margin))
    return LayerResult(map_features=mf, map_window=[minx - margin, miny - margin, maxx + margin, maxy + margin], map_features_truncated=truncated,
                       status="affected" if hits else "not_affected", overlap_area_m2=area,
                       pct_of_lot=round(100 * area / lot.area, 2) if lot.area else 0.0, footprint_affected=fp,
                       nearest_distance_m=None if near is None else round(near, 2), attributes=attrs,
                       geometries_wkt=[g.wkt for g in geoms], **base)

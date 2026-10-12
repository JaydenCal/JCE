"""Geometric comparison of a BuildingModel against an envelope and setback rules.

This is a drawing aid. It does not determine planning or building-code compliance; limits must come from cited requirements.
"""
from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel
from shapely import wkt as _wkt
from shapely.geometry import LineString, Polygon

from .mesh import to_footprint_polygon
from .model import BuildingModel
from .topology import Issue


class SetbackRule(BaseModel):
    name: str
    kind: Literal["front", "side", "rear", "all"] = "all"
    min_m: float
    source: str = ""            # citation text supplied by the caller (e.g. DCP clause)


class Requirements(BaseModel):
    setbacks: list[SetbackRule] = []
    max_height_m: float | None = None
    max_site_cover_pct: float | None = None
    max_floor_area_m2: float | None = None
    include_eaves: bool = False
    include_decks: bool = False


class EnvelopeReport(BaseModel):
    footprint_area_m2: float
    inside_area_m2: float
    encroachment_area_m2: float
    encroachment_wkt: str = ""
    within_envelope: bool
    setback_min_m: dict[str, float] = {}
    max_height_m: float = 0.0
    site_cover_pct: float | None = None
    warnings: list[Issue] = []
    disclaimer: str = "Geometric check only; not a planning or NCC/BCA compliance determination."


def _poly(p: Any):
    return p if hasattr(p, "geom_type") else (_wkt.loads(p) if isinstance(p, str) else Polygon(p))


def building_height(m: BuildingModel) -> float:
    """Max height above ground_rl to the roof ridge/top (flat: parapet-free roof plate top)."""
    best = 0.0
    for r in m.roofs:
        lv = m.level(r.level_id)
        best = max(best, lv.rl + lv.ceiling_height + (m.roof_ridge_height(r) if r.type != "flat" else 0.15) - m.ground_rl)
    return best


def check_against(model: BuildingModel, envelope_polygon: Any = None, requirements: Requirements | dict | None = None,
                  lot_polygon: Any = None) -> EnvelopeReport:
    """Encroachment of the footprint beyond `envelope_polygon`, plus per-rule warnings. Setback rules need `lot_polygon`
    (front/side/rear classified by each lot edge's outward normal relative to the model frontage direction)."""
    req = Requirements.model_validate(requirements) if isinstance(requirements, dict) else (requirements or Requirements())
    fp = to_footprint_polygon(model, include_decks=req.include_decks, include_eaves=req.include_eaves)
    out = EnvelopeReport(footprint_area_m2=round(fp.area, 3), inside_area_m2=round(fp.area, 3), encroachment_area_m2=0.0, within_envelope=True)
    w = out.warnings
    if envelope_polygon is not None:
        env = _poly(envelope_polygon)
        enc = fp.difference(env)
        out.inside_area_m2 = round(fp.intersection(env).area, 3)
        out.encroachment_area_m2 = round(enc.area, 3)
        out.encroachment_wkt = enc.wkt if not enc.is_empty else ""
        out.within_envelope = enc.area < 0.01
        if not out.within_envelope:
            w.append(Issue(code="ENVELOPE_ENCROACHMENT", message=f"footprint extends {enc.area:.2f} m2 beyond the supplied envelope"))
    if req.setbacks:
        if lot_polygon is None:
            w.append(Issue(code="NO_LOT_POLYGON", message="setback rules supplied but no lot_polygon; setbacks not measured"))
        else:
            lot = _poly(lot_polygon)
            f = model.frontage_vec()
            ring = list(lot.exterior.coords)
            cc = lot.centroid
            ccw = lot.exterior.is_ccw
            edges: dict[str, list[LineString]] = {"front": [], "side": [], "rear": []}
            for a, b in zip(ring, ring[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dy)
                if L < 1e-6:
                    continue
                n = (dy / L, -dx / L) if ccw else (-dy / L, dx / L)
                dot = n[0] * f[0] + n[1] * f[1]
                edges["front" if dot > 0.7 else "rear" if dot < -0.7 else "side"].append(LineString([a, b]))
            del cc
            for rule in req.setbacks:
                es = [e for k, v in edges.items() for e in v if rule.kind in ("all", k)]
                if not es:
                    w.append(Issue(code="NO_EDGES_FOR_RULE", message=f"no lot edges classified as '{rule.kind}' for rule {rule.name}"))
                    continue
                dmin = min(fp.distance(e) for e in es)
                out.setback_min_m[rule.name] = round(dmin, 3)
                if dmin < rule.min_m - 1e-6:
                    w.append(Issue(code="SETBACK_SHORT", message=f"{rule.name}: nearest approach {dmin:.2f} m is less than {rule.min_m:g} m" + (f" ({rule.source})" if rule.source else "")))
            if req.max_site_cover_pct is not None:
                out.site_cover_pct = round(100 * fp.area / lot.area, 2)
                if out.site_cover_pct > req.max_site_cover_pct:
                    w.append(Issue(code="SITE_COVER", message=f"footprint covers {out.site_cover_pct:.1f}% of the lot, above {req.max_site_cover_pct:g}%"))
    out.max_height_m = round(building_height(model), 3)
    if req.max_height_m is not None and out.max_height_m > req.max_height_m:
        w.append(Issue(code="HEIGHT", message=f"model height {out.max_height_m:.2f} m exceeds {req.max_height_m:g} m"))
    if req.max_floor_area_m2 is not None and model.floor_area() > req.max_floor_area_m2:
        w.append(Issue(code="FLOOR_AREA", message=f"floor area {model.floor_area():.1f} m2 exceeds {req.max_floor_area_m2:g} m2"))
    return out

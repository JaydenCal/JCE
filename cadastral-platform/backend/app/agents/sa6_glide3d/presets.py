"""Building presets: shed (Class 10a) and granny flat (secondary dwelling).

Every dimension is a USER-EDITABLE default for drawing purposes only. None of them is a planning or
building-code limit; compliance limits must come from cited requirements (SA2 / SA9), not from here.
"""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from shapely import affinity, wkt
from shapely.geometry import Polygon, box

from app.common.contracts import DevelopmentType

from .models import BuildingIn, RollerDoorIn

DEFAULTS_NOTE = ("Default dimensions are editable drawing inputs, NOT compliance limits; "
                 "verify size, height and setback limits against the cited planning requirements.")


class PresetDims(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width_m: float = Field(gt=0)
    depth_m: float = Field(gt=0)
    wall_height_m: float = Field(gt=0)
    roof_type: Literal["gable", "skillion"]
    roof_pitch_deg: float = Field(ge=0, lt=60)
    eaves_m: float = Field(ge=0)
    roller_door_width_m: float | None = None
    roller_door_height_m: float | None = None


SHED_DEFAULTS = PresetDims(width_m=6.0, depth_m=4.0, wall_height_m=2.4, roof_type="skillion", roof_pitch_deg=10.0,
                           eaves_m=0.15, roller_door_width_m=2.4, roller_door_height_m=2.1)
GRANNY_FLAT_DEFAULTS = PresetDims(width_m=9.0, depth_m=5.0, wall_height_m=2.7, roof_type="gable", roof_pitch_deg=22.5,
                                  eaves_m=0.45)


def default_dims(dev: DevelopmentType) -> PresetDims | None:
    return {DevelopmentType.shed: SHED_DEFAULTS, DevelopmentType.secondary_dwelling: GRANNY_FLAT_DEFAULTS}.get(dev)


def place_rectangle(envelope_wkt: str, width_m: float, depth_m: float, step_m: float = 0.5) -> str | None:
    """Axis-aligned (to the envelope's main axis) rectangle inside the largest envelope polygon, nearest its
    centroid. None if it does not fit (the caller must report that, not shrink it)."""
    g = wkt.loads(envelope_wkt)
    poly = max(g.geoms, key=lambda p: p.area) if hasattr(g, "geoms") else g
    if poly.is_empty:
        return None
    mrr = poly.minimum_rotated_rectangle
    c = list(mrr.exterior.coords)
    ang = math.degrees(math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]))
    o = poly.centroid
    local = affinity.rotate(poly, -ang, origin=o)
    minx, miny, maxx, maxy = local.bounds
    best, bd = None, 1e18
    x = minx
    while x + width_m <= maxx + 1e-9:
        y = miny
        while y + depth_m <= maxy + 1e-9:
            r = box(x, y, x + width_m, y + depth_m)
            if local.buffer(1e-6).contains(r):
                d = r.centroid.distance(local.centroid)
                if d < bd:
                    best, bd = r, d
            y += step_m
        x += step_m
    return None if best is None else affinity.rotate(best, ang, origin=o).wkt


def building_preset(dev: DevelopmentType, footprint_wkt: str, base_rl: float, dims: PresetDims | None = None,
                    name: str | None = None) -> BuildingIn:
    """BuildingIn for a shed / granny flat on the given footprint (dims only set roof/wall/door; the footprint is the caller's)."""
    d = dims or default_dims(dev)
    if d is None:
        raise ValueError(f"no building preset for development type {dev.value}")
    shed = dev is DevelopmentType.shed
    return BuildingIn(
        name=name or ("Shed" if shed else "Granny flat"), footprint_wkt=footprint_wkt, base_rl=base_rl,
        wall_height_m=d.wall_height_m, roof_type=d.roof_type, roof_pitch_deg=d.roof_pitch_deg, eaves_m=d.eaves_m,
        wall_colour="#bfc4c2" if shed else "#d8d3c4", use=dev, habitable=not shed,
        roller_door=RollerDoorIn(width_m=d.roller_door_width_m or 2.4, height_m=d.roller_door_height_m or 2.1) if shed else None)


def preset_footprint(dev: DevelopmentType, envelope_wkt: str, dims: PresetDims | None = None) -> str | None:
    d = dims or default_dims(dev)
    return place_rectangle(envelope_wkt, d.width_m, d.depth_m) if d else None

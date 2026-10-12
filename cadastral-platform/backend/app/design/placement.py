"""Placement validation: snapping, rotation steps, collisions and compliance checks.

All geometry is in the lot's MGA frame (metres). Compliance findings against services
buffers/driveway/envelope are WARNINGS (illustrative design, Terms addendum); only physical
impossibilities (outside lot, inside a wall, no dimensions) are 'blocking'.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

from shapely import affinity
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.base import BaseGeometry

from app.design.models import Issue, PlacementResult

Sampler = Callable[[float, float], "float | None"]
Named = tuple[str, BaseGeometry]


@dataclass
class PlacementContext:
    terrain: Sampler | None = None                  # (x, y) -> z m AHD, None outside the surface
    floor_rl: float | None = None                   # finished floor level of the item's level
    envelope: BaseGeometry | None = None
    boundary: BaseGeometry | None = None            # lot polygon
    dbyd_buffers: Sequence[Named] = field(default_factory=list)
    driveways: Sequence[Named] = field(default_factory=list)   # driveway / swept-path polygons
    walls: Sequence[tuple[str, LineString, float]] = field(default_factory=list)   # id, centreline, thickness
    others: Sequence[tuple[str, Polygon, float, float]] = field(default_factory=list)  # id, footprint, z0, z1
    rotation_step_deg: float = 15.0


def snap_yaw(yaw_deg: float, step: float) -> float:
    return round(yaw_deg / step) * step % 360 if step > 0 else yaw_deg % 360


def footprint(x: float, y: float, w: float, d: float, yaw_deg: float, scale: float = 1.0) -> Polygon:
    """Oriented box (OBB) centred on (x, y); yaw is counter-clockwise from +X (east)."""
    b = box(-w * scale / 2, -d * scale / 2, w * scale / 2, d * scale / 2)
    return affinity.translate(affinity.rotate(b, yaw_deg, origin=(0, 0)), x, y)


def validate_placement(dims: tuple[float | None, float | None, float | None], x: float, y: float,
                       z: float | None, yaw_deg: float, scale: float, anchor: str, ctx: PlacementContext,
                       self_id: str | None = None) -> PlacementResult:
    issues: list[Issue] = []
    w, d, h = dims
    yaw = snap_yaw(yaw_deg, ctx.rotation_step_deg)
    if not (w and d and h):
        issues.append(Issue(kind="dimensions", severity="blocking",
                            message="item has no real-world dimensions, so it cannot be placed to scale"))
        return PlacementResult(x=x, y=y, z=z or 0.0, yaw_deg=yaw, scale=scale, issues=issues)

    # --- snap vertically
    if anchor == "ground":
        gz = ctx.terrain(x, y) if ctx.terrain else None
        if gz is not None:
            z = gz
        elif ctx.terrain is not None:
            issues.append(Issue(kind="terrain", severity="warning",
                                message="no terrain data at this point; height not snapped"))
    elif anchor == "floor" and ctx.floor_rl is not None:
        z = ctx.floor_rl
    elif anchor == "ceiling" and ctx.floor_rl is not None and z is None:
        z = ctx.floor_rl + 2.7 - h * scale
    if z is None:
        z = 0.0
        issues.append(Issue(kind="terrain", severity="info", message="no height supplied; defaulted to 0 m AHD"))

    fp = footprint(x, y, w, d, yaw, scale)
    z0, z1 = z, z + h * scale

    # --- physical
    if ctx.boundary is not None and not ctx.boundary.buffer(1e-6).contains(fp):
        issues.append(Issue(kind="boundary", severity="blocking", message="item extends beyond the lot boundary"))
    for wid, line, t in ctx.walls:
        if fp.intersects(line.buffer(t / 2, cap_style="flat")):
            issues.append(Issue(kind="collision", severity="blocking", message="item intersects a wall", ref_id=wid))
    for oid, ofp, oz0, oz1 in ctx.others:
        if oid != self_id and z0 < oz1 and oz0 < z1 and fp.intersection(ofp).area > 1e-6:
            issues.append(Issue(kind="collision", severity="warning",
                                message="item overlaps another placed item", ref_id=oid))

    # --- compliance (warnings only)
    if ctx.envelope is not None and anchor in ("floor", "ceiling", "wall") and not ctx.envelope.buffer(1e-6).contains(fp):
        issues.append(Issue(kind="envelope", severity="warning",
                            message="indoor item lies outside the building envelope"))
    for bid, bg in ctx.dbyd_buffers:
        if fp.intersects(bg):
            issues.append(Issue(kind="dbyd_buffer", severity="warning", ref_id=bid,
                                message="item is on a utility exclusion buffer; verify service location and "
                                        "owner requirements before building"))
    for did, dg in ctx.driveways:
        if fp.intersects(dg):
            issues.append(Issue(kind="driveway", severity="warning", ref_id=did,
                                message="item is within the driveway / swept-path area"))
    return PlacementResult(x=x, y=y, z=round(z, 3), yaw_deg=yaw, scale=scale, issues=issues)

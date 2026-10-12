"""Typed, serialisable edit operations for a BuildingModel (pydantic discriminated union).

``apply(model, op) -> (new_model, ChangeReport)`` is pure (the input model is never mutated). Invalid operations return
the ORIGINAL model plus a report with ``ok=False`` and structured ``errors``. Warnings are advisory drawing hints only;
nothing here states or implies NCC/BCA or planning compliance.
"""
from __future__ import annotations

import math
from typing import Annotated, Any, ClassVar, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .model import ROOF_TYPES, ROOM_USES, XY, BuildingModel, Deck, Level, Opening, Room, Stair, resolve_material
from .topology import Issue

DISCLAIMER = "Advisory drawing checks only. SA8 does not determine or claim NCC/BCA, planning or any other compliance."
ADVISORY_MIN_AREA = {"bedroom": 9.0, "living": 12.0, "kitchen": 5.0, "bath": 3.0, "ensuite": 2.5, "laundry": 2.0, "study": 4.0, "garage": 13.0}
OPENING_DEFAULTS = {"window": (1.2, 1.2, 0.9), "door": (0.82, 2.04, 0.0), "sliding_door": (2.4, 2.1, 0.0), "garage_door": (2.4, 2.1, 0.0)}


class OpError(Exception):
    def __init__(self, code: str, message: str, ids: list[str] | None = None):
        super().__init__(message)
        self.code, self.message, self.ids = code, message, ids or []


class ChangeReport(BaseModel):
    op: str
    ok: bool = True
    summary: str = ""
    added: list[str] = []
    removed: list[str] = []
    modified: list[str] = []
    warnings: list[Issue] = []
    errors: list[Issue] = []
    metrics: dict[str, float] = {}
    disclaimer: str = DISCLAIMER


class _Ctx:
    def __init__(self):
        self.warnings: list[Issue] = []
        self.summary = ""

    def warn(self, code, msg, ids=None):
        self.warnings.append(Issue(code=code, message=msg, ids=ids or []))


class _Op(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: str

    def run(self, m: BuildingModel, c: _Ctx) -> None:  # pragma: no cover
        raise NotImplementedError


# ---------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------
def _lvl(m, ref):
    lv = m.level(ref)
    if lv is None:
        raise OpError("LEVEL_NOT_FOUND", f"level '{ref}' not found", [str(ref)])
    return lv


def _room(m, ref):
    r = m.room(ref)
    if r is None:
        raise OpError("ROOM_NOT_FOUND", f"room '{ref}' not found; rooms: {[r.name for r in m.rooms]}", [str(ref)])
    return r


def _roofs(m, rid):
    if rid is None:
        if not m.roofs:
            raise OpError("NO_ROOF", "the model has no roof")
        return list(m.roofs)
    r = m.roof(rid)
    if r is None:
        raise OpError("ROOF_NOT_FOUND", f"roof '{rid}' not found", [rid])
    return [r]


def _mat(m, spec, kind="other"):
    try:
        return resolve_material(m, spec, kind)
    except KeyError:
        raise OpError("UNKNOWN_MATERIAL", f"unknown material/colour '{spec}'. Use a name from materials, black/white (frames) or #rrggbb", [spec])


def _side_name(m: BuildingModel, side: str) -> str:
    """Normalise front/rear/left/right/n/e/s/w to front|back|left|right in the building frame."""
    try:
        sv = m.side_vec(side)
    except KeyError:
        raise OpError("BAD_SIDE", f"side '{side}' must be front, rear, left, right, n, e, s or w")
    f, r = m.frontage_vec(), m.frame().r
    if sv[0] * f[0] + sv[1] * f[1] > 0.7:
        return "front"
    if sv[0] * f[0] + sv[1] * f[1] < -0.7:
        return "back"
    return "right" if sv[0] * r[0] + sv[1] * r[1] > 0 else "left"


def _attach_rect(m, bounds, side, depth, width, offset):
    fr = m.frame()
    u0, w0, u1, w1 = bounds
    s = _side_name(m, side)
    if s == "front":
        width = width or (u1 - u0)
        return fr.rect(u0 + offset, w0 - depth, u0 + offset + width, w0)
    if s == "back":
        width = width or (u1 - u0)
        return fr.rect(u0 + offset, w1, u0 + offset + width, w1 + depth)
    width = width or (w1 - w0)
    if s == "right":
        return fr.rect(u1, w0 + offset, u1 + depth, w0 + offset + width)
    return fr.rect(u0 - depth, w0 + offset, u0, w0 + offset + width)


def _overlap(m, level_id, poly, ignore=()):
    others = [r.poly for r in m.rooms if r.level_id == level_id and r.id not in ignore]
    return float(Polygon(poly).intersection(unary_union(others)).area) if others else 0.0


def _ext_normal(w):
    d = w.direction
    return (d[1], -d[0])


def _room_walls(m, room, external=True):
    return [w for w in m.walls if room.id in w.room_ids and (w.external or not external)]


def _wall_toward(m, room, side):
    sv = m.side_vec(side)
    ws = _room_walls(m, room)
    if not ws:
        return None
    return max(ws, key=lambda w: (_ext_normal(w)[0] * sv[0] + _ext_normal(w)[1] * sv[1], w.length))


def transform_model(m: BuildingModel, fn, vec_fn=None) -> None:
    """Apply a point mapping to every geometric element (walls included so openings keep their host)."""
    for r in m.rooms:
        r.polygon = [fn(p) for p in r.polygon]
        r.polygon = Room(id=r.id, name=r.name, use=r.use, level_id=r.level_id, polygon=r.polygon).polygon
    for d in m.decks:
        d.polygon = Room(id="x", name="x", level_id="x", polygon=[fn(p) for p in d.polygon]).polygon
    for s in m.stairs:
        s.polygon = Room(id="x", name="x", level_id="x", polygon=[fn(p) for p in s.polygon]).polygon
    for f in m.fixtures:
        f.xy = fn(f.xy)
    for w in m.walls:
        w.a, w.b = fn(w.a), fn(w.b)
    if vec_fn:
        for rf in m.roofs:
            if rf.ridge_dir_deg is not None:
                a = math.radians(rf.ridge_dir_deg)
                v = vec_fn((math.cos(a), math.sin(a)))
                rf.ridge_dir_deg = math.degrees(math.atan2(v[1], v[0])) % 180.0


def _centre(m) -> XY:
    fp = m.footprint()
    c = fp.centroid if not fp.is_empty else Point(0, 0)
    return (c.x, c.y)


def _add_room(m, name, use, level_id, polygon) -> Room:
    r = Room(id=m.new_id("rm"), name=name, use=use, level_id=level_id, polygon=polygon)
    m.rooms.append(r)
    return r


def _opening(m, wall, typ, pos, width=None, height=None, sill=None, frame=None, c: _Ctx | None = None) -> Opening:
    dw, dh, ds = OPENING_DEFAULTS[typ]
    width, height, sill = width or dw, height or dh, ds if sill is None else sill
    if typ == "sliding_door" or typ == "garage_door":
        sill = 0.0 if sill is None else sill
    pos = round(wall.length / 2 if pos is None else pos, 6)
    if width <= 0 or height <= 0 or sill < 0:
        raise OpError("BAD_SIZE", "opening width/height must be > 0 and sill >= 0")
    if pos - width / 2 < 0.05 or pos + width / 2 > wall.length - 0.05:
        raise OpError("OPENING_OUTSIDE_WALL", f"opening ({width:g} m at {pos:.2f}) does not fit wall {wall.id} of length {wall.length:.2f} m", [wall.id])
    if sill + height > wall.height + 1e-6:
        raise OpError("OPENING_TOO_TALL", f"sill+height {sill + height:.2f} m exceeds wall height {wall.height:.2f} m", [wall.id])
    for o in m.openings:
        if o.wall_id == wall.id and abs(o.position - pos) < (o.width + width) / 2 - 1e-6:
            raise OpError("OPENING_OVERLAP", f"overlaps opening {o.id} on wall {wall.id}", [o.id, wall.id])
    if typ == "garage_door" and not wall.external or (typ in ("window", "sliding_door") and not wall.external):
        if c:
            c.warn("OPENING_ON_INTERNAL_WALL", f"{typ} placed on internal wall {wall.id}", [wall.id])
    fm = _mat(m, frame, "frame") if frame else ("mat_white_frame" if typ in ("door", "garage_door") else "mat_black_frame")
    o = Opening(id=m.new_id("op"), wall_id=wall.id, type=typ, position=pos, width=width, height=height, sill=sill, frame=fm)
    m.openings.append(o)
    return o


# ---------------------------------------------------------------------------------------------------
# operations
# ---------------------------------------------------------------------------------------------------
class SetRoofType(_Op):
    """Change roof type (gable, hip, skillion, flat, dutch_gable) for one roof or all roofs."""
    op: Literal["set_roof_type"] = "set_roof_type"
    roof_type: Literal["gable", "hip", "skillion", "flat", "dutch_gable"]
    roof_id: str | None = None

    def run(self, m, c):
        for r in _roofs(m, self.roof_id):
            r.type = self.roof_type
            if self.roof_type != "flat" and r.pitch_deg < 3:
                r.pitch_deg = 22.5
                c.warn("PITCH_RESET", "pitch was < 3 deg; reset to 22.5 deg for a pitched roof", [r.id])
        c.summary = f"roof type set to {self.roof_type}"


class SetRoofPitch(_Op):
    """Set roof pitch in degrees (0-60)."""
    op: Literal["set_roof_pitch"] = "set_roof_pitch"
    pitch_deg: float
    roof_id: str | None = None

    def run(self, m, c):
        if not 0 <= self.pitch_deg <= 60:
            raise OpError("PITCH_OUT_OF_RANGE", "pitch_deg must be between 0 and 60")
        for r in _roofs(m, self.roof_id):
            r.pitch_deg = self.pitch_deg
            if r.type == "flat" and self.pitch_deg > 0:
                c.warn("FLAT_ROOF_PITCH", "roof type is flat; pitch has no geometric effect until the type changes", [r.id])
        c.summary = f"roof pitch set to {self.pitch_deg:g} deg"


class SetRoofEaves(_Op):
    """Set eaves overhang in metres (0-2)."""
    op: Literal["set_roof_eaves"] = "set_roof_eaves"
    eaves_m: float
    roof_id: str | None = None

    def run(self, m, c):
        if not 0 <= self.eaves_m <= 2:
            raise OpError("EAVES_OUT_OF_RANGE", "eaves_m must be between 0 and 2")
        for r in _roofs(m, self.roof_id):
            r.eaves = self.eaves_m
        c.summary = f"eaves set to {self.eaves_m:g} m"


class SetRoofRidge(_Op):
    """Set the ridge direction (degrees anticlockwise from +x in the local frame) or null for automatic (along long axis)."""
    op: Literal["set_roof_ridge"] = "set_roof_ridge"
    ridge_dir_deg: float | None
    roof_id: str | None = None

    def run(self, m, c):
        for r in _roofs(m, self.roof_id):
            r.ridge_dir_deg = None if self.ridge_dir_deg is None else self.ridge_dir_deg % 180.0
        c.summary = "ridge direction updated"


class SetRoofMaterial(_Op):
    """Set roof material by material id or name (e.g. 'Monument', 'mat_surfmist') or #rrggbb."""
    op: Literal["set_roof_material"] = "set_roof_material"
    material: str
    roof_id: str | None = None

    def run(self, m, c):
        mid = _mat(m, self.material)
        for r in _roofs(m, self.roof_id):
            r.material = mid
        if m.materials[mid].approximate:
            c.warn("APPROXIMATE_COLOUR", f"{m.materials[mid].name} hex is an approximate screen colour; check the manufacturer sample", [mid])
        c.summary = f"roof material set to {m.materials[mid].name}"


class SetRoofColour(SetRoofMaterial):
    """Set roof colour by Colorbond-style name (Monument, Surfmist, ...) or hex."""
    op: Literal["set_roof_colour"] = "set_roof_colour"
    material: str = Field(alias="colour")
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SetWallFinish(_Op):
    """Set the wall finish (material name/id/hex). wall_ids null = all walls in `scope` (external|internal|all)."""
    op: Literal["set_wall_finish"] = "set_wall_finish"
    finish: str
    wall_ids: list[str] | None = None
    scope: Literal["external", "internal", "all"] = "external"

    def run(self, m, c):
        mid = _mat(m, self.finish)
        if self.wall_ids is None:
            ws = [w for w in m.walls if self.scope == "all" or (w.external == (self.scope == "external"))]
            if self.scope in ("external", "all"):
                m.external_finish = mid
        else:
            ws = []
            for i in self.wall_ids:
                w = m.wall(i)
                if w is None:
                    raise OpError("WALL_NOT_FOUND", f"wall '{i}' not found", [i])
                ws.append(w)
        for w in ws:
            w.finish = mid
        if m.materials[mid].approximate:
            c.warn("APPROXIMATE_COLOUR", f"{m.materials[mid].name} hex is approximate", [mid])
        c.summary = f"{len(ws)} wall(s) finished in {m.materials[mid].name}"


class SetWindowFrame(_Op):
    """Set window / sliding-door frame colour: 'black', 'white', a material name or hex. opening_ids null = all."""
    op: Literal["set_window_frame"] = "set_window_frame"
    frame: str
    opening_ids: list[str] | None = None

    def run(self, m, c):
        mid = _mat(m, self.frame, "frame")
        n = 0
        for o in m.openings:
            if self.opening_ids is not None and o.id not in self.opening_ids:
                continue
            if self.opening_ids is None and o.type not in ("window", "sliding_door"):
                continue
            o.frame = mid
            n += 1
        if self.opening_ids:
            missing = [i for i in self.opening_ids if m.opening(i) is None]
            if missing:
                raise OpError("OPENING_NOT_FOUND", f"openings not found: {missing}", missing)
        c.summary = f"{n} opening frame(s) set to {m.materials[mid].name}"


class AddRoom(_Op):
    """Add a room either by polygon (local metres) or by adjacency: adjacent_to (room name/id), side
    (front|rear|left|right as seen from the street, or n|e|s|w), depth_m (outward), width_m (along the edge; default full edge), offset_m."""
    op: Literal["add_room"] = "add_room"
    name: str
    use: str = "other"
    level_id: str | None = None
    polygon: list[XY] | None = None
    adjacent_to: str | None = None
    side: str = "right"
    depth_m: float = 3.0
    width_m: float | None = None
    offset_m: float = 0.0
    allow_overlap: bool = False

    def run(self, m, c):
        if self.use not in ROOM_USES:
            raise OpError("BAD_USE", f"use must be one of {list(ROOM_USES)}")
        if self.polygon:
            lv = _lvl(m, self.level_id)
            poly = self.polygon
        elif self.adjacent_to:
            ref = _room(m, self.adjacent_to)
            lv = _lvl(m, self.level_id or ref.level_id)
            if self.depth_m <= 0 or (self.width_m is not None and self.width_m <= 0):
                raise OpError("BAD_SIZE", "depth_m and width_m must be > 0")
            poly = _attach_rect(m, m.frame().bounds(ref.polygon), self.side, self.depth_m, self.width_m, self.offset_m)
        else:
            raise OpError("MISSING_GEOMETRY", "provide polygon or adjacent_to")
        try:
            if not Polygon(poly).is_valid:
                raise OpError("INVALID_POLYGON", "polygon is self-intersecting")
        except ValueError as e:
            raise OpError("INVALID_POLYGON", str(e))
        ov = _overlap(m, lv.id, poly)
        if ov > 0.05 and not self.allow_overlap:
            raise OpError("ROOM_OVERLAP", f"new room would overlap existing rooms by {ov:.2f} m2; choose another side/offset or set allow_overlap", [])
        r = _add_room(m, self.name, self.use, lv.id, poly)
        c.summary = f"added {r.name} ({r.id}) {r.area:.1f} m2"


class RemoveRoom(_Op):
    """Remove a room (by id or name). Walls and openings are re-derived; openings that lose their wall are removed."""
    op: Literal["remove_room"] = "remove_room"
    room: str

    def run(self, m, c):
        r = _room(m, self.room)
        if len(m.rooms) == 1:
            raise OpError("LAST_ROOM", "cannot remove the only room")
        m.rooms.remove(r)
        c.summary = f"removed {r.name}"


class ResizeRoom(_Op):
    """Resize a rectangular room to width_m (street-parallel) and/or depth_m (front to back), keeping `anchor` fixed.
    Neighbours are not moved; resulting overlaps are reported."""
    op: Literal["resize_room"] = "resize_room"
    room: str
    width_m: float | None = None
    depth_m: float | None = None
    anchor: Literal["front_left", "front_right", "back_left", "back_right", "centre"] = "front_left"

    def run(self, m, c):
        r = _room(m, self.room)
        fr = m.frame()
        u0, w0, u1, w1 = fr.bounds(r.polygon)
        if abs((u1 - u0) * (w1 - w0) - r.area) > 0.01 * r.area:
            raise OpError("NOT_RECTANGULAR", f"room {r.name} is not a rectangle in the building frame; use move_wall instead", [r.id])
        W = self.width_m or (u1 - u0)
        D = self.depth_m or (w1 - w0)
        if W < 0.5 or D < 0.5:
            raise OpError("BAD_SIZE", "width and depth must be >= 0.5 m")
        a = self.anchor
        if a == "centre":
            cu, cw = (u0 + u1) / 2, (w0 + w1) / 2
            nu0, nw0 = cu - W / 2, cw - D / 2
        else:
            nu0 = u0 if a.endswith("left") else u1 - W
            nw0 = w0 if a.startswith("front") else w1 - D
        r.polygon = Room(id="x", name="x", level_id="x", polygon=fr.rect(nu0, nw0, nu0 + W, nw0 + D)).polygon
        ov = _overlap(m, r.level_id, r.polygon, ignore=(r.id,))
        if ov > 0.05:
            c.warn("ROOM_OVERLAP", f"resized room overlaps neighbours by {ov:.2f} m2", [r.id])
        c.summary = f"{r.name} resized to {W:.2f} x {D:.2f} m"


class MoveWall(_Op):
    """Move a wall perpendicular to itself by distance_m. direction: outward|inward (external walls), left|right of a->b."""
    op: Literal["move_wall"] = "move_wall"
    wall_id: str
    distance_m: float
    direction: Literal["outward", "inward", "left", "right"] = "outward"

    def run(self, m, c):
        w = m.wall(self.wall_id)
        if w is None:
            raise OpError("WALL_NOT_FOUND", f"wall '{self.wall_id}' not found", [self.wall_id])
        d = w.direction
        left, right = (-d[1], d[0]), (d[1], -d[0])
        if self.direction == "outward":
            nrm = right if w.external else left
        elif self.direction == "inward":
            nrm = left if w.external else right
        else:
            nrm = left if self.direction == "left" else right
        delta = (nrm[0] * self.distance_m, nrm[1] * self.distance_m)
        line = LineString([w.a, w.b])
        for r in m.rooms:
            if r.level_id != w.level_id:
                continue
            new = []
            for p in r.polygon:
                on = math.dist(p, w.a) < 1e-6 or math.dist(p, w.b) < 1e-6 or line.distance(Point(p)) < 1e-6
                new.append((p[0] + delta[0], p[1] + delta[1]) if on else p)
            if new != r.polygon:
                if not Polygon(new).is_valid or Polygon(new).area < 0.5:
                    raise OpError("INVALID_GEOMETRY", f"moving the wall would collapse or self-intersect room {r.name}", [r.id, w.id])
                r.polygon = new
        c.summary = f"wall {w.id} moved {self.distance_m:g} m {self.direction}"


class AddOpening(_Op):
    """Add a door/window/garage_door/sliding_door to a wall (wall_id) or to the external wall of a room facing `side`.
    position_m = distance from the wall start to the opening centre (null = centred). Sizes default by type."""
    op: Literal["add_opening"] = "add_opening"
    type: Literal["door", "window", "garage_door", "sliding_door"]
    wall_id: str | None = None
    room: str | None = None
    side: str = "front"
    position_m: float | None = None
    width_m: float | None = None
    height_m: float | None = None
    sill_m: float | None = None
    frame: str | None = None

    def run(self, m, c):
        if self.wall_id:
            w = m.wall(self.wall_id)
            if w is None:
                raise OpError("WALL_NOT_FOUND", f"wall '{self.wall_id}' not found", [self.wall_id])
        elif self.room:
            r = _room(m, self.room)
            w = _wall_toward(m, r, self.side)
            if w is None:
                raise OpError("NO_EXTERNAL_WALL", f"room {r.name} has no external wall", [r.id])
        else:
            raise OpError("MISSING_TARGET", "provide wall_id or room")
        o = _opening(m, w, self.type, self.position_m, self.width_m, self.height_m, self.sill_m, self.frame, c)
        c.summary = f"added {o.type} {o.id} on {w.id}"


class RemoveOpening(_Op):
    """Remove an opening by id."""
    op: Literal["remove_opening"] = "remove_opening"
    opening_id: str

    def run(self, m, c):
        o = m.opening(self.opening_id)
        if o is None:
            raise OpError("OPENING_NOT_FOUND", f"opening '{self.opening_id}' not found", [self.opening_id])
        m.openings.remove(o)
        c.summary = f"removed {o.id}"


class MoveOpening(_Op):
    """Move an opening to position_m along its wall (or to another wall_id)."""
    op: Literal["move_opening"] = "move_opening"
    opening_id: str
    position_m: float
    wall_id: str | None = None

    def run(self, m, c):
        o = m.opening(self.opening_id)
        if o is None:
            raise OpError("OPENING_NOT_FOUND", f"opening '{self.opening_id}' not found", [self.opening_id])
        w = m.wall(self.wall_id or o.wall_id)
        if w is None:
            raise OpError("WALL_NOT_FOUND", f"wall '{self.wall_id}' not found", [str(self.wall_id)])
        m.openings.remove(o)
        try:
            n = _opening(m, w, o.type, self.position_m, o.width, o.height, o.sill, None, c)
        except OpError:
            m.openings.append(o)
            raise
        n.id, n.frame = o.id, o.frame
        m.counters["op"] -= 1
        c.summary = f"moved {o.id} to {self.position_m:g} m on {w.id}"


class AddDeck(_Op):
    """Add a deck / alfresco / verandah / porch beside the building (or beside `room`) on `side`
    (front|rear|left|right or n|e|s|w). depth_m outward, width_m along the edge (null = full), height_off_ground_m."""
    op: Literal["add_deck"] = "add_deck"
    kind: Literal["deck", "alfresco", "verandah", "porch"] = "deck"
    side: str = "rear"
    depth_m: float = 3.0
    width_m: float | None = None
    height_off_ground_m: float = 0.3
    room: str | None = None
    offset_m: float = 0.0
    roofed: bool | None = None

    def run(self, m, c):
        if self.depth_m <= 0 or self.height_off_ground_m < 0 or (self.width_m is not None and self.width_m <= 0):
            raise OpError("BAD_SIZE", "depth_m > 0, width_m > 0 and height_off_ground_m >= 0 are required")
        if self.room:
            ref = _room(m, self.room)
            lv, b = ref.level_id, m.frame().bounds(ref.polygon)
        else:
            lv = m.levels[0].id
            fp = m.level_polygon(lv)
            b = m.frame().bounds(list(fp.convex_hull.exterior.coords)[:-1])
        poly = _attach_rect(m, b, self.side, self.depth_m, self.width_m, self.offset_m)
        ov = _overlap(m, lv, poly)
        if ov > 0.05:
            raise OpError("DECK_OVERLAPS_ROOM", f"deck would overlap rooms by {ov:.2f} m2; deck is placed beside the building edge", [])
        d = Deck(id=m.new_id("dk"), kind=self.kind, level_id=lv, polygon=Room(id="x", name="x", level_id="x", polygon=poly).polygon,
                 height_off_ground=self.height_off_ground_m, roofed=self.kind == "alfresco" if self.roofed is None else self.roofed)
        m.decks.append(d)
        if self.height_off_ground_m > 1.0:
            c.warn("DECK_HEIGHT", f"deck is {self.height_off_ground_m:g} m off the ground; barriers/balustrade are not modelled", [d.id])
        c.summary = f"added {d.kind} {d.id} {Polygon(d.polygon).area:.1f} m2"


class AddStudyNook(_Op):
    """Add a small study off a named room (default the entry, or the front-most room). side null = first free side."""
    op: Literal["add_study_nook"] = "add_study_nook"
    from_room: str = "Entry"
    width_m: float = 2.4
    depth_m: float = 2.4
    side: str | None = None
    name: str = "Study Nook"

    def run(self, m, c):
        ref = m.room(self.from_room)
        if ref is None:
            cands = [r for r in m.rooms if r.use == "entry"] or sorted([r for r in m.rooms if r.enclosed], key=lambda r: m.frame().bounds(r.polygon)[1])
            if not cands:
                raise OpError("ROOM_NOT_FOUND", f"room '{self.from_room}' not found", [self.from_room])
            ref = cands[0]
            c.warn("REFERENCE_ROOM_SUBSTITUTED", f"'{self.from_room}' not found; used {ref.name}", [ref.id])
        b = m.frame().bounds(ref.polygon)
        for side in ([self.side] if self.side else ["left", "right", "back", "front"]):
            w = min(self.width_m, (b[3] - b[1]) if _side_name(m, side) in ("left", "right") else (b[2] - b[0])) if self.side is None else self.width_m
            poly = _attach_rect(m, b, side, self.depth_m, w, 0.0)
            if _overlap(m, ref.level_id, poly) <= 0.05:
                r = _add_room(m, self.name, "study", ref.level_id, poly)
                c.summary = f"added {r.name} ({r.area:.1f} m2) on the {side} of {ref.name}"
                return
        raise OpError("NO_SPACE", f"no free side of {ref.name} fits a {self.width_m:g} x {self.depth_m:g} m nook", [ref.id])


class FlipPlan(_Op):
    """Mirror the whole plan. left_right (default, e.g. 'garage on the other side') swaps left/right as seen from the street;
    the street frontage direction is unchanged. front_back swaps front and back (frontage direction still unchanged)."""
    op: Literal["flip_plan"] = "flip_plan"
    axis: Literal["left_right", "front_back"] = "left_right"

    def run(self, m, c):
        fr = m.frame()
        cx, cy = _centre(m)
        cu, cw = fr.to_frame((cx, cy))
        if self.axis == "left_right":
            fn = lambda p: fr.to_world(2 * cu - fr.to_frame(p)[0], fr.to_frame(p)[1])  # noqa: E731
        else:
            fn = lambda p: fr.to_world(fr.to_frame(p)[0], 2 * cw - fr.to_frame(p)[1])  # noqa: E731
            c.warn("FRONT_BACK_FLIP", "front_back flip places the former rear toward the street; the frontage direction is unchanged")
        vec = lambda v: tuple(np_sub(fn((v[0], v[1])), fn((0.0, 0.0))))  # noqa: E731
        transform_model(m, fn, vec)
        c.summary = f"plan mirrored {self.axis}; frontage direction kept at {m.frontage_deg:g} deg"


def np_sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


class RotateBuilding(_Op):
    """Rotate the building about its centroid by angle_deg (anticlockwise). The street frontage direction does not rotate."""
    op: Literal["rotate_building"] = "rotate_building"
    angle_deg: float

    def run(self, m, c):
        a = math.radians(self.angle_deg)
        cx, cy = _centre(m)
        ca, sa = math.cos(a), math.sin(a)
        fn = lambda p: (cx + ca * (p[0] - cx) - sa * (p[1] - cy), cy + sa * (p[0] - cx) + ca * (p[1] - cy))  # noqa: E731
        vec = lambda v: (ca * v[0] - sa * v[1], sa * v[0] + ca * v[1])  # noqa: E731
        transform_model(m, fn, vec)
        if abs(self.angle_deg % 90) > 1e-6:
            c.warn("NOT_AXIS_ALIGNED", "building is no longer aligned to the frontage frame; side-based edit operations assume axis-aligned geometry")
        c.summary = f"rotated {self.angle_deg:g} deg"


class SetCeilingHeight(_Op):
    """Set floor-to-ceiling height (2.0-6.0 m) for one level or all; levels above shift up/down accordingly."""
    op: Literal["set_ceiling_height"] = "set_ceiling_height"
    height_m: float
    level_id: str | None = None

    def run(self, m, c):
        if not 2.0 <= self.height_m <= 6.0:
            raise OpError("HEIGHT_OUT_OF_RANGE", "height_m must be between 2.0 and 6.0")
        if self.height_m < 2.4:
            c.warn("LOW_CEILING", f"{self.height_m:g} m is below the 2.4 m commonly drawn for habitable rooms (advisory; confirm requirements)")
        targets = m.levels if self.level_id is None else [_lvl(m, self.level_id)]
        for lv in sorted(targets, key=lambda l: l.rl):
            delta = self.height_m - lv.ceiling_height
            lv.ceiling_height = self.height_m
            for up in m.levels:
                if up.rl > lv.rl + 1e-9 and up not in targets:
                    up.rl += delta
                elif up.rl > lv.rl + 1e-9 and up in targets and self.level_id is None:
                    up.rl += delta
        c.summary = f"ceiling height set to {self.height_m:g} m"


class SetFloorLevel(_Op):
    """Set the finished floor RL (m AHD) of a level (default ground); with shift_upper, levels above move by the same amount."""
    op: Literal["set_floor_level"] = "set_floor_level"
    rl: float
    level_id: str | None = None
    shift_upper: bool = True

    def run(self, m, c):
        lv = _lvl(m, self.level_id)
        d = self.rl - lv.rl
        for l in m.levels:
            if l.id == lv.id or (self.shift_upper and l.rl > lv.rl + 1e-9):
                l.rl += d
        c.summary = f"{lv.name} floor level set to RL {self.rl:g}"


class ScaleFootprint(_Op):
    """Scale the plan about its centroid: factor_x along the street frontage, factor_y front-to-back (0.3-3)."""
    op: Literal["scale_footprint"] = "scale_footprint"
    factor_x: float = 1.0
    factor_y: float = 1.0

    def run(self, m, c):
        if not (0.3 <= self.factor_x <= 3 and 0.3 <= self.factor_y <= 3):
            raise OpError("BAD_SCALE", "factors must be within 0.3 to 3")
        fr = m.frame()
        cu, cw = fr.to_frame(_centre(m))

        def fn(p):
            u, w = fr.to_frame(p)
            return fr.to_world(cu + (u - cu) * self.factor_x, cw + (w - cw) * self.factor_y)
        transform_model(m, fn, None)
        c.summary = f"footprint scaled x{self.factor_x:g} (width) x{self.factor_y:g} (depth)"


class AddLevel(_Op):
    """Add an upper level over the non-garage footprint, split into `rooms` (names) as equal strips across the frontage.
    Adds a stair placeholder. rl defaults to the top level RL + ceiling height + floor_thickness_m."""
    op: Literal["add_level"] = "add_level"
    name: str = "First Floor"
    ceiling_height_m: float = 2.7
    floor_thickness_m: float = 0.3
    rooms: list[str] = ["Bedroom 1", "Bedroom 2", "Bathroom"]

    def run(self, m, c):
        top = max(m.levels, key=lambda l: l.rl)
        base = [r for r in m.rooms if r.level_id == top.id and r.enclosed and r.use not in ("garage", "shed")]
        if not base:
            raise OpError("NO_BASE_FOOTPRINT", "no enclosed non-garage rooms to build over")
        fp = unary_union([r.poly for r in base]).buffer(0)
        lv = Level(id=m.new_id("lv"), name=self.name, rl=top.rl + top.ceiling_height + self.floor_thickness_m, ceiling_height=self.ceiling_height_m)
        m.levels.append(lv)
        fr = m.frame()
        u0, w0, u1, w1 = fr.bounds(list(fp.convex_hull.exterior.coords)[:-1])
        n = max(len(self.rooms), 1)
        for i, nm in enumerate(self.rooms):
            strip = Polygon(fr.rect(u0 + (u1 - u0) * i / n, w0, u0 + (u1 - u0) * (i + 1) / n, w1)).intersection(fp)
            geoms = [g for g in (strip.geoms if hasattr(strip, "geoms") else [strip]) if isinstance(g, Polygon) and g.area > 1.0]
            if geoms:
                g = max(geoms, key=lambda g: g.area)
                use = "bath" if "bath" in nm.lower() else "bedroom" if "bed" in nm.lower() else "other"
                _add_room(m, nm, use, lv.id, list(g.exterior.coords)[:-1])
        host = max(base, key=lambda r: r.area)
        hb = fr.bounds(host.polygon)
        m.stairs.append(Stair(id=m.new_id("st"), from_level=top.id, to_level=lv.id, polygon=fr.rect(hb[0] + 0.2, hb[1] + 0.2, hb[0] + 1.2, hb[1] + 3.0)))
        c.warn("STAIR_PLACEHOLDER", "stair is a placeholder footprint only; no treads, headroom or landing design", [m.stairs[-1].id])
        c.summary = f"added level {lv.name} at RL {lv.rl:.2f} with {n} room(s)"


class SetGarage(_Op):
    """Set garage size none|single|double on the left or right of the building (as seen from the street); replaces any existing garage."""
    op: Literal["set_garage"] = "set_garage"
    size: Literal["none", "single", "double"] = "single"
    side: Literal["left", "right"] = "left"
    depth_m: float = 6.0

    def run(self, m, c):
        if m.development_type == "shed":
            raise OpError("NOT_APPLICABLE", "set_garage does not apply to a shed model")
        g0 = m.levels[0].id
        old = [r for r in m.rooms if r.use == "garage" and r.level_id == g0]
        for r in old:
            m.rooms.remove(r)
        if self.size == "none":
            c.summary = "garage removed"
            return
        main = [r for r in m.rooms if r.level_id == g0 and r.enclosed]
        if not main:
            raise OpError("NO_MAIN_BUILDING", "no rooms to attach a garage to")
        fr = m.frame()
        u0, w0, u1, w1 = fr.bounds(list(unary_union([r.poly for r in main]).convex_hull.exterior.coords)[:-1])
        wd = 3.6 if self.size == "single" else 6.0
        dp = min(self.depth_m, w1 - w0)
        poly = fr.rect(u0 - wd, w0, u0, w0 + dp) if self.side == "left" else fr.rect(u1, w0, u1 + wd, w0 + dp)
        r = _add_room(m, "Garage", "garage", g0, poly)
        m.resync()
        w = _wall_toward(m, r, "front")
        if w is not None:
            dw = 2.4 if self.size == "single" else 4.8
            try:
                _opening(m, w, "garage_door", None, min(dw, w.length - 0.4), 2.1, 0.0, None, c)
            except OpError as e:
                c.warn("GARAGE_DOOR_SKIPPED", e.message, [w.id])
        c.summary = f"{self.size} garage on the {self.side} ({wd:g} x {dp:g} m)"


class SetRoomUse(_Op):
    """Change a room's use and/or rename it."""
    op: Literal["set_room_use"] = "set_room_use"
    room: str
    use: str | None = None
    name: str | None = None

    def run(self, m, c):
        r = _room(m, self.room)
        if self.use:
            if self.use not in ROOM_USES:
                raise OpError("BAD_USE", f"use must be one of {list(ROOM_USES)}")
            r.use = self.use
        if self.name:
            r.name = self.name
        c.summary = f"{r.id} is now '{r.name}' ({r.use})"


Operation = Annotated[Union[SetRoofType, SetRoofPitch, SetRoofEaves, SetRoofRidge, SetRoofMaterial, SetRoofColour, SetWallFinish,
                            SetWindowFrame, AddRoom, RemoveRoom, ResizeRoom, MoveWall, AddOpening, RemoveOpening, MoveOpening,
                            AddDeck, AddStudyNook, FlipPlan, RotateBuilding, SetCeilingHeight, SetFloorLevel, ScaleFootprint,
                            AddLevel, SetGarage, SetRoomUse], Field(discriminator="op")]
_ADAPTER = TypeAdapter(Operation)
OP_CLASSES = [SetRoofType, SetRoofPitch, SetRoofEaves, SetRoofRidge, SetRoofMaterial, SetRoofColour, SetWallFinish, SetWindowFrame,
              AddRoom, RemoveRoom, ResizeRoom, MoveWall, AddOpening, RemoveOpening, MoveOpening, AddDeck, AddStudyNook, FlipPlan,
              RotateBuilding, SetCeilingHeight, SetFloorLevel, ScaleFootprint, AddLevel, SetGarage, SetRoomUse]


def parse_op(data: Any) -> _Op:
    return data if isinstance(data, _Op) else _ADAPTER.validate_python(data)


def op_schemas() -> list[dict]:
    """Tool-use style definitions: [{name, description, input_schema}] (one per operation; `op` is fixed per tool)."""
    out = []
    for cls in OP_CLASSES:
        sch = cls.model_json_schema(by_alias=False)
        name = cls.model_fields["op"].default
        sch.get("properties", {}).get("op", {}).pop("default", None)
        sch["properties"]["op"] = {"const": name, "type": "string"}
        sch["required"] = sorted(set(sch.get("required", [])) | {"op"})
        out.append({"name": name, "description": " ".join((cls.__doc__ or "").split()), "input_schema": sch})
    return out


# ---------------------------------------------------------------------------------------------------
# apply / advisories / history
# ---------------------------------------------------------------------------------------------------
def _collections(m: BuildingModel) -> dict[str, dict]:
    out = {}
    for name in ("levels", "rooms", "walls", "openings", "roofs", "decks", "stairs", "fixtures"):
        for e in getattr(m, name):
            out[e.id] = e.model_dump_json()
    for k, v in m.materials.items():
        out[k] = v.model_dump_json()
    return out


def advise(m: BuildingModel, room_ids: set[str] | None = None) -> list[Issue]:
    """Advisory-only checks: minimum areas/dimensions, window area, overlaps. Never a compliance determination."""
    out = []
    fr = m.frame()
    for r in m.rooms:
        if room_ids is not None and r.id not in room_ids:
            continue
        mn = ADVISORY_MIN_AREA.get(r.use)
        if mn and r.area < mn - 1e-6:
            out.append(Issue(code="ROOM_SMALL", message=f"{r.name} is {r.area:.1f} m2, under the {mn:g} m2 drawing guide for a {r.use} (advisory; confirm requirements)", ids=[r.id]))
        if r.use == "bedroom":
            u0, w0, u1, w1 = fr.bounds(r.polygon)
            if min(u1 - u0, w1 - w0) < 2.7 - 1e-6 and r.poly.area / max((u1 - u0) * (w1 - w0), 1e-9) > 0.95:
                out.append(Issue(code="ROOM_NARROW", message=f"{r.name} is {min(u1 - u0, w1 - w0):.2f} m in its narrow dimension (advisory guide 2.7 m)", ids=[r.id]))
        if r.use in ("bedroom", "living", "study", "kitchen", "dining"):
            glaz = sum(o.width * o.height for o in m.openings if o.type in ("window", "sliding_door")
                       and (w := m.wall(o.wall_id)) is not None and w.external and r.id in w.room_ids)
            if glaz < 0.10 * r.area - 1e-6:
                out.append(Issue(code="WINDOW_AREA", message=f"{r.name}: window area {glaz:.1f} m2 is under 10% of floor area {r.area:.1f} m2 (advisory)", ids=[r.id]))
    rs = [r for r in m.rooms if r.enclosed or True]
    for i, a in enumerate(rs):
        for b in rs[i + 1:]:
            if a.level_id != b.level_id or (room_ids is not None and a.id not in room_ids and b.id not in room_ids):
                continue
            ov = a.poly.intersection(b.poly).area
            if ov > 0.05:
                out.append(Issue(code="ROOM_OVERLAP", message=f"{a.name} and {b.name} overlap by {ov:.2f} m2", ids=[a.id, b.id]))
    return out


def _metrics(m: BuildingModel) -> dict[str, float]:
    fp = m.footprint()
    mx = max((m.roof_ridge_height(r) for r in m.roofs), default=0.0)
    return {"floor_area_m2": round(m.floor_area(), 3), "footprint_area_m2": round(float(fp.area), 3), "max_ridge_rise_m": round(mx, 3),
            "rooms": float(len(m.rooms)), "openings": float(len(m.openings))}


def apply(model: BuildingModel, op: Any) -> tuple[BuildingModel, ChangeReport]:
    """Pure: returns (new_model, report). On failure the original model is returned and report.ok is False."""
    try:
        o = parse_op(op)
    except ValidationError as e:
        name = op.get("op", "?") if isinstance(op, dict) else "?"
        return model, ChangeReport(op=str(name), ok=False, errors=[Issue(code="INVALID_OP", severity="error", message=str(e.errors(include_url=False)[:5]))])
    new = model.model_copy(deep=True)
    ctx = _Ctx()
    try:
        o.run(new, ctx)
        ctx.warnings += new.resync()
    except OpError as e:
        return model, ChangeReport(op=o.op, ok=False, errors=[Issue(code=e.code, message=e.message, ids=e.ids, severity="error")], metrics=_metrics(model))
    except (ValueError, KeyError) as e:
        return model, ChangeReport(op=o.op, ok=False, errors=[Issue(code="INVALID_RESULT", message=f"{type(e).__name__}: {e}", severity="error")])
    before, after = _collections(model), _collections(new)
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    modified = sorted(k for k in set(before) & set(after) if before[k] != after[k])
    touched_rooms = {i for i in added + modified if i in {r.id for r in new.rooms}}
    for i in added + modified:
        w = new.wall(i) if i.startswith("wl") else None
        if w:
            touched_rooms |= set(w.room_ids)
    for i in added + modified:
        op_ = new.opening(i)
        w = new.wall(op_.wall_id) if op_ else None
        if w:
            touched_rooms |= set(w.room_ids)
    seen = {(w.code, tuple(w.ids)) for w in ctx.warnings}
    for w in advise(new, touched_rooms):
        if (w.code, tuple(w.ids)) not in seen:
            ctx.warnings.append(w)
    rep = ChangeReport(op=o.op, summary=ctx.summary, added=added, removed=removed, modified=modified, warnings=ctx.warnings, metrics=_metrics(new))
    rep.metrics["floor_area_delta_m2"] = round(rep.metrics["floor_area_m2"] - _metrics(model)["floor_area_m2"], 3)
    return new, rep


class History:
    """Undo/redo wrapper. Each successful op pushes a snapshot; failed ops change nothing."""

    def __init__(self, model: BuildingModel):
        self._past: list[BuildingModel] = []
        self._future: list[BuildingModel] = []
        self.model = model
        self.log: list[dict] = []
        self._undone: list[dict] = []

    def do(self, op: Any) -> ChangeReport:
        new, rep = apply(self.model, op)
        if rep.ok:
            self._past.append(self.model)
            self._future.clear()
            self._undone.clear()
            self.model = new
            self.log.append(parse_op(op).model_dump(mode="json", by_alias=True))
        return rep

    @property
    def can_undo(self) -> bool:
        return bool(self._past)

    @property
    def can_redo(self) -> bool:
        return bool(self._future)

    def undo(self) -> BuildingModel:
        if self._past:
            self._future.append(self.model)
            self._undone.append(self.log.pop())
            self.model = self._past.pop()
        return self.model

    def redo(self) -> BuildingModel:
        if self._future:
            self._past.append(self.model)
            self.log.append(self._undone.pop())
            self.model = self._future.pop()
        return self.model

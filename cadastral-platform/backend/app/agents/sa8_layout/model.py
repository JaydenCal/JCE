"""SA8 parametric building model (lot-local metres frame, x east / y north, z = RL metres).

Coordinates are in a local frame whose origin sits at ``origin_mga`` (MGA E,N); ``rotation_deg`` is the
anticlockwise rotation of the local frame relative to MGA. ``frontage_deg`` is the direction (local frame,
degrees anticlockwise from +x) of the OUTWARD normal pointing to the street (default 270 = street to the south).
Nothing in this module states or implies NCC/BCA/planning compliance.
"""
from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from shapely.geometry import Polygon
from shapely.ops import unary_union

XY = tuple[float, float]

ROOM_USES = ("bedroom", "living", "kitchen", "dining", "bath", "ensuite", "wc", "laundry", "garage", "study",
             "alfresco", "deck", "verandah", "entry", "hall", "storage", "shed", "stair", "other")
UNENCLOSED_USES = ("alfresco", "deck", "verandah")
HABITABLE_USES = ("bedroom", "living", "kitchen", "dining", "study")

OPENING_TYPES = ("door", "window", "garage_door", "sliding_door")
ROOF_TYPES = ("gable", "hip", "skillion", "flat", "dutch_gable")

# Colorbond-style names. Hex values are APPROXIMATE screen colours, not manufacturer data.
_COLORBOND = {"Monument": "#323233", "Shale Grey": "#BDBFB9", "Surfmist": "#E4E2D6", "Basalt": "#6D6C6E",
              "Woodland Grey": "#4B4C46", "Night Sky": "#1D1E20", "Dune": "#B0A695", "Classic Cream": "#E7DCB9",
              "Paperbark": "#C9BFA6", "Cove": "#8C8272", "Jasper": "#6C5D53", "Wallaby": "#7D786B",
              "Windspray": "#7C8486", "Evening Haze": "#C9C3B0", "Gully": "#7B7568", "Bluegum": "#6E7A7C"}


def slug(s: str) -> str:
    return "mat_" + re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


class Material(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    kind: Literal["colorbond", "render", "frame", "brick", "weatherboard", "cladding", "paint", "glass", "other"] = "other"
    hex: str
    approximate: bool = False
    alpha: float = 1.0

    @field_validator("hex")
    @classmethod
    def _hex(cls, v: str) -> str:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            raise ValueError("hex must be #rrggbb")
        return v.lower()


def default_materials() -> dict[str, Material]:
    out: dict[str, Material] = {}
    for n, h in _COLORBOND.items():
        out[slug(n)] = Material(id=slug(n), name=n, kind="colorbond", hex=h, approximate=True)
    extra = [("Render White", "render", "#f1efe9", False), ("Render Charcoal", "render", "#4a4c4f", False),
             ("White Frame", "frame", "#f4f4f2", False), ("Black Frame", "frame", "#1c1c1e", False),
             ("Brick Red", "brick", "#9a4f3b", True), ("Brick Cream", "brick", "#d9c9a5", True),
             ("Weatherboard White", "weatherboard", "#e9e7e0", True), ("Cladding Grey", "cladding", "#8b8e90", True),
             ("Internal Paint", "paint", "#f6f5f1", False), ("Timber Deck", "other", "#9c7a54", True),
             ("Concrete", "other", "#cfcfc9", False), ("Clear Glass", "glass", "#a6c8da", False)]
    for n, k, h, ap in extra:
        out[slug(n)] = Material(id=slug(n), name=n, kind=k, hex=h, approximate=ap, alpha=0.35 if k == "glass" else 1.0)
    return out


class Level(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    rl: float                       # finished floor level (m AHD)
    ceiling_height: float = 2.7     # floor to ceiling / wall height


class Room(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    use: str = "other"
    level_id: str
    polygon: list[XY]

    @field_validator("use")
    @classmethod
    def _use(cls, v: str) -> str:
        if v not in ROOM_USES:
            raise ValueError(f"use must be one of {ROOM_USES}")
        return v

    @field_validator("polygon")
    @classmethod
    def _poly(cls, v):
        if len(v) > 1 and tuple(v[0]) == tuple(v[-1]):
            v = v[:-1]
        if len(v) < 3:
            raise ValueError("polygon needs >= 3 vertices")
        p = Polygon(v)
        if p.area < 1e-6:
            raise ValueError("degenerate polygon")
        if not p.exterior.is_ccw:
            v = list(reversed(v))
        return [(float(x), float(y)) for x, y in v]

    @property
    def poly(self) -> Polygon:
        return Polygon(self.polygon)

    @property
    def area(self) -> float:
        return float(self.poly.area)

    @property
    def enclosed(self) -> bool:
        return self.use not in UNENCLOSED_USES


class Wall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    level_id: str
    a: XY
    b: XY
    thickness: float = 0.25
    height: float = 2.7
    external: bool = True
    finish: str = "mat_render_white"        # material id
    room_ids: list[str] = []

    @property
    def length(self) -> float:
        return math.hypot(self.b[0] - self.a[0], self.b[1] - self.a[1])

    @property
    def direction(self) -> XY:
        L = self.length or 1.0
        return ((self.b[0] - self.a[0]) / L, (self.b[1] - self.a[1]) / L)

    def point_at(self, s: float) -> XY:
        d = self.direction
        return (self.a[0] + d[0] * s, self.a[1] + d[1] * s)


class Opening(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    wall_id: str
    type: Literal["door", "window", "garage_door", "sliding_door"]
    position: float                 # distance from wall.a to the opening centre (m)
    width: float
    height: float
    sill: float = 0.0
    frame: str = "mat_black_frame"  # material id (windows/sliding doors) or door/panel colour


class Roof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    level_id: str                   # level whose walls it sits on
    type: Literal["gable", "hip", "skillion", "flat", "dutch_gable"] = "gable"
    pitch_deg: float = 22.5
    eaves: float = 0.45
    ridge_dir_deg: float | None = None   # local-frame angle of ridge; None = along each wing's long axis
    material: str = "mat_monument"
    polygons: list[list[XY]] = []        # derived from rooms by resync()


class Deck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["deck", "alfresco", "verandah", "porch"] = "deck"
    level_id: str
    polygon: list[XY]
    height_off_ground: float = 0.3
    roofed: bool = False
    material: str = "mat_timber_deck"


class Stair(BaseModel):
    """Placeholder only: footprint + level link, no tread geometry."""
    model_config = ConfigDict(extra="forbid")
    id: str
    from_level: str
    to_level: str
    polygon: list[XY]


class Fixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: str
    name: str = ""
    level_id: str
    xy: XY
    dims: tuple[float, float, float] = (1.0, 1.0, 1.0)
    yaw_deg: float = 0.0


class BuildingModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_name: str = "building_model.v1"
    name: str = "Building"
    development_type: str = "dwelling_house"
    style: str = "contemporary"
    origin_mga: XY = (0.0, 0.0)
    rotation_deg: float = 0.0
    frontage_deg: float = 270.0
    ground_rl: float = 0.0
    levels: list[Level] = []
    rooms: list[Room] = []
    walls: list[Wall] = []
    openings: list[Opening] = []
    roofs: list[Roof] = []
    decks: list[Deck] = []
    stairs: list[Stair] = []
    fixtures: list[Fixture] = []
    materials: dict[str, Material] = Field(default_factory=default_materials)
    counters: dict[str, int] = {}
    external_finish: str = "mat_render_white"
    notes: list[str] = []

    # ---- ids / lookup -------------------------------------------------------------------------
    def new_id(self, prefix: str) -> str:
        n = self.counters.get(prefix, 0) + 1
        self.counters[prefix] = n
        return f"{prefix}{n}"

    def level(self, ref: str | None) -> Level | None:
        if ref is None:
            return self.levels[0] if self.levels else None
        for l in self.levels:
            if l.id == ref or l.name.lower() == str(ref).lower():
                return l
        return None

    def room(self, ref: str) -> Room | None:
        for r in self.rooms:
            if r.id == ref:
                return r
        hits = [r for r in self.rooms if r.name.lower() == str(ref).lower()]
        return hits[0] if hits else None

    def wall(self, wid: str) -> Wall | None:
        return next((w for w in self.walls if w.id == wid), None)

    def opening(self, oid: str) -> Opening | None:
        return next((o for o in self.openings if o.id == oid), None)

    def roof(self, rid: str) -> Roof | None:
        return next((r for r in self.roofs if r.id == rid), None)

    def element_ids(self) -> set[str]:
        out: set[str] = set()
        for coll in (self.levels, self.rooms, self.walls, self.openings, self.roofs, self.decks, self.stairs, self.fixtures):
            out |= {e.id for e in coll}
        return out

    # ---- frames --------------------------------------------------------------------------------
    def frontage_vec(self) -> XY:
        a = math.radians(self.frontage_deg)
        return (math.cos(a), math.sin(a))

    def frame(self) -> "Frame":
        return Frame(self.frontage_vec())

    def side_vec(self, side: str) -> XY:
        f = self.frontage_vec()
        fr = self.frame()
        table = {"front": f, "rear": (-f[0], -f[1]), "back": (-f[0], -f[1]), "right": fr.r,
                 "left": (-fr.r[0], -fr.r[1]), "n": (0.0, 1.0), "s": (0.0, -1.0), "e": (1.0, 0.0), "w": (-1.0, 0.0)}
        if side not in table:
            raise KeyError(side)
        return table[side]

    # ---- geometry ------------------------------------------------------------------------------
    def level_polygon(self, level_id: str, enclosed_only: bool = True):
        polys = [r.poly for r in self.rooms if r.level_id == level_id and (r.enclosed or not enclosed_only)]
        return unary_union(polys) if polys else Polygon()

    def footprint(self):
        """Union of enclosed room polygons across all levels (gross, to external wall faces)."""
        polys = [r.poly for r in self.rooms if r.enclosed]
        return unary_union(polys).buffer(0) if polys else Polygon()

    def floor_area(self) -> float:
        return float(sum(r.area for r in self.rooms if r.enclosed))

    def to_mga(self, xy: XY) -> XY:
        a = math.radians(self.rotation_deg)
        c, s = math.cos(a), math.sin(a)
        return (self.origin_mga[0] + c * xy[0] - s * xy[1], self.origin_mga[1] + s * xy[0] + c * xy[1])

    def from_mga(self, en: XY) -> XY:
        a = math.radians(-self.rotation_deg)
        c, s = math.cos(a), math.sin(a)
        dx, dy = en[0] - self.origin_mga[0], en[1] - self.origin_mga[1]
        return (c * dx - s * dy, s * dx + c * dy)

    def resync(self):
        from .topology import resync
        return resync(self)

    def roof_ridge_height(self, roof: Roof | str) -> float:
        from .mesh import roof_ridge_height
        return roof_ridge_height(self, roof if isinstance(roof, Roof) else self.roof(roof))

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, s: str) -> "BuildingModel":
        return cls.model_validate_json(s)


class Frame:
    """Building frame: u along the street-right direction, w from the street toward the back of the lot."""

    def __init__(self, f: XY):
        self.f = f
        self.r = (-f[1], f[0])
        self.b = (-f[0], -f[1])

    def to_frame(self, p: XY) -> XY:
        return (p[0] * self.r[0] + p[1] * self.r[1], p[0] * self.b[0] + p[1] * self.b[1])

    def to_world(self, u: float, w: float) -> XY:
        return (u * self.r[0] + w * self.b[0], u * self.r[1] + w * self.b[1])

    def bounds(self, poly: list[XY]):
        q = [self.to_frame(p) for p in poly]
        us, ws = [p[0] for p in q], [p[1] for p in q]
        return min(us), min(ws), max(us), max(ws)

    def rect(self, u0, w0, u1, w1) -> list[XY]:
        return [self.to_world(u0, w0), self.to_world(u1, w0), self.to_world(u1, w1), self.to_world(u0, w1)]


def resolve_material(m: BuildingModel, spec: str, kind: str = "other") -> str:
    """Material id from an id, a name (case-insensitive), 'black'/'white' (frames) or a hex colour. Creates custom materials."""
    if spec in m.materials:
        return spec
    low = spec.strip().lower()
    for mid, mat in m.materials.items():
        if mat.name.lower() == low:
            return mid
    if kind == "frame" and low in ("black", "white"):
        return slug(f"{low} frame")
    if re.fullmatch(r"#[0-9a-f]{6}", low):
        mid = slug(f"custom {low[1:]}")
        if mid not in m.materials:
            m.materials[mid] = Material(id=mid, name=f"Custom {low}", kind=kind if kind in Material.model_fields["kind"].annotation.__args__ else "other", hex=low)
        return mid
    raise KeyError(f"unknown material or colour '{spec}'")

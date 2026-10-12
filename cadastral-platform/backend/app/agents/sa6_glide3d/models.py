"""SA6 request/bundle models. SceneBundle is MODEL-compatible JSON (docs/05) plus `walkable` and `items`."""
from __future__ import annotations

import base64
from typing import Literal
from uuid import UUID

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from app.common.contracts import (DevelopmentType, DrivewayDesign, LotContext, OverlayPolygon, PlanOverlay,
                                  RwtSummary, ServiceLine)


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TinArrays(M):
    """Indexed TIN in absolute MGA (x=E, y=N, z=AHD)."""
    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]

    @classmethod
    def from_b64(cls, vertices_f64_b64: str, triangles_u32_b64: str) -> "TinArrays":
        """From SA3 TinOut base64 arrays."""
        v = np.frombuffer(base64.b64decode(vertices_f64_b64), "<f8").reshape(-1, 3)
        t = np.frombuffer(base64.b64decode(triangles_u32_b64), "<u4").reshape(-1, 3)
        return cls(vertices=[tuple(map(float, r)) for r in v], triangles=[tuple(map(int, r)) for r in t])

    @classmethod
    def from_sa3_mesh(cls, vertices: list[float], indices: list[int], origin: tuple[float, float, float]) -> "TinArrays":
        v = np.asarray(vertices, float).reshape(-1, 3) + np.asarray(origin, float)
        return cls(vertices=[tuple(map(float, r)) for r in v], triangles=[tuple(indices[i:i + 3]) for i in range(0, len(indices), 3)])


class CutFillIn(M):
    cut_volume_m3: float
    fill_volume_m3: float
    pad_level_m: float | None = None
    cut_area_m2: float | None = None
    fill_area_m2: float | None = None


class WallIn(M):
    """Retaining wall (screening only, not structural design)."""
    alignment: list[tuple[float, float]]          # absolute MGA
    height_m: float                               # retained height above the low-side ground
    thickness_m: float = 0.25
    mode: Literal["cut", "fill"] = "cut"
    label: str = "Retaining wall"
    suggested_type: str | None = None


class PitIn(M):
    xy: tuple[float, float]
    label: str = "Pit"
    size_m: float = 0.6
    depth_m: float = 0.9


class RollerDoorIn(M):
    """Roller door on one footprint edge (edge_index into the counter-clockwise exterior ring)."""
    width_m: float = 2.4
    height_m: float = 2.1
    edge_index: int = 0
    colour: str = "#8a8f94"


class BuildingIn(M):
    """Generic extruded footprint with optional roof (from the future design module)."""
    name: str
    footprint_wkt: str
    base_rl: float                                # finished floor level (AHD)
    wall_height_m: float = 2.7
    roof_type: Literal["flat", "gable", "hip", "skillion", "none"] = "gable"
    roof_pitch_deg: float = 22.5
    eaves_m: float = 0.45
    wall_colour: str = "#d8d3c4"
    roof_colour: str = "#4a4f55"
    door_xy: tuple[float, float] | None = None    # absolute MGA; adds a stair link when rise > 0.15 m
    is_existing: bool = False
    use: DevelopmentType = DevelopmentType.dwelling_house
    habitable: bool = True                        # False: no habitable rooms (Class 10a shed)
    roller_door: RollerDoorIn | None = None


class PlacedItem(M):
    item_id: str
    name: str
    x: float                                      # absolute MGA
    y: float
    z: float | None = None                        # None = on the ground
    yaw_deg: float = 0.0
    scale: float = 1.0
    dims_m: tuple[float, float, float] = (1.0, 1.0, 1.0)   # w (x), d (y), h (z)
    catalogue_id: str | None = None
    retailer: str | None = None
    source_url: str | None = None
    price: float | None = None
    model_url: str | None = None                  # glTF/GLB if one exists; else dimensioned proxy
    level: str | None = None


class SceneOptions(M):
    contour_interval_m: float = 0.5
    major_every: int = 5
    max_triangles_per_mesh: int = 20000
    max_total_triangles: int = 50000
    tube_sides: int = 8
    road_width_m: float = 8.0
    eye_height_m: float = 1.6
    default_depth_m: dict[str, float] = {"water": 0.6, "sewer": 1.2, "stormwater": 0.9, "electricity": 0.6,
                                         "gas": 0.5, "telecom": 0.5, "other": 0.6}


class SceneRequest(M):
    schema_name: str = "scene_request.v1"
    project_title: str
    subtitle: str = ""
    lot: LotContext
    origin: tuple[float, float] | None = None     # MGA E0,N0; default = lot centroid floored to 10 m
    ffl: float | None = None
    existing_tin: TinArrays | None = None
    design_tin: TinArrays | None = None
    cut_fill: CutFillIn | None = None
    walls: list[WallIn] = []
    driveway: DrivewayDesign | None = None
    driveway_levels: tuple[float, float] | None = None   # optional kerb RL, garage RL override
    services: list[ServiceLine] = []
    pits: list[PitIn] = []
    rwt: RwtSummary | None = None
    rwt_height_m: float | None = None
    slab_wkt: str | None = None
    overlay: PlanOverlay | None = None
    buildings: list[BuildingIn] = []
    council_overlays: list[OverlayPolygon] = []
    items: list[PlacedItem] = []
    development_type: DevelopmentType = DevelopmentType.dwelling_house
    terms_version_id: UUID | None = None
    options: SceneOptions = SceneOptions()


# ---- bundle -------------------------------------------------------------------------------
class Layer(M):
    c: str
    n: str
    on: bool = True


class Part(M):
    n: str
    c: str
    col: str
    a: float = 1.0
    ro: float | None = None
    me: float | None = None
    v: list[float] | None = None        # flat triangle soup, 9 numbers per triangle
    f: list[int] | None = None
    vc: list[float] | None = None       # per-vertex rgb (0-1), 3 per vertex
    cf: list[float] | None = None       # per-vertex fill(+)/cut(-) depth in metres (surface/cutfill parts)
    lines: list[float] | None = None    # segment pairs, 6 numbers per segment
    lw: float | None = None
    tex: str | None = None
    cs: int | None = None


class Label(M):
    t: str
    p: tuple[float, float, float]
    c: str
    s: float = 0.85


class Info(M):
    title: str
    subtitle: str = ""
    FFL: float | None = None
    origin: tuple[float, float, float]
    srid: int
    status: Literal["unverified"] = "unverified"
    schema_name: str = "scene_bundle.v1"
    ground_texture: str | None = None   # optional aerial ground-texture URL/path (north-up in `srid`)
    ground_texture_extent: tuple[float, float, float, float] | None = None
    ground_texture_attribution: str | None = None


class Floor(M):
    id: str
    kind: Literal["floor", "driveway", "pad"]
    level: float
    ring: list[tuple[float, float]]


class Collider(M):
    id: str
    kind: Literal["box", "prism"]
    c: tuple[float, float, float] | None = None       # box centre
    size: tuple[float, float, float] | None = None    # box length (along yaw), thickness, height
    yaw_deg: float = 0.0
    ring: list[tuple[float, float]] | None = None
    z0: float | None = None
    z1: float | None = None


class Link(M):
    kind: Literal["ramp", "stairs"]
    id: str
    a: tuple[float, float, float]
    b: tuple[float, float, float]
    width_m: float
    steps: int | None = None


class Spawn(M):
    pos: tuple[float, float, float]
    yaw_deg: float
    eye_height_m: float


class Walkable(M):
    terrain_parts: list[str]
    floors: list[Floor] = []
    colliders: list[Collider] = []
    links: list[Link] = []
    spawn: Spawn


class ItemOut(M):
    id: str
    name: str
    t: tuple[float, float, float]
    yaw_deg: float
    scale: float
    dims_m: tuple[float, float, float]
    proxy: Literal["box", "model"]
    model_url: str | None = None
    catalogue_id: str | None = None
    retailer: str | None = None
    source_url: str | None = None
    price: float | None = None
    level: str | None = None
    warnings: list[str] = []


class SceneBundle(M):
    info: Info
    layers: list[Layer]
    parts: list[Part]
    labels: list[Label]
    views: dict[str, dict]
    summary: list[tuple[str, str]]
    notes: list[str]
    walkable: Walkable
    items: list[ItemOut]
    stats: dict[str, float | int]

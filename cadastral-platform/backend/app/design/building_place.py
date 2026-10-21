"""Place a typical dwelling on a lot to the CITED council setbacks (stage 8).

The dwelling is the Plan Studio (Pocket Architect) typical house, imported with ``app.design.building_import`` and read here for the two things the importer does not carry: the
garage room and the garage door.  Everything is geometry in the lot's MGA frame (metres).

Rules this module follows
  * No setback value is typed here.  Each value is read from the council's ``knowledge/<lga>/requirements.json`` for the lot's ZONE (``cited_setbacks``).  A value that is not
    cited for the zone is UNRESOLVED and the dwelling is not placed (``place_house`` returns ``placed=False`` with the reason).
  * The front setback is applied to EVERY part of the building (garage and roofed alfresco included), which is the conservative reading of the cited primary frontage rule.
    The cited text reads "6.5 m or the average of the adjoining dwellings, whichever is less"; the adjoining dwellings are not in the data, so the 6.5 m value is used and the
    row says so.
  * Side and rear values are the cited 0.9 m ("or compliance with the BCA": the BCA alternative is not applied).  The building is centred between the side boundaries.
  * The cited "garage minimum 1 m behind the front building line" rule is MEASURED, never adjusted for.  A typical house whose garage projects forward of the dwelling fails it,
    and the row says by how much.
  * Nothing is shrunk, rotated off the frontage, or moved to hide a failure.  A setback that cannot be met is reported with its deficit.
  * The building outline is indicative: the Plan Studio template is a typical house, not a design for the lot.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points, unary_union

from app.design.building_import import import_planstudio, to_local

KNOW = Path(__file__).resolve().parents[2] / "knowledge"
SOURCE_LABEL = "PLAN STUDIO TYPICAL HOUSE (INDICATIVE)"
LATERAL_STEP_M = 0.02
MET_TOL = 1e-6


# ---------------------------------------------------------------------------------------------------------------------
# the house
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class HouseModel:
    name: str
    footprint: Polygon                       # local frame: x east, y north, origin arbitrary, north up (Plan Studio north arrow applied)
    roof: Polygon | None
    garage: Polygon | None
    dwelling: Polygon | None                 # the rooms other than the garage, grown by half the external wall thickness (the front building line is read from it)
    garage_door_centre: tuple[float, float] | None
    garage_door_width_m: float | None
    front_dir: tuple[float, float]           # unit vector, local frame, pointing OUT through the garage door (or the entry) toward the street
    rooms: list[dict] = field(default_factory=list)      # {name, type, outdoor, area_m2}
    eave_overhang_m: float | None = None
    roof_type: str | None = None
    roof_pitch_deg: float | None = None
    storeys: int = 1
    ceiling_height_m: float | None = None
    tank: dict | None = None                 # template tank (not placed)
    provenance: dict = field(default_factory=dict)
    source_file: str = ""

    @property
    def indoor_area_m2(self) -> float:
        """Indoor floor area as Plan Studio's status bar counts it: rooms that are not outdoor and not the garage."""
        return round(sum(r["area_m2"] for r in self.rooms if not r["outdoor"] and r["type"] != "garage"), 2)

    @property
    def garage_area_m2(self) -> float | None:
        g = [r["area_m2"] for r in self.rooms if r["type"] == "garage"]
        return round(sum(g), 2) if g else None

    @property
    def bedrooms(self) -> int:
        return sum(1 for r in self.rooms if r["type"] == "bedroom")

    def summary(self) -> str:
        parts = [f"{self.name}", f"indoor area {self.indoor_area_m2:.1f} m2"]
        if self.garage_area_m2:
            parts.append(f"attached garage {self.garage_area_m2:.1f} m2")
        outdoor = sum(r["area_m2"] for r in self.rooms if r["outdoor"] and r["type"] == "alfresco")
        if outdoor:
            parts.append(f"roofed alfresco {outdoor:.1f} m2")
        if self.roof_type:
            parts.append(f"{self.roof_type} roof" + (f" at {self.roof_pitch_deg:g} degrees" if self.roof_pitch_deg else ""))
        parts.append(f"{self.storeys} storey" + ("s" if self.storeys != 1 else ""))
        return ", ".join(parts)


def _shoelace(pts: list[tuple[float, float]]) -> float:
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))) / 2.0


def load_house(src: str | Path | dict, use: str = "house") -> HouseModel:
    """Read a Plan Studio project file (``.planstudio.json``) into a ``HouseModel``.  The footprint and roof come from ``building_import`` (the importer used in the app);
    the garage room and the garage door come straight from the file."""
    path = ""
    if isinstance(src, dict):
        raw = src
    else:
        path = str(src)
        raw = json.loads(Path(src).read_text(encoding="utf-8"))
    pl = import_planstudio(raw, Path(path).name if path else "design.planstudio.json", use=use)
    b = pl.building
    north = float(raw.get("site", {}).get("northDeg", 0.0))
    level = b.levels[b.datum_index]
    foot = unary_union([Polygon(r) for r in level.rings]).buffer(0)
    if foot.geom_type != "Polygon":
        foot = max(foot.geoms, key=lambda g: g.area)
    roof = None
    if b.roof_outline:
        rr = unary_union([Polygon(r) for r in b.roof_outline]).buffer(0)
        roof = rr if rr.geom_type == "Polygon" else max(rr.geoms, key=lambda g: g.area)
    lv0 = raw["levels"][0]

    def loc(p: dict) -> tuple[float, float]:
        return to_local(float(p["x"]), float(p["y"]), north)

    rooms, garage, others = [], None, []
    for r in lv0.get("rooms", []):
        pts = [loc(q) for q in r["polygon"]]
        a = round(_shoelace(pts), 2)
        rooms.append({"name": str(r.get("name", "")), "type": str(r.get("type", "")), "outdoor": bool(r.get("outdoor")), "area_m2": a})
        if r.get("type") == "garage" and garage is None:
            garage = Polygon(pts)
        else:
            others.append(Polygon(pts))
    half_wall = float(raw.get("settings", {}).get("extWall", 250)) / 2000.0
    if garage is not None:                                           # the garage as built: room grown to the outside face of the external wall
        garage = garage.buffer(half_wall, join_style=2).intersection(foot.buffer(0.01))
        garage = garage if garage.geom_type == "Polygon" else max(garage.geoms, key=lambda g: g.area)
    dwelling = unary_union(others).buffer(half_wall, join_style=2).intersection(foot.buffer(0.01)) if others else None
    if dwelling is not None and dwelling.geom_type != "Polygon" and not dwelling.is_empty:
        dwelling = max(dwelling.geoms, key=lambda g: g.area)
    walls = {w["id"]: w for w in lv0.get("walls", [])}
    door_c, door_w = None, None
    for o in lv0.get("openings", []):
        if o.get("kind") == "garage_door" and o.get("wallId") in walls:
            w = walls[o["wallId"]]
            a, bb = loc(w["a"]), loc(w["b"])
            L = math.dist(a, bb)
            t = float(o["offset"]) / 1000.0 / L if L else 0.5              # Plan Studio stores the offset of the opening CENTRE along the wall from point a
            door_c = (a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t)
            door_w = float(o["width"]) / 1000.0
            wall_dir = ((bb[0] - a[0]) / L, (bb[1] - a[1]) / L) if L else (1.0, 0.0)
            break
    front = (0.0, -1.0)
    if door_c is not None and garage is not None:
        n1 = (-wall_dir[1], wall_dir[0])
        gc = garage.centroid
        front = n1 if (n1[0] * (door_c[0] - gc.x) + n1[1] * (door_c[1] - gc.y)) > 0 else (-n1[0], -n1[1])
    roofd = lv0.get("roof", {}) or {}
    tank = (raw.get("site", {}).get("tanks") or [None])[0]
    prov = dict(raw.get("_provenance") or {})
    return HouseModel(name=str(raw.get("name", "House")), footprint=foot, roof=roof, garage=garage, dwelling=dwelling, garage_door_centre=door_c, garage_door_width_m=door_w, front_dir=front,
                      rooms=rooms, eave_overhang_m=(float(roofd["overhang"]) / 1000.0 if roofd.get("overhang") is not None else None), roof_type=roofd.get("type"),
                      roof_pitch_deg=roofd.get("pitch"), storeys=len(raw.get("levels", [])) or 1,
                      ceiling_height_m=(float(lv0["height"]) / 1000.0 if lv0.get("height") else None),
                      tank=({"capacity_l": tank.get("capacityL"), "note": "template tank, not placed"} if tank else None), provenance=prov, source_file=path)


# ---------------------------------------------------------------------------------------------------------------------
# cited setbacks
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Cited:
    key: str
    value: float
    unit: str
    doc: str
    version: str
    page: int | None
    section: str
    quote: str
    rule: str = ""
    zone: str | None = None

    @property
    def ref(self) -> str:
        return f"{self.doc} ({self.version.split('(')[0].strip()}), {self.section.replace(' - ', ', ')}" + (f", p.{self.page}" if self.page else "")

    @property
    def vtext(self) -> str:
        v = int(self.value) if float(self.value) == int(self.value) else self.value
        return f"{v} {self.unit}"


SETBACK_KEYS = {"front": "setback.{t}.front_m", "side": "setback.{t}.side_m", "rear": "setback.{t}.rear_m", "secondary": "setback.{t}.secondary_frontage_m",
                "secondary_garage": "setback.{t}.secondary_frontage_garage_m", "garage_behind": "setback.{t}.garage_behind_front_building_line_m",
                "articulation": "setback.{t}.articulation_encroachment_m"}


def _council_folder(council: str | None) -> Path | None:
    c = (council or "").lower()
    if not c or not KNOW.exists():
        return None
    for d in sorted(KNOW.iterdir()):
        if d.is_dir() and d.name != "esc" and (d / "requirements.json").exists() and d.name in c:
            return d
    return None


def cited_requirement(council: str | None, zone: str | None, key: str) -> Cited | None:
    """One resolved requirement for the council and zone, or None.  A requirement written for another zone is never used."""
    d = _council_folder(council)
    if d is None:
        return None
    try:
        reqs = json.loads((d / "requirements.json").read_text(encoding="utf-8"))["requirements"]
    except (OSError, ValueError, KeyError):
        return None
    z = (zone or "").upper()
    for r in reqs:
        if r.get("key") != key or r.get("status", "resolved") != "resolved":
            continue
        rz = (r.get("applies_to") or {}).get("zone")
        if rz is not None and str(rz).upper() != z:
            continue
        if not isinstance(r.get("value"), (int, float)) or isinstance(r.get("value"), bool):
            continue
        s = r.get("source", {})
        return Cited(key, float(r["value"]), r.get("unit") or "m", s.get("document_title", ""), s.get("version", ""), s.get("page"), s.get("section_ref", ""),
                     s.get("quote", ""), (r.get("value_struct") or {}).get("rule", ""), rz)
    return None


def cited_setbacks(council: str | None, zone: str | None, dwelling_type: str = "dwelling_house") -> dict[str, Cited | None]:
    return {k: cited_requirement(council, zone, tpl.format(t=dwelling_type)) for k, tpl in SETBACK_KEYS.items()}


# ---------------------------------------------------------------------------------------------------------------------
# lot edges
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Edge:
    seq: int
    kind: str                  # front | secondary | side | rear
    line: LineString
    adjoins: str = ""

    @property
    def label(self) -> str:
        return {"front": "FRONT BOUNDARY", "secondary": "SECONDARY FRONTAGE", "side": "SIDE BOUNDARY", "rear": "REAR BOUNDARY"}[self.kind]


def _unit(v: tuple[float, float]) -> tuple[float, float]:
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n else (0.0, 0.0)


def classify_edges(segments: list[Any]) -> list[Edge]:
    """Boundary segments (SA1 ``BoundarySegment``: seq, start_xy, end_xy, is_front, adjoins) -> front, secondary frontage, side and rear edges.  The rear edge is the lot edge
    that faces the front edge (about antiparallel, farthest from it); with no such edge every other edge is a side."""
    raw = []
    for s in segments:
        raw.append((int(s.seq), LineString([tuple(s.start_xy), tuple(s.end_xy)]), bool(s.is_front), str(getattr(s, "adjoins", ""))))
    fronts = [r for r in raw if r[2]]
    out: list[Edge] = []
    if not fronts:
        return [Edge(seq, "side", ln, adj) for seq, ln, _f, adj in raw]
    f0 = max(fronts, key=lambda r: r[1].length)
    fd = _unit((f0[1].coords[-1][0] - f0[1].coords[0][0], f0[1].coords[-1][1] - f0[1].coords[0][1]))
    cand = []
    for seq, ln, isf, adj in raw:
        if isf or adj == "road":
            continue
        d = _unit((ln.coords[-1][0] - ln.coords[0][0], ln.coords[-1][1] - ln.coords[0][1]))
        if abs(d[0] * fd[0] + d[1] * fd[1]) >= 0.7:
            cand.append((ln.centroid.distance(f0[1]), seq))
    rear_seq = max(cand)[1] if cand else None
    for seq, ln, isf, adj in raw:
        kind = "front" if isf else ("secondary" if adj == "road" else ("rear" if seq == rear_seq else "side"))
        out.append(Edge(seq, kind, ln, adj))
    return out


# ---------------------------------------------------------------------------------------------------------------------
# placement
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class SetbackRow:
    label: str                       # FRONT BOUNDARY, SIDE BOUNDARY (LEFT), ...
    edge_seq: int
    kind: str
    required_m: float | None         # None = UNRESOLVED
    actual_m: float
    met: bool | None                 # None when the requirement is UNRESOLVED
    cite_ref: str
    cite_value: str
    cite_quote: str
    p_building: tuple[float, float]
    p_boundary: tuple[float, float]
    note: str = ""
    informational: bool = False      # a distance with no cited requirement (e.g. roof eave)

    @property
    def deficit_m(self) -> float | None:
        return None if (self.required_m is None or self.met) else round(self.required_m - self.actual_m, 2)


@dataclass
class Placement:
    placed: bool
    reason: str = ""
    house: HouseModel | None = None
    footprint: Polygon | None = None
    roof: Polygon | None = None
    garage: Polygon | None = None
    dwelling: Polygon | None = None            # footprint without the garage (the front building line is read from it)
    rotation_deg: float = 0.0
    orientation: str = "AS DRAWN"             # the orientation option applied to the template (stage 8b): AS DRAWN, MIRRORED, FRONT TURNED 90/180/270
    translation: tuple[float, float] = (0.0, 0.0)
    front_dir: tuple[float, float] = (0.0, 0.0)  # unit vector toward the street
    garage_door_xy: tuple[float, float] | None = None
    garage_door_width_m: float | None = None
    rows: list[SetbackRow] = field(default_factory=list)
    garage_rule: SetbackRow | None = None
    flags: list[str] = field(default_factory=list)
    ffl_m: float | None = None
    ffl_note: str = ""
    cited: dict[str, Cited | None] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    source: str = SOURCE_LABEL
    ground_range: tuple[float, float, float] | None = None   # DEM min, mean, max RL under the footprint

    @property
    def all_met(self) -> bool:
        return self.placed and all(r.met for r in self.rows if not r.informational and r.met is not None) and not any(r.met is None for r in self.rows if not r.informational)

    def transform(self, g):
        """A local-frame geometry -> the lot frame (same rotation and translation the footprint received)."""
        h = self.house
        if h is None:
            return g
        return affinity.translate(affinity.rotate(g, self.rotation_deg, origin=(0, 0)), *self.translation)

    def to_dict(self) -> dict:
        return {"placed": self.placed, "reason": self.reason, "source": self.source, "rotation_deg": round(self.rotation_deg, 3), "orientation": self.orientation,
                "footprint_wkt": self.footprint.wkt if self.footprint is not None else None,
                "garage_door_xy": self.garage_door_xy, "flags": list(self.flags), "ffl_m": self.ffl_m, "ffl_note": self.ffl_note,
                "house": self.house.summary() if self.house else None, "ground_range": self.ground_range,
                "rows": [{"label": r.label, "required_m": r.required_m, "actual_m": round(r.actual_m, 2), "met": r.met, "cite": r.cite_ref, "cite_value": r.cite_value,
                          "note": r.note, "informational": r.informational} for r in self.rows],
                "garage_rule": ({"actual_m": round(self.garage_rule.actual_m, 2), "required_m": self.garage_rule.required_m, "met": self.garage_rule.met, "cite": self.garage_rule.cite_ref,
                                 "note": self.garage_rule.note} if self.garage_rule else None)}


def plain_flags(bd: dict) -> list[str]:
    """The placement flags as formal sentences in ordinary case (for the report and the SoEE), built from the structured rows of ``Placement.to_dict()`` so the
    figures are the plan figures.  A control that is not met, and a control that could not be checked, are stated; nothing is said of a control that is met."""
    out: list[str] = []
    for r in bd.get("rows") or []:
        if r.get("informational"):
            continue
        lab = str(r["label"]).lower()
        if r.get("met") is None:
            out.append(f"The {lab} setback could not be checked: the cited value is unresolved for this zone. Not checked is not clear.")
        elif not r["met"]:
            out.append(f"The {lab} setback is not met: {r['actual_m']:.2f} m is provided and the cited minimum is {r['cite_value']}.")
    g = bd.get("garage_rule")
    if g is not None and not g.get("met"):
        req = g.get("required_m")
        fwd = g["actual_m"] < 0
        out.append("The garage control is not met: the cited control requires the garage " + (f"{req:g} m " if req is not None else "") + "behind the front building line, and the garage is "
                   + (f"{abs(g['actual_m']):.2f} m forward of it" if fwd else f"{g['actual_m']:.2f} m behind it") + ". The typical house does not meet this control and the layout is not changed to hide this.")
    return out


def _outward_normal(lot: Polygon, ln: LineString) -> tuple[float, float]:
    c = ln.coords
    d = _unit((c[-1][0] - c[0][0], c[-1][1] - c[0][1]))
    n = (d[1], -d[0])
    mid = ln.interpolate(0.5, normalized=True)
    probe = Point(mid.x + n[0] * 0.5, mid.y + n[1] * 0.5)
    return (-n[0], -n[1]) if lot.contains(probe) else n


def _nearest(a, b) -> tuple[tuple[float, float], tuple[float, float]]:
    p, q = nearest_points(a, b)
    return (p.x, p.y), (q.x, q.y)


def _side_label(kind: str, line: LineString, front_dir_out: tuple[float, float], ctr: Point) -> str:
    return {"front": "FRONT BOUNDARY", "secondary": "SECONDARY FRONTAGE", "rear": "REAR BOUNDARY"}.get(kind, "SIDE BOUNDARY")


# ---------------------------------------------------------------------------------------------------------------------
# orientation study (stage 8b): does ANY orientation of this template meet the cited garage rule?  The template is never changed silently.
# ---------------------------------------------------------------------------------------------------------------------
def orientation_label(mirror: bool, turn_deg: float) -> str:
    t = int(round(turn_deg)) % 360
    if not mirror and t == 0:
        return "AS DRAWN"
    return ("MIRRORED" if mirror else "") + (" AND " if mirror and t else "") + (f"FRONT TURNED {t} DEG" if t else "")


def orient_house(house: HouseModel, mirror: bool = False, turn_deg: float = 0.0) -> HouseModel:
    """A copy of the house mirrored left to right (``mirror``) and/or with the street-facing direction turned ``turn_deg`` anticlockwise about the house (the house is turned
    relative to the street: the garage door then faces another way).  Geometry other than that is unchanged."""
    import dataclasses

    def tf(g):
        if g is None:
            return None
        return affinity.scale(g, -1.0, 1.0, origin=(0, 0)) if mirror else g

    fd = (-house.front_dir[0], house.front_dir[1]) if mirror else house.front_dir
    a = math.radians(turn_deg)
    fd = (fd[0] * math.cos(a) - fd[1] * math.sin(a), fd[0] * math.sin(a) + fd[1] * math.cos(a))
    dc = house.garage_door_centre
    if dc is not None and mirror:
        dc = (-dc[0], dc[1])
    return dataclasses.replace(house, footprint=tf(house.footprint), roof=tf(house.roof), garage=tf(house.garage), dwelling=tf(house.dwelling), garage_door_centre=dc,
                               front_dir=_unit(fd), provenance=dict(house.provenance))


@dataclass
class OrientationResult:
    label: str
    mirror: bool
    turn_deg: float
    placed: bool
    all_setbacks_met: bool | None
    garage_behind_m: float | None            # positive: the garage is behind the dwelling front wall
    garage_rule_met: bool | None
    garage_door_faces_street: bool           # the garage door looks toward the street (template orientation turned 0 or mirrored only)
    n_flags: int

    @property
    def meets_all(self) -> bool:
        return bool(self.placed and self.all_setbacks_met and self.garage_rule_met)

    @property
    def usable(self) -> bool:
        """Meets every cited setback and the garage rule AND the garage door faces the street (a garage whose door faces the side or rear would not meet the intent of the rule)."""
        return self.meets_all and self.garage_door_faces_street


def orientation_study(house: HouseModel, lot: Polygon, edges: list[Edge], cited: dict[str, Cited | None], **kw) -> list[OrientationResult]:
    """Place the template in each of the eight orientations (as drawn, mirrored, front turned 90/180/270, each also mirrored) and report the cited garage rule and the setbacks."""
    out: list[OrientationResult] = []
    for mirror in (False, True):
        for turn in (0.0, 90.0, 180.0, 270.0):
            pl = place_house(house, lot, edges, cited, mirror=mirror, turn_deg=turn, **kw)
            gr = pl.garage_rule
            out.append(OrientationResult(pl.orientation, mirror, turn, pl.placed, pl.all_met if pl.placed else None, (gr.actual_m if gr else None), (gr.met if gr else None),
                                         turn == 0.0, len(pl.flags)))
    return out


def orientation_summary(res: list[OrientationResult]) -> str:
    """Plain statement for the report and the sheets."""
    if not res:
        return "ORIENTATION STUDY NOT RUN"
    ok = [r for r in res if r.usable]
    lines = [f"{r.label}: GARAGE {('LEVEL WITH' if abs(r.garage_behind_m or 0) < 0.005 else 'BEHIND' if (r.garage_behind_m or 0) > 0 else 'FORWARD OF')} THE FRONT BUILDING LINE" + ("" if abs(r.garage_behind_m or 0) < 0.005 else f" BY {abs(r.garage_behind_m or 0):.2f} m") + " "
             f"({'MET' if r.garage_rule_met else 'NOT MET' if r.garage_rule_met is False else 'NOT CHECKED'}); GARAGE DOOR {'FACES' if r.garage_door_faces_street else 'DOES NOT FACE'} THE STREET" for r in res]
    head = ("NO ORIENTATION OF THIS TEMPLATE MEETS THE CITED GARAGE RULE WITH THE GARAGE DOOR TO THE STREET: THE TEMPLATE IS KEPT AS DRAWN"
            if not ok else f"ORIENTATION(S) MEETING THE CITED GARAGE RULE WITH THE GARAGE DOOR TO THE STREET: {', '.join(r.label for r in ok)} (THE TEMPLATE IS STILL PLACED AS DRAWN UNLESS THE OPTION IS SELECTED)")
    return head + ". " + "; ".join(lines)


def place_house(house: HouseModel, lot: Polygon, edges: list[Edge], cited: dict[str, Cited | None], ground: Any = None, freeboard: Cited | None = None,
                flood_level_m: float | None = None, mirror: bool = False, turn_deg: float = 0.0) -> Placement:
    """Place ``house`` on ``lot`` to the cited setbacks (see the module docstring).  ``ground`` is an optional callable (x, y) -> RL used only to report the existing ground range
    under the footprint.  ``mirror`` / ``turn_deg`` (stage 8b) test an alternative orientation of the same template (``orient_house``); the default placement is the template as drawn
    and the template itself is never changed."""
    orientation = orientation_label(mirror, turn_deg)
    if orientation != "AS DRAWN":
        house = orient_house(house, mirror, turn_deg)
    pl = Placement(placed=False, house=house, cited=cited, edges=edges, orientation=orientation)
    front_edges = [e for e in edges if e.kind == "front"]
    if not front_edges:
        pl.reason = "NO FRONT BOUNDARY IN THE LOT DATA: THE DWELLING CANNOT BE ORIENTED"
        return pl
    fe = max(front_edges, key=lambda e: e.line.length)
    missing = [k for k in ("front", "side", "rear") if cited.get(k) is None]
    if any(e.kind == "secondary" for e in edges) and cited.get("secondary") is None:
        missing.append("secondary")
    if missing:
        pl.reason = "CITED SETBACK UNRESOLVED FOR THIS ZONE (" + ", ".join(m.upper() for m in missing) + "): THE DWELLING IS NOT PLACED"
        return pl
    out = _outward_normal(lot, fe.line)               # toward the street
    ninward = (-out[0], -out[1])
    fcoords = fe.line.coords
    fdir = _unit((fcoords[-1][0] - fcoords[0][0], fcoords[-1][1] - fcoords[0][1]))
    # rotation: house front_dir -> outward normal
    a_house = math.atan2(house.front_dir[1], house.front_dir[0])
    a_out = math.atan2(out[1], out[0])
    rot = math.degrees(a_out - a_house)
    base = affinity.rotate(house.footprint, rot, origin=(0, 0))
    mid = fe.line.interpolate(0.5, normalized=True)
    front_req = cited["front"].value

    def at(s: float, t: float):
        return (mid.x + ninward[0] * s + fdir[0] * t, mid.y + ninward[1] * s + fdir[1] * t)

    def moved(g, s: float, t: float):
        # build the translation so that the footprint's front-most point sits at depth s from the frontage line through the midpoint, shifted laterally by t
        return affinity.translate(g, *_shift(g, s, t))

    def _shift(g, s: float, t: float) -> tuple[float, float]:
        pts = list(g.exterior.coords)
        d0 = min((p[0] - mid.x) * ninward[0] + (p[1] - mid.y) * ninward[1] for p in pts)
        l0 = 0.5 * (min((p[0] - mid.x) * fdir[0] + (p[1] - mid.y) * fdir[1] for p in pts) + max((p[0] - mid.x) * fdir[0] + (p[1] - mid.y) * fdir[1] for p in pts))
        dx = ninward[0] * (s - d0) + fdir[0] * (t - l0)
        dy = ninward[1] * (s - d0) + fdir[1] * (t - l0)
        return dx, dy

    sides = [e for e in edges if e.kind == "side"]
    rear = [e for e in edges if e.kind == "rear"]
    secs = [e for e in edges if e.kind == "secondary"]

    def clearance(fp):
        """Minimum of distance-minus-required over the side, rear and secondary edges: the slack the lateral search maximises."""
        sl = []
        for e in sides:
            sl.append(fp.distance(e.line) - cited["side"].value)
        for e in rear:
            sl.append(fp.distance(e.line) - cited["rear"].value)
        for e in secs:
            sl.append(fp.distance(e.line) - cited["secondary"].value)
        return min(sl) if sl else 0.0

    # lateral search along the frontage: depth s = the front setback measured to the true edge (iterated), then maximise the side clearance
    span = max(lot.bounds[2] - lot.bounds[0], lot.bounds[3] - lot.bounds[1])
    best, best_key = None, None
    n_steps = int(span / LATERAL_STEP_M)
    for i in range(-n_steps // 2, n_steps // 2 + 1):
        t = i * LATERAL_STEP_M
        s = front_req
        fp = moved(base, s, t)
        for _ in range(4):
            dist = fp.distance(fe.line)
            if abs(dist - front_req) < 1e-6:
                break
            s += front_req - dist
            fp = moved(base, s, t)
        if not lot.buffer(1e-6).contains(fp):
            continue
        cl = clearance(fp)
        key = (round(min(cl, 5.0), 3), -abs(t))                        # most side clearance, then nearest the frontage midpoint
        if best_key is None or key > best_key:
            best, best_key, best_st = fp, key, (s, t)
    if best is None:                                                    # no position inside the lot: report the failure at the frontage midpoint
        s = front_req
        fp = moved(base, s, 0.0)
        for _ in range(4):
            dist = fp.distance(fe.line)
            if abs(dist - front_req) < 1e-6:
                break
            s += front_req - dist
            fp = moved(base, s, 0.0)
        best, best_st = fp, (s, 0.0)
        pl.flags.append("THE BUILDING DOES NOT FIT INSIDE THE LOT AT THE CITED FRONT SETBACK: IT IS SHOWN AT THE FRONTAGE MIDPOINT AND EXTENDS BEYOND THE BOUNDARY")
    fp = best
    dx, dy = _shift(base, *best_st)
    pl.rotation_deg = rot
    pl.translation = (dx, dy)
    pl.footprint = fp
    pl.placed = True
    pl.front_dir = out
    pl.roof = pl.transform(house.roof) if house.roof is not None else None
    pl.garage = pl.transform(house.garage) if house.garage is not None else None
    pl.dwelling = pl.transform(house.dwelling) if house.dwelling is not None else fp
    if house.garage_door_centre is not None:
        pl.garage_door_xy = tuple(pl.transform(Point(*house.garage_door_centre)).coords[0])
        pl.garage_door_width_m = house.garage_door_width_m

    # ---- setback rows (measured, with the nearest points for the dimension lines)
    def row(e: Edge, label: str, req: Cited | None, geom, note: str = "") -> SetbackRow:
        p, q = _nearest(geom, e.line)
        d = geom.distance(e.line)
        if req is None:
            return SetbackRow(label, e.seq, e.kind, None, d, None, "REQUIREMENT UNRESOLVED", "UNRESOLVED", "", p, q, note)
        met = d + MET_TOL >= req.value
        n2 = note
        if e.kind == "front" and req.rule:
            n2 = (note + "; " if note else "") + "ADJOINING DWELLING AVERAGE NOT IN DATA, CITED MAXIMUM USED"
        if e.kind in ("side", "rear") and "BCA" in req.rule.upper():
            n2 = (note + "; " if note else "") + "BCA ALTERNATIVE NOT APPLIED"
        return SetbackRow(label, e.seq, e.kind, req.value, d, met, req.ref, req.vtext, req.quote, p, q, n2)

    side_sorted = sorted(sides, key=lambda e: (e.line.centroid.x - mid.x) * fdir[0] + (e.line.centroid.y - mid.y) * fdir[1])
    for e in edges:
        if e.kind == "front":
            req = cited["front"]
            pl.rows.append(row(e, "FRONT BOUNDARY", req, fp, "NEAREST PART: " + ("GARAGE" if pl.garage is not None and pl.garage.distance(e.line) <= pl.dwelling.distance(e.line) - 1e-6 else "DWELLING")))
        elif e.kind == "rear":
            pl.rows.append(row(e, "REAR BOUNDARY", cited["rear"], fp))
        elif e.kind == "secondary":
            pl.rows.append(row(e, "SECONDARY FRONTAGE", cited["secondary"], pl.dwelling or fp, "BUILDING WALL"))
            if pl.garage is not None and cited.get("secondary_garage") is not None:
                pl.rows.append(row(e, "SECONDARY FRONTAGE (GARAGE)", cited["secondary_garage"], pl.garage))
        else:
            idx = side_sorted.index(e)
            name = "SIDE BOUNDARY" if len(sides) == 1 else ("SIDE BOUNDARY (LEFT)" if idx == 0 else "SIDE BOUNDARY (RIGHT)" if idx == len(sides) - 1 else f"SIDE BOUNDARY {idx + 1}")
            pl.rows.append(row(e, name, cited["side"], fp))
    # roof eave distances (informational, no cited requirement)
    if pl.roof is not None:
        for e in edges:
            if e.kind in ("front", "side", "rear"):
                ref = next((r for r in pl.rows if r.edge_seq == e.seq and not r.informational), None)
                p, q = _nearest(pl.roof, e.line)
                d = pl.roof.distance(e.line)
                art = cited.get("articulation")
                ov = getattr(pl.house, "eave_overhang_m", None) if pl.house is not None else None
                if art is not None:        # no eave rule as such: the DCP articulation encroachment is the cited allowance that an eave of that overhang falls within
                    inside = ov is not None and ov <= art.value + 1e-9
                    note = ((f"EAVE OVERHANG {ov:.2f} m (PLAN STUDIO FILE) " + ("IS WITHIN" if inside else "EXCEEDS") + f" THE CITED {art.vtext.upper()} ARTICULATION ENCROACHMENT"
                             + (f" ({art.rule.upper()})" if art.rule else "")) if ov is not None else "EAVE OVERHANG NOT IN THE PLAN STUDIO FILE")
                    pl.rows.append(SetbackRow((ref.label if ref else e.label) + " TO ROOF EAVE", e.seq, e.kind, None, d, None, art.ref, art.vtext, art.quote, p, q,
                                              "INFORMATION ONLY: " + note, True))
                else:
                    pl.rows.append(SetbackRow((ref.label if ref else e.label) + " TO ROOF EAVE", e.seq, e.kind, None, d, None, "NO CITED EAVE REQUIREMENT", "", "", p, q,
                                              "INFORMATION ONLY (EAVE OVERHANG FROM THE PLAN STUDIO FILE)", True))
    # ---- garage behind the front building line (cited, measured)
    gb = cited.get("garage_behind")
    if pl.garage is not None and gb is not None and pl.dwelling is not None:
        dg = pl.garage.distance(fe.line)
        dd = pl.dwelling.distance(fe.line)
        behind = dg - dd                                      # positive: the garage is behind the dwelling's front wall
        met = behind + MET_TOL >= gb.value
        note = ("GARAGE PROJECTS " + f"{abs(behind):.1f} m".replace("-", "") + " FORWARD OF THE DWELLING FRONT WALL; THE TYPICAL HOUSE DOES NOT MEET THIS RULE" if behind < 0
                else f"GARAGE IS {behind:.1f} m BEHIND THE DWELLING FRONT WALL")
        p, q = _nearest(pl.garage, fe.line)
        pl.garage_rule = SetbackRow("GARAGE BEHIND FRONT BUILDING LINE", fe.seq, "front", gb.value, behind, met, gb.ref, gb.vtext, gb.quote, p, q, note)
        if not met:
            pl.flags.append(f"GARAGE RULE NOT MET: {gb.vtext.upper()} BEHIND THE FRONT BUILDING LINE IS REQUIRED ({gb.ref.upper()}); " + note + ". THE LAYOUT IS NOT CHANGED TO HIDE THIS")
    elif pl.garage is not None and gb is None:
        pl.flags.append("GARAGE POSITION RULE UNRESOLVED FOR THIS ZONE: NOT CHECKED, NOT CLEAR")
    for r in pl.rows:
        if r.met is False:
            pl.flags.append(f"SETBACK NOT MET: {r.label} {r.actual_m:.2f} m PROVIDED, {r.cite_value.upper()} REQUIRED ({r.cite_ref.upper()}); SHORT BY {r.deficit_m:.2f} m")
    pl.source = SOURCE_LABEL
    pl.ffl_m, pl.ffl_note = derive_ffl(freeboard, flood_level_m)
    if ground is not None:
        try:
            import numpy as np
            xs, ys = fp.exterior.xy
            zs = [float(ground(x, y)) for x, y in zip(xs, ys)]
            g = np.array([z for z in zs if math.isfinite(z)])
            gx = fp.representative_point()
            if g.size:
                pl.ground_range = (round(float(g.min()), 2), round(float(g.mean()), 2), round(float(g.max()), 2))
        except Exception:  # noqa: BLE001
            pl.ground_range = None
    return pl


FFL_TBC_REASON = ("FFL TBC: the cited rule sets habitable floor levels at or above the Flood Planning Level (1% AEP flood level plus the cited freeboard); the flood level is not "
                  "available in the data, and no cited minimum height above ground exists. No level is assumed.")


def derive_ffl(cited_freeboard: Cited | None, flood_level_m: float | None) -> tuple[float | None, str]:
    """FFL only from a cited rule: flood level plus the cited freeboard.  Otherwise None with the reason."""
    if flood_level_m is not None and cited_freeboard is not None:
        v = round(flood_level_m + cited_freeboard.value, 2)
        return v, f"FFL = FLOOD LEVEL {flood_level_m:g} m AHD + CITED FREEBOARD {cited_freeboard.vtext} ({cited_freeboard.ref})"
    return None, FFL_TBC_REASON


def edges_from_lot_context(lot_ctx: Any) -> tuple[Polygon, list[Edge]]:
    from shapely import wkt as swkt
    poly = swkt.loads(lot_ctx.boundary_wkt)
    if poly.geom_type != "Polygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    return poly, classify_edges(list(lot_ctx.segments))

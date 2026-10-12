"""Generators (from_brief) and importers (from_footprint, from_dxf) for BuildingModel.

All dimensions are editable drawing defaults, NOT planning or building-code limits; nothing here claims compliance.
"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from shapely import wkt as _wkt
from shapely.geometry import Polygon
from shapely.prepared import prep
from shapely.ops import unary_union

from .model import BuildingModel, Frame, Level, Roof, Room, resolve_material
from .ops import AddDeck, AddOpening, _opening, apply
from .topology import Issue

STYLES = {   # roof type, pitch, eaves, roof colour, wall finish
    "contemporary": ("gable", 22.5, 0.45, "Monument", "Render White"),
    "modern": ("skillion", 8.0, 0.30, "Monument", "Render Charcoal"),
    "traditional": ("hip", 25.0, 0.60, "Surfmist", "Brick Red"),
    "hamptons": ("gable", 25.0, 0.60, "Basalt", "Weatherboard White"),
    "coastal": ("gable", 20.0, 0.45, "Shale Grey", "Weatherboard White"),
    "rural": ("gable", 15.0, 0.45, "Woodland Grey", "Cladding Grey"),
}


def _poly(limit: Any) -> Polygon | None:
    if limit is None:
        return None
    if isinstance(limit, Polygon):
        return limit
    if isinstance(limit, str):
        return _wkt.loads(limit)
    return Polygon(limit)


def _base_model(name, dev, style, frontage_deg, floor_rl, storeys, ceiling=2.7) -> BuildingModel:
    m = BuildingModel(name=name, development_type=dev, style=style, frontage_deg=frontage_deg, ground_rl=floor_rl)
    for i in range(storeys):
        m.levels.append(Level(id=m.new_id("lv"), name="Ground Floor" if i == 0 else "First Floor",
                              rl=floor_rl + i * (ceiling + 0.3), ceiling_height=ceiling))
    rt, pitch, eaves, rc, wf = STYLES.get(style, STYLES["contemporary"])
    m.external_finish = resolve_material(m, wf)
    m.roofs = [Roof(id="tmpl", level_id=m.levels[-1].id, type=rt, pitch_deg=pitch, eaves=eaves, material=resolve_material(m, rc))]
    return m


def _finish_roofs(m: BuildingModel):
    tmpl = m.roofs[0] if m.roofs and m.roofs[0].id == "tmpl" else None
    m.roofs = [tmpl] if tmpl else []
    m.resync()
    if tmpl:
        for r in m.roofs:
            if r.id == "tmpl":
                r.id = m.new_id("rf")


# unit layouts: (name, use, level_idx, u0, w0, u1, w1) in frame metres from the building's front-left corner ------------------
def _row(level, w0, depth, specs, W, u0=0.0):
    out, u, fixed = [], u0, sum(s[2] for s in specs if s[2] is not None)
    for name, use, wd in specs:
        wd = (W - fixed) if wd is None else wd
        out.append((name, use, level, u, w0, u + wd, w0 + depth))
        u += wd
    return out


def _dwelling_1(beds, baths, garage):
    ens = baths >= 2
    front_need = 1.6 + 3.4 * max(beds - 1, 0)
    W = max(10.8 + (2.2 if ens else 0) if beds <= 2 else 13.0, front_need + 0.0, 3.6 + (2.2 if ens else 0) + 3.0 + 4.2)
    rooms = []
    fr = [("Entry", "entry", 1.6)] + [(f"Bedroom {i}", "bedroom", 3.4) for i in range(2, beds + 1)]
    rest = W - sum(s[2] for s in fr)
    fr.append(("Study", "study", None) if rest >= 2.4 else None)
    fr = [f for f in fr if f]
    if rest < 2.4 and beds >= 2:
        fr[-1] = (fr[-1][0], fr[-1][1], fr[-1][2] + rest)
    rooms += _row(0, 0.0, 3.8, fr, W)
    mid = [("Bathroom", "bath", 2.4)] + ([("Bathroom 2", "bath", 2.4)] if baths >= 3 else []) + [("Laundry", "laundry", 1.8), ("Hall", "hall", None)]
    rooms += _row(0, 3.8, 3.0, mid, W)
    rear = [("Bedroom 1", "bedroom", 3.6)] + ([("Ensuite", "ensuite", 2.2)] if ens else []) + [("Kitchen", "kitchen", 3.0), ("Living", "living", None)]
    rooms += _row(0, 6.8, 5.2, rear, W)
    return rooms, W, 12.0


def _dwelling_2(beds, baths, garage):
    beds = max(beds, 2)
    W = 11.0
    rooms = _row(0, 0.0, 3.8, [("Entry", "entry", 1.8), ("Study", "study", 3.2), ("WC", "wc", 1.6), ("Laundry", "laundry", None)], W)
    rooms += _row(0, 3.8, 3.0, [("Storage", "storage", 2.0), ("Hall", "hall", None)], W)
    rooms += _row(0, 6.8, 5.2, [("Kitchen", "kitchen", 3.6), ("Living", "living", None)], W)
    nb = beds - 1
    rooms += _row(1, 0.0, 3.8, [(f"Bedroom {i}", "bedroom", W / nb) for i in range(2, beds + 1)], W)
    mid = [("Bathroom", "bath", 2.4)] + ([("Bathroom 2", "bath", 2.4)] if baths >= 3 else []) + [("Landing", "hall", None)]
    rooms += _row(1, 3.8, 3.0, mid, W)
    rooms += _row(1, 6.8, 5.2, [("Bedroom 1", "bedroom", 4.6)] + ([("Ensuite", "ensuite", 2.4)] if baths >= 2 else []) + [("Dressing", "storage", None)], W)
    return rooms, W, 12.0


def _granny(beds):
    beds = 2 if beds >= 2 else 1
    b2 = 3.0
    W = 3.2 + (b2 if beds == 2 else 0) + 2.2 + 1.4
    rooms = _row(0, 0.0, 3.4, [("Kitchen", "kitchen", 3.0), ("Living", "living", None)], W)
    rear = [("Bedroom 1", "bedroom", 3.2)] + ([("Bedroom 2", "bedroom", b2)] if beds == 2 else []) + [("Bathroom", "bath", 2.2), ("Laundry", "laundry", None)]
    rooms += _row(0, 3.4, 3.0, rear, W)
    return rooms, W, 6.4


def from_brief(bedrooms: int = 3, bathrooms: int = 2, garage: str = "double", storeys: int = 1, style: str = "contemporary",
               footprint_limit: Any = None, orientation_deg: float = 270.0, development_type: str = "dwelling_house",
               floor_rl: float = 0.0, garage_side: str = "left", alfresco: bool = False, shed_size: tuple[float, float] | None = None,
               name: str | None = None) -> BuildingModel:
    """Parametric layout. orientation_deg = direction (local frame, deg anticlockwise from +x) of the OUTWARD normal toward the
    street (270 = street to the south). footprint_limit = polygon (local metres) the building should fit inside (e.g. buildable envelope)."""
    dev = str(getattr(development_type, "value", development_type))
    if dev == "dual_occupancy":
        raise ValueError("dual_occupancy is a stub: no layout generator is wired for it yet")
    if dev not in ("dwelling_house", "secondary_dwelling", "shed"):
        raise ValueError(f"unsupported development_type {dev}")
    storeys = 2 if (storeys >= 2 and dev == "dwelling_house") else 1
    bedrooms, bathrooms = max(1, int(bedrooms)), max(0, int(bathrooms)) if dev != "secondary_dwelling" else 1
    if dev == "shed":
        W, D = shed_size or (6.0, 4.0)
        specs, garage, storeys = [("Shed", "shed", 0, 0.0, 0.0, W, D)], "none", 1
    elif dev == "secondary_dwelling":
        specs, W, D = _granny(bedrooms)
        garage = "none"
    else:
        specs, W, D = (_dwelling_2 if storeys == 2 else _dwelling_1)(bedrooms, max(bathrooms, 1), garage)
    gw = {"none": 0.0, "single": 3.6, "double": 6.0}.get(garage)
    if gw is None:
        raise ValueError("garage must be none, single or double")
    fr = Frame((math.cos(math.radians(orientation_deg)), math.sin(math.radians(orientation_deg))))
    lim = _poly(footprint_limit)
    notes: list[str] = []
    s = 1.0
    place = (0.0, 0.0)
    if lim is not None:
        lim_f = Polygon([fr.to_frame(p) for p in lim.exterior.coords])
        plim = prep(lim_f.buffer(1e-6))
        minu, minw, maxu, maxw = lim_f.bounds
        found = None
        left = garage_side == "left"
        cu = (minu + maxu) / 2
        for s in [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]:
            gdep = min(6.0, D * s)
            best = None
            u = minu
            while u <= maxu:
                w = minw
                while w <= maxw:
                    shapes = [Polygon([(u, w), (u + W * s, w), (u + W * s, w + D * s), (u, w + D * s)])]
                    if gw:
                        gu = u - gw * s if left else u + W * s
                        shapes.append(Polygon([(gu, w), (gu + gw * s, w), (gu + gw * s, w + gdep), (gu, w + gdep)]))
                    if all(plim.contains(sh) for sh in shapes):
                        cand = (w, abs(u + W * s / 2 - cu), u)
                        if best is None or cand < best:
                            best = cand
                        break
                    w += 0.5
                u += 0.5
            if best:
                found = (best[2], best[0])
                break
        if found:
            place = (found[0], found[1])
            if s < 1.0:
                notes.append(f"Layout scaled to {s:.2f} to fit the footprint limit; room sizes reduced proportionally (check advisories)")
        else:
            s = 0.6
            c = lim_f.centroid
            place = (c.x - W * s / 2, c.y - D * s / 2)
            notes.append("Could not fit the layout inside footprint_limit; placed at its centroid at 0.6 scale - it likely encroaches")
    m = _base_model(name or {"dwelling_house": "Dwelling", "secondary_dwelling": "Secondary Dwelling", "shed": "Shed"}[dev], dev, style,
                    orientation_deg, floor_rl, storeys)
    lvids = [l.id for l in m.levels]
    for nm, use, lvi, u0, w0, u1, w1 in specs:
        m.rooms.append(Room(id=m.new_id("rm"), name=nm, use=use, level_id=lvids[min(lvi, len(lvids) - 1)],
                            polygon=fr.rect(place[0] + u0 * s, place[1] + w0 * s, place[0] + u1 * s, place[1] + w1 * s)))
    if gw:
        gdep = min(6.0, D * s)
        gu0, gu1 = (-gw * s, 0.0) if garage_side == "left" else (W * s, W * s + gw * s)
        m.rooms.append(Room(id=m.new_id("rm"), name="Garage", use="garage", level_id=lvids[0],
                            polygon=fr.rect(place[0] + gu0, place[1], place[0] + gu1, place[1] + gdep)))
    if dev == "shed":
        for r in m.roofs:
            r.type, r.pitch_deg, r.eaves = "skillion", 10.0, 0.15
        m.levels[0].ceiling_height = 2.4
    _finish_roofs(m)
    m.notes += notes
    _auto_openings(m)
    if alfresco and dev == "dwelling_house":
        liv = m.room("Living")
        if liv:
            nm, rep = apply(m, AddDeck(kind="alfresco", side="rear", depth_m=3.0, width_m=fr.bounds(liv.polygon)[2] - fr.bounds(liv.polygon)[0], room="Living"))
            if rep.ok:
                m = nm
            else:
                m.notes.append("alfresco not added: " + rep.errors[0].message)
    m.notes.append("Generated from a brief: dimensions are drawing defaults, not compliance limits.")
    return m


def _auto_openings(m: BuildingModel) -> None:
    fr = m.frame()
    f = m.frontage_vec()
    shed = m.development_type == "shed"
    for r in [r for r in m.rooms if r.enclosed]:
        ws = [w for w in m.walls if r.id in w.room_ids]
        for w in ws:
            n = (w.direction[1], -w.direction[0])
            frontward = n[0] * f[0] + n[1] * f[1] > 0.7
            rearward = n[0] * f[0] + n[1] * f[1] < -0.7
            if not w.external:
                continue
            try:
                if r.use == "garage" and frontward:
                    _opening(m, w, "garage_door", None, min(4.8 if r.area > 25 else 2.4, w.length - 0.4), 2.1, 0.0)
                elif shed and frontward:
                    _opening(m, w, "garage_door", None, min(2.4, w.length - 0.4), 2.1, 0.0)
                elif r.use == "entry" and frontward:
                    _opening(m, w, "door", None, 0.92, 2.04, 0.0)
                elif r.use == "living" and rearward and w.length > 3.0:
                    _opening(m, w, "sliding_door", None, min(2.4, w.length - 0.8), 2.1, 0.0)
                elif r.use in ("bedroom", "living", "kitchen", "study") and w.length > 1.8:
                    _opening(m, w, "window", None, min(1.8, w.length - 0.9), 1.2, 0.9)
                elif r.use in ("bath", "ensuite", "laundry", "wc") and w.length > 1.2:
                    _opening(m, w, "window", None, 0.6, 0.9, 1.5)
            except Exception:  # noqa: BLE001
                pass
    pri = ("hall", "entry", "living")
    done = set()
    for r in [r for r in m.rooms if r.enclosed and r.use not in ("garage", "shed", "entry", "hall")]:
        cands = []
        for w in m.walls:
            if w.external or r.id not in w.room_ids or len(w.room_ids) != 2 or w.length < 1.1:
                continue
            other = m.room([i for i in w.room_ids if i != r.id][0])
            if other and other.use in pri:
                cands.append((pri.index(other.use), -w.length, w, other))
        if cands:
            cands.sort(key=lambda c: (c[0], c[1]))
            w = cands[0][2]
            key = (r.id, cands[0][3].id)
            if key not in done:
                done.add(key)
                try:
                    _opening(m, w, "door", None, 0.82, 2.04, 0.0)
                except Exception:  # noqa: BLE001
                    pass
    # garage / room connections omitted: internal door to garage is placed on any shared wall with a habitable room
    for g in [r for r in m.rooms if r.use == "garage"]:
        for w in m.walls:
            if not w.external and g.id in w.room_ids and len(w.room_ids) == 2 and w.length > 1.2:
                try:
                    _opening(m, w, "door", None, 0.82, 2.04, 0.0)
                    break
                except Exception:  # noqa: BLE001
                    pass
    del fr


# ---------------------------------------------------------------------------------------------------
# importers
# ---------------------------------------------------------------------------------------------------
class ImportReport(BaseModel):
    source: str
    method: str = ""
    confidence: float = 0.0
    units: str = ""
    scale_to_metres: float = 1.0
    rooms_found: int = 0
    ignored: dict[str, int] = {}
    notes: list[str] = []


def from_footprint(footprint: Any, bedrooms: int | None = None, bathrooms: int = 1, style: str = "contemporary",
                   frontage_deg: float = 270.0, floor_rl: float = 0.0, development_type: str = "dwelling_house",
                   local: bool = False, name: str = "Dwelling") -> BuildingModel:
    """Model from a footprint: WKT / Polygon / SA7 PlanOverlay (MGA coordinates unless local=True). Origin = centroid rounded to 1 m.
    Default is a single room; with `bedrooms` and a near-rectangular footprint the footprint is subdivided with the brief layout."""
    if hasattr(footprint, "footprint_wkt"):
        footprint = footprint.footprint_wkt
    poly = _poly(footprint)
    if poly is None or poly.is_empty:
        raise ValueError("empty footprint")
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    origin = (0.0, 0.0) if local else (round(poly.centroid.x), round(poly.centroid.y))
    loc = Polygon([(x - origin[0], y - origin[1]) for x, y in poly.exterior.coords])
    m = _base_model(name, development_type, style, frontage_deg, floor_rl, 1)
    m.origin_mga = origin
    mr = loc.minimum_rotated_rectangle
    ratio = loc.area / mr.area
    if bedrooms and ratio > 0.9:
        pts = list(mr.exterior.coords)[:4]
        e1, e2 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        if math.hypot(*e2) > math.hypot(*e1):
            e1, e2 = e2, e1
            org = pts[1]
        else:
            org = pts[0]
        L1, L2 = math.hypot(*e1), math.hypot(*e2)
        d1, d2 = (e1[0] / L1, e1[1] / L1), (e2[0] / L2, e2[1] / L2)
        if d1[0] * d2[1] - d1[1] * d2[0] < 0:
            d2 = (-d2[0], -d2[1])
            org = (org[0] - d2[0] * 0 + 0, org[1])
        gen = from_brief(bedrooms, bathrooms, "none", 1, style, None, 270.0, development_type, floor_rl)
        gm = gen.footprint().bounds
        sx, sy = L1 / (gm[2] - gm[0]), L2 / (gm[3] - gm[1])
        cen = mr.centroid
        # generator frame (x east, y north, front at south) -> (d1, d2) frame centred on the rectangle
        fx = lambda p: (cen.x + d1[0] * (p[0] - (gm[0] + gm[2]) / 2) * sx + d2[0] * (p[1] - (gm[1] + gm[3]) / 2) * sy,  # noqa: E731
                        cen.y + d1[1] * (p[0] - (gm[0] + gm[2]) / 2) * sx + d2[1] * (p[1] - (gm[1] + gm[3]) / 2) * sy)
        # front of generator (south, -y) must face the street: flip 180 deg if its outward normal opposes the frontage direction
        fv = m.frontage_vec()
        if -d2[0] * fv[0] - d2[1] * fv[1] < 0:
            f0 = fx
            fx = lambda p: (2 * cen.x - f0(p)[0], 2 * cen.y - f0(p)[1])  # noqa: E731
        for r in gen.rooms:
            m.rooms.append(Room(id=m.new_id("rm"), name=r.name, use=r.use, level_id=m.levels[0].id, polygon=[fx(p) for p in r.polygon]))
        m.notes.append("Footprint subdivided by the brief layout scaled to the footprint's oriented bounding rectangle")
    else:
        m.rooms.append(Room(id=m.new_id("rm"), name="Dwelling", use="other", level_id=m.levels[0].id, polygon=list(loc.exterior.coords)[:-1]))
        if ratio <= 0.9:
            m.notes.append("Footprint is not rectangular; kept as a single room")
    _finish_roofs(m)
    if bedrooms and len(m.rooms) > 1:
        _auto_openings(m)
    return m


_USE_WORDS = [("bed", "bedroom"), ("master", "bedroom"), ("living", "living"), ("lounge", "living"), ("family", "living"), ("kitchen", "kitchen"),
              ("dining", "dining"), ("ensuite", "ensuite"), ("bath", "bath"), ("wc", "wc"), ("toilet", "wc"), ("laundry", "laundry"),
              ("garage", "garage"), ("study", "study"), ("office", "study"), ("alfresco", "alfresco"), ("deck", "deck"),
              ("verandah", "verandah"), ("porch", "verandah"), ("entry", "entry"), ("foyer", "entry"), ("hall", "hall"),
              ("store", "storage"), ("robe", "storage"), ("shed", "shed")]


def _use_from_name(name: str) -> str:
    low = name.lower()
    return next((u for k, u in _USE_WORDS if k in low), "other")


def from_dxf(path: str | Path, floor_rl: float = 0.0, style: str = "contemporary", frontage_deg: float = 270.0,
             units: str | None = None) -> tuple[BuildingModel, ImportReport]:
    """Best-effort import of a plan DXF. Closed polylines on room-like layers become rooms; wall-band layers are unioned
    and their holes become rooms; otherwise the outline becomes a single room. Returns (model, ImportReport with confidence)."""
    import ezdxf
    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()
    rep = ImportReport(source=str(path))
    ignored: dict[str, int] = {}
    closed: list[tuple[str, list]] = []
    texts: list[tuple[str, tuple[float, float]]] = []
    for e in msp:
        t = e.dxftype()
        if t == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            if (e.closed or (len(pts) > 3 and pts[0] == pts[-1])) and len(pts) >= 3:
                if pts[0] == pts[-1]:
                    pts = pts[:-1]
                closed.append((e.dxf.layer, pts))
            else:
                ignored["open_polyline"] = ignored.get("open_polyline", 0) + 1
        elif t == "POLYLINE" and e.is_2d_polyline and e.is_closed:
            closed.append((e.dxf.layer, [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]))
        elif t in ("TEXT", "MTEXT"):
            s = e.dxf.text if t == "TEXT" else e.plain_text()
            texts.append((s.strip(), (e.dxf.insert.x, e.dxf.insert.y)))
        else:
            ignored[t.lower()] = ignored.get(t.lower(), 0) + 1
    if not closed:
        rep.ignored, rep.notes = ignored, ["no closed polylines found"]
        raise ValueError("DXF contains no closed polylines; cannot infer a footprint")
    # units
    ins = {1: ("in", 0.0254), 2: ("ft", 0.3048), 4: ("mm", 0.001), 5: ("cm", 0.01), 6: ("m", 1.0)}
    span = max(max(p[0] for _, pts in closed for p in pts) - min(p[0] for _, pts in closed for p in pts),
               max(p[1] for _, pts in closed for p in pts) - min(p[1] for _, pts in closed for p in pts))
    conf_k = 1.0
    if units:
        uname, k = {"mm": ("mm", 0.001), "cm": ("cm", 0.01), "m": ("m", 1.0)}[units]
    else:
        code = int(doc.header.get("$INSUNITS", 0) or 0)
        if code in ins:
            uname, k = ins[code]
        else:
            uname, k = ("mm", 0.001) if span > 500 else ("cm", 0.01) if span > 120 else ("m", 1.0)
            conf_k = 0.85
            rep.notes.append(f"units not declared; guessed {uname} from drawing extent {span:g}")
    rep.units, rep.scale_to_metres = uname, k
    polys = [(ly, Polygon([(x * k, y * k) for x, y in pts])) for ly, pts in closed]
    polys = [(ly, p.buffer(0)) for ly, p in polys if p.buffer(0).area > 1e-3 and p.buffer(0).geom_type == "Polygon"]
    txts = [(s, (x * k, y * k)) for s, (x, y) in texts]
    room_re, wall_re = re.compile(r"room|space|area|zone|apart|bed|living"), re.compile(r"wall|footprint|outline|slab|building|extern")
    rooms_p = [p for ly, p in polys if room_re.search(ly.lower())]
    walls_p = [p for ly, p in polys if wall_re.search(ly.lower()) and not room_re.search(ly.lower())]
    named = False
    if rooms_p:
        rep.method = "room_layer"
        conf = 0.75
        rooms_p = [p for p in rooms_p if p.area >= 1.0]
        outer = [p for p in rooms_p if sum(1 for q in rooms_p if q is not p and p.contains(q.representative_point())) >= 2]
        if outer:
            ignored["outer_room_outline"] = len(outer)
            rooms_p = [p for p in rooms_p if p not in outer]
    elif walls_p:
        thin = sorted(min(p.minimum_rotated_rectangle.exterior.coords[1][0] - p.minimum_rotated_rectangle.exterior.coords[0][0] or 1, 1) for p in walls_p)
        dims = [sorted([math.dist(p.minimum_rotated_rectangle.exterior.coords[i], p.minimum_rotated_rectangle.exterior.coords[i + 1]) for i in (0, 1)])[0] for p in walls_p]
        if len(walls_p) > 4 and sorted(dims)[len(dims) // 2] < 0.7:
            u = unary_union([p.buffer(0.02) for p in walls_p])
            holes = [Polygon(i) for g in (u.geoms if hasattr(u, "geoms") else [u]) for i in g.interiors]
            rooms_p = [h for h in holes if h.area >= 1.0]
            rep.method, conf = "wall_bands_holes", 0.6
            if not rooms_p:
                rooms_p = [Polygon(max(u.geoms, key=lambda g: g.area).exterior) if hasattr(u, "geoms") else Polygon(u.exterior)]
                rep.method, conf = "wall_bands_outline", 0.4
            del thin
        else:
            big = max(walls_p, key=lambda p: p.area)
            inner = [p for p in walls_p if p is not big and big.contains(p.representative_point()) and p.area >= 1.0]
            if inner:
                rooms_p, rep.method, conf = inner, "outline_plus_inner", 0.55
            else:
                rooms_p, rep.method, conf = [big], "outline_only", 0.4
    else:
        cand = [p for _, p in polys if p.area >= 4.0]
        if not cand:
            raise ValueError("no closed polylines large enough to be rooms or a footprint")
        big = max(cand, key=lambda p: p.area)
        inner = [p for p in cand if p is not big and big.contains(p.representative_point())]
        rooms_p, rep.method, conf = (inner, "all_polylines_inner", 0.3) if inner else ([big], "all_polylines_largest", 0.3)
        rep.notes.append("no wall/room-like layer names; used geometry only")
    used = {id(p) for p in rooms_p}
    ignored["closed_polylines_unused"] = sum(1 for _, p in polys if id(p) not in used)
    minx = min(p.bounds[0] for p in rooms_p)
    miny = min(p.bounds[1] for p in rooms_p)
    m = _base_model(Path(path).stem, "dwelling_house", style, frontage_deg, floor_rl, 1)
    nunnamed = 0
    for p in sorted(rooms_p, key=lambda p: (round(p.centroid.y, 1), p.centroid.x)):
        label = next((s for s, xy in txts if p.contains(__import__("shapely").geometry.Point(xy)) and not re.fullmatch(r"[\d.,\s]*(m2|m²|sqm)?", s.lower())), None)
        if label:
            named = True
        else:
            nunnamed += 1
        nm = label.splitlines()[0][:40] if label else f"Room {len(m.rooms) + 1}"
        pts = [(x - minx, y - miny) for x, y in p.exterior.coords][:-1]
        pts = list(Polygon(pts).simplify(0.005).exterior.coords)[:-1]
        m.rooms.append(Room(id=m.new_id("rm"), name=nm, use=_use_from_name(nm), level_id=m.levels[0].id, polygon=pts))
    if named and rep.method == "room_layer":
        conf = 0.9
    if nunnamed:
        rep.notes.append(f"{nunnamed} room(s) had no text label and were named generically")
    ov = sum(a.poly.intersection(b.poly).area for i, a in enumerate(m.rooms) for b in m.rooms[i + 1:])
    if ov > 0.1:
        conf *= 0.8
        rep.notes.append(f"imported rooms overlap by {ov:.2f} m2")
    rep.notes.append(f"coordinates translated by ({-minx:.3f}, {-miny:.3f}) m so the plan starts at the local origin; walls, doors and windows are not imported (re-derived)")
    _finish_roofs(m)
    rep.confidence = round(conf * conf_k, 2)
    rep.rooms_found, rep.ignored = len(m.rooms), ignored
    return m, rep

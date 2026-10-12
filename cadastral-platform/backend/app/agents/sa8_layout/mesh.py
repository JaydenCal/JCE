"""BuildingModel -> 3D parts (SA6 MODEL-format compatible), floorplan DXF/PDF, footprint polygon.

Part ids (``n``) equal element ids (wall id, opening id, roof id, deck id) so the viewer can map a click to an
element. Openings produce ``<id>`` (frame/panel) and ``<id>:glass`` parts; ``<roof id>:gable`` holds gable infill.
Vertices are returned in the scene frame: MGA minus ``origin`` (default: the model origin), z = RL metres.
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box as sbox
from shapely.ops import unary_union

from .model import BuildingModel, Roof, resolve_material

LAYER = "buildings"
GLASS = "#a6c8da"


# ---------------------------------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------------------------------
def _tris_poly(poly: Polygon, z: float, up: bool = True) -> list:
    out = []
    for g in (poly.geoms if hasattr(poly, "geoms") else [poly]):
        if g.is_empty or g.area < 1e-9:
            continue
        for t in shapely.constrained_delaunay_triangles(g).geoms:
            c = list(t.exterior.coords)[:3]
            tri = [(x, y, z) for x, y in c]
            n = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0])
            if (n < 0) == up:
                tri = [tri[0], tri[2], tri[1]]
            out.append(tri)
    return out


def _prism(poly: Polygon, z0: float, z1: float) -> list:
    out = _tris_poly(poly, z1, True) + _tris_poly(poly, z0, False)
    for g in (poly.geoms if hasattr(poly, "geoms") else [poly]):
        c = list(g.exterior.coords)
        if not g.exterior.is_ccw:
            c = c[::-1]
        for (x0, y0), (x1, y1) in zip(c, c[1:]):
            out += [[(x0, y0, z0), (x1, y1, z0), (x1, y1, z1)], [(x0, y0, z0), (x1, y1, z1), (x0, y0, z1)]]
    return out


def _wall_pt(a, d, n, s, t, z):
    return (a[0] + d[0] * s + n[0] * t, a[1] + d[1] * s + n[1] * t, z)


def _box(a, d, n, s0, s1, t0, t1, z0, z1) -> list:
    """Watertight box in a wall frame (origin a, along d, lateral n=left normal, up z)."""
    P = lambda s, t, z: _wall_pt(a, d, n, s, t, z)  # noqa: E731
    c = {(i, j, k): P(s, t, z) for i, s in enumerate((s0, s1)) for j, t in enumerate((t0, t1)) for k, z in enumerate((z0, z1))}
    quads = [((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
             ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
             ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))]
    out = []
    for q in quads:
        p = [c[k] for k in q]
        out += [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]
    return out


def soup_volume(tris) -> float:
    v = 0.0
    for a, b, c in tris:
        v += np.dot(a, np.cross(b, c)) / 6.0
    return float(v)


def _flat(tris) -> list[float]:
    return [round(float(x), 4) for t in tris for p in t for x in p]


# ---------------------------------------------------------------------------------------------------
# walls
# ---------------------------------------------------------------------------------------------------
def wall_frame(m: BuildingModel, w):
    """(origin, d, n, t0, t1): wall occupies lateral [t0,t1] about origin line. External walls sit inside the room outline."""
    d = w.direction
    n = (-d[1], d[0])
    if w.external:
        return w.a, d, n, 0.0, w.thickness      # interior is on the left of a->b
    return w.a, d, n, -w.thickness / 2, w.thickness / 2


def wall_solid_boxes(m: BuildingModel, w) -> list:
    """Wall boxes with opening holes cut, in model-local metres, z relative to the level floor RL (level.rl added later)."""
    lv = m.level(w.level_id)
    a, d, n, t0, t1 = wall_frame(m, w)
    L, H = w.length, w.height
    ops = [o for o in m.openings if o.wall_id == w.id]
    cuts = [(max(0.0, o.position - o.width / 2), min(L, o.position + o.width / 2), max(0.0, o.sill), min(H, o.sill + o.height)) for o in ops]
    xs = sorted({0.0, L, *[c[0] for c in cuts], *[c[1] for c in cuts]})
    out = []
    for x0, x1 in zip(xs, xs[1:]):
        if x1 - x0 < 1e-6:
            continue
        xm = (x0 + x1) / 2
        holes = sorted((c[2], c[3]) for c in cuts if c[0] <= xm <= c[1])
        z = 0.0
        for h0, h1 in holes + [(H, H)]:
            if h0 > z + 1e-6:
                out.append((x0, x1, z, min(h0, H)))
            z = max(z, h1)
    zbase = lv.rl if lv else 0.0
    tris = []
    for x0, x1, z0, z1 in out:
        tris += _box(a, d, n, x0, x1, t0, t1, zbase + z0, zbase + z1)
    return tris


def wall_volume(m: BuildingModel, w) -> float:
    return soup_volume(wall_solid_boxes(m, w))


# ---------------------------------------------------------------------------------------------------
# roofs
# ---------------------------------------------------------------------------------------------------
def _rot(p, a):
    c, s = math.cos(a), math.sin(a)
    return (c * p[0] - s * p[1], s * p[0] + c * p[1])


def _slabs(poly: Polygon, axis: int) -> list[tuple[float, float, float, float]]:
    """Rectilinear slab decomposition (axis 0: horizontal strips). Returns (x0,y0,x1,y1) rectangles."""
    P = poly if axis == 0 else shapely.transform(poly, lambda c: c[:, ::-1])
    ys = sorted({round(y, 6) for _, y in P.exterior.coords})
    rects = []
    minx, _, maxx, _ = P.bounds
    for y0, y1 in zip(ys, ys[1:]):
        if y1 - y0 < 1e-4:
            continue
        inter = P.intersection(LineString([(minx - 1, (y0 + y1) / 2), (maxx + 1, (y0 + y1) / 2)]))
        segs = list(inter.geoms) if hasattr(inter, "geoms") else [inter]
        for sg in segs:
            if sg.is_empty or sg.length < 1e-4:
                continue
            x0, x1 = sorted((sg.coords[0][0], sg.coords[-1][0]))
            rects.append([x0, y0, x1, y1])
    merged = []
    for r in rects:
        for q in merged:
            if abs(q[0] - r[0]) < 1e-4 and abs(q[2] - r[2]) < 1e-4 and abs(q[3] - r[1]) < 1e-4:
                q[3] = r[3]
                break
        else:
            merged.append(list(r))
    if axis == 1:
        merged = [[r[1], r[0], r[3], r[2]] for r in merged]
    return [tuple(r) for r in merged]


def roof_wings(roof: Roof) -> list[dict]:
    """Rectangular roof wings: centre, unit ridge vector u, half-length a (along ridge), half-span b (across)."""
    wings = []
    for coords in roof.polygons:
        poly = Polygon(coords)
        ring = list(poly.exterior.coords)
        longest = max(zip(ring, ring[1:]), key=lambda e: math.dist(*e))
        th = math.atan2(longest[1][1] - longest[0][1], longest[1][0] - longest[0][0])
        rp = Polygon([_rot(p, -th) for p in coords]).buffer(0)
        best = None
        for axis in (0, 1):
            rects = _slabs(rp, axis)
            cover = unary_union([sbox(*r) for r in rects]).intersection(rp).area / rp.area if rects else 0
            if cover > 0.97 and (best is None or len(rects) < len(best)):
                best = rects
        if best is None:
            mr = rp.minimum_rotated_rectangle
            best = [mr.bounds]
            mr_pts = list(mr.exterior.coords)
        for (x0, y0, x1, y1) in best:
            if (x1 - x0) < 0.3 or (y1 - y0) < 0.3:
                continue
            c = _rot(((x0 + x1) / 2, (y0 + y1) / 2), th)
            along_x = (x1 - x0) >= (y1 - y0)
            if roof.ridge_dir_deg is None:
                ang = th + (0.0 if along_x else math.pi / 2)
                a, b = ((x1 - x0) / 2, (y1 - y0) / 2) if along_x else ((y1 - y0) / 2, (x1 - x0) / 2)
            else:
                ang = math.radians(roof.ridge_dir_deg)
                u, v = (math.cos(ang), math.sin(ang)), (-math.sin(ang), math.cos(ang))
                corners = [_rot(p, th) for p in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
                us = [p[0] * u[0] + p[1] * u[1] for p in corners]
                vs = [p[0] * v[0] + p[1] * v[1] for p in corners]
                a, b = (max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2
                c = (((max(us) + min(us)) / 2) * u[0] + ((max(vs) + min(vs)) / 2) * v[0],
                     ((max(us) + min(us)) / 2) * u[1] + ((max(vs) + min(vs)) / 2) * v[1])
            wings.append({"c": c, "u": (math.cos(ang), math.sin(ang)), "a": a, "b": b})
    return wings


def roof_ridge_height(m: BuildingModel, roof: Roof) -> float:
    """Ridge rise above wall-top level: gable/hip/dutch = (half-span) * tan(pitch); skillion = span * tan; flat = 0."""
    if roof.type == "flat":
        return 0.0
    tp = math.tan(math.radians(roof.pitch_deg))
    hs = max((w["b"] for w in roof_wings(roof)), default=0.0)
    return (2 * hs if roof.type == "skillion" else hs) * tp


def _wing_mesh(wg, z, kind, pitch, e):
    c, u, a, b = wg["c"], wg["u"], wg["a"], wg["b"]
    v = (-u[1], u[0])
    tp = math.tan(math.radians(pitch))
    P = lambda s, t, h=0.0: (c[0] + s * u[0] + t * v[0], c[1] + s * u[1] + t * v[1], z + h)  # noqa: E731
    ae, be, de = a + e, b + e, -e * tp
    H = b * tp
    roof, gable = [], []

    def quad(*q):
        roof.extend([[q[0], q[1], q[2]], [q[0], q[2], q[3]]])

    def tri(*q):
        roof.append([q[0], q[1], q[2]])
    if kind == "skillion":
        Hs = 2 * b * tp
        quad(P(-ae, -be, de), P(ae, -be, de), P(ae, be, Hs - de), P(-ae, be, Hs - de))
        gable += [[P(-a, -b), P(-a, b), P(-a, b, Hs)], [P(a, -b), P(a, b, Hs), P(a, b)]]
    elif kind == "gable":
        quad(P(-ae, -be, de), P(ae, -be, de), P(ae, 0, H), P(-ae, 0, H))
        quad(P(ae, be, de), P(-ae, be, de), P(-ae, 0, H), P(ae, 0, H))
        gable += [[P(-a, -b), P(-a, b), P(-a, 0, H)], [P(a, -b), P(a, 0, H), P(a, b)]]
    elif kind == "hip":
        r = max(a - b, 0.0)
        quad(P(-ae, -be, de), P(ae, -be, de), P(r, 0, H), P(-r, 0, H))
        quad(P(ae, be, de), P(-ae, be, de), P(-r, 0, H), P(r, 0, H))
        tri(P(-ae, be, de), P(-ae, -be, de), P(-r, 0, H))
        tri(P(ae, -be, de), P(ae, be, de), P(r, 0, H))
    elif kind == "dutch_gable":     # approximate: hip with a vertical gablet at each ridge end
        g = min(1.2, max(a - b, 0.0) / 2 + 0.6, a)
        r2 = min(max(a - b, 0.0) + g, a)
        z0 = 0.6 * H
        y0 = max(b - z0 / max(tp, 1e-6), 0.0)
        for sg in (-1, 1):
            hx = [P(-ae, sg * -be, de), P(ae, sg * -be, de), P(r2, sg * -y0, z0), P(r2, 0, H), P(-r2, 0, H), P(-r2, sg * -y0, z0)]
            if sg == -1:
                hx = hx[::-1]
            for i in range(1, 5):
                roof.append([hx[0], hx[i], hx[i + 1]])
        quad(P(ae, -be, de), P(ae, be, de), P(r2, y0, z0), P(r2, -y0, z0))
        quad(P(-ae, be, de), P(-ae, -be, de), P(-r2, -y0, z0), P(-r2, y0, z0))
        gable += [[P(r2, -y0, z0), P(r2, y0, z0), P(r2, 0, H)], [P(-r2, y0, z0), P(-r2, -y0, z0), P(-r2, 0, H)]]
    else:
        raise ValueError(kind)
    return roof, gable


def roof_tris(m: BuildingModel, roof: Roof):
    lv = m.level(roof.level_id)
    z = lv.rl + lv.ceiling_height
    if roof.type == "flat":
        pl = unary_union([Polygon(p) for p in roof.polygons]).buffer(roof.eaves, join_style=2)
        return _prism(pl, z, z + 0.15), []
    rt, gt = [], []
    for wg in roof_wings(roof):
        r, g = _wing_mesh(wg, z, roof.type, roof.pitch_deg, roof.eaves)
        rt += r
        gt += g
    # roof surfaces face upward
    fixed = []
    for t in rt:
        n = np.cross(np.subtract(t[1], t[0]), np.subtract(t[2], t[0]))
        fixed.append(t if n[2] >= 0 else [t[0], t[2], t[1]])
    return fixed, gt


# ---------------------------------------------------------------------------------------------------
# parts
# ---------------------------------------------------------------------------------------------------
def _col(m: BuildingModel, mid: str, default="#cccccc") -> str:
    mt = m.materials.get(mid)
    return mt.hex if mt else default


def to_parts(m: BuildingModel, origin: tuple[float, float] | None = None, layer: str = LAYER) -> list[dict]:
    """MODEL-format parts (dicts with SA6 Part fields: n,c,col,a,ro,me,v). Vertices: MGA - origin; z = RL."""
    origin = origin if origin is not None else m.origin_mga
    ang = math.radians(m.rotation_deg)
    ca, sa = math.cos(ang), math.sin(ang)

    def tf(tris):
        out = []
        for t in tris:
            tt = []
            for (x, y, z) in t:
                tt.append((m.origin_mga[0] + ca * x - sa * y - origin[0], m.origin_mga[1] + sa * x + ca * y - origin[1], z))
            out.append(tt)
        return out

    parts = []

    def add(n, col, tris, a=1.0, ro=0.7, me=0.0):
        if tris:
            parts.append({"n": n, "c": layer, "col": col, "a": a, "ro": ro, "me": me, "v": _flat(tf(tris))})
    for lv in m.levels:
        poly = m.level_polygon(lv.id)
        if not poly.is_empty:
            add(f"slab_{lv.id}", _col(m, "mat_concrete"), _prism(poly.buffer(0), lv.rl - 0.2, lv.rl), ro=0.9)
    for w in m.walls:
        add(w.id, _col(m, w.finish), wall_solid_boxes(m, w), ro=0.8)
    for o in m.openings:
        w = m.wall(o.wall_id)
        if not w:
            continue
        lv = m.level(w.level_id)
        a, d, n, t0, t1 = wall_frame(m, w)
        tm = (t0 + t1) / 2
        s0, s1 = o.position - o.width / 2, o.position + o.width / 2
        z0, z1 = lv.rl + o.sill, lv.rl + o.sill + o.height
        th = 0.05
        if o.type in ("door", "garage_door"):
            add(o.id, _col(m, o.frame, "#6b5a4a"), _box(a, d, n, s0, s1, tm - th / 2, tm + th / 2, z0, z1), ro=0.6)
        else:
            f = 0.06
            bars = (_box(a, d, n, s0, s1, tm - th / 2, tm + th / 2, z0, z0 + f) + _box(a, d, n, s0, s1, tm - th / 2, tm + th / 2, z1 - f, z1)
                    + _box(a, d, n, s0, s0 + f, tm - th / 2, tm + th / 2, z0 + f, z1 - f) + _box(a, d, n, s1 - f, s1, tm - th / 2, tm + th / 2, z0 + f, z1 - f))
            add(o.id, _col(m, o.frame, "#1c1c1e"), bars, ro=0.5, me=0.3)
            add(o.id + ":glass", GLASS, _box(a, d, n, s0 + f, s1 - f, tm - 0.01, tm + 0.01, z0 + f, z1 - f), a=0.35, ro=0.1, me=0.1)
    for r in m.roofs:
        rt, gt = roof_tris(m, r)
        add(r.id, _col(m, r.material), rt, ro=0.5, me=0.3)
        lvw = next((w for w in m.walls if w.level_id == r.level_id), None)
        add(r.id + ":gable", _col(m, lvw.finish if lvw else m.external_finish), gt, ro=0.8)
    for dk in m.decks:
        pl = Polygon(dk.polygon)
        lv = m.level(dk.level_id)
        top = lv.rl - (0.0 if dk.kind == "porch" else 0.0) if lv else m.ground_rl
        top = (m.ground_rl + dk.height_off_ground)
        tris = _prism(pl, top - 0.15, top)
        if dk.height_off_ground > 0.3:
            for (x, y) in list(pl.exterior.coords)[:-1]:
                tris += _prism(sbox(x - 0.05, y - 0.05, x + 0.05, y + 0.05), m.ground_rl, top - 0.15)
        add(dk.id, _col(m, dk.material), tris, ro=0.9)
        if dk.roofed:
            zr = (lv.rl if lv else top) + 2.7
            rtris = _prism(pl.buffer(0.2, join_style=2), zr, zr + 0.1)
            for (x, y) in list(pl.exterior.coords)[:-1]:
                rtris += _prism(sbox(x - 0.06, y - 0.06, x + 0.06, y + 0.06), top, zr)
            add(dk.id + ":roof", _col(m, m.roofs[0].material if m.roofs else "mat_monument"), rtris, ro=0.5, me=0.3)
    for s in m.stairs:
        lv = m.level(s.from_level)
        up = m.level(s.to_level)
        if lv and up:
            add(s.id, "#b8b3a6", _prism(Polygon(s.polygon), lv.rl, up.rl), ro=0.9)
    return parts


def to_scene_parts(m: BuildingModel, origin=None):
    """SA6 ``Part`` models (lazy import so SA8 has no hard dependency on SA6)."""
    from app.agents.sa6_glide3d.models import Part
    return [Part(**p) for p in to_parts(m, origin)]


def to_building_in(m: BuildingModel) -> list:
    """Converter to SA6 ``BuildingIn`` entries (one per roof-bearing footprint; absolute MGA WKT). Use in SceneRequest.buildings."""
    from shapely import affinity
    from app.agents.sa6_glide3d.models import BuildingIn
    from app.common.contracts import DevelopmentType
    fp = to_footprint_polygon(m)
    if fp.is_empty:
        return []
    fp_mga = Polygon([m.to_mga(p) for p in fp.exterior.coords]) if isinstance(fp, Polygon) else fp
    top = max(m.levels, key=lambda l: l.rl)
    base = min(m.levels, key=lambda l: l.rl)
    roof = next((r for r in m.roofs if r.level_id == top.id), m.roofs[-1] if m.roofs else None)
    rt = {"dutch_gable": "hip"}.get(roof.type, roof.type) if roof else "none"
    wall_col = _col(m, m.external_finish)
    try:
        use = DevelopmentType(m.development_type)
    except ValueError:
        use = DevelopmentType.dwelling_house
    del affinity
    return [BuildingIn(name=m.name, footprint_wkt=fp_mga.wkt, base_rl=base.rl, wall_height_m=top.rl + top.ceiling_height - base.rl,
                       roof_type=rt, roof_pitch_deg=roof.pitch_deg if roof else 0.0, eaves_m=roof.eaves if roof else 0.0,
                       wall_colour=wall_col, roof_colour=_col(m, roof.material) if roof else "#4a4f55", use=use,
                       habitable=m.development_type != "shed")]


def to_footprint_polygon(m: BuildingModel, include_decks: bool = False, include_eaves: bool = False, level: str | None = None):
    """Shapely footprint in the local frame (union of enclosed rooms; optionally decks and roof eaves)."""
    polys = [r.poly for r in m.rooms if r.enclosed and (level is None or r.level_id == level)]
    if include_decks:
        polys += [Polygon(d.polygon) for d in m.decks]
    fp = unary_union(polys).buffer(0) if polys else Polygon()
    if include_eaves and m.roofs and not fp.is_empty:
        fp = fp.buffer(max(r.eaves for r in m.roofs), join_style=2)
    if hasattr(fp, "geoms") and len(fp.geoms):
        return fp
    return fp


def total_volume(parts: list[dict]) -> float:
    return sum(soup_volume(np.array(p["v"]).reshape(-1, 3, 3)) for p in parts)


# ---------------------------------------------------------------------------------------------------
# floorplans
# ---------------------------------------------------------------------------------------------------
def floorplan_dxf(m: BuildingModel, path: str | Path | None = None, level: str | None = None) -> bytes | str:
    """DXF floor plan (metres): layers A-WALL, A-ROOM, A-DOOR, A-GLAZ, A-ANNO-TEXT, A-ANNO-AREA, A-DIMS, A-DECK, A-STAIR."""
    import ezdxf
    doc = ezdxf.new("R2010", setup=True)
    doc.units = 6
    for name, col in (("A-WALL", 7), ("A-ROOM", 3), ("A-DOOR", 2), ("A-GLAZ", 5), ("A-ANNO-TEXT", 1), ("A-ANNO-AREA", 8),
                      ("A-DIMS", 4), ("A-DECK", 6), ("A-STAIR", 9)):
        doc.layers.add(name, color=col)
    msp = doc.modelspace()
    lvs = [l for l in m.levels if level in (None, l.id)] or m.levels[:1]
    pts_all = []
    for lv in lvs:
        for w in (w for w in m.walls if w.level_id == lv.id):
            a, d, n, t0, t1 = wall_frame(m, w)
            c = [(a[0] + n[0] * t, a[1] + n[1] * t) for t in (t0, t1)]
            quad = [c[0], c[1], (c[1][0] + d[0] * w.length, c[1][1] + d[1] * w.length), (c[0][0] + d[0] * w.length, c[0][1] + d[1] * w.length)]
            msp.add_lwpolyline(quad, close=True, dxfattribs={"layer": "A-WALL"})
            pts_all += quad
        for o in (o for o in m.openings if (m.wall(o.wall_id) or None) and m.wall(o.wall_id).level_id == lv.id):
            w = m.wall(o.wall_id)
            a, d, n, t0, t1 = wall_frame(m, w)
            p0, p1 = (a[0] + d[0] * (o.position - o.width / 2), a[1] + d[1] * (o.position - o.width / 2)), (a[0] + d[0] * (o.position + o.width / 2), a[1] + d[1] * (o.position + o.width / 2))
            if o.type == "window" or o.type == "sliding_door":
                for t in (t0, (t0 + t1) / 2, t1):
                    msp.add_line((p0[0] + n[0] * t, p0[1] + n[1] * t), (p1[0] + n[0] * t, p1[1] + n[1] * t), dxfattribs={"layer": "A-GLAZ"})
            else:
                msp.add_line(p0, p1, dxfattribs={"layer": "A-DOOR"})
                ang = math.degrees(math.atan2(d[1], d[0]))
                msp.add_arc(p0, o.width, ang, ang + 90, dxfattribs={"layer": "A-DOOR"})
        for r in (r for r in m.rooms if r.level_id == lv.id):
            msp.add_lwpolyline(r.polygon, close=True, dxfattribs={"layer": "A-ROOM"})
            c = r.poly.centroid
            msp.add_text(r.name, height=0.25, dxfattribs={"layer": "A-ANNO-TEXT", "insert": (c.x - 0.5, c.y)})
            msp.add_text(f"{r.area:.1f} m2", height=0.18, dxfattribs={"layer": "A-ANNO-AREA", "insert": (c.x - 0.5, c.y - 0.35)})
        for dk in (d for d in m.decks if d.level_id == lv.id):
            msp.add_lwpolyline(dk.polygon, close=True, dxfattribs={"layer": "A-DECK"})
            pts_all += dk.polygon
        for s in m.stairs:
            if s.from_level == lv.id:
                msp.add_lwpolyline(s.polygon, close=True, dxfattribs={"layer": "A-STAIR"})
    if pts_all:
        xs, ys = [p[0] for p in pts_all], [p[1] for p in pts_all]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        try:
            msp.add_linear_dim(base=(x0, y0 - 1.5), p1=(x0, y0), p2=(x1, y0), dimstyle="EZDXF", dxfattribs={"layer": "A-DIMS"}).render()
            msp.add_linear_dim(base=(x0 - 1.5, y0), p1=(x0, y0), p2=(x0, y1), angle=90, dimstyle="EZDXF", dxfattribs={"layer": "A-DIMS"}).render()
        except Exception:  # noqa: BLE001
            msp.add_text(f"{x1 - x0:.2f} x {y1 - y0:.2f} m overall", height=0.3, dxfattribs={"layer": "A-DIMS", "insert": (x0, y0 - 1.0)})
    msp.add_text("CONCEPT LAYOUT - not a construction drawing; no code compliance is stated", height=0.2,
                 dxfattribs={"layer": "A-ANNO-TEXT", "insert": (min([p[0] for p in pts_all] or [0]), min([p[1] for p in pts_all] or [0]) - 2.5)})
    if path is not None:
        doc.saveas(str(path))
        return str(path)
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def floorplan_pdf(m: BuildingModel, path: str | Path | None = None, level: str | None = None) -> bytes | str:
    """A3-landscape PDF floor plan with walls, openings, room labels, overall dimensions."""
    from reportlab.lib.pagesizes import A3, landscape
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    W, H = landscape(A3)
    cv = canvas.Canvas(str(path) if path else buf, pagesize=(W, H))
    lvs = [l for l in m.levels if level in (None, l.id)] or m.levels[:1]
    for lv in lvs:
        rooms = [r for r in m.rooms if r.level_id == lv.id]
        pts = [p for r in rooms for p in r.polygon] + [p for d in m.decks for p in d.polygon]
        if not pts:
            cv.showPage()
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
        mx = 40
        sc = min((W - 2 * mx) / (x1 - x0), (H - 120) / (y1 - y0))
        T = lambda p: (mx + (p[0] - x0) * sc, 70 + (p[1] - y0) * sc)  # noqa: E731
        cv.setFont("Helvetica-Bold", 14)
        cv.drawString(mx, H - 35, f"{m.name} - {lv.name} (RL {lv.rl:.2f})")
        for r in rooms:
            cv.setFillColorRGB(0.93, 0.95, 0.93)
            p = cv.beginPath()
            pp = [T(q) for q in r.polygon]
            p.moveTo(*pp[0])
            for q in pp[1:]:
                p.lineTo(*q)
            p.close()
            cv.drawPath(p, fill=1, stroke=0)
            c = r.poly.centroid
            cv.setFillColorRGB(0, 0, 0)
            cv.setFont("Helvetica", 8)
            tx, ty = T((c.x, c.y))
            cv.drawCentredString(tx, ty, r.name)
            cv.drawCentredString(tx, ty - 10, f"{r.area:.1f} m2")
        for dk in (d for d in m.decks if d.level_id == lv.id):
            cv.setStrokeColorRGB(0.5, 0.35, 0.2)
            cv.setDash(3, 2)
            pp = [T(q) for q in dk.polygon]
            for a, b in zip(pp, pp[1:] + pp[:1]):
                cv.line(*a, *b)
            cv.setDash()
        for w in (w for w in m.walls if w.level_id == lv.id):
            a, d, n, t0, t1 = wall_frame(m, w)
            c = [(a[0] + n[0] * t0, a[1] + n[1] * t0), (a[0] + n[0] * t1, a[1] + n[1] * t1)]
            quad = [c[0], c[1], (c[1][0] + d[0] * w.length, c[1][1] + d[1] * w.length), (c[0][0] + d[0] * w.length, c[0][1] + d[1] * w.length)]
            p = cv.beginPath()
            pp = [T(q) for q in quad]
            p.moveTo(*pp[0])
            for q in pp[1:]:
                p.lineTo(*q)
            p.close()
            cv.setFillColorRGB(0.15, 0.15, 0.15)
            cv.drawPath(p, fill=1, stroke=0)
        for o in m.openings:
            w = m.wall(o.wall_id)
            if not w or w.level_id != lv.id:
                continue
            a, d, n, t0, t1 = wall_frame(m, w)
            s0, s1 = o.position - o.width / 2, o.position + o.width / 2
            q = [(a[0] + d[0] * s + n[0] * t, a[1] + d[1] * s + n[1] * t) for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
            p = cv.beginPath()
            pp = [T(x) for x in q]
            p.moveTo(*pp[0])
            for x in pp[1:]:
                p.lineTo(*x)
            p.close()
            cv.setFillColorRGB(0.65, 0.8, 0.9) if o.type in ("window", "sliding_door") else cv.setFillColorRGB(0.85, 0.7, 0.45)
            cv.drawPath(p, fill=1, stroke=0)
        cv.setFillColorRGB(0, 0, 0)
        cv.setFont("Helvetica", 9)
        bx0, bx1 = min(p[0] for p in pts) + 1, max(p[0] for p in pts) - 1
        by0, by1 = min(p[1] for p in pts) + 1, max(p[1] for p in pts) - 1
        cv.drawString(*T((bx0, by0 - 0.8)), f"Overall width {bx1 - bx0:.2f} m")
        cv.drawString(*T((bx0, by1 + 0.4)), f"Overall depth {by1 - by0:.2f} m   (street frontage direction {m.frontage_deg:.0f} deg)")
        cv.setFont("Helvetica-Oblique", 8)
        cv.drawString(mx, 30, "Concept layout only - not a construction drawing. No NCC/BCA or planning compliance is stated or implied.")
        cv.showPage()
    cv.save()
    return str(path) if path else buf.getvalue()

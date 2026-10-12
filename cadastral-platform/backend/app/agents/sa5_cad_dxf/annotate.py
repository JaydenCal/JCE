"""Data-driven annotation generation for SA5.

Every label is derived from the request data (segments, areas, services, ...);
nothing is hand-typed per project.  Heights are DXF text heights (cap height) in
paper millimetres converted to model metres via the drawing scale.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Sequence

from reportlab.pdfbase.pdfmetrics import stringWidth
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from app.agents.sa5_cad_dxf.layers import SERVICE_LAYER
from app.agents.sa5_cad_dxf.model import DISCLAIMER_PARTS, PlanModel, left_normal, lines_of

CAP_HEIGHT_RATIO = 0.718          # Helvetica cap height / font size
H_BRNG, H_LOT, H_AREA, H_ROAD, H_DIM, H_LEVEL, H_SERV, H_NOTE, H_OVLY = 2.0, 3.5, 2.5, 3.5, 2.0, 1.8, 1.8, 1.8, 2.2

_ATTACH = {"LEFT": 0.0, "CENTER": -0.5, "RIGHT": -1.0, "TOP": -1.0, "MIDDLE": -0.5, "BOTTOM": 0.0}


@dataclass
class Annotation:
    kind: str                       # annotations.text_annotations.kind
    content: str
    x: float
    y: float
    rotation_deg: float
    height_m: float
    layer: str
    attachment: str = "MIDDLE_CENTER"
    params: dict = field(default_factory=dict)
    push_dir: tuple[float, float] | None = None
    fixed: bool = False             # never moved by the resolver
    render: bool = True             # False = reserved space only (drawn by a DIMENSION entity)
    collision_group: str | None = None
    source_seq: int | None = None

    def width_m(self) -> float:
        return text_width_m(self.content, self.height_m)

    def box(self) -> Polygon:
        w, h = self.width_m(), self.height_m
        v, hz = self.attachment.split("_")
        x0, y0 = _ATTACH[hz] * w, _ATTACH[v] * h
        ring = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]
        a = math.radians(self.rotation_deg)
        c, s = math.cos(a), math.sin(a)
        pad = 0.15 * h
        out = []
        for i, (px, py) in enumerate(ring):
            px += (-pad if px == x0 else pad)
            py += (-pad if py == y0 else pad)
            out.append((self.x + px * c - py * s, self.y + px * s + py * c))
        return Polygon(out)


@dataclass
class AnnotationSet:
    items: list[Annotation]
    unresolved: int = 0

    @property
    def drawn(self) -> list[Annotation]:
        return [a for a in self.items if a.render]


# ---- formatting -------------------------------------------------------------

def text_width_m(text: str, height_m: float) -> float:
    return stringWidth(text, "Helvetica", height_m / CAP_HEIGHT_RATIO)


def format_dms(deg: float) -> str:
    """Bearing in degrees -> 87°14'30\" (seconds rounded, carries handled)."""
    total = int(round((deg % 360.0) * 3600.0))
    total %= 360 * 3600
    d, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{d}°{m:02d}'{s:02d}\""


def format_distance(m: float) -> str:
    return f"{m:.2f} m"


def upright_rotation(deg: float) -> float:
    """Normalise a text rotation into (-90, 90] so text is never upside-down."""
    r = round(((deg + 180.0) % 360.0) - 180.0, 3)
    if r > 90.0:
        r -= 180.0
    elif r <= -90.0:
        r += 180.0
    return round(r, 3)


def line_rotation(dx: float, dy: float) -> float:
    return upright_rotation(math.degrees(math.atan2(dy, dx)))


def format_lotplan(lotplan: str) -> str:
    """'12//DP345678' -> 'LOT 12 DP345678'; '3RP12345' -> 'LOT 3 RP12345'."""
    if "//" in lotplan:
        lot, plan = lotplan.split("//", 1)
        return f"LOT {lot} {plan}"
    m = re.match(r"^(\d+)([A-Za-z]+\d+)$", lotplan)
    if m:
        return f"LOT {m.group(1)} {m.group(2)}"
    return f"LOT/PLAN {lotplan}"


# ---- generators -------------------------------------------------------------

def _mm(scale: int) -> float:
    return scale / 1000.0


def _inside_normal(model: PlanModel, p0, p1) -> tuple[float, float]:
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    nx, ny = left_normal(dx, dy)
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    eps = 0.05
    if model.lot.buffer(1e-6).contains(Point(mx + nx * eps, my + ny * eps)):
        return (nx, ny)
    return (-nx, -ny)


def boundary_annotations(model: PlanModel, scale: int, side: str = "inside") -> list[Annotation]:
    out = []
    h = H_BRNG * _mm(scale)
    for s in model.request.lot.segments:
        p0, p1 = s.start_xy, s.end_xy
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        if math.hypot(dx, dy) < 1e-9:
            continue
        nx, ny = _inside_normal(model, p0, p1)
        if side == "outside":
            nx, ny = -nx, -ny
        off = (0.5 * H_BRNG + 0.9) * _mm(scale)
        mx, my = (p0[0] + p1[0]) / 2 + nx * off, (p0[1] + p1[1]) / 2 + ny * off
        text = f"{s.bearing_dms or format_dms(s.bearing_deg)}  {format_distance(s.distance_m)}"
        out.append(Annotation(
            "bearing_distance", text, mx, my, line_rotation(dx, dy), h, "C-ANNO-BRNG",
            params={"bearing_deg": s.bearing_deg, "distance_m": s.distance_m, "seq": s.seq},
            push_dir=(nx, ny), collision_group="boundary", source_seq=s.seq))
    return out


def lot_annotations(model: PlanModel, scale: int) -> list[Annotation]:
    req = model.request
    pt = model.rep_point
    k = _mm(scale)
    hl = H_LOT * k
    text_w = text_width_m(format_lotplan(req.lot.lotplan), hl)
    # Prefer the largest free part of the lot (clear of slab, driveway and the
    # inside bearing labels) wide enough for the label.
    free = model.lot.buffer(-(H_BRNG * 3.2) * k, join_style="mitre")
    for g in (model.footprint, model.drive_poly):
        if g is not None:
            free = free.difference(g.buffer(1.0 * k * 2))
    for frac in (0.55, 0.35, 0.15):
        try:
            cand = free.buffer(-text_w * frac)
        except Exception:
            break
        polys = [p for p in getattr(cand, "geoms", [cand]) if isinstance(p, Polygon) and not p.is_empty]
        if polys:
            pt = max(polys, key=lambda p: p.area).representative_point()
            break
    area = req.lot.area_m2_registered
    area_txt = f"{area:.1f} m²" if area is not None else f"{req.lot.area_m2_calculated:.1f} m² (calc.)"
    ha = H_AREA * _mm(scale)
    return [
        Annotation("lot_label", format_lotplan(req.lot.lotplan), pt.x, pt.y + 0.9 * hl, 0.0, hl, "C-ANNO-LOTN",
                   params={"lotplan": req.lot.lotplan}, fixed=True),
        Annotation("area", f"AREA {area_txt}", pt.x, pt.y - 0.9 * ha, 0.0, ha, "C-ANNO-LOTN",
                   params={"area_m2_registered": area, "area_m2_calculated": req.lot.area_m2_calculated}, fixed=True),
    ]


def road_annotations(model: PlanModel, scale: int) -> list[Annotation]:
    names = model.request.lot.road_names
    segs = [s for s in model.request.lot.segments if s.is_front or s.adjoins == "road"]
    if not names or not segs:
        return []
    segs.sort(key=lambda s: s.seq)
    groups: list[list] = []
    for s in segs:
        if groups and s.seq - groups[-1][-1].seq == 1:
            groups[-1].append(s)
        else:
            groups.append([s])
    out = []
    h = H_ROAD * _mm(scale)
    for gi, grp in enumerate(groups):
        name = names[min(gi, len(names) - 1)]
        s = max(grp, key=lambda q: q.distance_m)
        p0, p1 = s.start_xy, s.end_xy
        nx, ny = _inside_normal(model, p0, p1)
        off = -(H_ROAD / 2 + (16.0 if s.is_front else 8.0)) * _mm(scale)
        mx, my = (p0[0] + p1[0]) / 2 + nx * off, (p0[1] + p1[1]) / 2 + ny * off
        out.append(Annotation(
            "road_name", name.upper(), mx, my, line_rotation(p1[0] - p0[0], p1[1] - p0[1]), h, "C-ANNO-ROAD",
            params={"road": name}, push_dir=(-nx, -ny), collision_group="road", source_seq=s.seq))
    return out


def dimension_annotations(model: PlanModel, scale: int) -> list[Annotation]:
    """Reserve (render=False) the text position of each DIMENSION entity and record
    it as an annotation so it can be stored / avoided by other labels."""
    kind_map = {"setback": "setback_dimension", "frontage": "user_note", "driveway": "crossover_label"}
    out = []
    h = H_DIM * _mm(scale)
    for d in model.dims:
        mx, my = (d.p1[0] + d.p2[0]) / 2, (d.p1[1] + d.p2[1]) / 2
        off = (d.offset_mm + 1.6) * _mm(scale)
        out.append(Annotation(
            kind_map[d.kind], d.text, mx + d.side[0] * off, my + d.side[1] * off,
            line_rotation(d.p2[0] - d.p1[0], d.p2[1] - d.p1[1]), h, "C-ANNO-DIMS",
            params={"p1": d.p1, "p2": d.p2, "length_m": d.length}, fixed=True, render=False))
    rd = model.radius_dim
    if rd is not None:
        a = math.radians(rd.angle_deg)
        d = rd.radius + 5.8 * _mm(scale)
        out.append(Annotation("crossover_label", rd.text, rd.centre[0] + math.cos(a) * d, rd.centre[1] + math.sin(a) * d,
                              0.0, h, "C-ANNO-DIMS", attachment="MIDDLE_LEFT",
                              params={"radius_m": rd.radius}, fixed=True, render=False))
    return out


def crossover_annotation(model: PlanModel, scale: int) -> list[Annotation]:
    dw = model.request.driveway
    if dw is None or model.crossover is None:
        return []
    text = f"CROSSOVER - {dw.design_vehicle} design vehicle"
    if dw.max_grade_pct is not None:
        text += f", max grade {dw.max_grade_pct:.1f}%"
    pt = model.crossover.representative_point()
    push = (0.0, 1.0)
    fronts = [s for s in model.request.lot.segments if s.is_front]
    if fronts:
        s = fronts[0]
        nx, ny = _inside_normal(model, s.start_xy, s.end_xy)
        push = (-nx, -ny)
    return [Annotation("crossover_label", text, pt.x, pt.y, 0.0, H_NOTE * _mm(scale), "C-ANNO-NOTE",
                       params={"design_vehicle": dw.design_vehicle, "max_grade_pct": dw.max_grade_pct,
                               "standard": dw.council_standard_label},
                       push_dir=push, collision_group="crossover")]


def level_spot_annotations(spots: Sequence[tuple[float, float, float]], scale: int) -> list[Annotation]:
    h = H_LEVEL * _mm(scale)
    off = 0.9 * _mm(scale)
    return [Annotation("level_spot", f"{z:.2f}", x + off, y + off, 0.0, h, "C-ANNO-LEVL",
                       attachment="BOTTOM_LEFT", params={"z": z}, push_dir=(1.0, 1.0), collision_group="level")
            for x, y, z in spots]


def service_label_text(label: str, service: str, dia: int | None, depth: float | None, proposed: bool) -> str:
    bits = [service.upper()]
    if dia:
        bits.append(f"DN{dia}")
    head = " ".join(bits)
    tail = f", {depth:.2f} m deep" if depth is not None else ""
    base = f"{label} - {head}{tail}" if label and label.upper() != service.upper() else f"{head}{tail}"
    return base + (" (PROPOSED)" if proposed else "")


def service_annotations(model: PlanModel, scale: int) -> list[Annotation]:
    h = H_SERV * _mm(scale)
    out = []
    for sv in model.services:
        lns = lines_of(sv.geom)
        if not lns:
            pt = sv.geom.representative_point()
            x, y, rot, push = pt.x, pt.y, 0.0, (0.0, 1.0)
        else:
            ln = max(lns, key=lambda l: l.length)
            coords = list(ln.coords)
            half, acc, x = ln.length / 2, 0.0, coords[0][0]
            y = coords[0][1]
            rot, push = 0.0, (0.0, 1.0)
            for a, b in zip(coords, coords[1:]):
                seg = math.dist(a, b)
                if seg and acc + seg >= half:
                    t = (half - acc) / seg
                    x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    rot = line_rotation(b[0] - a[0], b[1] - a[1])
                    nx, ny = left_normal(b[0] - a[0], b[1] - a[1])
                    push = (nx, ny)
                    off = (0.5 * H_SERV + 0.8) * _mm(scale)
                    x, y = x + nx * off, y + ny * off
                    break
                acc += seg
        out.append(Annotation(
            "service_label", service_label_text(sv.label, sv.service, sv.diameter_mm, sv.depth_m, sv.is_proposed),
            x, y, rot, h, "C-ANNO-SERV",
            params={"service": sv.service, "diameter_mm": sv.diameter_mm, "depth_m": sv.depth_m},
            push_dir=push, collision_group="service"))
    if model.rwt is not None:
        x, y, d = model.rwt
        out.append(Annotation("service_label", model.rwt_text, x, y - d / 2 - 1.2 * h, 0.0, h, "C-ANNO-SERV",
                              params={"rwt": True}, push_dir=(0.0, -1.0), collision_group="service"))
    return out


def overlay_annotations(model: PlanModel, scale: int) -> list[Annotation]:
    h = H_OVLY * _mm(scale)
    out = []
    for o in model.overlays:
        polys = [g for g in getattr(o.geom, "geoms", [o.geom])]
        big = max(polys, key=lambda g: g.area if g.geom_type == "Polygon" else g.length)
        pt = big.representative_point()
        out.append(Annotation("user_note", f"{o.label} ({o.kind})", pt.x, pt.y, 0.0, h, "C-ZONE-OVLY",
                              params={"kind": o.kind}, push_dir=(0.0, -1.0), collision_group="overlay"))
    return out


def wrap_lines(text: str, width_m: float, height_m: float) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if cur and text_width_m(trial, height_m) > width_m:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def disclaimer_annotations(x: float, y_top: float, width_m: float, scale: int) -> list[Annotation]:
    h = H_NOTE * _mm(scale)
    lines = ["NOTES:"] + [ln for part in DISCLAIMER_PARTS for ln in wrap_lines(part, width_m, h)]
    return [Annotation("disclaimer", ln, x, y_top - i * 1.6 * h, 0.0, h, "C-ANNO-NOTE",
                       attachment="TOP_LEFT", fixed=True, params={"line": i}) for i, ln in enumerate(lines)]


# ---- collision resolver -----------------------------------------------------

def resolve_collisions(items: list[Annotation], obstacles: Sequence[BaseGeometry] = (),
                       max_tries: int = 10, step_factor: float = 0.9, slides: int = 4) -> int:
    """Push colliding labels along their perpendicular until clear (max ``max_tries``).

    Fixed annotations are placed first and never move.  Movable ones are tried at
    offsets +1..+k steps along ``push_dir`` (or the text's own perpendicular), then
    -1..-k (``max_tries`` perpendicular tries in total).  If every try collides the
    label is slid along its own baseline (up to ``slides`` times each way, in
    steps of four text heights) and the perpendicular tries repeat.  Returns the number of labels still colliding after the last try.
    """
    placed: list[Polygon] = [a.box() for a in items if a.fixed]
    obst = list(obstacles)
    unresolved = 0
    for a in items:
        if a.fixed:
            continue
        if a.push_dir is not None:
            ux, uy = a.push_dir
        else:
            ux, uy = left_normal(math.cos(math.radians(a.rotation_deg)), math.sin(math.radians(a.rotation_deg)))
        step = step_factor * a.height_m
        ox, oy = a.x, a.y
        tx, ty = math.cos(math.radians(a.rotation_deg)), math.sin(math.radians(a.rotation_deg))
        half = max(1, (max_tries + 1) // 2)
        perp = [0] + list(range(1, half + 1)) + [-i for i in range(1, max_tries - half + 1)]
        along = [0.0] + [sgn * 4.0 * i * a.height_m for i in range(1, slides + 1) for sgn in (1, -1)]
        chosen = None
        for sl in along:
            for k in perp:
                a.x = ox + ux * step * k + tx * sl
                a.y = oy + uy * step * k + ty * sl
                b = a.box()
                if not any(b.intersects(p) for p in placed) and not any(b.intersects(o) for o in obst):
                    chosen = b
                    break
            if chosen is not None:
                break
        if chosen is None:
            a.x, a.y = ox, oy
            chosen = a.box()
            unresolved += 1
        placed.append(chosen)
    return unresolved


def annotation_bounds(items: Sequence[Annotation]) -> tuple[float, float, float, float] | None:
    boxes = [a.box() for a in items if a.render]
    if not boxes:
        return None
    xs = [c[0] for b in boxes for c in b.exterior.coords]
    ys = [c[1] for b in boxes for c in b.exterior.coords]
    return (min(xs), min(ys), max(xs), max(ys))


def generate_annotations(model: PlanModel, scale: int | None = None, include_disclaimer: bool = True,
                         max_tries: int = 10, bearing_side: str = "inside") -> AnnotationSet:
    scale = scale or model.scale
    items: list[Annotation] = []
    items += dimension_annotations(model, scale)
    items += lot_annotations(model, scale)
    items += road_annotations(model, scale)
    items += crossover_annotation(model, scale)
    items += service_annotations(model, scale)
    items += overlay_annotations(model, scale)
    items += level_spot_annotations(model.level_spots, scale)
    items += boundary_annotations(model, scale, bearing_side)
    # Priority: bearings keep their place against lower-priority labels.
    order = {"boundary": 0, "road": 1, "service": 2, "crossover": 3, "level": 4, "overlay": 5}
    items.sort(key=lambda a: (not a.fixed, order.get(a.collision_group or "", 9)))
    unresolved = resolve_collisions(items, max_tries=max_tries)
    aset = AnnotationSet(items, unresolved)
    if include_disclaimer:
        b = annotation_bounds(items)
        minx, miny, maxx, maxy = model.lot.bounds
        if b:
            minx, miny, maxx, maxy = min(minx, b[0]), min(miny, b[1]), max(maxx, b[2]), max(maxy, b[3])
        for dgeo in model.dims:
            miny = min(miny, dgeo.p1[1] - dgeo.offset_mm * _mm(scale), dgeo.p2[1] - dgeo.offset_mm * _mm(scale))
        width = max(maxx - minx, 40 * _mm(scale))
        aset.items += disclaimer_annotations(minx, miny - 4 * _mm(scale), width, scale)
    return aset


def annotation_rows(aset: AnnotationSet, project_id: str, mga_srid: int, scale: int) -> list[dict]:
    """Rows shaped for annotations.text_annotations (insertion as WKT PointZ)."""
    rows = []
    for a in aset.items:
        rows.append({
            "project_id": project_id, "kind": a.kind, "content": a.content, "content_params": a.params,
            "insertion_wkt": f"POINT Z ({a.x:.4f} {a.y:.4f} 0)", "mga_srid": mga_srid,
            "rotation_deg": a.rotation_deg, "text_height_mm": round(a.height_m / (scale / 1000.0), 2),
            "attachment": a.attachment, "layer_name": a.layer, "keep_upright": True,
            "collision_group": a.collision_group,
        })
    return rows

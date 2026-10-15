"""DXF of the site design in plan (R2010 by default, R2000 and R12 on request), on the JCS layer codes of docs/11.

Coordinates are MGA metres (the bundle origin is added back). Each object is drawn on the layers of its type and status (``layers.py``): the outline or line on ``-LINE``, a solid fill of
a polygon on ``-HATCH`` (R2010 and R2000, R12 has no hatch), its label on ``-TEXT``. Existing services that are not verified are drawn DASHED, on their own layers. The contours, the lot
boundary, the adjoining lots and the assumed kerb line come from the scene bundle. A title note states the terrain status, the services status, the date (DD/MM/YYYY) and the
coordinate system. Every label is upper case. A dimension that the object does not have is not drawn.

Versions and text encoding: ``R2010`` (the default) stores text as UTF-8, so a label with an accent or any other letter round trips exactly. ``R2000`` and ``R12`` can only hold a code page
(ANSI 1252): ezdxf encodes the text for it, so an accented Latin letter is stored correctly, and a letter outside that code page is written as ``\\U+XXXX`` (R2000 and R12, the form older readers know) rather than
written as bytes the reader would misread. Use R2010 unless a program needs an older file. A bundle label that has no position is skipped and the drawing note says how many.
"""
from __future__ import annotations

import io
import math
from typing import Any, Sequence

import ezdxf
from shapely.geometry import LineString, Point, Polygon

from app.design.site_design import SiteObject

from . import layers as L
from .common import ExportContext, check_deadline
from .glb import num, pv

TEXT_H = 0.5                  # drawing units (metres): label height, 2.5 mm at 1:200
NOTE_H = 0.6
VERSIONS = {"R2010": "R2010", "R2000": "R2000", "R12": "R12"}
DEFAULT_VERSION = "R2010"


class Dxf:
    def __init__(self, version: str = DEFAULT_VERSION, deadline: float | None = None) -> None:
        if version not in VERSIONS:
            raise ValueError("version must be R2010, R2000 or R12")
        self.deadline = deadline
        self.notes: list[str] = []
        self.doc = ezdxf.new(VERSIONS[version], setup=True)
        self.r12 = version == "R12"
        self.doc.header["$LTSCALE"] = 1.0
        if version != "R12":
            self.doc.header["$INSUNITS"] = 6             # metres
        self.msp = self.doc.modelspace()
        self.used: dict[str, int] = {}
        self.defaults: dict[str, tuple[int, float, str]] = {}
        self.counts: dict[str, int] = {}

    def layer(self, element: str, kind: str, disc: str = "SITE") -> str:
        name = L.layer(element, kind, disc)
        if name not in self.doc.layers:
            aci, lw, lt = L.layer_defaults(element) if element in L.FIXED or element[:3].isalpha() else (7, 0.18, "CONTINUOUS")
            lay = self.doc.layers.add(name, color=aci, linetype=lt if lt in self.doc.linetypes else "Continuous")        # ezdxf takes color and linetype as arguments, not through dxfattribs
            if not self.r12:
                lay.dxf.lineweight = int(round(lw * 100))
        self.used[name] = self.used.get(name, 0) + 1
        return name

    def line(self, a: Sequence[float], b: Sequence[float], layer: str, **kw: Any) -> None:
        self.msp.add_line((a[0], a[1], 0.0), (b[0], b[1], 0.0), dxfattribs={"layer": layer, **kw})

    def poly(self, pts: Sequence[Sequence[float]], layer: str, closed: bool = False, **kw: Any) -> None:
        pts2 = [(float(p[0]), float(p[1])) for p in pts]
        if len(pts2) < 2:
            return
        if self.r12:
            self.msp.add_polyline2d(pts2, close=closed, dxfattribs={"layer": layer, **kw})
        else:
            self.msp.add_lwpolyline(pts2, close=closed, dxfattribs={"layer": layer, **kw})

    def text(self, s: str, at: Sequence[float], layer: str, height: float = TEXT_H, rot: float = 0.0) -> None:
        t = self.msp.add_text(s.upper(), dxfattribs={"layer": layer, "height": height, "rotation": rot})
        t.set_placement((float(at[0]), float(at[1])))

    def fill(self, ring: Sequence[Sequence[float]], element: str) -> bool:
        if self.r12 or len(ring) < 3:
            return False
        h = self.msp.add_hatch(color=256, dxfattribs={"layer": self.layer(element, "HATCH")})
        h.paths.add_polyline_path([(float(p[0]), float(p[1])) for p in ring], is_closed=True)
        return True

    def circle(self, c: Sequence[float], r: float, layer: str, **kw: Any) -> None:
        self.msp.add_circle((float(c[0]), float(c[1]), 0.0), r, dxfattribs={"layer": layer, **kw})

    def to_bytes(self) -> bytes:
        """The file, encoded the way the version declares (UTF-8 from R2007, the code page below); ezdxf's own error handler escapes what the code page cannot hold."""
        buf = io.BytesIO()
        w = io.TextIOWrapper(buf, encoding=self.doc.output_encoding, errors="dxfreplace", newline="\n")
        self.doc.write(w)
        w.flush()
        data = buf.getvalue()
        w.detach()
        return data


def _label(o: SiteObject) -> str:
    base = L.TYPE_CODES[o.type][3] if o.type in L.TYPE_CODES else (L.SERVICE_CODES.get(str(pv(o, "service_kind")), L.SERVICE_CODES["other"])[2] if o.type == "service_existing" else o.type.upper())
    bits = [f"{base}: {o.label.upper()}" if o.label else base]
    if o.status != "proposed":
        bits.append(L.STATUS_WORDS[o.status])
    if o.type == "service_existing":
        bits.append("VERIFIED" if o.verified else "UNVERIFIED, INDICATIVE ONLY")
        d = num(o, "diameter_mm")
        if d:
            bits.append(f"{d:g} MM")
        dp = num(o, "depth_m")
        bits.append(f"DEPTH {dp:g} M ({str(pv(o, 'depth_basis') or 'BASIS NOT SET').replace('_', ' ').upper()})" if dp else "DEPTH NOT AVAILABLE")
    if o.type == "building":
        ffl = num(o, "ffl_rl", False)
        bits.append(f"FFL {ffl:.2f}" if ffl is not None else "FFL NOT SET")
    if o.origin == "ai_proposal":
        bits.append(f"AI PROPOSAL, {(o.accepted or 'pending').upper()}")
    return ", ".join(bits)


def _centre(pts: Sequence[Sequence[float]]) -> tuple[float, float]:
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def draw_object(d: Dxf, o: SiteObject) -> None:
    el = L.object_element(o.type, o.status, str(pv(o, "service_kind") or "other") if o.type == "service_existing" else None, o.verified)
    lay_line, lay_text = d.layer(el, "LINE"), d.layer(el, "TEXT")
    dashed = {"linetype": "DASHED"} if (o.type == "service_existing" and not o.verified) else ({"linetype": "HIDDEN"} if o.status == "to_be_removed" else {})
    g = o.geometry
    label_at: tuple[float, float]
    if g.kind == "polygon":
        ring = [(p[0], p[1]) for p in g.ring]
        d.poly(ring, lay_line, True, **dashed)
        if o.type in ("landscape_area", "grading_area", "pool", "osd_basin", "building", "footpath"):
            d.fill(ring, el)
        if o.type == "building" and o.building:
            for r in o.building.levels[o.building.datum_index].rings[1:]:
                d.poly([(p[0], p[1]) for p in r], lay_line, True)
        label_at = _centre(ring)
    elif g.kind == "polyline":
        pts = [(p[0], p[1]) for p in g.pts]
        d.poly(pts, lay_line, False, **dashed)
        w = num(o, "width_m") or num(o, "thickness_m") or ((num(o, "diameter_mm") or 0) / 1000.0 if o.type != "service_existing" else 0) or None
        if w and o.type in ("driveway", "footpath", "infiltration_trench", "retaining_wall"):
            try:
                edge = LineString(pts).buffer(w / 2, cap_style=2, join_style=2)
                if isinstance(edge, Polygon) and not edge.is_empty:
                    d.poly(list(edge.exterior.coords)[:-1], lay_line, True, **dashed)
            except Exception:  # noqa: BLE001
                pass
        mid = LineString(pts).interpolate(0.5, normalized=True)
        label_at = (mid.x, mid.y)
    else:
        x, y = float(g.p[0]), float(g.p[1])
        dia, wd, ln = num(o, "diameter_m"), num(o, "width_m"), num(o, "length_m") or num(o, "depth_m")
        if dia:
            d.circle((x, y), dia / 2, lay_line, **dashed)
        elif wd and ln:
            t = math.radians(g.yaw_deg or 0.0)
            s_, c_ = math.sin(t), math.cos(t)
            ring = [(x + lx * c_ + ly * s_, y - lx * s_ + ly * c_) for lx, ly in ((-wd / 2, -ln / 2), (wd / 2, -ln / 2), (wd / 2, ln / 2), (-wd / 2, ln / 2))]
            d.poly(ring, lay_line, True, **dashed)
        else:
            d.circle((x, y), 0.25, lay_line, **dashed)                       # a marker of 0.5 m diameter: the object has no dimensions
            d.line((x - 0.4, y), (x + 0.4, y), lay_line)
            d.line((x, y - 0.4), (x, y + 0.4), lay_line)
        label_at = (x + 0.5, y + 0.5)
    d.text(_label(o), label_at, lay_text)


def _segments(flat: Sequence[float], O: tuple[float, float]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    out = []
    for i in range(0, len(flat) - 5, 6):
        out.append(((flat[i] + O[0], flat[i + 1] + O[1]), (flat[i + 3] + O[0], flat[i + 4] + O[1])))
    return out


def draw_bundle(d: Dxf, ctx: ExportContext) -> list[tuple[float, float]]:
    """Boundary, adjoining lots, assumed kerb, contours and their labels from the scene bundle. Returns the boundary points (MGA) for the title note position."""
    b = ctx.bundle
    O = ctx.origin
    bnd: list[tuple[float, float]] = []
    if not b:
        return bnd
    for p in b.get("parts") or []:
        if not p.get("lines"):
            continue
        n = str(p.get("n"))
        cls = str(p.get("c"))
        if n == "Property_boundary":
            el = "BNDY"
        elif cls == "adjoining":
            el = "ADJN"
        elif n == "Kerb_line_assumed":
            el = "KERB"
        elif cls == "contours":
            el = "CONT"
        else:
            continue
        lay = d.layer(el, "LINE")
        for a, c in _segments(p["lines"], O):
            d.line(a, c, lay)
            if el == "BNDY":
                bnd += [a, c]
    skipped = 0
    for lb in b.get("labels") or []:
        if not isinstance(lb, dict):
            skipped += 1
            continue
        cls = str(lb.get("c"))
        if cls not in ("lab_cont", "lab_lots"):
            continue
        at = lb.get("p")
        if (not isinstance(at, (list, tuple)) or len(at) < 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in at[:2])):
            skipped += 1                                            # a label with no usable position is not drawn at a position that was made up
            continue
        el = "CONT" if cls == "lab_cont" else "LOTS"
        h = TEXT_H * (0.8 if el == "CONT" else 1.0)
        d.text(str(lb.get("t") or ""), (at[0] + O[0], at[1] + O[1]), d.layer(el, "TEXT"), h)
    if skipped:
        d.notes.append(f"{skipped} LABEL{'S' if skipped != 1 else ''} OF THE SCENE BUNDLE SKIPPED, NO POSITION")
    return bnd


def title_note(d: Dxf, ctx: ExportContext, bounds: tuple[float, float, float, float]) -> None:
    x0, y0, x1, y1 = bounds
    lay = d.layer("NOTE", "TEXT", "ANNO")
    lines = ["SITE DESIGN PLAN", ctx.title.upper(), f"DATE {ctx.date_text()}", f"COORDINATES: {ctx.coordinate_text()}", *ctx.status_lines(),
             f"OBJECTS IN THE DESIGN: {len(ctx.design.objects)}", *d.notes]
    for i, s in enumerate(lines):
        d.text(s, (x0, y0 - 3.0 - i * (NOTE_H * 1.8)), lay, NOTE_H * (1.4 if i == 0 else 1.0))
    # north arrow and a 10 m scale bar
    ln, tx = d.layer("NRTH", "LINE", "ANNO"), d.layer("NRTH", "TEXT", "ANNO")
    cx, cy = x1 + 6.0, y1 - 6.0
    d.line((cx, cy - 3), (cx, cy + 3), ln)
    d.poly([(cx - 1.0, cy + 1.0), (cx, cy + 3.0), (cx + 1.0, cy + 1.0)], ln, False)
    d.text("N", (cx - 0.4, cy + 3.6), tx, NOTE_H * 1.4)
    d.line((x1 + 3.0, y0), (x1 + 13.0, y0), ln)
    d.line((x1 + 3.0, y0 - 0.5), (x1 + 3.0, y0 + 0.5), ln)
    d.line((x1 + 13.0, y0 - 0.5), (x1 + 13.0, y0 + 0.5), ln)
    d.text("10 M", (x1 + 6.5, y0 + 1.0), tx, NOTE_H)


def build_dxf(ctx: ExportContext, version: str = DEFAULT_VERSION, deadline: float | None = None) -> bytes:
    d = Dxf(version, deadline)
    bnd = draw_bundle(d, ctx)
    for o in ctx.design.objects:
        check_deadline(deadline)
        draw_object(d, o)
    pts = list(bnd)
    for o in ctx.design.objects:
        g = o.geometry
        pts += [(float(g.p[0]), float(g.p[1]))] if g.kind == "point" else [(p[0], p[1]) for p in (g.pts if g.kind == "polyline" else g.ring)]
    if pts:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        bounds = (min(xs), min(ys), max(xs), max(ys))
    else:
        O = ctx.origin
        bounds = (O[0], O[1], O[0] + 10.0, O[1] + 10.0)
    title_note(d, ctx, bounds)
    if not ctx.bundle:
        d.text("TERRAIN DATA NOT AVAILABLE, NO SCENE BUNDLE FOR THIS PROJECT", (bounds[0], bounds[1] - 3.0 - 12 * NOTE_H * 1.8), d.layer("NOTE", "TEXT", "ANNO"), NOTE_H)
    return d.to_bytes()

"""A3 landscape sheet layout shared by the DXF paper space and the PDF.

All sheet coordinates are paper millimetres, origin bottom-left.  The title
block / legend / notes panel is described once as drawing primitives and then
rendered by each back end.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Union

from app.agents.sa5_cad_dxf.annotate import wrap_lines
from app.agents.sa5_cad_dxf.gate import ACK_TEXT
from app.agents.sa5_cad_dxf.model import DISCLAIMER, PlanModel
from app.common.contracts import AckKind

SHEET_W, SHEET_H = 420.0, 297.0
FRAME = (10.0, 10.0, 410.0, 287.0)
VIEWPORT = (12.0, 12.0, 308.0, 285.0)           # x0, y0, x1, y1
PANEL_X0, PANEL_X1 = 310.0, 410.0
FIT_PAD_MM = 4.0
STANDARD_SCALES = (50, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000)


@dataclass
class FitResult:
    fits: bool
    scale: int
    suggested_scale: int | None
    needed_mm: tuple[float, float]
    available_mm: tuple[float, float]
    centre: tuple[float, float]            # model centre of the viewport

    @property
    def message(self) -> str:
        if self.fits:
            return ""
        return (f"Plan does not fit A3 at 1:{self.scale} (needs {self.needed_mm[0]:.0f} x {self.needed_mm[1]:.0f} mm, "
                f"viewport {self.available_mm[0]:.0f} x {self.available_mm[1]:.0f} mm); "
                f"suggested scale 1:{self.suggested_scale}")


def viewport_size() -> tuple[float, float]:
    return VIEWPORT[2] - VIEWPORT[0], VIEWPORT[3] - VIEWPORT[1]


def compute_fit(bounds: tuple[float, float, float, float], scale: int) -> FitResult:
    minx, miny, maxx, maxy = bounds
    aw, ah = viewport_size()
    def need(n: int) -> tuple[float, float]:
        return ((maxx - minx) * 1000.0 / n + 2 * FIT_PAD_MM, (maxy - miny) * 1000.0 / n + 2 * FIT_PAD_MM)
    nw, nh = need(scale)
    fits = nw <= aw and nh <= ah
    sug = None
    if not fits:
        sug = next((s for s in STANDARD_SCALES if s > scale and need(s)[0] <= aw and need(s)[1] <= ah), STANDARD_SCALES[-1])
    return FitResult(fits, scale, sug, (nw, nh), (aw, ah), ((minx + maxx) / 2, (miny + maxy) / 2))


# ---- primitives ---------------------------------------------------------------

@dataclass
class Line:
    x1: float
    y1: float
    x2: float
    y2: float
    layer: str = "C-ANNO-TTLB"
    lw: float | None = None            # mm override


@dataclass
class Poly:
    pts: list[tuple[float, float]]
    layer: str = "C-ANNO-TTLB"
    closed: bool = True
    fill: bool = False
    lw: float | None = None


@dataclass
class Circle:
    x: float
    y: float
    r: float
    layer: str = "C-ANNO-TTLB"


@dataclass
class Text:
    x: float
    y: float
    h: float
    text: str
    anchor: str = "BOTTOM_LEFT"
    layer: str = "C-ANNO-TTLB"
    bold: bool = False
    grey: bool = False


Prim = Union[Line, Poly, Circle, Text]


def north_arrow(cx: float, cy: float, size: float) -> list[Prim]:
    return [
        Circle(cx, cy, size * 0.5),
        Poly([(cx, cy + size * 0.5), (cx - size * 0.16, cy - size * 0.38), (cx, cy - size * 0.2)], fill=True),
        Poly([(cx, cy + size * 0.5), (cx + size * 0.16, cy - size * 0.38), (cx, cy - size * 0.2)], fill=False),
        Text(cx, cy + size * 0.58, 3.5, "N", "BOTTOM_CENTER", bold=True),
    ]


def scale_bar(x: float, y: float, scale: int) -> tuple[list[Prim], float]:
    mm_per_m = 1000.0 / scale
    total_m = next((m for m in (200, 100, 50, 25, 20, 10, 5, 2, 1) if m * mm_per_m <= 60.0), 1)
    n = 4 if total_m % 4 == 0 or total_m in (10, 20, 50, 100, 200, 25) else 2
    seg_m = total_m / n
    out: list[Prim] = []
    hbar = 1.8
    for i in range(n):
        x0 = x + i * seg_m * mm_per_m
        out.append(Poly([(x0, y), (x0 + seg_m * mm_per_m, y), (x0 + seg_m * mm_per_m, y + hbar), (x0, y + hbar)],
                        fill=(i % 2 == 0)))
        lab = f"{i * seg_m:g}"
        out.append(Text(x0, y + hbar + 0.8, 1.8, lab, "BOTTOM_CENTER"))
    out.append(Text(x + total_m * mm_per_m, y + hbar + 0.8, 1.8, f"{total_m:g} m", "BOTTOM_CENTER"))
    out.append(Text(x, y - 3.6, 2.0, f"SCALE 1:{scale} (A3)", "BOTTOM_LEFT"))
    return out, total_m * mm_per_m


def legend_entries(model: PlanModel) -> list[tuple[str, str, str]]:
    """(label, symbol, layer): symbol in line | box | hatch | circle."""
    e = [("Lot boundary", "line", "C-PROP-BDY")]
    if model.envelope is not None:
        e += [("Building envelope", "line", "C-ZONE-ENVL"), ("Setback measurement", "line", "C-ZONE-SBAK")]
    if model.footprint is not None:
        e.append(("Proposed slab (unverified)", "box", "A-BLDG-SLAB"))
    if model.drive_poly is not None:
        e += [("Driveway / crossover", "line", "C-DRIV-XOVR"), ("Driveway centreline", "line", "C-DRIV-CNTR")]
        if model.turn_path is not None or model.turn_centre is not None:
            e.append(("Turning path / circle", "line", "C-DRIV-TURN"))
    from app.agents.sa5_cad_dxf.layers import SERVICE_LAYER
    seen = set()
    for s in model.services:
        if s.service not in seen:
            seen.add(s.service)
            e.append((f"{s.service.capitalize()} service", "line", SERVICE_LAYER[s.service]))
    if any(s.exclusion is not None for s in model.services):
        e.append(("Service exclusion buffer", "line", "C-UTIL-EXCL"))
    if model.rwt is not None:
        e.append(("Rainwater tank", "circle", "C-UTIL-RWTK"))
    if model.overlays:
        e.append(("Council overlay", "hatch", "C-ZONE-OVLY"))
    return e


def build_panel(model: PlanModel, scale: int, acks: list[AckKind], fit: FitResult, issue_date: str) -> list[Prim]:
    req = model.request
    x0, x1 = PANEL_X0, PANEL_X1
    tx = x0 + 3.0
    tw = (x1 - x0) - 6.0
    out: list[Prim] = []
    out.append(Line(x0, FRAME[1], x0, FRAME[3]))
    y = FRAME[3] - 4.0

    out.append(Text(tx, y - 2.0, 1.8, "PROJECT", grey=True))
    y -= 4.0
    for ln in wrap_lines(req.project_title, tw, 4.2 * 0.72):
        out.append(Text(tx, y - 4.2, 4.2, ln, bold=True))
        y -= 6.0
    y -= 1.0
    out.append(Line(x0, y, x1, y))

    zone = {7854: "54", 7855: "55", 7856: "56"}[req.mga_srid]
    rows = [
        ("LOT / PLAN", _lotplan(req.lot.lotplan)),
        ("COUNCIL", req.council_name or req.lot.lga_name),
        ("SCALE", f"1:{scale} @ A3"),
        ("DATE", issue_date),
        ("DRAWN BY", req.drawn_by),
        ("DATUM / GRID", f"GDA2020 MGA zone {zone} (EPSG:{req.mga_srid})"),
        ("AREA", f"{(req.lot.area_m2_registered or req.lot.area_m2_calculated):.1f} sq m"
                 + (" (registered)" if req.lot.area_m2_registered else " (calculated)")),
    ]
    for lab, val in rows:
        out.append(Text(tx, y - 3.0, 1.5, lab, grey=True))
        out.append(Text(tx, y - 6.6, 2.6, val))
        y -= 8.0
        out.append(Line(x0, y, x1, y, lw=0.13))
    y -= 2.0

    # north arrow + scale bar
    out += north_arrow(x0 + 14.0, y - 14.0, 14.0)
    sb, _ = scale_bar(x0 + 32.0, y - 14.0, scale)
    out += sb
    y -= 32.0
    out.append(Line(x0, y, x1, y))

    # legend
    out.append(Text(tx, y - 4.0, 2.2, "LEGEND", bold=True))
    y -= 6.0
    for lab, sym, layer in legend_entries(model):
        sy = y - 2.0
        if sym == "line":
            out.append(Line(tx, sy, tx + 10.0, sy, layer))
        elif sym in ("box", "hatch"):
            out.append(Poly([(tx, sy - 1.3), (tx + 10.0, sy - 1.3), (tx + 10.0, sy + 1.3), (tx, sy + 1.3)], layer))
            if sym == "hatch":
                for k in range(1, 5):
                    out.append(Line(tx + 2.5 * k - 2.5, sy - 1.3, tx + 2.5 * k, sy + 1.3, layer, lw=0.1))
        else:
            out.append(Circle(tx + 5.0, sy, 1.6, layer))
        out.append(Text(tx + 13.0, sy, 2.0, lab, "MIDDLE_LEFT"))
        y -= 4.2
    y -= 1.0
    out.append(Line(x0, y, x1, y))

    # acknowledgements + notes
    h = 1.7
    out.append(Text(tx, y - 4.0, 2.2, "ACKNOWLEDGEMENTS ON FILE", bold=True))
    y -= 6.0
    for k in AckKind:
        if k in acks:
            for i, ln in enumerate(wrap_lines(ACK_TEXT[k], tw - 3.5, h * 0.72 * 0.9)):
                out.append(Text(tx + (3.5 if i else 0.0), y - h, h, ("- " if i == 0 else "") + ln))
                y -= h + 0.9
            y -= 0.5
    y -= 1.5
    out.append(Text(tx, y - 4.0, 2.2, "NOTES", bold=True))
    y -= 6.0
    notes = [DISCLAIMER, "Coordinates are MGA grid metres; plan is oriented to grid north.",
             "Dimensions in metres. Service exclusion buffers are indicative planning offsets."]
    if model.rwt_text and req.rwt and req.rwt.note:
        notes.append(f"RWT: {req.rwt.note}")
    if not fit.fits:
        notes.append("WARNING: " + fit.message)
    for n in notes:
        for ln in wrap_lines(n, tw, h * 0.72 * 0.9):
            out.append(Text(tx, y - h, h, ln))
            y -= h + 0.9
        y -= 0.8
    if y < FRAME[1] + 2:
        model.warnings.append("Title block panel text overflows the sheet.")
    return out


def _lotplan(lotplan: str) -> str:
    from app.agents.sa5_cad_dxf.annotate import format_lotplan
    return format_lotplan(lotplan)


def nice_scale_bar_total(scale: int) -> float:
    return next((m for m in (200, 100, 50, 25, 20, 10, 5, 2, 1) if m * 1000.0 / scale <= 60.0), 1)


def finite(v: float) -> bool:
    return math.isfinite(v)

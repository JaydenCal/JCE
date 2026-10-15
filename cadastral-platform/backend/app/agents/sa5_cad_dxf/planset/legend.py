"""Legend of the line types, fills and hatches used on the plan sheets (paper view; drawn with the same style helpers as the plans, so the key can
never differ from the drawing).  Nothing here carries a value: every swatch is a graphic convention, labelled as such where it is a placeholder."""
from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon

from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset import sections as SEC
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.core import View

CUT_RED, FILL_GREEN = (0.85, 0.15, 0.1), (0.1, 0.6, 0.2)
SW, SH = 24.0, 7.0                      # swatch size, mm


def _rect(x: float, y: float) -> Polygon:
    return Polygon([(x, y - SH / 2), (x + SW, y - SH / 2), (x + SW, y + SH / 2), (x, y + SH / 2)])


def _line(x: float, y: float) -> LineString:
    return LineString([(x, y), (x + SW, y)])


def _boundary(v, x, y):
    ST.boundary(v, _line(x, y))


def _adjoining(v, x, y):
    v.geom(_line(x, y), "C-PROP-ADJN", lw=ST.REF.neighbour_lw * 2, color=ST.FENCE)


def _kerb(v, x, y):
    ST.kerb(v, _line(x, y + 1.3), gutter=True)
    ST.kerb(v, _line(x, y - 1.3))


def _layover(v, x, y):
    ST.concrete_fill(v, _rect(x, y), "C-ROAD-CONC")


def _driveway(v, x, y):
    ST.driveway_fill(v, _rect(x, y), None)


def _road(v, x, y):
    v.fill(_rect(x, y), "C-ROAD-PAVE", ST.BITUMEN, 1.0, edge=ST.BLACK, edge_lw=0.13)


def _existing(v, x, y):
    SEC.hatch(v, list(_rect(x, y).exterior.coords)[:-1], "existing")


def _proposed(v, x, y):
    SEC.hatch(v, list(_rect(x, y).exterior.coords)[:-1], "proposed")


def _cut(v, x, y):
    v.fill(_rect(x, y), "C-EART-CUTT", CUT_RED, 0.55, (45, 1.6), edge=ST.BLACK, edge_lw=0.13)


def _fill(v, x, y):
    v.fill(_rect(x, y), "C-EART-FILL", FILL_GREEN, 0.55, (-45, 1.6), edge=ST.BLACK, edge_lw=0.13)


def _contour(v, x, y):
    pts = [(x + i * SW / 12, y + 1.6 * math.sin(i * 0.9)) for i in range(13)]
    v.geom(LineString(pts), "C-TOPO-EXST", lw=0.28, color=(0.5, 0.5, 0.5))


def _aerial(v, x, y):
    v.fill(_rect(x, y), "C-ANNO-NOTE", (0.85, 0.85, 0.85), 1.0, edge=ST.GRID, edge_lw=0.1)


def _none(v, x, y):
    P = ST.Paper(v)
    P.poly(list(_rect(x, y).exterior.coords)[:-1], "C-DATA-NONE", ST.WHITE, edge=(0.72, 0.1, 0.1), edge_lw=0.35)


def _esc(v, x, y):
    v.fill(_rect(x, y), "C-ESCP-GENL", (0.4, 0.7, 0.4), 0.35, edge=ST.BLACK, edge_lw=0.13)


ENTRIES = [
    (_boundary, "PROPERTY BOUNDARY (STATE CADASTRE, NOT A SURVEY)"),
    (_adjoining, "ADJOINING LOT AND ROAD RESERVE BOUNDARY (DCDB)"),
    (_kerb, "KERB AND GUTTER LINES (ASSUMED, NOT SURVEYED)"),
    (_road, "ROAD PAVEMENT (ASSUMED EXTENT)"),
    (_layover, "PROPOSED CROSSOVER AND LAYOVER (CONCRETE STIPPLE)"),
    (_driveway, "PROPOSED DRIVEWAY (SURFACE TO BE CONFIRMED)"),
    (_existing, "EXISTING MATERIAL / EXISTING GROUND: HATCH \"/\""),
    (_proposed, "PROPOSED WORKS / FILL BODY: HATCH \"\\\""),
    (_cut, "CUT (RED HATCH)"),
    (_fill, "FILL (GREEN HATCH)"),
    (_contour, "EXISTING CONTOUR (5 m DEM, INDICATIVE)"),
    (_aerial, "FADED AERIAL IMAGE (UNDERLAY ONLY, NOT A SURVEY)"),
    (_esc, "EROSION AND SEDIMENT CONTROL ELEMENT (INDICATIVE)"),
    (_none, "DATA NOT AVAILABLE: NOT DRAWN, NOT CHECKED, NOT CLEAR"),
]


def legend_height(cols: int, pitch: float = 11.0) -> float:
    return 12.0 + math.ceil(len(ENTRIES) / cols) * pitch


def draw_legend(v: View, x0: float, y1: float, w: float, cols: int = 3, pitch: float = 11.0, title: str = "LEGEND", contour_label: str | None = None, boundary_label: str | None = None) -> float:
    """Boxed legend with its top-left at (x0, y1) in paper mm; returns the y of the bottom of the box."""
    P = ST.Paper(v)
    rows = math.ceil(len(ENTRIES) / cols)
    h = legend_height(cols, pitch)
    y0 = y1 - h
    P.line([(x0, y0), (x0 + w, y0), (x0 + w, y1), (x0, y1)], "C-ANNO-NOTE", 0.35, ST.BLACK, closed=True)
    P.text(x0 + 4.0, y1 - 3.0, title, 4.0, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
    cw = (w - 8.0) / cols
    for i, (fn, label) in enumerate(ENTRIES):
        if fn is _contour and contour_label:
            label = contour_label
        if fn is _boundary and boundary_label:
            label = boundary_label
        c, r = divmod(i, rows)
        x = x0 + 4.0 + c * cw
        y = y1 - 15.0 - r * pitch - SH / 2 + 3.0
        fn(v, x, y)
        for k, ln in enumerate(fonts.wrap(label, 2.5, cw - SW - 8.0)[:2]):
            P.text(x + SW + 3.0, y + 1.3 - k * 3.4, ln, 2.5, "MIDDLE_LEFT", layer="C-ANNO-NOTE")
    return y0

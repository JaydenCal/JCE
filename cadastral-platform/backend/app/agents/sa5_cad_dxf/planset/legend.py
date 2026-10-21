"""Legend of the line types, fills and hatches used on the plan sheets (paper view; drawn with the same style helpers as the plans, so the key can
never differ from the drawing).  Nothing here carries a value: every swatch is a graphic convention, labelled as such where it is a placeholder."""
from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon

from app.agents.sa5_cad_dxf.planset import draw as D
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


# ---- symbols and linework that are drawn on some sheets only (listed when the sheet set draws them) ---------------------------------------------
def _centreline(v, x, y):
    P = ST.Paper(v)
    P.line([(x, y), (x + SW, y)], "C-DRIV-CNTR", 0.18, ST.BLACK, "DASHDOT")
    for xx in (x + 4.0, x + 12.0, x + 20.0):
        P.line([(xx, y - 1.6), (xx, y + 1.6)], "C-DRIV-CNTR", 0.25, ST.BLACK)


def _esc_line(v, x, y):
    ST.Paper(v).line([(x, y), (x + SW, y)], "C-ESCP-GENL", 0.4, ST.BLACK)


def _section(v, x, y):
    P = ST.Paper(v)
    P.line([(x + 4.0, y), (x + SW - 4.0, y)], "C-ANNO-NOTE", 0.35, ST.BLACK, "DASHED")
    for xx in (x + 2.0, x + SW - 2.0):
        P.circle(xx, y, 2.0, "C-ANNO-NOTE", 0.3, ST.BLACK, ST.WHITE)
        P.text(xx, y, "A", 2.0, "MIDDLE_CENTER", bold=True, layer="C-ANNO-NOTE")


def _callout(v, x, y):
    P = ST.Paper(v)
    P.poly([(x, y - 2.0), (x + 11.0, y - 2.0), (x + 11.0, y + 2.0), (x, y + 2.0)], "C-ANNO-CALL", ST.WHITE, edge=ST.BLACK, edge_lw=0.25)
    P.line([(x + 11.0, y), (x + 15.0, y), (x + SW - 1.0, y - 2.0)], "C-ANNO-CALL", 0.25, ST.BLACK)
    P.circle(x + SW - 1.0, y - 2.0, 0.8, "C-ANNO-CALL", 0.1, ST.BLACK, ST.BLACK)


def _dimension(v, x, y):
    P = ST.Paper(v)
    P.line([(x, y), (x + SW, y)], "C-ANNO-DIMS", 0.25, ST.BLACK)
    for xx, sg in ((x, 1), (x + SW, -1)):
        P.line([(xx, y - 2.5), (xx, y + 2.5)], "C-ANNO-DIMS", 0.13, ST.BLACK)
        P.poly([(xx, y), (xx + sg * 2.6, y + 0.5), (xx + sg * 2.6, y - 0.5)], "C-ANNO-DIMS", ST.BLACK)
    P.text(x + SW / 2, y + 0.8, "3.0m", ST.TXT.SMALL, "BOTTOM_CENTER", layer="C-ANNO-DIMS")


def _spot(v, x, y):
    P = ST.Paper(v)
    P.line([(x + 3.0, y + 0.8), (x + 4.6, y + 0.8)], "C-TOPO-SPOT", 0.1, (0.62, 0.62, 0.62))
    P.line([(x + 3.8, y), (x + 3.8, y + 1.6)], "C-TOPO-SPOT", 0.1, (0.62, 0.62, 0.62))
    P.text(x + 3.8, y - 0.2, "265.50", ST.TXT.SMALL, "TOP_CENTER", layer="C-TOPO-SPOT", color=(0.2, 0.2, 0.2))


def _north(v, x, y):
    P = ST.Paper(v)
    cx = x + 6.0
    P.circle(cx, y, 3.2, "C-ANNO-NRTH", 0.25, ST.BLACK)
    P.line([(cx, y - 2.2), (cx, y + 3.0)], "C-ANNO-NRTH", 0.25, ST.BLACK)
    P.poly([(cx, y + 3.0), (cx - 1.0, y + 0.8), (cx + 1.0, y + 0.8)], "C-ANNO-NRTH", ST.BLACK)


def _swept(v, x, y):
    ST.Paper(v).line([(x, y), (x + SW, y)], "C-DRIV-TURN", 0.25, (0.9, 0.45, 0.0))


def _flow(v, x, y):
    P = ST.Paper(v)
    P.line([(x + 3.0, y), (x + SW - 3.0, y)], "C-UTIL-FLOW", 0.25, D.STORM)
    P.line([(x + SW - 6.0, y + 1.6), (x + SW - 3.0, y), (x + SW - 6.0, y - 1.6)], "C-UTIL-FLOW", 0.25, D.STORM)


def _lot_highlight(v, x, y):
    v.fill(_rect(x, y), "C-PROP-BDY", (1, 0.9, 0.5), 0.5, edge=ST.BLACK, edge_lw=0.25)


def _symbol(fn):
    return lambda v, x, y: fn(v, x + SW / 2, y) if v.paper else None


def _tree(v, x, y):
    ST.tree_canopy(v, x + SW / 2, y, 2.6)


def _svc(v, x, y):
    ST.Paper(v).line([(x, y), (x + SW, y)], "C-UTIL-OTHR", 0.25, ST.BLACK)


def _svc_prop(v, x, y):
    ST.Paper(v).line([(x, y), (x + SW, y)], "C-UTIL-OTHR", 0.25, ST.BLACK, "DASHED")


def entries_for(site=None, swept: bool = False) -> list[tuple]:
    """Legend entries for the sheet set: the base conventions, plus an entry for every other symbol or line the set draws from this site's data
    (driveway centreline and chainage ticks, section mark, spot levels, ESC linework, service symbols and lines, swept path)."""
    out = list(ENTRIES)
    out.append((_callout, "CALL-OUT: BOX, LEADER AND DOT OR ARROW"))
    out.append((_dimension, "DIMENSION (EXTENSION LINES AND ARROWS)"))
    out.append((_north, "NORTH POINT (ROTATED WITH THE VIEW)"))
    out.append((_lot_highlight, "SUBJECT LOT HIGHLIGHT (COVER SHEET SITE PLAN)"))
    if site is None:
        return out
    if getattr(site, "drive_cl", None) is not None:
        out.append((_centreline, "DRIVEWAY CENTRELINE AND CHAINAGE TICKS (SA3 CENTRELINE)"))
    if getattr(site, "tin", None) is not None:
        out.append((_section, "SECTION LINE AND SECTION LETTER"))
    if getattr(site, "tin", None) is not None:
        out.append((_flow, "OVERLAND FLOW DIRECTION (DOWNSLOPE OF THE 5 m DEM, INDICATIVE)"))
    if getattr(site, "spots", None):
        out.append((_spot, "SPOT LEVEL (DEM POST, m AHD, INDICATIVE)"))
    if getattr(site, "esc", None) is not None:
        out.append((_esc_line, "SEDIMENT FENCE, FENCE RETURN, DIVERSION AND LIMIT OF WORKS (INDICATIVE)"))
    if swept:
        out.append((_swept, "SWEPT PATH OF THE DESIGN VEHICLE (PLATFORM DATA)"))
    seen: set = set()
    inp = getattr(site, "inp", None)
    for sv in (getattr(inp, "services", None) or []):
        from app.agents.sa5_cad_dxf.planset.sheets_ref import _symbol as _sym_for
        from shapely import wkt as swkt
        g = swkt.loads(sv.geometry_wkt)
        if g.geom_type == "Point":
            fn = _sym_for(sv)
            if fn is not None and fn not in seen:
                seen.add(fn)
                out.append((_symbol(fn), {"hyd": "HYDRANT (AS SUPPLIED)", "water_meter": "WATER METER (AS SUPPLIED)", "tpit": "TELECOMMUNICATIONS PIT (AS SUPPLIED)", "grate": "STORMWATER PIT OR GRATE (AS SUPPLIED)"}.get(fn.__name__, "SERVICE SYMBOL (AS SUPPLIED)")))
        else:
            key = "prop" if sv.is_proposed else "exist"
            if key not in seen:
                seen.add(key)
                out.append((_svc_prop, "PROPOSED SERVICE LINE (AS SUPPLIED)") if sv.is_proposed else (_svc, "EXISTING SERVICE LINE (AS SUPPLIED, LOCATION NOT VERIFIED)"))
    return out


def legend_height(cols: int, pitch: float = 11.0, n: int | None = None) -> float:
    return 12.0 + math.ceil((len(ENTRIES) if n is None else n) / cols) * pitch


def draw_legend(v: View, x0: float, y1: float, w: float, cols: int = 3, pitch: float = 11.0, title: str = "LEGEND", entries=None) -> float:
    """Boxed legend with its top-left at (x0, y1) in paper mm; returns the y of the bottom of the box."""
    P = ST.Paper(v)
    entries = list(ENTRIES) if entries is None else list(entries)
    rows = math.ceil(len(entries) / cols)
    h = legend_height(cols, pitch, len(entries))
    y0 = y1 - h
    P.line([(x0, y0), (x0 + w, y0), (x0 + w, y1), (x0, y1)], "C-ANNO-NOTE", 0.35, ST.BLACK, closed=True)
    P.text(x0 + 4.0, y1 - 3.0, title, 4.0, "TOP_LEFT", bold=True, layer="C-ANNO-NOTE")
    cw = (w - 8.0) / cols
    for i, (fn, label) in enumerate(entries):
        c, r = divmod(i, rows)
        x = x0 + 4.0 + c * cw
        y = y1 - 15.0 - r * pitch - SH / 2 + 3.0
        fn(v, x, y)
        for k, ln in enumerate(fonts.wrap(label, ST.TXT.BODY, cw - SW - 8.0)[:2]):
            P.text(x + SW + 3.0, y + 1.3 - k * 3.4, ln, ST.TXT.BODY, "MIDDLE_LEFT", layer="C-ANNO-NOTE")
    return y0


# Every drawn layer element (DISC-ELEM of the JCS scheme) is either keyed to the legend entry (swatch function) that shows it or listed with the reason it needs none.
# tests/test_planset_stage7.py checks the drawn layers of the real run against these two tables.
LEGEND_COVERS = {
    "SITE-BNDY": "_boundary", "SITE-BNDD": "_boundary", "SITE-ADJN": "_adjoining", "SITE-KERB": "_kerb", "SITE-ROAD": "_road", "SITE-XOVR": "_layover", "SITE-DRVW": "_driveway",
    "SITE-CONT": "_contour", "SITE-EART": "_cut", "SITE-STRM": "_flow", "SITE-DRVC": "_centreline", "SITE-ESCP": "_esc", "ANNO-CALL": "_callout", "ANNO-DIMS": "_dimension",
    "ANNO-NRTH": "_north", "ANNO-DATA": "_none", "ANNO-DETL": "_existing",
}
NO_LEGEND = {
    "ANNO-NOTE": "text and note boxes", "SITE-LOTS": "lot labels (text)", "FRAM-TABL": "revision and register tables", "FRAM-TTLB": "frame and title block",
}

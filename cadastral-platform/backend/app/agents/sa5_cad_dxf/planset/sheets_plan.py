"""Plan-type sheets sharing the site window: C100 existing, C101 proposed, C200 earthworks, C300 stormwater, C310 water/sewer."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from app.agents.sa5_cad_dxf.planset import draw as D
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import LegendEntry as LE
from app.agents.sa5_cad_dxf.planset.core import Sheet, View, pick_scale
from app.agents.sa5_cad_dxf.planset.data import DEM_NOTE, Site
from app.agents.sa5_cad_dxf.planset.titleblock import Proj, scale_bar

MAIN = (10.0, 10.0, 262.0, 287.0)
SIDE_X0, SIDE_X1 = 266.0, 332.0
KEY = (SIDE_X0, 233.0, SIDE_X1, 287.0)
EX_NOTE = "EXISTING CONTOURS: " + DEM_NOTE


@dataclass
class Ctx:
    site: Site
    proj: Proj
    scale: int
    centre: tuple[float, float]
    key_centre: tuple[float, float]
    key_scale: int


def plan_window(site: Site, vp_w: float = 252.0, vp_h: float = 277.0, margin_m: float = 10.0) -> tuple[int, tuple[float, float]]:
    base = [g for g in (site.footprint, site.drive_poly, site.crossover) if g is not None]
    wm = site.inp.window_m
    if site.big:
        ub = unary_union(base).bounds if base else site.lot.representative_point().buffer(30).bounds
        cx, cy = (ub[0] + ub[2]) / 2, (ub[1] + ub[3]) / 2
        w, h = max(ub[2] - ub[0] + 2 * margin_m, wm[0]), max(ub[3] - ub[1] + 2 * margin_m, wm[1])
        if site.inp.window_centre:
            cx, cy = site.inp.window_centre
    else:
        ub = unary_union([site.lot] + base).bounds
        cx, cy = (ub[0] + ub[2]) / 2, (ub[1] + ub[3]) / 2
        w, h = ub[2] - ub[0] + 2 * margin_m, ub[3] - ub[1] + 2 * margin_m
    sc = pick_scale(w, h, vp_w - 6, vp_h - 6)
    return sc, (cx, cy)


def key_window(site: Site, win: Polygon) -> tuple[int, tuple[float, float]]:
    ub = unary_union([site.lot, win]).bounds
    cx, cy = (ub[0] + ub[2]) / 2, (ub[1] + ub[3]) / 2
    w, h = max((ub[2] - ub[0]) * 1.15, 90), max((ub[3] - ub[1]) * 1.15, 90)
    return pick_scale(w, h, KEY[2] - KEY[0] - 6, KEY[3] - KEY[1] - 12), (cx, cy)


def _main(ctx: Ctx, name: str = "main") -> View:
    return View(name, MAIN, ctx.centre, ctx.scale, frame=True)


def key_plan(ctx: Ctx, main: View, sh: Sheet) -> View:
    s = ctx.site
    k = View("key", KEY, ctx.key_centre, ctx.key_scale, frame=True)
    sh.add(k)
    k.fill(s.lot, "C-PROP-BDY", (0.9, 0.96, 0.88), 1.0)
    for _l, p, _r in s.neighbours:
        k.geom(p, "C-PROP-ADJN", lw=0.1, color=(0.45, 0.45, 0.45))
    k.geom(s.lot, "C-PROP-BDY", lw=0.35)
    if s.footprint is not None:
        k.fill(s.footprint, "A-BLDG-SLAB", (0.1, 0.2, 0.7), 1.0)
    w = main.model_window()
    pts = [(w[0], w[1]), (w[2], w[1]), (w[2], w[3]), (w[0], w[3])]
    k.line(pts, "C-ANNO-WNDW", True, 0.5, anno=True)
    # label the window just above its top-left corner when there is room
    k.text(w[0], w[3], f"SITE WINDOW 1:{ctx.scale}", 1.9, "BOTTOM_LEFT", bold=True, color=D.RED, layer="C-ANNO-WNDW", halo=True)
    k.text_p(KEY[0] + 2, KEY[3] - 1.0, "KEY PLAN", 2.8, "TOP_LEFT", 0, True, layer="C-ANNO-NOTE", halo=True)
    k.text_p(KEY[0] + 2, KEY[1] + 1.2, f"1:{ctx.key_scale} @ A3  |  LOT {s.inp.lot.lotplan.replace('//', ' ').replace('/', ' ')}", 1.8, "BOTTOM_LEFT", 0, False, layer="C-ANNO-NOTE", halo=True)
    sh.add(View("p", KEY))      # placeholder keeps order simple
    sh.views.pop()
    return k


def side_notes(sh: Sheet, title: str, lines: list[str], warn: bool = False, y_top: float = 229.0, y_bot: float = 10.0) -> View:
    p = View("side", (0, 0, 420, 297))
    D.panel(p, SIDE_X0, y_bot, SIDE_X1, y_top, title, lines, 2.0, warn)
    sh.add(p)
    return p


def window_note(ctx: Ctx) -> str:
    s = ctx.site
    return (f"SITE WINDOW at 1:{ctx.scale} ({252e0 * ctx.scale / 1000:.0f} x {277e0 * ctx.scale / 1000:.0f} m) centred on the "
            + ("proposed structure" if s.big else "lot") + "; outlined on the key plan. MATCHLINE/WINDOW: the lot continues beyond the window edges."
            if s.big else f"WHOLE LOT shown at 1:{ctx.scale}.")


def aerial_credit(v: View, s: Site) -> None:
    txt = s.aerial_site.note if s.aerial_site else "AERIAL UNDERLAY NOT AVAILABLE (imagery provider not enabled or request failed)"
    v.text_p(MAIN[0] + 2, MAIN[1] + 1.4, txt, 1.8, "BOTTOM_LEFT", 0, False, color=(0.25, 0.25, 0.25), layer="C-ANNO-NOTE", halo=True)


def north_scale(v: View, ctx: Ctx) -> None:
    scale_bar(v, MAIN[0] + 4, MAIN[1] + 9, ctx.scale)


def base_legend(s: Site, aer: bool = True) -> list[LE]:
    lg = [LE("LOT BOUNDARY (CADASTRE; NOT A SURVEY)", "line", (0, 0.5, 0.1), 0.5, layer="C-PROP-BDY"),
          LE("ADJOINING LOT BOUNDARY", "line", (0.35, 0.35, 0.35), 0.13, layer="C-PROP-ADJN")]
    return lg


# ======================================================================================================== C100
def c100(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C100", "Existing site conditions plan", f"{s.inp.lot.lotplan}  |  1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(_main(ctx))
    D.aerial(v, s, 0.35)
    D.neighbours(v, s)
    D.contours(v, s, "ex")
    D.lot_boundary(v, s)
    D.road_names(v, s)
    D.spot_levels(v, s)
    D.services(v, s)
    nsv = len(s.inp.services)
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = base_legend(s) + [
        LE("EXISTING CONTOUR (INDICATIVE) MINOR", "line", (0.5, 0.5, 0.5), 0.13, "DASHED", layer="C-TOPO-EXST"),
        LE("EXISTING CONTOUR MAJOR (INDEX, RL LABELLED)", "line", (0.5, 0.5, 0.5), 0.28, "DASHED", layer="C-TOPO-EXST"),
        LE("DEM SPOT LEVEL (RL m AHD, 5 m posts)", "point", (0.5, 0.5, 0.5), layer="C-TOPO-SPOT"),
        LE("BOUNDARY CORNER (UNMARKED/UNVERIFIED)", "point", (0, 0.5, 0.1), layer="C-PROP-BDY"),
    ]
    lines = [window_note(ctx), ""]
    if s.tin is not None:
        lines += [f"EXISTING CONTOURS at {s.interval:g} m interval (major/index contours heavier and RL labelled), generated by marching triangles from the {s.tin_source}.",
                  EX_NOTE + ". Contours are smoothed for plotting only. Vertical accuracy is NOT STATED by the data service (placeholder 5 m used in quantities).",
                  "Contours extend only as far as the supplied levels cover." + (" The contour set here is SPARSE (<4 lines): the site is near-flat at 5 m DEM resolution. It must not be read as survey." if len(s.ex_cont) < 4 else "")]
    else:
        D.no_data(v, (MAIN[0] + 60, MAIN[3] - 45, MAIN[0] + 190, MAIN[3] - 5), "EXISTING CONTOURS: survey levels not supplied.", "Needed: detail survey (DWG/CSV) or run with --levels nsw.")
        sh.data_missing.append("existing contours / levels: survey or 5 m DEM levels")
    lines += ["BOUNDARY: bearings and distances from the NSW cadastre (Spatial Services). Verify against the registered plan / survey.",
              "ADJOINING LOTS labelled LOT / DP from the cadastre lot layer." + ("" if s.neighbours else " NO ADJOINING LOT DATA RETURNED."),
              "ROAD NAMES from the NSW roads layer; kerb, pavement and verge levels not surveyed.",
              "EASEMENTS: none identified in the supplied data. A title search / s88B instrument is required." if True else "",
              "EXISTING SERVICES: " + (f"{nsv} asset(s) supplied (BYDA/council) are drawn." if nsv else "EXISTING SERVICE LOCATION TO BE CONFIRMED FROM COUNCIL RECORDS / BYDA. None drawn (not invented)."),
              "TREES / VEGETATION: none supplied; see aerial for indicative canopy only."]
    if not s.neighbours:
        sh.data_missing.append("adjoining lots (cadastre query returned none)")
    if not nsv:
        sh.data_missing.append("existing services: BYDA / council records")
    if not s.aerial_site:
        sh.data_missing.append("aerial underlay (imagery provider disabled/failed)")
    side_notes(sh, "NOTES", lines)
    return sh


# ======================================================================================================== C101
def c101(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C101", "Proposed site plan", f"{s.dev_label} | 1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(_main(ctx))
    D.aerial(v, s, 0.6)
    D.neighbours(v, s, h=2.6)
    D.contours(v, s, "ex", labels=False)
    D.contours(v, s, "pr", labels=True)
    D.envelope(v, s)
    D.lot_boundary(v, s, bearings=True)
    D.road_names(v, s)
    if s.pad is not None:
        v.geom(s.pad, "C-EART-PADD", lw=0.2, dash="DASHED2", color=D.BLUE)
    D.drive(v, s)
    D.building(v, s)
    D.building_setbacks(v, s)
    D.services(v, s)
    if s.inp.rwt is not None:
        x, y = s.inp.rwt.location_xy
        v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", (0.6, 0.8, 1.0), 0.8)
        v.callout((x, y), [f"RWT {s.inp.rwt.tank_volume_l} L"], 2.2, layer="C-UTIL-RWTK")
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = base_legend(s) + [
        LE("BUILDING ENVELOPE (SETBACK LINE)", "line", (0.8, 0.1, 0.1), 0.3, layer="C-ZONE-ENVL"),
        LE("PROPOSED STRUCTURE (SEE LABEL)", "fill", D.BLUE, 0.5, fill=(0.78, 0.84, 1.0), layer="A-BLDG-SLAB"),
        LE("DRIVEWAY / CROSSOVER", "fill", (0, 0, 0), 0.3, fill=(0.8, 0.8, 0.8), layer="C-DRIV-XOVR"),
        LE("PAD / BATTER LIMIT (INDICATIVE)", "line", D.BLUE, 0.2, "DASHED2", layer="C-EART-PADD"),
        LE("PROPOSED CONTOUR (PAD + BATTERS)", "line", D.MAGENTA, 0.2, layer="C-TOPO-PROP"),
        LE("EXISTING CONTOUR (INDICATIVE)", "line", (0.5, 0.5, 0.5), 0.13, "DASHED", layer="C-TOPO-EXST"),
    ]
    lines = [window_note(ctx), ""]
    if s.footprint is None:
        D.no_data(v, (MAIN[0] + 50, MAIN[3] - 45, MAIN[0] + 200, MAIN[3] - 5), "PROPOSED STRUCTURE footprint not available.",
                  s.missing.get("footprint", ""))
        sh.data_missing.append("proposed structure footprint")
    else:
        lines.append(f"STRUCTURE: {s.fp_label}. Source: {s.fp_source}. " + ("Preset dimensions are editable drawing defaults, NOT compliance limits; position is illustrative (near the crossover, inside the envelope)." if s.fp_source == "SA6 PRESET" else ""))
        lines.append("FFL: " + (s.ffl_note if s.ffl is not None else "not set: no levels") + (f" (RL {s.ffl:.2f})" if s.ffl is not None else ""))
    if s.envelope is not None:
        lines.append("ENVELOPE: setbacks as entered/cited in the council DCP; unresolved items: " + (", ".join(s.inp.unresolved) or "none reported") + ". Verify with council.")
    else:
        sh.data_missing.append("building envelope (setback rules)")
    lines.append("DRIVEWAY: " + ("see C400/C410/C420." if s.drive_poly is not None else "NOT AVAILABLE (no driveway design)."))
    if s.pr_cont:
        lines.append(f"PROPOSED CONTOURS at {s.interval:g} m: pad level + batters (cut 1V:2H, fill 1V:3H assumed) over the {s.tin_source}; drawn only where the surface changes. " + EX_NOTE + ".")
    else:
        sh.data_missing.append("proposed contours (need survey levels and a structure)")
    lines.append("SERVICES: see C300 (stormwater) and C310 (water / sewer).")
    side_notes(sh, "NOTES", lines)
    return sh


# ======================================================================================================== C200
def c200(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C200", "Earthworks plan", f"Cut / fill, batters and volumes | 1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(_main(ctx))
    D.aerial(v, s, 0.75)
    D.neighbours(v, s, labels=True, h=2.4)
    cf = s.cutfill
    bands = []
    if cf is not None:
        from shapely import wkt as swkt
        for z in cf.zones:
            g = swkt.loads(z.wkt)
            d = z.max_depth_m
            a = 0.35 + 0.15 * min(3, [0.1, 0.5, 1.0, 2.0].index(next(b for b in (0.1, 0.5, 1.0, 2.0, 99) if z.min_depth_m < b + 1e-6 if True)) if False else 0)
            col = (0.85, 0.15, 0.1) if z.kind == "cut" else (0.1, 0.6, 0.2)
            ang = 45 if z.kind == "cut" else -45
            sp = {0.0: 3.2, 0.1: 2.4, 0.5: 1.7, 1.0: 1.2, 2.0: 0.9}.get(round(z.min_depth_m, 1), 1.5)
            v.fill(g, "C-EART-CUTT" if z.kind == "cut" else "C-EART-FILL", col, 0.8, (ang, sp))
    D.contours(v, s, "ex", labels=True)
    D.contours(v, s, "pr", labels=True)
    D.lot_boundary(v, s, bearings=False)
    if s.pad is not None:
        v.geom(s.pad, "C-EART-PADD", lw=0.3, color=D.BLUE)
    if cf is not None:
        from shapely import wkt as swkt
        cut_u = unary_union([swkt.loads(z.wkt) for z in cf.zones if z.kind == "cut"]) if any(z.kind == "cut" for z in cf.zones) else None
        fill_u = unary_union([swkt.loads(z.wkt) for z in cf.zones if z.kind == "fill"]) if any(z.kind == "fill" for z in cf.zones) else None
        for g, nm in ((cut_u, "TOP OF CUT BATTER"), (fill_u, "TOE OF FILL BATTER")):
            if g is not None and not g.is_empty:
                v.geom(g, "C-EART-BATR", lw=0.25)
                b = g.buffer(0).exterior if g.geom_type == "Polygon" else None
        if s.footprint is not None:
            c = s.footprint.centroid
            v.callout((c.x, c.y), ["PROPOSED PAD", f"FFL RL {s.ffl:.2f}"], 2.3, color=D.BLUE, layer="C-EART-PADD", prefer=[(14, 14), (-50, 14)])
    D.drive(v, s, label=False)
    if s.footprint is not None:
        v.geom(s.footprint, "A-BLDG-SLAB", lw=0.6, color=D.BLUE)
    # retaining walls
    w = s.walls
    nwalls = 0
    if w is not None:
        for seg in w.segments:
            if len(seg.alignment) >= 2:
                v.line(seg.alignment, "C-WALL-RETN", False, 0.8)
                m = seg.alignment[len(seg.alignment) // 2]
                v.callout(m, [f"RETAINING WALL ({seg.mode.upper()}) H max {seg.max_height_m:.2f} m", "screening only; engineer to design"], 2.0, layer="C-WALL-RETN")
                nwalls += 1
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = [LE("LOT BOUNDARY", "line", (0, 0.5, 0.1), 0.5, layer="C-PROP-BDY"),
                 LE("CUT (hatch spacing = depth band)", "fill", D.RED, 0.2, fill=(0.85, 0.15, 0.1), hatch=(45, 1.6), layer="C-EART-CUTT"),
                 LE("FILL (hatch spacing = depth band)", "fill", D.GREEN, 0.2, fill=(0.1, 0.6, 0.2), hatch=(-45, 1.6), layer="C-EART-FILL"),
                 LE("TOP OF CUT / TOE OF FILL (BATTER LIMIT)", "line", (0, 0, 0.8), 0.25, "DASHED2", layer="C-EART-BATR"),
                 LE("EXISTING CONTOUR (INDICATIVE)", "line", (0.5, 0.5, 0.5), 0.13, "DASHED", layer="C-TOPO-EXST"),
                 LE("PROPOSED CONTOUR", "line", D.MAGENTA, 0.2, layer="C-TOPO-PROP"),
                 LE("RETAINING WALL (SCREENING)", "line", (0, 0, 0.8), 0.8, layer="C-WALL-RETN"),
                 LE("PAD (BUILDING + 0.9 m APRON)", "line", D.BLUE, 0.3, layer="C-EART-PADD")]
    lines = [window_note(ctx), ""]
    if cf is None:
        D.no_data(v, (MAIN[0] + 50, MAIN[3] - 45, MAIN[0] + 200, MAIN[3] - 5), "EARTHWORKS: proposed surface not computed.",
                  "Needed: survey levels (--levels nsw / detail survey) and a proposed structure + FFL.")
        sh.data_missing.append("earthworks (levels and/or structure)")
    else:
        # volumes table in the side column
        rows = [("Pad level (FFL)", f"RL {cf.pad_level_m:.2f} m"), ("Cut (bank)", f"{cf.cut_volume_m3:,.1f} m3  over {cf.cut_area_m2:,.0f} m2"),
                ("Fill (compacted)", f"{cf.fill_volume_m3:,.1f} m3  over {cf.fill_area_m2:,.0f} m2"),
                ("Net (cut - fill)", f"{cf.net_volume_m3:+,.1f} m3  ({'export' if cf.net_volume_m3 > 0 else 'import'})"),
                ("Topsoil strip", f"{cf.topsoil_strip_m3:,.1f} m3  ({cf.topsoil_area_m2:,.0f} m2 x 0.15 m)"),
                ("Cut (loose, x%.2f)" % cf.bulking_factor, f"{cf.cut_loose_m3:,.1f} m3"),
                ("Fill (bank equiv.)", f"{cf.fill_bank_equivalent_m3:,.1f} m3  (shrinkage {cf.shrinkage_factor:.2f})"),
                ("Volume uncertainty", f"+/- {cf.volume_uncertainty_m3:,.0f} m3  ({cf.stated_uncertainty_pct:.0f} %)")]
        t = View("vol", (0, 0, 420, 297))
        x0, y1 = SIDE_X0, 229.0
        ytop = y1 - 56
        t.line([(x0, ytop), (SIDE_X1, ytop), (SIDE_X1, y1), (x0, y1)], "C-ANNO-TABL", True, 0.25)
        t.text(x0 + 2, y1 - 1.2, "EARTHWORKS VOLUMES (INDICATIVE)", 2.6, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
        yy = y1 - 6.5
        for l, r in rows:
            t.text(x0 + 2, yy, l, 2.0, "TOP_LEFT", layer="C-ANNO-TABL")
            for k, ln in enumerate(fonts.wrap(r, 2.0, SIDE_X1 - x0 - 27)):
                t.text(x0 + 25, yy - k * 2.6, ln, 2.0, "TOP_LEFT", bold=True, layer="C-ANNO-TABL")
            yy -= 5.4 if len(r) > 28 else 4.4
            t.line([(x0, yy + 1.3), (SIDE_X1, yy + 1.3)], "C-ANNO-TABL", False, 0.08)
        sh.add(t)
        lines = [f"Batters: cut 1V:{cf and 2:g}H, fill 1V:3H and 0.9 m pad apron are ASSUMED design parameters (geotechnical advice required).",
                 "Depth bands (hatch spacing): <0.1, 0.1-0.5, 0.5-1.0, 1.0-2.0, >2.0 m.",
                 "Volumes by prismoidal method on the 5 m DEM-derived TIN. " + DEM_NOTE + ". Vertical accuracy not stated by the service; quantities are NOT suitable for pricing or earthworks certification.",
                 (f"{nwalls} retaining wall segment(s) flagged by screening." if nwalls else "No retaining wall required at the assumed pad level and thresholds (screening, not design)."),
                 ] + [x for x in (s.inp.terrain.warnings if s.inp.terrain is not None else [])[:2]]
        side_notes(sh, "NOTES", lines, y_top=229 - 58)
        return sh
    side_notes(sh, "NOTES", lines)
    return sh


# ======================================================================================================== C300
def downslope(s: Site, p: tuple[float, float]) -> tuple[float, float] | None:
    if s.tin is None:
        return None
    eps = 2.5
    zx = (s.tin.z_at(p[0] + eps, p[1]) - s.tin.z_at(p[0] - eps, p[1])) / (2 * eps)
    zy = (s.tin.z_at(p[0], p[1] + eps) - s.tin.z_at(p[0], p[1] - eps)) / (2 * eps)
    if not (np.isfinite(zx) and np.isfinite(zy)):
        return None
    n = math.hypot(zx, zy)
    if n < 1e-4:
        return None
    return (-float(zx) / n, -float(zy) / n)


def paper_dir(v: View, d) -> tuple[float, float]:
    """A model-space direction as a paper-space direction: rotated by the view rotation (the same turn View.tp applies to a point)."""
    if v.paper:
        return float(d[0]), float(d[1])
    return d[0] * v._c - d[1] * v._s, d[0] * v._s + d[1] * v._c


def arrow(v: View, p, d, L_mm=7.0, layer="C-UTIL-FLOW", color=D.STORM, lw=0.25, dash=None) -> None:
    """Arrow from model point p along the model direction d, L_mm long ON PAPER.  The direction is rotated with the view, so a rotated plan shows the true fall."""
    px, py = v.tp(*p)
    dx, dy = paper_dir(v, d)
    qx, qy = px + dx * L_mm, py + dy * L_mm
    v.line([v.tm(px, py), v.tm(qx, qy)], layer, False, lw, dash, color, anno=True)
    nx, ny = -dy, dx
    v.line([v.tm(qx - dx * 1.8 + nx * 0.8, qy - dy * 1.8 + ny * 0.8), v.tm(qx, qy), v.tm(qx - dx * 1.8 - nx * 0.8, qy - dy * 1.8 - ny * 0.8)],
           layer, False, lw, None, color, anno=True)


def frontage_point(s: Site, p: Point) -> Point | None:
    fs = [LineString([g.start_xy, g.end_xy]) for g in s.inp.lot.segments if g.is_front or g.adjoins == "road"]
    if not fs:
        return None
    best = min(fs, key=lambda l: l.distance(p))
    q = best.interpolate(best.project(p))
    return q


def c300(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C300", "Stormwater drainage plan", f"Roof / surface drainage, discharge and overland flow | 1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(_main(ctx))
    D.aerial(v, s, 0.7)
    D.neighbours(v, s, labels=True, h=2.4)
    D.contours(v, s, "ex", labels=False)
    D.lot_boundary(v, s, bearings=False)
    D.road_names(v, s)
    D.drive(v, s, label=False)
    D.building(v, s, with_label=False)
    lines = [window_note(ctx), ""]
    st_exist = [x for x in s.inp.services if x.service == "stormwater"]
    D.services(v, s, "stormwater")
    fp = s.footprint
    if fp is None:
        D.no_data(v, (MAIN[0] + 50, MAIN[3] - 45, MAIN[0] + 200, MAIN[3] - 5), "STORMWATER: no proposed structure footprint.", "Roof catchment cannot be drawn.")
        sh.data_missing.append("stormwater (structure footprint)")
    else:
        c = fp.centroid
        dirn = downslope(s, (c.x, c.y))
        # roof downpipes: schematic, at the two lowest corners along the downslope direction (or the two nearest the frontage)
        corners = list(fp.minimum_rotated_rectangle.exterior.coords)[:4]
        key = (lambda p: p[0] * dirn[0] + p[1] * dirn[1]) if dirn else (lambda p: -Point(p).distance(frontage_point(s, Point(p)) or Point(p)))
        dps = sorted(corners, key=key, reverse=True)[:2]
        mid = ((dps[0][0] + dps[1][0]) / 2, (dps[0][1] + dps[1][1]) / 2)
        out = frontage_point(s, Point(mid))
        rural = s.rural
        for p in dps:
            q = (p[0] + (mid[0] - c.x) * 0.0, p[1])
            v.line([v.tp(*p)] if False else [p, p], "C-UTIL-STRM", False)    # no-op keeps symmetry
            px, py = v.tp(*p)
            paper_ok = v.inside(*p, 2)
            if paper_ok:
                D.paper_circle(v, px, py, 0.9, "C-UTIL-STRM", 0.3, D.STORM)
        v.line([dps[0], dps[1]], "C-UTIL-STRM", False, 0.35, "DASHED", D.STORM)
        v.callout(dps[0], ["DOWNPIPE (SCHEMATIC)", "roof drainage collection"], 2.0, color=D.STORM, layer="C-UTIL-STRM", prefer=[(-40, -10), (14, -14)])
        # discharge route
        if not rural and out is not None and out.distance(Point(mid)) < 120:
            pit = Point(mid[0] + (out.x - mid[0]) * 0.55, mid[1] + (out.y - mid[1]) * 0.55)
            v.line([mid, (pit.x, pit.y), (out.x, out.y)], "C-UTIL-STRM", False, 0.4, "DASHED", D.STORM)
            if v.inside(pit.x, pit.y, 2):
                px, py = v.tp(pit.x, pit.y)
                v.line([v.tm(px - 1.3, py - 1.3), v.tm(px + 1.3, py - 1.3), v.tm(px + 1.3, py + 1.3), v.tm(px - 1.3, py + 1.3)], "C-UTIL-STRM", True, 0.4, color=D.STORM, anno=True)
                v.callout((pit.x, pit.y), ["PIT P1 (SCHEMATIC)", "size / level by hydraulic designer"], 2.0, color=D.STORM, layer="C-UTIL-STRM")
            v.callout((out.x, out.y), ["DISCHARGE TO STREET (GUTTER / KERB INLET)", "point and method TO BE CONFIRMED with council"], 2.0, color=D.STORM, layer="C-UTIL-STRM",
                      prefer=[(10, 8), (-70, 8)])
            lines.append(f"DISCHARGE: roof water to the street gutter / nearest council kerb inlet ({out.distance(Point(mid)):.0f} m from the structure). Connection details per council standard drawings, TO BE CONFIRMED.")
        else:
            lines.append("DISCHARGE: rural / large lot: no street stormwater connection assumed. Dispersal, tank overflow or table-drain discharge to be designed and confirmed (disposal to be clear of buildings per cited rules where applicable).")
        if s.inp.rwt is not None:
            x, y = s.inp.rwt.location_xy
            v.fill(Point(x, y).buffer(s.inp.rwt.diameter_m / 2), "C-UTIL-RWTK", (0.6, 0.8, 1.0), 0.8)
            v.callout((x, y), [f"RWT {s.inp.rwt.tank_volume_l} L (overflow to drainage)"], 2.0, layer="C-UTIL-RWTK")
        else:
            lines.append("RAINWATER TANK: none supplied (BASIX / council requirement TO BE CONFIRMED); tank location not shown.")
        # overland flow arrows
        n = 0
        if s.tin is not None:
            w = v.model_window()
            gx = np.linspace(w[0] + 25 / v.k, w[2] - 25 / v.k, 7)
            gy = np.linspace(w[1] + 25 / v.k, w[3] - 25 / v.k, 8)
            for x in gx:
                for y in gy:
                    p = Point(x, y)
                    if not s.lot.contains(p) or (fp.buffer(1.5).contains(p)) or (s.drive_poly is not None and s.drive_poly.buffer(2).contains(p)):
                        continue
                    d = downslope(s, (x, y))
                    if d:
                        arrow(v, (x, y), d)
                        n += 1
            lines.append(f"OVERLAND FLOW: arrows show the downslope direction of the {s.tin_source} (INDICATIVE, 5 m posts). Flow paths, catchments and flood behaviour not modelled." if n else "OVERLAND FLOW: DATA NOT AVAILABLE: slope too flat / outside the levels extent.")
            if not n:
                sh.data_missing.append("overland flow arrows (levels)")
        else:
            D.no_data(v, (MAIN[0] + 4, MAIN[3] - 40, MAIN[0] + 120, MAIN[3] - 5), "OVERLAND FLOW: survey levels not supplied.", "Needed: survey or 5 m DEM levels.")
            sh.data_missing.append("overland flow (levels)")
    c = s.cites
    for k in ("stormwater.designed_per_eng_standards", "stormwater.farm_building_disposal_clear_of_buildings_m", "stormwater.osd_roof_plumbing_design_aep_pct"):
        t = c.line(k)
        if t:
            lines.append("CITED: " + t)
    lines.append("All drainage shown is SCHEMATIC. Pipe sizes, grades, invert levels, pit types and OSD/detention (if required) by a hydraulic designer.")
    if st_exist:
        lines.append(f"{len(st_exist)} existing stormwater asset(s) supplied are drawn.")
    else:
        lines.append("EXISTING COUNCIL STORMWATER ASSETS: not supplied; to be confirmed from council records / BYDA.")
        sh.data_missing.append("existing stormwater assets: council records / BYDA")
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = base_legend(s) + [
        LE("PROPOSED DRAINAGE LINE (SCHEMATIC)", "line", D.STORM, 0.4, "DASHED", layer="C-UTIL-STRM"),
        LE("DOWNPIPE / PIT (SCHEMATIC)", "point", D.STORM, layer="C-UTIL-STRM"),
        LE("OVERLAND FLOW DIRECTION (INDICATIVE)", "line", D.STORM, 0.25, layer="C-UTIL-FLOW"),
        LE("PROPOSED STRUCTURE", "fill", D.BLUE, 0.5, fill=(0.78, 0.84, 1.0), layer="A-BLDG-SLAB"),
        LE("DRIVEWAY / CROSSOVER", "fill", (0, 0, 0), 0.3, fill=(0.8, 0.8, 0.8), layer="C-DRIV-XOVR")]
    side_notes(sh, "NOTES", lines)
    return sh


# ======================================================================================================== C310
def c310(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C310", "Water and sewer services plan", f"Proposed connections (schematic) | 1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(_main(ctx))
    D.aerial(v, s, 0.7)
    D.neighbours(v, s, labels=True, h=2.4)
    D.lot_boundary(v, s, bearings=False)
    D.road_names(v, s)
    D.drive(v, s, label=False)
    D.building(v, s, with_label=False)
    lines = [window_note(ctx), ""]
    ex_w = [x for x in s.inp.services if x.service in ("water", "sewer") and not x.is_proposed]
    D.services(v, s, "water")
    D.services(v, s, "sewer")
    shed = s.dev == "shed"
    fp = s.footprint
    if shed:
        lines.append("NO WATER OR SEWER CONNECTION PROPOSED: Class 10a shed (as modelled by SA4). Any amenities / tap require a separate design.")
    elif fp is None:
        D.no_data(v, (MAIN[0] + 50, MAIN[3] - 45, MAIN[0] + 200, MAIN[3] - 5), "SERVICES: no proposed structure footprint.", "Connections cannot be drawn.")
        sh.data_missing.append("water / sewer connections (structure footprint)")
    else:
        near = frontage_point(s, fp.centroid)
        dist = near.distance(fp) if near is not None else None
        if near is not None and dist is not None and dist <= 60 and not s.rural:
            # service entry at the structure corner nearest the frontage; schematic runs to the frontage (road side of the boundary)
            corners = list(fp.exterior.coords)[:-1]
            ce = min(corners, key=lambda p: Point(p).distance(near))
            dxn, dyn = near.x - ce[0], near.y - ce[1]
            L = math.hypot(dxn, dyn) or 1.0
            ux, uy = -dyn / L, dxn / L
            wpt = (ce[0] + ux * 1.0, ce[1] + uy * 1.0)
            spt = (ce[0] - ux * 1.0, ce[1] - uy * 1.0)
            wend = frontage_point(s, Point(wpt))
            send = frontage_point(s, Point(spt))
            v.line([wpt, (wend.x, wend.y)], "C-UTIL-WATR", False, 0.5, "DASHED", D.WATER)
            v.line([spt, (send.x, send.y)], "C-UTIL-SEWR", False, 0.5, "DASHED", D.SEWER)
            v.callout((wend.x, wend.y), ["WATER SERVICE (SCHEMATIC)", "to council main: location and size TO BE CONFIRMED"], 2.0, color=D.WATER, layer="C-UTIL-WATR", prefer=[(12, 10), (-75, 10)])
            v.callout((send.x, send.y), ["SEWER HOUSE CONNECTION (SCHEMATIC)", "to junction: location TO BE CONFIRMED"], 2.0, color=D.SEWER, layer="C-UTIL-SEWR", prefer=[(12, -22), (-75, -22)])
            lines.append("SCHEMATIC CONNECTIONS run from the structure to the nearest frontage only to show intent. They are NOT located assets.")
        else:
            D.no_data(v, (MAIN[0] + 4, MAIN[3] - 52, MAIN[0] + 135, MAIN[3] - 5), "WATER / SEWER CONNECTIONS NOT DRAWN.",
                      (f"Nearest frontage is {dist:.0f} m from the structure (rural / large lot); " if dist is not None else "No frontage identified; ") +
                      "availability of reticulated water / sewer is unknown. Needed: council water & sewer records / BYDA and a servicing decision (reticulated, tank, on-site sewage management).")
            sh.data_missing.append("water / sewer connection points (council records / BYDA; servicing strategy)")
    if ex_w:
        lines.append(f"{len(ex_w)} existing water/sewer asset(s) supplied are drawn.")
    else:
        v.text_p(MAIN[0] + 4, MAIN[3] - 5, "EXISTING SERVICE LOCATION TO BE CONFIRMED FROM COUNCIL RECORDS / BYDA", 3.0, "TOP_LEFT", 0, True, color=D.RED, layer="C-DATA-NONE", halo=True)
        lines.append("EXISTING WATER MAIN, SEWER MAIN AND JUNCTION: location not supplied. EXISTING SERVICE LOCATION TO BE CONFIRMED FROM COUNCIL RECORDS / BYDA. Nothing is drawn or assumed.")
        sh.data_missing.append("existing water / sewer assets: BYDA / council records")
    c = s.cites
    for k, lab in (("water.min_cover_m", "Water min cover (carriageway)"), ("water.min_cover_m.footway_reserve", "Water min cover (footway)"),
                   ("sewer.junction_min_diameter_mm", "Sewer junction"), ("sewer.house_connection_min_cover_m", "House connection cover"),
                   ("sewer.house_connection_min_grade_1_in", "House connection grade (1 in N)"), ("util.build_over_sewer_policy", "Build over sewer")):
        t = c.line(k, lab)
        if t:
            lines.append("CITED: " + t)
    lines.append("Services are indicative. Locate all services by BYDA and physical location (potholing) before excavation.")
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = base_legend(s) + [
        LE("PROPOSED WATER SERVICE (SCHEMATIC)", "line", D.WATER, 0.5, "DASHED", layer="C-UTIL-WATR"),
        LE("PROPOSED SEWER CONNECTION (SCHEMATIC)", "line", D.SEWER, 0.5, "DASHED", layer="C-UTIL-SEWR"),
        LE("EXISTING SERVICES (BYDA): NONE SUPPLIED", "line", (0.5, 0.5, 0.5), 0.25, layer="C-UTIL-OTHR"),
        LE("PROPOSED STRUCTURE", "fill", D.BLUE, 0.5, fill=(0.78, 0.84, 1.0), layer="A-BLDG-SLAB")]
    side_notes(sh, "NOTES", lines)
    return sh

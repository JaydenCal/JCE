"""C000 cover, C400/C410/C420 driveway + crossover, C500 ESC, C600 details, C700 notes."""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from app.agents.sa5_cad_dxf.planset import draw as D
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import LegendEntry as LE
from app.agents.sa5_cad_dxf.planset.core import Sheet, View, pick_scale
from app.agents.sa5_cad_dxf.planset.data import DEM_NOTE
from app.agents.sa5_cad_dxf.planset.sheets_plan import (Ctx, MAIN, SIDE_X0, SIDE_X1, aerial_credit, base_legend, key_plan, north_scale, side_notes, window_note)
from app.agents.sa5_cad_dxf.planset.titleblock import AREA, scale_bar

DISCL = ("Indicative only. Not a survey. Verify BYDA plans and physically locate services before excavation. Verify setbacks with council. "
         "All items marked TO BE CONFIRMED require designer / council confirmation.")


def _drv_window(ctx: Ctx, vw=252.0, vh=277.0):
    s = ctx.site
    g = [x for x in (s.drive_poly, s.crossover) if x is not None]
    if not g:
        return None
    ub = unary_union(g).bounds
    w, h = max(ub[2] - ub[0] + 16, 30), max(ub[3] - ub[1] + 16, 30)
    return pick_scale(w, h, vw - 8, vh - 8), ((ub[0] + ub[2]) / 2, (ub[1] + ub[3]) / 2)


# ================================================================ C400
def c400(ctx: Ctx) -> Sheet:
    s = ctx.site
    w = _drv_window(ctx)
    sc, ce = w if w else (200, ctx.centre)
    sh = Sheet("C400", "Driveway and crossover plan", f"B85 swept path / turning circle | 1:{sc} @ A3", scale_text=f"1:{sc}")
    v = sh.add(View("main", (10, 10, 332, 287), ce, sc, frame=True)) if False else sh.add(View("main", MAIN, ce, sc, frame=True))
    D.aerial(v, s, 0.7) if False else None
    D.neighbours(v, s, h=2.4)
    D.lot_boundary(v, s, bearings=False)
    D.road_names(v, s)
    lines = []
    if s.drive_poly is None:
        D.no_data(v, (MAIN[0] + 4, MAIN[3] - 40, MAIN[0] + 140, MAIN[3] - 5), "DRIVEWAY: no driveway design available.", "Needed: SA3 driveway result (kerb to garage).")
        sh.data_missing.append("driveway design")
    else:
        D.drive(v, s, label=False)
        D.building(v, s, with_label=False)
        if s.turn_path is not None:
            v.geom(s.turn_path, "C-DRIV-TURN", lw=0.25)
        drv = s.inp.driveway
        if drv.turning_circle_centre_xy and drv.turning_circle_radius_m:
            cx, cy = drv.turning_circle_centre_xy
            v.geom(Point(cx, cy).buffer(drv.turning_circle_radius_m, 48).exterior, "C-DRIV-TURN", lw=0.25)
            v.label(cx, cy, f"R{drv.turning_circle_radius_m:.2f} m", 2.4, 0, layer="C-DRIV-TURN")
        L = s.drive_cl.length
        step = 5.0 if L > 12 else 2.0
        for i in range(int(L / step) + 1):
            d = i * step
            p, q = s.drive_cl.interpolate(d), s.drive_cl.interpolate(min(L, d + 0.2))
            a = math.atan2(q.y - p.y, q.x - p.x)
            nx, ny = -math.sin(a), math.cos(a)
            h = 1.6 / v.k
            v.line([(p.x - nx * h, p.y - ny * h), (p.x + nx * h, p.y + ny * h)], "C-DRIV-CNTR", False, 0.25, "CONTINUOUS", anno=False)
            v.label(p.x + nx * 3.2 / v.k, p.y + ny * 3.2 / v.k, f"CH {d:g}", 1.9, math.degrees(a) + 90, layer="C-ANNO-DIMS", nudges=False)
        for lab, p1, p2 in drv.dimensions:
            v.dim(tuple(p1), tuple(p2), f"{lab} {math.dist(p1, p2):.2f} m" if not any(ch.isdigit() for ch in lab) else lab, side=(0, 1), off_mm=5)
        lines += [f"Design vehicle {drv.design_vehicle}; swept path and turning circle from SA3 (indicative; verify against AS/NZS 2890.1).",
                  f"Driveway width {drv.width_m:.1f} m." + (f" Max grade {drv.max_grade_pct:.1f} %." if drv.max_grade_pct else "")]
        c = s.cites
        wmin, wmax = c.get("driveway.min_width_m"), c.get("driveway.max_width_m")
        if wmin and wmax:
            ok = wmin.value - 1e-6 <= drv.width_m <= wmax.value + 1e-6
            lines.append(f"CITED width of access (excl. layback splays) {wmin.value:g}-{wmax.value:g} m [{wmin.ref}]: design {drv.width_m:.1f} m = {'within range' if ok else 'OUTSIDE range'} (screening).")
        for k in ("driveway.min_separation_from_common_boundary_m", "driveway.min_crossing_kerb_separation_m", "driveway.min_separation_m", "access.crossing_standard"):
            t = c.line(k)
            if t:
                lines.append("CITED: " + t)
        if s.crossover is not None:
            sides = [LineString([g.start_xy, g.end_xy]) for g in s.inp.lot.segments if not g.is_front and g.adjoins != "road"]
            if sides:
                dmin = min(s.crossover.distance(x) for x in sides)
                lines.append(f"Crossover to nearest side boundary: {dmin:.2f} m (cited minimum to common boundary 0.5 m: {'OK' if dmin >= 0.5 else 'CHECK'}; screening).")
        for ch in s.inp.driveway_checks[:6]:
            lines.append(f"CHECK {ch.name}: {'PASS' if ch.passed else ('FAIL' if ch.passed is False else 'NOT EVALUATED')}{'' if ch.value is None else f' ({ch.value} {ch.unit})'}")
    north_scale(v, Ctx(s, ctx.proj, sc, ce, ce, 1000))
    sh.legend = [LE("LOT BOUNDARY", "line", (0, 0.5, 0.1), 0.5, layer="C-PROP-BDY"), LE("DRIVEWAY / CROSSOVER", "fill", (0, 0, 0), 0.3, fill=(0.8, 0.8, 0.8), layer="C-DRIV-XOVR"),
                 LE("DRIVEWAY CENTRELINE + CHAINAGE TICKS", "line", (0.4, 0, 0.6), 0.13, "CENTER", layer="C-DRIV-CNTR"),
                 LE("B85 TURNING PATH / CIRCLE", "line", (0.9, 0.45, 0), 0.25, "DASHDOT", layer="C-DRIV-TURN"), LE("PROPOSED STRUCTURE", "fill", D.BLUE, 0.5, fill=(0.78, 0.84, 1.0), layer="A-BLDG-SLAB")]
    lines.append("Longitudinal section: C410. Crossover details: C420. " + DISCL)
    side_notes(sh, "NOTES", lines, y_top=287)
    return sh


# ================================================================ C410
def profile(ctx: Ctx):
    s = ctx.site
    if s.drive_cl is None or s.tin is None or s.ffl is None:
        return None
    cl = s.drive_cl
    L = cl.length
    c = list(cl.coords)
    a = math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0])
    sb = None
    for g in s.inp.lot.segments:
        h = cl.intersection(LineString([g.start_xy, g.end_xy]))
        if h.geom_type == "Point" and (g.is_front or sb is None):
            sb = cl.project(h)
    sb = sb if sb is not None else 0.0
    xy = lambda t: (c[0][0] + math.cos(a) * t, c[0][1] + math.sin(a) * t) if t < 0 else (cl.interpolate(min(t, L)).x, cl.interpolate(min(t, L)).y)  # noqa: E731
    ts = [-0.45] + [i * 0.5 for i in range(int(L / 0.5) + 1)] + [L]
    ex = []
    for t in ts:
        z = float(s.tin.z_at(*xy(t)))
        if np.isfinite(z):
            ex.append((t, z))
    if len(ex) < 3:
        return None
    zb = float(np.interp(sb, [e[0] for e in ex], [e[1] for e in ex]))
    st = [(-0.45, ex[0][1], "gutter"), (0.0, float(np.interp(0, [e[0] for e in ex], [e[1] for e in ex])), "kerb"), (sb, zb, "boundary"), (L, s.ffl, "garage")]
    st = sorted({x[0]: x for x in st}.values())
    from app.agents.sa3_driveway.profile import check_profile
    return {"ex": ex, "st": st, "L": L, "sb": sb, "checks": check_profile(st)}


def c410(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C410", "Driveway longitudinal section", "Existing vs proposed levels along the centreline (screening only)", north=None)
    v = sh.add(View("chart", (10, 10, 332, 287), frame=True))
    p = profile(ctx)
    if p is None:
        D.no_data(v, (20, 200, 320, 280), "LONGITUDINAL SECTION NOT DRAWN.", "Needed: driveway design, survey/DEM levels along the centreline and a proposed FFL / garage threshold level.")
        sh.data_missing.append("driveway long section (levels, driveway, FFL)")
        sh.legend = []
        return sh
    ex, st, L = p["ex"], p["st"], p["L"]
    zs = [e[1] for e in ex] + [x[1] for x in st]
    zmin, zmax = min(zs) - 0.3, max(zs) + 0.3
    hs = pick_scale(L + 4, 1, 290, 1)
    vs = hs
    for k in (1, 2, 5, 10, 20):
        vs = hs / k
        if (zmax - zmin) * 1000 / vs <= 105:
            break
    X0, Y0 = 28.0, 100.0
    hx = lambda t: X0 + (t + 1) * 1000 / hs  # noqa: E731
    zy = lambda z: Y0 + (z - zmin) * 1000 / vs  # noqa: E731
    v.line([(X0 - 4, Y0 - 12), (hx(L) + 4, Y0 - 12)], "C-DRIV-LONG", False, 0.25)
    z0 = math.floor(zmin * 2) / 2
    n = 0
    z = z0
    while z <= zmax + 1e-6:
        if zy(z) >= Y0 - 12:
            v.line([(X0 - 4, zy(z)), (hx(L) + 4, zy(z))], "C-DRIV-LONG", False, 0.05, color=(0.8, 0.8, 0.8))
            v.text(X0 - 5, zy(z), f"{z:.1f}", 2.0, "MIDDLE_RIGHT", layer="C-DRIV-LONG")
        z += 0.5 if (zmax - zmin) < 6 else 1.0
    for i in range(int(L) + 2):
        yy = Y0 - 12
        v.line([(hx(i), yy), (hx(i), yy - (2 if i % 5 == 0 else 1))], "C-DRIV-LONG", False, 0.18)
        if i % 5 == 0:
            v.text(hx(i), yy - 3, f"{i}", 2.0, "TOP_CENTER", layer="C-DRIV-LONG")
    v.text(X0 - 4, Y0 - 20, "CHAINAGE (m) FROM CENTRELINE START (KERB / ROAD EDGE)", 2.2, "TOP_LEFT", bold=True, layer="C-DRIV-LONG")
    v.line([(hx(t), zy(z)) for t, z in ex], "C-DRIV-EXGD", False, 0.3)
    v.line([(hx(t), zy(z)) for t, _z, _n in st for z in [_z]], "C-DRIV-LONG", False, 0.6, color=(0.8, 0, 0))
    v.text(hx(0.2), zy(ex[0][1]) + 5, "EXISTING GROUND (INDICATIVE, DEM)", 2.2, "BOTTOM_LEFT", layer="C-DRIV-EXGD", color=(0.4, 0.4, 0.4))
    for t, z, nm in st:
        v.line([(hx(t), Y0 - 12), (hx(t), zy(z) + 3)], "C-DRIV-LONG", False, 0.13, "DASHED")
        v.text(hx(t), zy(z) + 4, f"{nm.upper()}  RL {z:.2f}", 2.0, "BOTTOM_LEFT", 90.0 if False else 0.0, layer="C-DRIV-LONG", halo=True)
    for (t0, z0_, n0), (t1, z1, n1) in zip(st, st[1:]):
        g = 100 * (z1 - z0_) / (t1 - t0)
        mx, my = hx((t0 + t1) / 2), (zy(z0_) + zy(z1)) / 2
        v.text(mx, my - 6, f"{g:+.1f} %  ({'1:%.0f' % (100 / abs(g)) if abs(g) > 0.05 else 'LEVEL'})  L={t1 - t0:.2f} m", 2.2, "TOP_CENTER", layer="C-DRIV-LONG", halo=True)
    rows = [("Chainage", [t for t, _z, _n in st]), ("Proposed RL", [z for _t, z, _n in st])]
    ty = Y0 - 36
    v.line([(X0 - 4, ty + 6), (hx(L) + 4, ty + 6), (hx(L) + 4, ty - 8), (X0 - 4, ty - 8)], "C-ANNO-TABL", True, 0.2)
    for lab, vals in rows:
        v.text(X0 - 3, ty, lab, 2.0, "MIDDLE_LEFT", bold=True, layer="C-ANNO-TABL")
        for t, val in zip([x[0] for x in st], vals):
            v.text(hx(t), ty, f"{val:.2f}", 2.0, "MIDDLE_CENTER", layer="C-ANNO-TABL")
        ty -= 6
    v.text(X0, 275, f"HORIZONTAL 1:{hs}   VERTICAL 1:{int(vs)}" + (f" ({hs / vs:g}x exaggeration)" if hs != vs else ""), 3.2, "TOP_LEFT", bold=True, layer="C-DRIV-LONG")
    sh.scale_text = f"H 1:{hs} V 1:{int(vs)}"
    lines = ["Proposed levels: gutter, kerb and boundary taken at existing ground (no verge regrading assumed); garage threshold at FFL (" + ("illustrative" if "ILLUSTRATIVE" in s.ffl_note else "design") + f" RL {s.ffl:.2f}). Existing ground " + DEM_NOTE + "."]
    for ch in p["checks"]:
        lines.append(f"{ch.name}: {'PASS' if ch.passed else ('FAIL' if ch.passed is False else 'NOT EVALUATED')}" + ("" if ch.value is None else f" value {ch.value} {ch.unit}") + (f" (limit {ch.limit})" if ch.limit is not None else "") + f". {ch.note}")
    lines.append("B85 SCRAPING / GROUND CLEARANCE: SCREENING ONLY (AS/NZS 2890.1 template method, unverified); not certification. Transitions/vertical curves shown in check notes are minimum lengths to be detailed by the designer.")
    dv = View("notes", (0, 0, 420, 297))
    D.panel(dv, 20, 14, 322, 62, "CHECKS AND NOTES", lines, 2.0)
    sh.add(dv)
    sh.legend = []
    return sh


# ================================================================ C420
def c420(ctx: Ctx) -> Sheet:
    s = ctx.site
    w = _drv_window(ctx)
    sc = 100
    ce = w[1] if w else ctx.centre
    sh = Sheet("C420", "Crossover details", "Plan and section (council standard drawing governs)", scale_text="1:100 / NTS")
    v = sh.add(View("xplan", (10, 150, 332, 287), ce, sc, frame=True))
    D.neighbours(v, s, labels=False)
    D.lot_boundary(v, s, bearings=False, corners=False)
    drv = s.inp.driveway
    lines = []
    if drv is None or s.crossover is None:
        D.no_data(v, (14, 230, 200, 283), "CROSSOVER: no driveway/crossover design.", "Needed: SA3 driveway result.")
        sh.data_missing.append("crossover geometry")
    else:
        D.drive(v, s, label=False)
        mrr = list(s.crossover.minimum_rotated_rectangle.exterior.coords)[:4]
        e = sorted([(math.dist(mrr[i], mrr[(i + 1) % 4]), mrr[i], mrr[(i + 1) % 4]) for i in range(4)])
        v.dim(e[0][1], e[0][2], f"CROSSOVER WIDTH {e[0][0]:.2f} m", side=(0, -1), off_mm=6)
        v.dim(e[-1][1], e[-1][2], f"{e[-1][0]:.2f} m", side=(1, 0), off_mm=6)
        v.text_p(14, 282, "CROSSOVER PLAN (1:100)", 3.2, "TOP_LEFT", 0, True)
        v.text_p(14, 277, f"Kerb return / splay: {'%.1f m' % drv_splay(s) if drv_splay(s) else 'per council standard drawing, to be confirmed'}", 2.2, "TOP_LEFT")
    sec = View("xsec", (10, 10, 332, 148), frame=True)
    sh.add(sec)
    sec.text(14, 143, "TYPICAL CROSSING SECTION (NOT TO SCALE): typical, to be confirmed by designer", 3.0, "TOP_LEFT", bold=True)
    X, Y = 40.0, 70.0
    sec.line([(X, Y), (X + 40, Y), (X + 40, Y + 4), (X + 44, Y + 4), (X + 44, Y), (X + 150, Y)], "C-DETL-LINE", False, 0.5)
    sec.line([(X + 44, Y - 6), (X + 150, Y - 6)], "C-DETL-LINE", False, 0.25, "DASHED")
    sec.line([(X + 44, Y), (X + 44, Y - 6)], "C-DETL-LINE", False, 0.25)
    for t, x, y in (("ROAD PAVEMENT", X + 15, Y - 4), ("KERB AND GUTTER / LAYBACK OR DISH CROSSING per council standard drawing", X + 40, Y + 12),
                    ("DRIVEWAY PAVEMENT: thickness / concrete grade per Council standard drawing, to be confirmed", X + 100, Y + 6), ("SUBGRADE / BASE: per Council standard drawing, to be confirmed", X + 100, Y - 10)):
        sec.text(x, y, t, 2.2, "BOTTOM_CENTER" if y > Y else "TOP_CENTER", layer="C-DETL-LINE")
    sec.text(X + 100, Y - 24, "CROSSING WIDTH (excl. splays): see plan above", 2.2, "TOP_CENTER")
    c = s.cites
    for k in ("access.crossing_standard", "driveway.min_width_m", "driveway.max_width_m", "driveway.min_crossing_kerb_separation_m", "driveway.min_separation_from_common_boundary_m",
              "driveway.min_separation_m", "driveway.max_crossings_per_frontage", "driveway.min_culvert_diameter_mm.rural", "driveway.min_culvert_width_m"):
        t = c.line(k)
        if t and (s.rural or "culvert" not in k):
            lines.append("CITED: " + t)
    lines.append("PAVEMENT THICKNESS, REINFORCEMENT AND CONCRETE SPECIFICATION: no value cited in the council requirements supplied. Per Council standard drawing, to be confirmed.")
    lines.append("CROSSING TYPE (layback / dish / rural entrance with culvert): per Council standard access drawing (DCP C.1.4), to be confirmed with Council.")
    dv = View("n", (0, 0, 420, 297))
    D.panel(dv, 130, 14, 328, 112, "NOTES (CITED STANDARDS)", lines, 2.1)
    sh.add(dv)
    sh.north = 0.0
    sh.legend = [LE("LOT BOUNDARY", "line", (0, 0.5, 0.1), 0.5, layer="C-PROP-BDY"), LE("DRIVEWAY / CROSSOVER", "fill", (0, 0, 0), 0.3, fill=(0.8, 0.8, 0.8), layer="C-DRIV-XOVR")]
    return sh


def drv_splay(s):
    return s.inp.driveway.__dict__.get("kerb_return_splay_m") if s.inp.driveway else None


# ================================================================ C500
def c500(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C500", "Erosion and sediment control plan", f"ESCP | 1:{ctx.scale} @ A3", scale_text=f"1:{ctx.scale}")
    v = sh.add(View("main", MAIN, ctx.centre, ctx.scale, frame=True))
    D.aerial(v, s, 0.6)
    D.neighbours(v, s, labels=True, h=2.4)
    D.lot_boundary(v, s, bearings=False)
    D.drive(v, s, label=False)
    D.building(v, s, with_label=False)
    D.road_names(v, s)
    out = s.esc
    lines = [window_note(ctx), ""]
    leg = []
    if out is None:
        D.no_data(v, (MAIN[0] + 4, MAIN[3] - 52, MAIN[0] + 150, MAIN[3] - 5), "ESCP DATA PENDING.",
                  "The SA10 erosion and sediment control layout was not available in this run; the ESCP follows. Base plan shown for the layout to be placed on. " + "Cited controls will be drawn when SA10 output is supplied.")
        sh.data_missing.append("ESCP layout (SA10 output)")
        lines.append("ESCP DATA PENDING: sediment fence, stabilised access, stockpile, washout and inlet protection to be placed by SA10 and reviewed by a suitably qualified person" + " (cited: " + (s.cites.line("esc.escp.prepared_by_suitably_qualified_person") or "ESC Guidelines") + ").")
    else:
        from shapely import wkt as swkt
        seen = {}
        for el in out.elements:
            g = swkt.loads(el.geometry_wkt)
            v.geom(g, el.layer, lw=0.4)
            if g.geom_type in ("Polygon", "MultiPolygon"):
                v.fill(g, el.layer, (0.4, 0.7, 0.4), 0.35)
            c = g.representative_point()
            v.label(c.x, c.y, el.label.upper()[:40], 2.0, 0, layer=el.layer, halo=True)
            seen.setdefault(el.kind, el.label)
        leg = [LE(f"{k.upper()}: {l[:28]}", "line", (0, 0.5, 0.2), 0.4, layer="C-ESCP-GENL") for k, l in list(seen.items())[:8]]
        lines += [f"Elements from SA10: {len(out.elements)}.", *[a for a in out.assumptions[:3]], *[w for w in out.warnings[:3]], "Review and certification by a suitably qualified person required."]
        for u in out.unresolved[:3]:
            lines.append("UNRESOLVED: " + str(u.get("prompt", u))[:120])
    north_scale(v, ctx)
    aerial_credit(v, s)
    key_plan(ctx, v, sh)
    sh.legend = base_legend(s) + leg
    side_notes(sh, "NOTES", lines)
    return sh


# ================================================================ C600
def c600(ctx: Ctx) -> Sheet:
    s = ctx.site
    sh = Sheet("C600", "Typical sections and details", "Typical, to be confirmed by designer", scale_text="NTS", north=None)
    v = sh.add(View("d", (10, 10, 332, 287), frame=True))
    c = s.cites
    L = "C-DETL-LINE"
    # 1 sediment fence
    X, Y = 30.0, 200.0
    v.text(X - 10, 282, "1  SEDIMENT FENCE (TYPICAL, NTS)", 3.4, "TOP_LEFT", bold=True)
    v.line([(X, Y), (X + 100, Y)], L, False, 0.5)
    for i in range(3):
        px = X + 15 + i * 35
        v.line([(px, Y - 8), (px, Y + 28)], L, False, 0.6)
    v.line([(X + 15, Y + 26), (X + 85, Y + 26), (X + 85, Y - 6), (X + 15, Y - 6)], L, False, 0.3, "DASHED")
    v.text(X + 50, Y + 33, "STAR PICKETS / GEOTEXTILE FABRIC (typical)", 2.2, "BOTTOM_CENTER")
    t = [c.line("esc.sediment_fence.post_spacing_m", "Post spacing"), c.line("esc.sediment_fence.trench_depth_mm", "Trench depth (upslope)"),
         c.line("esc.sediment_fence.return_interval_m", "Returns"), c.line("esc.sediment_fence.joint_overlap_mm", "Joint overlap")]
    D.panel(v, 20, 120, 160, 182, "SEDIMENT FENCE: CITED VALUES", [x for x in t if x] or ["No cited values available."], 2.0)
    # 2 trench
    X2 = 200.0
    v.text(X2 - 10, 282, "2  PIPE TRENCH AND BEDDING (SCHEMATIC, NTS)", 3.4, "TOP_LEFT", bold=True)
    v.line([(X2, 200), (X2 + 30, 200), (X2 + 30, 235), (X2 + 90, 235), (X2 + 90, 200), (X2 + 120, 200)], L, False, 0.4)
    v.line([(X2 + 30, 200), (X2 + 90, 200)], L, False, 0.3)
    for t_, x, y, a in (("BACKFILL (per standard)", X2 + 60, 220, "MIDDLE_CENTER"), ("BEDDING / HAUNCH / OVERLAY: type and thickness per AS/NZS 3500 and council / WSAA standard drawing, to be confirmed", X2 + 60, 180, "TOP_CENTER"),
                        ("COVER: see cited minimum", X2 + 60, 242, "BOTTOM_CENTER")):
        for k, ln in enumerate(fonts.wrap(t_, 2.1, 70)):
            v.text(x, y - k * 2.9 if a.startswith("TOP") else y, ln, 2.1, a)
    D.panel(v, 190, 120, 322, 168, "TRENCH: CITED MINIMUMS", [x for x in (c.line("water.min_cover_m", "Water cover"), c.line("sewer.house_connection_min_cover_m", "Sewer house connection"),
                                                                            c.line("esc.trench.max_open_days", "Trench open")) if x] or ["No cited values available."], 2.0)
    # 3 stabilised access
    v.text(20, 105, "3  STABILISED SITE ACCESS (TYPICAL)", 3.4, "TOP_LEFT", bold=True)
    D.panel(v, 20, 14, 160, 98, "STABILISED ACCESS: CITED VALUES", [x for x in (c.line("esc.access.min_length_m", "Min length"), c.line("esc.access.min_width_m", "Min width"), c.line("esc.access.thickness_mm", "Thickness"),
                                                                           c.line("esc.access.max_aggregate_mm", "Max aggregate"), c.line("esc.access.geotextile_underlay", "Underlay")) if x] or ["No cited values."], 2.0)
    D.panel(v, 190, 14, 322, 112, "STATUS OF DETAILS", ["All details are TYPICAL / SCHEMATIC and labelled 'to be confirmed by designer'. Only values shown with a [citation] come from the cited documents.",
                                                        "Driveway crossover section: see C420. Council standard drawings govern.", DISCL], 2.0)
    sh.legend = []
    return sh


# ================================================================ C700
def c700(ctx: Ctx, all_sheets: list[Sheet]) -> Sheet:
    s = ctx.site
    sh = Sheet("C700", "General notes and specification notes", "", north=None)
    v = sh.add(View("n", (10, 10, 332, 287), frame=True))
    cols = [(14, 118), (121, 225), (228, 330)]
    secs = [("GENERAL", [DISCL, "Cadastral boundaries are from the NSW cadastre and are not a survey; engage a registered surveyor.", "Nothing here is a development or building approval.", "Dimensions in metres, levels in m (AHD, DEM-derived, indicative)."]),
            ("DATUM AND ACCURACY", ["Horizontal: GDA2020 / MGA " + f"(EPSG:{s.inp.lot.mga_srid}).", "Vertical: AHD from the NSW 5 m DEM when levels are shown; vertical accuracy NOT STATED by the service. Contours/spot levels are INDICATIVE; detail survey required."]),
            ("EARTHWORKS", ["Strip topsoil and stockpile for reuse (cited 100-150 mm: " + (s.cites.line("esc.topsoil.strip_depth_max_mm") or "n/a") + ").", "Batters 1V:2H cut / 1V:3H fill are assumed; geotechnical advice required. Compact fill per designer specification, to be confirmed."]),
            ("DRAINAGE", [s.cites.line("stormwater.designed_per_eng_standards") or "Stormwater to be designed per council standards, to be confirmed.", "Drainage on C300 is schematic; sizes and levels by a hydraulic designer."]),
            ("SERVICES", ["Locate all services via DBYD and potholing before excavation. Water / sewer per C310 (schematic).", s.cites.line("sewer.junction_min_diameter_mm") or ""]),
            ("DRIVEWAY / CROSSOVER", [s.cites.line("access.crossing_standard") or "Crossing per council standard drawing.", "Pavement thickness: per council standard drawing, to be confirmed. B85 checks are screening only."]),
            ("EROSION AND SEDIMENT CONTROL", [s.cites.line("esc.escp.prepared_by_suitably_qualified_person") or "ESCP by a suitably qualified person.", s.cites.line("esc.inspection.min_frequency") or ""]),
            ("DATA AND ASSUMPTIONS REGISTER", [f"{x.number}: " + ("; ".join(x.data_missing) if x.data_missing else "no missing data") for x in all_sheets])]
    y = [283.0] * 3
    ci = 0
    for title, ls in secs:
        ls = [x for x in ls if x]
        need = 9 + sum(len(fonts.wrap(x, 2.2, cols[ci][1] - cols[ci][0] - 6)) * 3.3 + 1.2 for x in ls)
        if y[ci] - need < 14 and ci < 2:
            ci += 1
        x0, x1 = cols[ci]
        y[ci] = D.panel(v, x0, y[ci] - need, x1, y[ci], title, ls, 2.2) and y[ci] - need - 3
    sh.legend = []
    return sh


# ================================================================ C000
def c000(ctx: Ctx, sheets: list[Sheet], font_note: str) -> Sheet:
    s = ctx.site
    sh = Sheet("C000", "Cover sheet, drawing index and locality plan", "", north=0.0, scale_text="AS SHOWN")
    v = sh.add(View("cover", (10, 10, 332, 287), frame=True))
    pj = ctx.proj
    v.text(16, 282, "CIVIL PLAN SET", 9, "TOP_LEFT", bold=True)
    v.text(16, 270, pj.title, 5.5, "TOP_LEFT", bold=True)
    y = 262
    for t in (pj.address, f"LOT {s.inp.lot.lotplan}  |  {pj.council}  |  ZONE {pj.zone}  |  {pj.area}", pj.dev_label, "PRELIMINARY ISSUE: NOT FOR CONSTRUCTION"):
        if t:
            v.text(16, y, t, 3.0, "TOP_LEFT")
            y -= 5
    # index
    x0, yt = 16.0, 232.0
    v.text(x0, yt, "DRAWING INDEX", 3.4, "TOP_LEFT", bold=True)
    yy = yt - 7
    v.line([(x0, yy + 3), (x0 + 150, yy + 3)], "C-ANNO-TABL", False, 0.25)
    for t, dx in (("No.", 0), ("TITLE", 14), ("DATA STATUS", 80)):
        v.text(x0 + dx, yy, t, 2.0, "MIDDLE_LEFT", bold=True)
    yy -= 5
    for x in sheets:
        v.text(x0, yy, x.number, 2.4, "MIDDLE_LEFT", bold=True)
        v.text(x0 + 14, yy, x.title, 2.4, "MIDDLE_LEFT")
        st = "DATA NOT AVAILABLE: " + "; ".join(x.data_missing) if x.data_missing else "complete for supplied data"
        v.text(x0 + 80, yy, fonts.wrap(st, 2.0, 70)[0] + ("..." if len(fonts.wrap(st, 2.0, 70)) > 1 else ""), 2.0, "MIDDLE_LEFT", color=(0.7, 0.1, 0.1) if x.data_missing else None)
        yy -= 5.2
    v.line([(x0, yy + 3), (x0 + 150, yy + 3)], "C-ANNO-TABL", False, 0.25)
    D.panel(v, 14, 14, 168, yy - 3, "ABBREVIATIONS AND NOTES", [
        "AHD Australian Height Datum | DBYD Dial Before You Dig | DEM digital elevation model | DP deposited plan | ESCP erosion and sediment control plan | FFL finished floor level",
        "GDA2020 Geocentric Datum of Australia 2020 | MGA Map Grid of Australia | RL reduced level | RWT rainwater tank | TBC to be confirmed | NTS not to scale",
        "Symbols and line types are listed in the legend on each sheet.", DISCL, "Text: " + font_note], 2.0)
    # locality plan
    r = (172, 150, 330, 285)
    sc = pick_scale(max(s.lot.bounds[2] - s.lot.bounds[0], 220) * 1.3, max(s.lot.bounds[3] - s.lot.bounds[1], 150) * 1.3, r[2] - r[0] - 4, r[3] - r[1] - 4)
    lc = s.lot.centroid
    lv = sh.add(View("locality", r, (lc.x, lc.y), sc, frame=True))
    if s.aerial_loc:
        lv.image(s.aerial_loc.path, s.aerial_loc.extent, 0.35, "C-IMAG-LOCL")
    for _l, p, _r in s.neighbours:
        lv.geom(p, "C-PROP-ADJN", lw=0.1, color=(0.3, 0.3, 0.3))
    lv.fill(s.lot, "C-PROP-BDY", (1, 0.9, 0.2), 0.35)
    lv.geom(s.lot, "C-PROP-BDY", lw=0.6)
    D.road_names(lv, s)
    if s.footprint is not None:
        lv.fill(s.footprint.buffer(max(2, 1.2 / lv.k)), "A-BLDG-SLAB", (0.1, 0.2, 0.7), 1.0)
    lv.text_p(r[0] + 2, r[3] - 1, "LOCALITY PLAN", 3.0, "TOP_LEFT", 0, True, halo=True)
    lv.text_p(r[0] + 2, r[1] + 1.2, (s.aerial_loc.note if s.aerial_loc else "No aerial underlay (linework only)") + f"  |  1:{sc} @ A3", 1.8, "BOTTOM_LEFT", halo=True)
    D.panel(v, 172, 14, 330, 146, "GENERAL NOTES", [
        "1. This plan set is PRELIMINARY and indicative; not for construction.", "2. Boundaries from the NSW cadastre (not a survey). Adjoining lot labels from the cadastre lot layer.",
        "3. Levels / contours are derived from the NSW 5 m DEM and are INDICATIVE; detail survey required before design.", "4. Proposed structure footprint and FFL are ILLUSTRATIVE unless stated as from an architect plan.",
        "5. Services shown are schematic; existing services to be confirmed from council records / DBYD.", "6. Cited requirements show their source document and page; items without a citation are assumptions marked TO BE CONFIRMED.",
        "7. Aerial imagery: NSW Spatial Services; verify terms before commercial use.", "8. Sheets with missing inputs show a DATA NOT AVAILABLE panel; nothing is invented."], 2.1)
    sh.legend = [LE("LOT BOUNDARY", "line", (0, 0.5, 0.1), 0.5, layer="C-PROP-BDY"), LE("ADJOINING LOT BOUNDARY", "line", (0.35, 0.35, 0.35), 0.13, layer="C-PROP-ADJN"),
                 LE("PROPOSED STRUCTURE", "fill", D.BLUE, 0.5, fill=(0.78, 0.84, 1.0), layer="A-BLDG-SLAB"), LE("BUILDING ENVELOPE", "line", (0.8, 0.1, 0.1), 0.3, layer="C-ZONE-ENVL"),
                 LE("EXISTING CONTOUR (INDICATIVE)", "line", (0.5, 0.5, 0.5), 0.13, "DASHED", layer="C-TOPO-EXST"), LE("PROPOSED CONTOUR", "line", D.MAGENTA, 0.2, layer="C-TOPO-PROP")]
    return sh

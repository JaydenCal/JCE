"""Stage 8: the placed dwelling on the plan sheets (outline, setback dimensions, setback schedule, building and FFL text).

Everything comes from ``Site.placement`` (``app.design.building_place.Placement``): the footprint, garage, roof eave, garage door and the setback rows with their cited
values.  Nothing is typed here.  The dwelling is the Plan Studio typical house (INDICATIVE); the FFL is TBC unless a cited rule and a flood level give one.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Point
from shapely.ops import nearest_points, unary_union

from app.agents.sa5_cad_dxf.planset import callout as CO
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.dimstyle import dim_best
from app.agents.sa5_cad_dxf.planset.style import TXT

COLS = (0.36, 0.17, 0.2, 0.27)
SIDES = ((0, 1), (0, -1), (1, 0), (-1, 0))
LAYER_OUTLINE = "A-BLDG-PROP"


def _to_paper(v, g):
    return v.to_paper_geom(g)


def draw_outline(v, s, hatch: bool = True, door: bool = True, eave: bool = True) -> None:
    """Footprint with the proposed hatch and outline, the roof eave as a dashed outline and the garage door as a heavy line."""
    pl = s.placement
    fp = s.footprint
    if fp is None:
        return
    if hatch:
        ST.hatch_fill(v, fp, "proposed")
    else:
        v.geom(fp, LAYER_OUTLINE, lw=ST.REF.outline_lw, color=ST.BLACK)
    if eave and pl is not None and pl.roof is not None:
        v.geom(pl.roof.exterior, LAYER_OUTLINE, lw=0.13, dash="DASHED", color=ST.BLACK)
    if door and pl is not None and pl.garage_door_xy is not None and pl.garage_door_width_m:
        c = pl.garage_door_xy
        d = pl.front_dir
        t = (-d[1], d[0])
        h = pl.garage_door_width_m / 2.0
        v.line([(c[0] - t[0] * h, c[1] - t[1] * h), (c[0] + t[0] * h, c[1] + t[1] * h)], LAYER_OUTLINE, False, 0.6, color=ST.BLACK)


def _anchor_pair(fp, line: LineString, d_min: float, keep_clear=None):
    """(building point, boundary point) for a dimension: along the overlap between the building face and the boundary edge when the face runs parallel to it (so the
    dimension sits on the wall, at its middle first and then at other fractions that keep the dimension clear of ``keep_clear``, e.g. the driveway), else the nearest pair."""
    p0, q0 = nearest_points(fp, line)
    c = list(line.coords)
    ex, ey = c[-1][0] - c[0][0], c[-1][1] - c[0][1]
    L = math.hypot(ex, ey)
    if L < 1e-9:
        return (p0.x, p0.y), (q0.x, q0.y)
    ux, uy = ex / L, ey / L
    xs, ys = fp.exterior.xy
    ts = [(x - c[0][0]) * ux + (y - c[0][1]) * uy for x, y in zip(xs, ys)]
    # only the building vertices that are as close as the nearest point (the face that governs), so a deep building does not pull the anchor off its governing face
    near = [t for (x, y), t in zip(zip(xs, ys), ts) if Point(x, y).distance(line) <= d_min + 0.02]
    if len(near) >= 2:
        t_lo, t_hi = min(near), max(near)
    else:
        t_lo, t_hi = min(ts), max(ts)
    t_lo, t_hi = max(t_lo, 0.0), min(t_hi, L)
    if t_hi - t_lo < 0.3:
        return (p0.x, p0.y), (q0.x, q0.y)
    first = None
    for f in (0.5, 0.12, 0.88, 0.25, 0.75, 0.04, 0.96):
        tm = t_lo + (t_hi - t_lo) * f
        q = Point(c[0][0] + ux * tm, c[0][1] + uy * tm)
        p, _q2 = nearest_points(fp, q)
        if abs(p.distance(q) - d_min) > 0.05:
            continue
        if first is None:
            first = ((p.x, p.y), (q.x, q.y))
        if keep_clear is None or LineString([(p.x, p.y), (q.x, q.y)]).distance(keep_clear) > 0.6:
            return (p.x, p.y), (q.x, q.y)
    return first or ((p0.x, p0.y), (q0.x, q0.y))


def draw_setback_dims(b, avoid=None, keep_clear=None) -> list[str]:
    """Dimension lines from the building to every boundary (the measured minimum), one per cited setback row, plus the dwelling front wall to the front boundary
    when the garage projects.  Returns the labels of dimensions that found no clear place (they are listed in the schedule anyway)."""
    s, v, pl = b.s, b.v, b.s.placement
    if pl is None or not pl.placed:
        return []
    lost: list[str] = []
    av = [to for to in (avoid or []) if to is not None]
    edges = {e.seq: e for e in pl.edges}
    jobs = []
    for r in pl.rows:
        if r.informational:
            continue
        e = edges.get(r.edge_seq)
        if e is None:
            continue
        jobs.append((r.label, s.footprint if "GARAGE" not in r.label else pl.garage, e.line, r.actual_m))
    front = next((e for e in pl.edges if e.kind == "front"), None)
    if front is not None and pl.garage is not None and pl.dwelling is not None and pl.garage_rule is not None and pl.garage_rule.actual_m < 0:
        jobs.append(("DWELLING FRONT WALL TO FRONT BOUNDARY", pl.dwelling, front.line, pl.dwelling.distance(front.line)))
    for label, g, ln, d in jobs:
        (px, py), (qx, qy) = _anchor_pair(g, ln, g.distance(ln), keep_clear)
        a, c = v.tp(px, py), v.tp(qx, qy)
        text = CO.prep([f"{d:.2f} m"])[0]
        res = dim_best(v, a, c, text, (5.0, 9.0, 13.0, 18.0), SIDES, TXT.BODY, av)
        if res is None:
            lost.append(label)
    return lost


def schedule_rows(pl) -> list[tuple]:
    """Rows (boundary, cited minimum, provided, result) for the setback schedule; every value from the placement."""
    rows: list[tuple] = [("BOUNDARY", "CITED MINIMUM", "PROVIDED", "RESULT")]
    for r in pl.rows:
        if r.informational:
            continue
        res = "NOT CHECKED, NOT CLEAR" if r.met is None else ("MET" if r.met else f"NOT MET, SHORT BY {r.deficit_m:.2f} m")
        rows.append((r.label, r.cite_value if r.met is not None else "UNRESOLVED", f"{r.actual_m:.2f} m", res))
    gr = pl.garage_rule
    if gr is not None:
        fwd = gr.actual_m < 0
        rows.append(("GARAGE BEHIND FRONT BUILDING LINE", gr.cite_value, (f"{abs(gr.actual_m):.2f} m FORWARD" if fwd else f"{gr.actual_m:.2f} m BEHIND"),
                     "MET" if gr.met else f"NOT MET, SHORT BY {gr.deficit_m:.2f} m"))
    return rows


def source_lines(pl) -> list[str]:
    """One line per distinct cited requirement used: value and source, plus how the cited rule was applied."""
    out, seen = [], set()
    for r in pl.rows:
        if r.informational or r.met is None or r.cite_ref in seen and r.cite_value in seen:
            continue
        k = (r.label.split(" (")[0], r.cite_value)
        if k in seen:
            continue
        seen.add(k)
        out.append(f"- {r.label.split(' (')[0]}: {r.cite_value} [{r.cite_ref}]" + (f". {r.note}" if r.note and "NEAREST" not in r.note else ""))
    if pl.garage_rule is not None:
        out.append(f"- GARAGE: {pl.garage_rule.cite_value} BEHIND THE FRONT BUILDING LINE [{pl.garage_rule.cite_ref}]")
    return out


def building_lines(s) -> list[str]:
    """Text block for the building panel: what it is, where it came from, the FFL and the existing ground under it."""
    pl, h = s.placement, s.placement.house
    lines = [f"{pl.source}: {h.summary().upper()}.",
             "THE HOUSE IS A TYPICAL TEMPLATE FROM THE PLAN STUDIO DESIGN TOOL, NOT A DESIGN FOR THIS LOT. IT IS PLACED TO THE CITED SETBACKS AND ORIENTED TO THE FRONTAGE."]
    if pl.ffl_m is not None:
        lines.append(f"FINISHED FLOOR LEVEL {pl.ffl_m:.2f} m AHD. {pl.ffl_note}")
    else:
        lines.append(f"FINISHED FLOOR LEVEL: TBC. {pl.ffl_note}")
    if pl.ground_range is not None:
        lo, mean, hi = pl.ground_range
        lines.append(f"EXISTING GROUND UNDER THE FOOTPRINT: RL {lo:.2f} TO {hi:.2f} m AHD (MEAN {mean:.2f}), INDICATIVE 5 m DEM, DETAIL SURVEY REQUIRED.")
    if h.tank is not None:
        lines.append("THE TEMPLATE RAINWATER TANK IS NOT PLACED: THE CITED RULE REQUIRES A TANK BEHIND THE STREET SETBACK OF THE DWELLING AND NO TANK POSITION IS DESIGNED.")
    return lines


def flag_lines(pl) -> list[str]:
    return [f.replace("  ", " ") for f in pl.flags]


def panels(s) -> list[tuple]:
    """Panels for the C101 column: ('table'|'text', title, content, warn)."""
    pl = s.placement
    if pl is None or not pl.placed:
        return []
    out: list[tuple] = [("table", "BUILDING SETBACKS (CITED)", schedule_rows(pl)), ("text", "SETBACK SOURCES", source_lines(pl), False),
                        ("text", "BUILDING AND FINISHED FLOOR LEVEL", building_lines(s), False)]
    if pl.flags:
        out.append(("text", "FLAGS: NOT MET OR NOT CHECKED", flag_lines(pl), True))
    return out


def row_failed(r) -> bool:
    """A schedule row whose result cell reads NOT MET or NOT CHECKED is red."""
    return str(r[3]).startswith(("NOT MET", "NOT CHECKED"))


def draw_light(b, door: bool = True) -> None:
    """The dwelling as a light grey filled outline (sheets other than C101): footprint, garage door line.  Adds the footprint to ``b.hard`` so labels keep clear."""
    s, v, pl = b.s, b.v, b.s.placement
    fp = s.footprint
    if fp is None or pl is None:
        return
    v.fill(fp, LAYER_OUTLINE, (0.92, 0.92, 0.92), 1.0, edge=ST.BLACK, edge_lw=ST.REF.outline_lw)
    if door and pl.garage_door_xy is not None and pl.garage_door_width_m:
        c, d = pl.garage_door_xy, pl.front_dir
        t = (-d[1], d[0])
        h = pl.garage_door_width_m / 2.0
        v.line([(c[0] - t[0] * h, c[1] - t[1] * h), (c[0] + t[0] * h, c[1] + t[1] * h)], LAYER_OUTLINE, False, 0.6, color=ST.BLACK)
    b.hard.append(fp)


def label_lines(s, extra=()) -> list[str]:
    return ["PROPOSED DWELLING", f"{s.placement.source}", *extra]


def roof_area_m2(pl) -> float | None:
    """Roof plan area to the eaves (the Plan Studio roof outline), m2; None when the file has no roof outline."""
    return round(pl.roof.area, 1) if pl is not None and pl.roof is not None else None

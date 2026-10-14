"""Cadastre (DCDB) padding to the plan viewport.

The SA1 lot query returns only the lots adjoining the subject lot, so the neighbour linework stopped short of the viewport edges.  The plan sheets
therefore ask ``PlansetInput.cadastre_fetch`` for every lot and road reserve in and around the viewport, a window derived from the viewport itself
(its rotated rectangle outset by a fraction of its own diagonal, never a fixed distance).  Lines are then clipped to the viewport, so they run edge
to edge, and every visible lot carries a LOT / DP label.  Nothing is invented: a window the source cannot fill is reported on the sheet.
"""
from __future__ import annotations

import math

from shapely import wkt as swkt
from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.data import CadastreWindow, Site

PAD_FRACTION = 0.05            # outset of the fetch window, as a fraction of the viewport diagonal


def _polys(g) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    return [g] if g.geom_type == "Polygon" else [p for x in getattr(g, "geoms", []) for p in _polys(x)]


def _key(label: str, p: Polygon) -> tuple:
    c = p.centroid
    return (str(label).strip().upper(), round(p.area, 1), round(c.x, 1), round(c.y, 1))


def all_lots(s: Site) -> list[tuple]:
    """Adjoining lots (SA1) plus every lot fetched for the viewports: [(label, Polygon, is_road)]."""
    return list(s.neighbours) + list(s.window_lots)


def fetch_window(view: View) -> Polygon:
    win = view.window_poly()
    b = win.bounds
    return win.buffer(PAD_FRACTION * math.hypot(b[2] - b[0], b[3] - b[1]))


def ensure(s: Site, v: View) -> None:
    """Make sure the cadastre covers viewport ``v`` (fetch once per window; later views reuse a window that already contains theirs)."""
    hook = s.inp.cadastre_fetch
    if hook is None:
        return
    win = v.window_poly()
    if any(w.buffer(1e-6).contains(win) for w, _c, _n in s.cad_cache):
        return
    req = fetch_window(v)
    try:
        res = hook(req)
        if not isinstance(res, CadastreWindow):
            res = CadastreWindow(list(res), True, "")
    except Exception as ex:  # noqa: BLE001 - a failed window query never fails the plan set; the sheet says so
        res = CadastreWindow([], False, f"WINDOW QUERY FAILED: {type(ex).__name__}")
    own = s.lot.buffer(0.01)
    have = {_key(lab, p) for lab, p, _r in all_lots(s)}
    for it in res.lots:
        if hasattr(it, "wkt"):
            lab, g, road = it.label, swkt.loads(it.wkt), bool(it.is_road)
        else:
            lab, g, road = it
        for p in _polys(g):
            if p.is_empty or p.intersection(own).area > 0.5 * min(p.area, own.area):
                continue                                   # the subject lot itself
            k = _key(lab, p)
            if k in have:
                continue
            have.add(k)
            s.window_lots.append((lab, p, road))
    s.cad_cache.append((req, bool(res.complete), res.note or ""))
    s.cad_complete = all(c for _w, c, _n in s.cad_cache)
    s.cad_note = "; ".join(dict.fromkeys(n for _w, c, n in s.cad_cache if not c and n))


def cad_notes(s: Site) -> list[str]:
    """Statements the sheet must carry when the DCDB does not (or may not) reach the viewport edges.  Not checked never reads as clear."""
    if s.cad_complete is True:
        return []
    if s.cad_complete is False:
        why = f" ({s.cad_note})" if s.cad_note else ""
        return [f"DCDB BEYOND THE LOTS SHOWN IS NOT AVAILABLE{why}, SO THE CADASTRE DOES NOT REACH THE VIEWPORT EDGES. NOT CHECKED, NOT CLEAR"]
    return ["DCDB SHOWN IS LIMITED TO THE ADJOINING LOTS SUPPLIED BY THE SA1 QUERY (NO VIEWPORT WINDOW QUERY WAS RUN). LOTS BEYOND ARE NOT SHOWN, NOT CHECKED, NOT CLEAR"]

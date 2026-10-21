"""Stage 8: DBYD (Before You Dig) on the plan sheets.

Only VERIFIED services are drawn (``DbydView.verified``): each with the asset owner, the plan date and "LOCATION INDICATIVE, CONFIRM BY POTHOLING".  A draft or rejected service is never
drawn; the services status table (C310) says how many exist.  With no BYDA data the sheets keep the DATA NOT AVAILABLE rows and say EXISTING SERVICES NOT CONFIRMED.
The view is ``app.integrations.byda.view.DbydView`` on ``PlansetInput.dbyd``.
"""
from __future__ import annotations

from shapely.geometry import LineString, Point

from app.agents.sa5_cad_dxf.layers import SERVICE_LAYER
from app.agents.sa5_cad_dxf.planset import panels as PN
from app.agents.sa5_cad_dxf.planset import style as ST
from app.integrations.byda.view import SYNTHETIC_STAMP

COLS = (0.27, 0.14, 0.23, 0.08, 0.12, 0.16)


def view_of(s):
    return getattr(s.inp, "dbyd", None)


def draw_verified(b, which: tuple | None = None) -> list[tuple]:
    """Draw the verified services on the sheet's view.  Returns the pending call-outs ([lines], (x, y)) to place after the other labels.  Services in another CRS than the lot are not drawn
    and are recorded as a data gap."""
    s = b.s
    view = view_of(s)
    if view is None:
        return []
    v = b.v
    srid = getattr(s.inp.lot, "mga_srid", None)
    pending: list[tuple] = []
    for f in view.verified:
        svc = f.get("service") or "other"
        if which is not None and svc not in which:
            continue
        g = f.get("geometry") or {}
        if g.get("srid") not in (None, srid):
            b.sh.data_missing.append(f"verified service {f.get('id', '')[:8]} is in SRID {g.get('srid')}, the lot is SRID {srid}: not drawn")
            continue
        pts = [tuple(p) for p in g.get("pts") or []]
        layer = SERVICE_LAYER.get(svc, SERVICE_LAYER["other"])
        if g.get("kind") == "point" and pts:
            x, y = pts[0]
            if v.inside(x, y, 4):
                v.fill(Point(x, y).buffer(0.3), layer, ST.WHITE, 1.0, edge=ST.BLACK, edge_lw=0.25)
                v.line([(x - 0.45, y), (x + 0.45, y)], layer, False, 0.2, color=ST.BLACK)
                v.line([(x, y - 0.45), (x, y + 0.45)], layer, False, 0.2, color=ST.BLACK)
                pending.append((view.drawn_label(f), (x, y)))
        elif len(pts) >= 2:
            ln = LineString(pts)
            v.geom(ln, layer, lw=0.35, color=ST.BLACK)
            c = ln.interpolate(0.5, normalized=True)
            pending.append((view.drawn_label(f), (c.x, c.y)))
    return pending


def n_drawn(s, which: tuple | None = None) -> int:
    view = view_of(s)
    return 0 if view is None else sum(1 for f in view.verified if which is None or f.get("service") in which)


def rows_missing(s) -> list[str]:
    """The data not available row for existing services (replaces the 'none supplied' row when BYDA responses exist)."""
    view = view_of(s)
    if view is None or view.n_owners == 0:
        return ["existing services: no BYDA response recorded; EXISTING SERVICES NOT CONFIRMED (locate by DBYD and potholing)"]
    if view.n_verified:
        return []
    return [view.not_confirmed_text().lower().replace("existing services not confirmed", "existing services not confirmed") + "; LOCATE BY POTHOLING"]


def notes_for(s) -> list[str]:
    view = view_of(s)
    if view is None:
        return []
    out = [view.summary_lines()[0]] if view.summary_lines() else []
    w = view.expiry_warning()
    if w:
        out.append(w)
    if view.synthetic:
        out.append(SYNTHETIC_STAMP)
    return out


def status_lines(view) -> list[str]:
    lines = view.summary_lines()
    if view.n_verified:
        lines.append("ONLY VERIFIED SERVICES ARE DRAWN. DRAFT AND REJECTED TRACES ARE NEVER DRAWN.")
    else:
        lines.append(view.not_confirmed_text())
    lines.append("ASSET OWNER PLANS ARE FOR THIS PROJECT ONLY. LOCATION INDICATIVE, CONFIRM BY POTHOLING.")
    return lines


def table_rows(view) -> list[tuple]:
    return [view.status_header()] + view.status_rows()


def table_panel(b, title: str, rows: list[tuple], w: float = 150.0):
    """Place the services status table on a free part of the sheet; None when no free place exists (the rows are then listed as sheet data gaps by the caller)."""
    from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
    h = PN.table_height(rows, w, cols=COLS)
    r = S2.place_panel(b, w, h)
    if r is None:
        return None
    PN.draw_table(b.v, r, title, rows, cols=COLS, bold_col=0, red_col=None, red_when=lambda row: "EXPIRED" in str(row[5]) or str(row[2]).startswith("NOT RECEIVED"))
    return r

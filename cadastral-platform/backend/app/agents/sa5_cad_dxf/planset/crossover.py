"""Crossover in the reference style: pure geometry (shapely) plus drawing.

Local frame: s runs along the front boundary segment from its start, t runs outward (away from the lot, toward the road) from the
boundary line, so the verge is 0 <= t <= D (D = boundary to kerb).  The body spans the boundary to the start of the wings, a wing at
each side flares outward over the last stretch before the kerb and gutter band, and the band runs along the road edge.

Data rules: width and flare come from the SA3 crossover polygon (a trapezoid: width at the boundary, wider at the kerb).  D is read
from that polygon, or from the platform default verge depth when there is no driveway.  No survey of the kerb is supplied to the plan set,
so the kerb is always drawn as ASSUMED unless the caller says otherwise.  Wing length, band width and the stipple are graphic conventions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely.geometry import LineString, Point, Polygon, box

from app.agents.sa5_cad_dxf.planset.callout import place_callout
from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.style import BLACK, REF, Paper, concrete_fill, kerb

KERB_ASSUMED_TEXT = "ASSUMED KERB LINE"
STANDARD_NOT_SELECTED = "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED)"
WING_CONVENTION_TEXT = "WING FLARE: PLATFORM DEFAULT (PLACEHOLDER), NOT A DESIGN VALUE"
# Provenance (the SA3 result carries no provenance flag): the driveway width is the AS/NZS 2890.1 Class 1 width parameter held in SA3 (verify), raised or
# lowered to a council limit only when one is cited; the kerb flare is SA3's default kerb return splay unless a council value is cited.  Neither is
# a derived or surveyed value, so both read PLATFORM DEFAULT.
WIDTH_SRC = "PLATFORM DEFAULT, TO BE VERIFIED"
FLARE_SRC = "PLATFORM DEFAULT"
NO_DRIVEWAY_TEXT = "NO DRIVEWAY OR CROSSOVER DATA (SA3 DRIVEWAY RESULT NOT SUPPLIED)"


# ---- single sources shared by C101, C400, C410 and C420 ---------------------------------------------------------------------
GUTTER_BAND_SIDE = "KERB LINE TOWARD THE LOT"     # the band lies between the kerb line (road edge, boundary to kerb = D) and D minus its width
FRONTAGE_SOURCE = "CADASTRE"


def gutter_band_m(kerb_offset_m: float | None) -> float:
    """Kerb and gutter band width: ONE value for the plan (C101, C400, C420) and the long section (C410)."""
    return min(REF.kerb_band_m, kerb_offset_m * 0.25) if kerb_offset_m else 0.0


def frontage_length_m(front) -> float:
    """Frontage length: ONE value (the cadastre distance, 2 d.p.) used by the boundary labels, the layover text and the schedule."""
    return round(float(front.distance_m), 2)


def default_kerb_offset_m() -> float | None:
    """Platform default verge depth (kerb line to front boundary) read from the SA3 request model, not hard-coded here."""
    try:
        from app.agents.sa3_driveway.models import Sa3DrivewayRequest
        return float(Sa3DrivewayRequest.model_fields["kerb_to_boundary_m"].default)
    except Exception:  # noqa: BLE001
        return None


def standard_text(label: str | None) -> str:
    return f"COUNCIL STANDARD: {label}" if standard_resolved(label) else STANDARD_NOT_SELECTED


def kerb_text(g: "CrossoverGeom") -> str:
    """Provenance of the boundary to kerb distance: always a default or user input, never a survey."""
    return f"BOUNDARY TO KERB {_fmt_m(g.kerb_offset_m)} ({g.kerb_source}, NOT SURVEYED)"


def standard_resolved(label: str | None) -> bool:
    """True when SA3 reports a selected council standard; False when it fell back to the platform default (nothing selected)."""
    if not label or not str(label).strip():
        return False
    try:
        from app.agents.sa3_driveway.models import DEFAULT_STANDARD
        return str(label).strip().lower() != DEFAULT_STANDARD.source_label.strip().lower()
    except Exception:  # noqa: BLE001
        return "default" not in str(label).lower()


@dataclass
class Frontage:
    a: tuple
    b: tuple
    u: tuple
    n: tuple          # outward unit normal (toward the road)
    length: float

    def xy(self, s: float, t: float) -> tuple:
        return (self.a[0] + self.u[0] * s + self.n[0] * t, self.a[1] + self.u[1] * s + self.n[1] * t)

    def st(self, x: float, y: float) -> tuple:
        dx, dy = x - self.a[0], y - self.a[1]
        return (dx * self.u[0] + dy * self.u[1], dx * self.n[0] + dy * self.n[1])

    def poly(self, pts_st) -> Polygon:
        return Polygon([self.xy(s, t) for s, t in pts_st])


def make_frontage(p0, p1, lot: Polygon) -> Frontage:
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if L < 1e-6:
        raise ValueError("front boundary segment has zero length")
    u = ((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L)
    n = (-u[1], u[0])
    mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    probe = Point(mid[0] + n[0] * 0.2, mid[1] + n[1] * 0.2)
    if lot.contains(probe) or (not lot.contains(Point(mid[0] - n[0] * 0.2, mid[1] - n[1] * 0.2)) and
                               (lot.centroid.x - mid[0]) * n[0] + (lot.centroid.y - mid[1]) * n[1] > 0):
        n = (-n[0], -n[1])
    return Frontage(tuple(p0), tuple(p1), u, n, L)


@dataclass
class CrossoverGeom:
    present: bool = False
    note: str = ""
    frontage: Frontage | None = None
    kerb_offset_m: float | None = None
    kerb_assumed: bool = True
    kerb_source: str = "PLATFORM DEFAULT"      # where the verge depth came from
    width_m: float = 0.0
    flare_m: float = 0.0
    flare_source: str = ""
    body_len_m: float = 0.0
    centre_s: float = 0.0
    body: Polygon | None = None
    wing_a: Polygon | None = None
    wing_b: Polygon | None = None
    band: Polygon | None = None
    verge: Polygon | None = None
    kerb_line: LineString | None = None
    gutter_line: LineString | None = None
    polys: dict = field(default_factory=dict)
    wing_len_m: float = 0.0          # drafting convention (REF.wing_len_m), not SA3 data
    band_w_m: float = 0.0            # kerb and gutter band width, drafting convention
    avail_m: float = 0.0             # boundary to the inner edge of the band
    drive_width_m: float = 0.0       # SA3 driveway width (0 = not supplied)
    std_label: str | None = None     # SA3 council standard label (None or the platform default label = nothing selected)


def _s_range_at(poly_st: Polygon, t: float) -> tuple[float, float] | None:
    g = LineString([(-1e5, t), (1e5, t)]).intersection(poly_st)
    return None if g.is_empty else (g.bounds[0], g.bounds[2])


def build_crossover(front_seg, lot: Polygon, xover_poly: Polygon | None, kerb_offset_m: float | None = None, kerb_assumed: bool = True,
                    reach_m: float = 60.0, kerb_user_supplied: bool | None = None) -> CrossoverGeom:
    """Crossover geometry for any frontage bearing.  front_seg = ((x, y), (x, y)); xover_poly = SA3 crossover polygon or None.
    ``kerb_user_supplied``: True when the user gave the verge depth; None or False means the platform default (unknown means default)."""
    if front_seg is None:
        return CrossoverGeom(False, "NO FRONT BOUNDARY SEGMENT IN THE LOT DATA")
    fr = make_frontage(front_seg[0], front_seg[1], lot)
    g = CrossoverGeom(False, "", fr, kerb_offset_m, kerb_assumed)
    g.kerb_source = "USER INPUT" if kerb_user_supplied is True else "PLATFORM DEFAULT"
    pst = None
    if xover_poly is not None and not xover_poly.is_empty:
        pst = Polygon([fr.st(x, y) for x, y in xover_poly.exterior.coords])
        if pst.is_valid and pst.area > 1e-6:
            g.kerb_offset_m = float(pst.bounds[3])
        else:
            pst = None
    D = g.kerb_offset_m
    if D is None or D <= 0:
        g.note = "KERB OFFSET NOT AVAILABLE" if pst is None else "CROSSOVER POLYGON INVALID"
        return g
    gw = gutter_band_m(D)
    g.verge = fr.poly([(0, 0), (fr.length, 0), (fr.length, D), (0, D)])
    g.kerb_line = LineString([fr.xy(-reach_m, D), fr.xy(fr.length + reach_m, D)])
    g.gutter_line = LineString([fr.xy(-reach_m, D - gw), fr.xy(fr.length + reach_m, D - gw)])
    if pst is None:
        g.note = NO_DRIVEWAY_TEXT
        return g
    t0, t1 = pst.bounds[1], pst.bounds[3]
    e = max(1e-4, 1e-4 * (t1 - t0))
    rb, rk = _s_range_at(pst, t0 + e), _s_range_at(pst, t1 - e)
    if rb is None or rk is None:
        g.note = "CROSSOVER POLYGON HAS NO WIDTH"
        return g
    w = rb[1] - rb[0]
    g.width_m, g.centre_s = w, (rb[0] + rb[1]) / 2
    g.flare_m = max(0.0, ((rk[1] - rk[0]) - w) / 2)
    g.flare_source = "SA3 DRIVEWAY POLYGON"
    if g.flare_m < 0.05:                      # the SA3 polygon carries no kerb flare: use the reference sheet's wing proportion
        g.flare_m, g.flare_source = REF.wing_flare_m, "GRAPHIC CONVENTION"
    avail = D - gw
    wing = min(REF.wing_len_m, avail * 0.4)
    g.body_len_m = avail - wing
    g.wing_len_m, g.band_w_m, g.avail_m = wing, gw, avail
    sa, sb = g.centre_s - w / 2, g.centre_s + w / 2
    f = g.flare_m
    g.body = fr.poly([(sa, 0), (sb, 0), (sb, avail), (sa, avail)])        # boundary to the gutter band, so body, wings and band are one contiguous piece
    g.wing_a = fr.poly([(sa, g.body_len_m), (sa, avail), (sa - f, avail)])
    g.wing_b = fr.poly([(sb, g.body_len_m), (sb + f, avail), (sb, avail)])
    ex = REF.band_extra_m
    g.band = fr.poly([(sa - f - ex, D - gw), (sb + f + ex, D - gw), (sb + f + ex, D), (sa - f - ex, D)])
    g.polys = {"body": g.body, "wing_a": g.wing_a, "wing_b": g.wing_b, "band": g.band, "verge": g.verge}
    g.present = True
    g.note = ""
    return g


def _fmt_m(v: float) -> str:
    r = round(v, 2)
    return f"{r:.1f}m" if abs(r * 10 - round(r * 10)) < 1e-6 else f"{r:.2f}m"


def _dim(view: View, p1, p2, text: str, layer: str = "C-ANNO-DIMS", side=None) -> bool:
    if not (view.inside(*p1, 2.0) and view.inside(*p2, 2.0)):
        return False
    a, b = view.tp(*p1), view.tp(*p2)
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 3.0:
        return False
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    P = Paper(view)
    P.line([a, b], layer, 0.18, BLACK)
    for q, d in ((a, 1.0), (b, -1.0)):
        P.poly([q, (q[0] + d * ux * 2.2 - uy * 0.6, q[1] + d * uy * 2.2 + ux * 0.6), (q[0] + d * ux * 2.2 + uy * 0.6, q[1] + d * uy * 2.2 - ux * 0.6)], layer, BLACK)
    ang = math.degrees(math.atan2(uy, ux))
    nx, ny = -uy, ux
    if side is not None and nx * side[0] + ny * side[1] < 0:
        nx, ny = -nx, -ny
    P.text((a[0] + b[0]) / 2 + nx * 2.6, (a[1] + b[1]) / 2 + ny * 2.6, text, 2.5, "MIDDLE_CENTER", ang, layer=layer)
    return True


def _width_dim(view: View, g: CrossoverGeom) -> bool:
    """Crossover width: dimension line 7 mm (paper) beyond the kerb, extension lines up the inner edges of the wings."""
    fr = g.frontage
    td = g.kerb_offset_m + 7.0 / view.k
    sa, sb = g.centre_s - g.width_m / 2, g.centre_s + g.width_m / 2
    if not _dim(view, fr.xy(sa, td), fr.xy(sb, td), _fmt_m(g.width_m), side=fr.n):
        return False
    P = Paper(view)
    for s_ in (sa, sb):
        a, b = view.tp(*fr.xy(s_, g.body_len_m)), view.tp(*fr.xy(s_, td))
        P.line([a, (b[0] + fr.n[0] * 1.5, b[1] + fr.n[1] * 1.5)], "C-ANNO-DIMS", 0.13, BLACK)
    a, b = view.tp(*fr.xy(sa, td)), view.tp(*fr.xy(sb, td))
    view.occ.append((min(a[0], b[0]) - 5.0, min(a[1], b[1]) - 5.0, max(a[0], b[0]) + 5.0, max(a[1], b[1]) + 5.0))     # keep labels off the dimension
    return True


def crossover_notes(g: CrossoverGeom, standard_label: str | None = None) -> list[str]:
    """Statements that must appear on the sheet whenever the item they qualify is drawn (also used to size the notes panel)."""
    notes: list[str] = []
    if g.kerb_line is not None:
        if g.kerb_assumed:
            notes.append(KERB_ASSUMED_TEXT)
        if g.kerb_offset_m:
            notes.append(kerb_text(g))
    if not g.present:
        if g.note:
            notes.append(g.note)
        return notes
    notes.append(standard_text(standard_label))
    if g.flare_source == "GRAPHIC CONVENTION":
        notes.append(WING_CONVENTION_TEXT)
    return notes


def draw_crossover(view: View, g: CrossoverGeom, standard_label: str | None = None, kerb_only: bool = False, light: bool = False) -> list[str]:
    """Kerb lines, kerb and gutter band, wings and body (stipple + outline).  Dimensions are NOT drawn here (see ``layover_dims``, driveway sheets only).
    ``kerb_only``: existing-conditions sheets draw the assumed kerb and gutter lines and no crossover.  Returns notes (assumptions, missing data)."""
    notes = crossover_notes(g, standard_label)
    if g.kerb_line is not None:
        kerb(view, g.gutter_line, gutter=True)
        kerb(view, g.kerb_line)
    if not g.present or kerb_only:
        return notes
    for key in ("band", "wing_a", "wing_b", "body"):
        if g.polys[key].area > 1e-6:
            concrete_fill(view, g.polys[key], light=light)
    return notes


def callouts_crossover(view: View, g: CrossoverGeom, standard_label: str | None = None, keep_out=(), avoid=(), soft_avoid=(), kerb_only: bool = False, short_kerb: bool = False, must_avoid=(), extra=()) -> None:
    """Call-outs for the crossover (with the council standard statement) and for the assumed kerb line.  Both are must-carry: when no slot
    is free they fall back to a numbered tag with the text in the notes panel."""
    fr = g.frontage
    if g.present and not kerb_only:
        tgt = fr.xy(g.centre_s + g.width_m * 0.25, g.body_len_m * 0.7)
        place_callout(view, ["PROPOSED CROSSOVER", f"WIDTH {_fmt_m(g.width_m)} (PLATFORM DEFAULT)"] + list(extra) + [standard_text(standard_label)], tgt, "dot", keep_out,
                      avoid=avoid, soft_avoid=soft_avoid, must=True, must_avoid=must_avoid)
    if g.kerb_line is not None and g.kerb_assumed:
        D = g.kerb_offset_m
        lo = (g.centre_s - g.width_m / 2 - g.flare_m - REF.band_extra_m - 1.0) if g.present else fr.length * 0.5
        hi = (g.centre_s + g.width_m / 2 + g.flare_m + REF.band_extra_m + 1.0) if g.present else fr.length * 0.5
        lines = [KERB_ASSUMED_TEXT] if short_kerb else [KERB_ASSUMED_TEXT, kerb_text(g)]
        first = None
        for s in (lo - 2.0, hi + 2.0, fr.length * 0.15, fr.length * 0.85, fr.length * 0.5):
            tgt = fr.xy(s, D)
            if not view.inside(*tgt, 4.0):
                continue
            first = first or tgt
            if place_callout(view, lines, tgt, "arrow", keep_out, avoid=avoid, soft_avoid=soft_avoid, must_avoid=must_avoid) is not None:
                return
        fallback = first or fr.xy(fr.length * 0.5, D)
        place_callout(view, lines, fallback, "arrow", keep_out, avoid=avoid, soft_avoid=soft_avoid, must=True, must_avoid=must_avoid)


# ---- layover (NSW driveway layover / vehicle crossing at the kerb): dimension values, text and drawn dimensions ------------------------
PLACEHOLDER_TAG = "(PLACEHOLDER)"
LAYOVER_STANDARD_NOTE = "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED). DIMENSIONS ARE PLACEHOLDERS PENDING COUNCIL STANDARD"


def layover_values(g: "CrossoverGeom", front=None) -> list[dict]:
    """Every layover dimension with its source.  ``placeholder`` is True for drafting conventions (PLACEHOLDER); the platform defaults (width, flare, kerb offset) read PLATFORM DEFAULT.  front = BoundarySegment or None."""
    if not g.present:
        return []
    kerb_src = "USER INPUT, NOT SURVEYED" if g.kerb_source == "USER INPUT" else "PLATFORM DEFAULT, NOT SURVEYED"
    sel = standard_resolved(getattr(g, "std_label", None))      # a council standard was selected: the SA3 width and splay may follow it, so say so
    wsrc = WIDTH_SRC + (", WITHIN OR CLAMPED TO THE SELECTED STANDARD" if sel else "")
    fsrc = FLARE_SRC + (" UNLESS GIVEN BY THE SELECTED STANDARD" if sel else "")
    out = [
        dict(key="w_bdy", label="LAYOVER WIDTH AT BOUNDARY", m=g.width_m, src=wsrc, placeholder=False),
        dict(key="w_kerb", label="LAYOVER WIDTH AT KERB", m=g.width_m + 2 * g.flare_m, src=fsrc, placeholder=False),
        dict(key="wing", label="WING LENGTH", m=g.wing_len_m, src="DRAFTING CONVENTION", placeholder=True),
        dict(key="flare", label="WING FLARE (EACH SIDE)", m=g.flare_m, src=fsrc, placeholder=False),
    ]
    if g.drive_width_m:
        out.append(dict(key="drive", label="DRIVEWAY WIDTH", m=g.drive_width_m, src=wsrc, placeholder=False))
    out.append(dict(key="d_kerb", label="BOUNDARY TO KERB", m=g.kerb_offset_m, src=kerb_src, placeholder=False))
    out.append(dict(key="band", label="KERB AND GUTTER BAND WIDTH", m=g.band_w_m, src="DRAFTING CONVENTION", placeholder=True))
    return out


def layover_text(r: dict) -> str:
    """'WIDTH AT BOUNDARY 3.0m (PLATFORM DEFAULT, TO BE VERIFIED)' with (PLACEHOLDER) beside drafting-convention values."""
    return f"{r['label']} {_fmt_m(r['m'])} " + (PLACEHOLDER_TAG if r["placeholder"] else f"({r['src']})")


def frontage_text(front) -> str:
    return f"FRONTAGE BEARING {front.bearing_dms}  {frontage_length_m(front):.2f}m ({FRONTAGE_SOURCE})" if front is not None else ""


def layover_lines(g: "CrossoverGeom", front=None) -> list[str]:
    ls = [layover_text(r) for r in layover_values(g, front)]
    if front is not None:
        ls.append(frontage_text(front))
    return ls


def layover_dims(view: View, g: "CrossoverGeom") -> int:
    """Proper dimensions on a plan, DRIVEWAY SHEETS ONLY: width at boundary (lot side), width at kerb (road side) and boundary to kerb.  Each is
    placed at the first offset and side that keeps its text off earlier labels and off the stippled concrete, so strings never overprint.
    Dimensions too short to read at the sheet scale are skipped and carried by the layover schedule call-out.  Returns the number drawn."""
    from shapely.geometry import Polygon as _Poly
    from app.agents.sa5_cad_dxf.planset.dimstyle import dim_best
    if not g.present:
        return 0
    fr, f, n = g.frontage, g.flare_m, 0
    sa, sb = g.centre_s - g.width_m / 2, g.centre_s + g.width_m / 2
    nd = view.tp(*fr.xy(0, 1))[0] - view.tp(*fr.xy(0, 0))[0], view.tp(*fr.xy(0, 1))[1] - view.tp(*fr.xy(0, 0))[1]       # paper vector toward the road
    tn = (-nd[0], -nd[1])
    hard = [_Poly([view.tp(*q) for q in p.exterior.coords]) for p in (g.body, g.wing_a, g.wing_b, g.band) if p is not None and not p.is_empty]
    # width at boundary: dimension line on the lot side so it does not meet the kerb dimensions
    if dim_best(view, view.tp(*fr.xy(sa, 0)), view.tp(*fr.xy(sb, 0)), _fmt_m(g.width_m), (6.0, 10.0, 14.0), (tn,), 2.5, hard) is not None:
        n += 1
    # width at kerb: across the outer wing tips, on the road side
    if dim_best(view, view.tp(*fr.xy(sa - f, g.avail_m)), view.tp(*fr.xy(sb + f, g.avail_m)), _fmt_m(g.width_m + 2 * f), (15.0, 19.0, 23.0), (nd,), 2.5, hard) is not None:
        n += 1
    # boundary to kerb: along the normal, left of the band
    s_l = sa - f - REF.band_extra_m - 0.3
    u_paper = (view.tp(*fr.xy(1, 0))[0] - view.tp(*fr.xy(0, 0))[0], view.tp(*fr.xy(1, 0))[1] - view.tp(*fr.xy(0, 0))[1])
    if dim_best(view, view.tp(*fr.xy(s_l, 0)), view.tp(*fr.xy(s_l, g.kerb_offset_m)), _fmt_m(g.kerb_offset_m), (5.0, 9.0, 13.0), ((-u_paper[0], -u_paper[1]), u_paper), 2.5, hard) is not None:
        n += 1
    return n

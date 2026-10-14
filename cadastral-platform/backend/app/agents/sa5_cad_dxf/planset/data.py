"""Plan-set input and the derived Site: geometry, proposed building, terrain surfaces, earthworks, aerial imagery.

Nothing here invents data: where an input is missing the corresponding field is None/empty and the sheet builders print a
'DATA NOT AVAILABLE' panel.  Illustrative items (preset footprint, pad level) are flagged on the drawings.
"""
from __future__ import annotations

import base64
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np
from shapely import wkt as swkt
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from app.agents.sa5_cad_dxf.planset import contours as K
from app.agents.sa5_cad_dxf.planset.refs import Cites
from app.common.contracts import DevelopmentType, DrivewayDesign, LotContext, RwtSummary, ServiceLine

DEV_NAME = {"dwelling_house": "NEW DWELLING", "secondary_dwelling": "GRANNY FLAT", "shed": "SHED", "dual_occupancy": "DUAL OCCUPANCY"}
# Editable ILLUSTRATIVE footprints (width along the street x depth), metres.  Not compliance limits.
PRESET_DIMS = {"shed": (6.0, 4.0), "secondary_dwelling": (9.0, 5.0), "dwelling_house": (15.0, 10.5), "dual_occupancy": (15.0, 10.5)}
DEM_NOTE = "INDICATIVE, DERIVED FROM 5 m DEM; DETAIL SURVEY REQUIRED"


@dataclass
class PlansetInput:
    lot: LotContext
    development_type: DevelopmentType | str = "dwelling_house"
    project_title: str = "Proposed development"
    drawn_by: str = "JCE"
    council_name: str | None = None
    out_stem: str = "planset"
    driveway: DrivewayDesign | None = None
    driveway_checks: list = field(default_factory=list)        # SA3 CheckItem list
    services: list[ServiceLine] = field(default_factory=list)
    rwt: RwtSummary | None = None
    overlay: Any = None                                          # SA7 PlanOverlay (footprint_wkt)
    footprint_wkt: str | None = None                             # explicit footprint (e.g. SA8 layout)
    footprint_source: str = ""
    terrain: Any = None                                          # Sa3TerrainResult
    survey_points: list[tuple[float, float, float]] = field(default_factory=list)
    dem_fetch: Callable[[Polygon], dict | None] | None = None    # polygon -> SurveyInput kwargs (local 5 m DEM)
    levels_note: str = ""
    levels_accuracy_m: float | None = None
    ffl_value: float | None = None                               # design FFL (flood based) if known
    ffl_label: str | None = None
    imagery: Any = None                                          # ImageryProvider or None
    esc_output: Any = None                                       # Sa10EscOutput (optional)
    esc_runner: Callable[["Site"], Any] | None = None            # builds ESC output from the Site (lazy SA10)
    window_m: tuple[float, float] = (120.0, 80.0)
    window_centre: tuple[float, float] | None = None
    unresolved: list[str] = field(default_factory=list)
    acknowledgements: list[str] = field(default_factory=list)
    brand: Any = None
    issue_date: str | None = None
    client: str = ""
    address: str = ""
    zone_code_override: str | None = None
    show_dwelling: bool = False                                  # ref style only: draw the dwelling footprint, hatch, call-out, setbacks and FFL (house design is another tool)
    job: str = ""                                                # job number for the reference-style drawing number (JCE-{job}-CV-1xxx); empty shows XXX
    cadastre_fetch: Callable[[Polygon], Any] | None = None       # window (MGA polygon) -> CadastreWindow: lots in and around the viewport, so the DCDB fills it edge to edge
    rules: list = field(default_factory=list)                    # requirements-resolver / --rules-json entries (setbacks etc.) cited on the general notes sheet


@dataclass
class CadastreWindow:
    """Result of a cadastre window query: lots (and road reserves) in and around a viewport.  ``complete`` is False when the source could not
    supply the whole window (offline fixture, query limit, service error), so the sheet says the DCDB does not reach the viewport edges."""
    lots: list                      # NeighbourLot (label, wkt, is_road) or (label, Polygon, is_road)
    complete: bool = True
    note: str = ""


@dataclass
class Aerial:
    path: str
    extent: tuple[float, float, float, float]
    note: str


@dataclass
class Site:
    inp: PlansetInput
    lot: Polygon
    neighbours: list[tuple[str, Polygon, bool]]
    envelope: Polygon | None
    footprint: Polygon | None
    fp_source: str
    fp_label: str
    ffl: float | None
    ffl_note: str
    drive_cl: LineString | None
    drive_poly: Polygon | None
    crossover: Polygon | None
    turn_path: Any
    tin: Any                              # existing surface Tin (local window DEM if available else SA3 TIN)
    tin_source: str                       # description for notes
    spots: list[tuple[float, float, float]]
    pad: Polygon | None
    surf: Callable | None
    cutfill: Any
    walls: Any
    cites: Cites
    dev: str
    dev_label: str
    big: bool
    front_segs: list
    road_name_by_seq: dict[int, str]
    notes: list[str] = field(default_factory=list)
    missing: dict[str, str] = field(default_factory=dict)
    aerial_site: Aerial | None = None
    aerial_loc: Aerial | None = None
    window: tuple[float, float, float, float] | None = None
    interval: float = 0.5
    ex_cont: list = field(default_factory=list)
    pr_cont: list = field(default_factory=list)
    esc: Any = None
    esc_error: str = ""                                   # why the SA10 layout is absent when its runner failed
    profile: dict | None = None
    window_lots: list = field(default_factory=list)      # cadastre lots fetched for the plan viewports: [(label, Polygon, is_road)] (beyond the adjoining lots)
    cad_cache: list = field(default_factory=list)        # [(window Polygon, complete, note)] of the cadastre windows already fetched
    cad_complete: bool | None = None                     # None = no window fetch hook, True = every window fetched in full, False = a window came back partial or failed
    cad_note: str = ""
    view_twist: float | None = None                      # set-wide plan view twist (degrees counter-clockwise), decided once from the lot

    @property
    def zone(self) -> str:
        return self.inp.zone_code_override or self.inp.lot.zone_code or "UNRESOLVED"

    @property
    def rural(self) -> bool:
        return self.zone.upper().startswith(("RU", "R5", "E", "C")) or self.lot.area > 10000


# ---------------------------------------------------------------------------------------------------------------
def _polys(g) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    return [g] if g.geom_type == "Polygon" else [p for x in getattr(g, "geoms", []) for p in _polys(x)]


def _big(g) -> Polygon | None:
    ps = _polys(g)
    return max(ps, key=lambda p: p.area) if ps else None


def place_building(env: Polygon, lot: Polygon, drive_cl: LineString | None, dims: tuple[float, float], extra: list[tuple[float, float]] = ()) -> Polygon | None:
    """Rectangle of ``dims`` (width W across the driveway direction, depth D along it) inside ``env``, as close to the
    driveway's garage end as possible and aligned with the driveway direction.  None if it does not fit (never shrunk)."""
    if env is None:
        return None
    env_t = env.buffer(0.01)
    if drive_cl is not None and drive_cl.length > 1:
        c = list(drive_cl.coords)
        g = c[-1]
        d = (c[-1][0] - c[-2][0], c[-1][1] - c[-2][1])
        n = math.hypot(*d)
        v = (d[0] / n, d[1] / n)
    else:
        mrr = list(env.minimum_rotated_rectangle.exterior.coords)
        g = env.representative_point().coords[0]
        v = (mrr[1][0] - mrr[0][0], mrr[1][1] - mrr[0][1])
        n = math.hypot(*v)
        v = (v[0] / n, v[1] / n)
    u = (-v[1], v[0])
    W, D = dims
    best, score = None, 1e18
    for dim in [dims] + list(extra):
        W, D = dim
        for f in np.arange(0.0, 60.0, 0.5):
            for cu in np.arange(-25.0, 25.01, 0.5):
                cx, cy = g[0] + v[0] * (f + D / 2) + u[0] * cu, g[1] + v[1] * (f + D / 2) + u[1] * cu
                pts = [(cx + u[0] * sx * W / 2 + v[0] * sy * D / 2, cy + u[1] * sx * W / 2 + v[1] * sy * D / 2)
                       for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                r = Polygon(pts)
                if env_t.contains(r):
                    sc = f + 0.15 * abs(cu)
                    if sc < score:
                        best, score = r, sc
            if best is not None and f > score + 1:
                break
        if best is not None:
            return best
    return best


def _tin_from_survey(kw: dict, srid: int, boundary: Polygon):
    from app.agents.sa3_terrain.ingest import ingest
    from app.agents.sa3_terrain.models import SurveyInput
    from app.agents.sa3_terrain.tin import build_tin
    sv = ingest(SurveyInput(**kw), srid)
    return build_tin(sv, boundary, 2.0, 0.0, 60.0, 1.0), sv


def build_site(inp: PlansetInput) -> Site:
    lot_c = inp.lot
    lot = _big(swkt.loads(lot_c.boundary_wkt))
    env = _big(swkt.loads(lot_c.envelope_wkt)) if lot_c.envelope_wkt else None
    dev = inp.development_type.value if hasattr(inp.development_type, "value") else str(inp.development_type)
    nb = []
    for n in lot_c.neighbours:
        p = _big(swkt.loads(n.wkt))
        if p is not None:
            nb.append((n.label, p, n.is_road))
    drv = inp.driveway
    cl = swkt.loads(drv.centreline_wkt) if drv else None
    if cl is not None and cl.geom_type != "LineString":
        cl = max(getattr(cl, "geoms", [cl]), key=lambda g: g.length)
    dpoly = cl.buffer(drv.width_m / 2, cap_style="flat", join_style="mitre") if cl is not None else None
    xo = _big(swkt.loads(drv.crossover_wkt)) if drv else None
    tp = swkt.loads(drv.turning_path_wkt) if drv and drv.turning_path_wkt else None
    cites = Cites(inp.council_name or lot_c.lga_name)
    notes: list[str] = []
    missing: dict[str, str] = {}

    # ---- proposed building ---------------------------------------------------------------------------------
    fp, src, lab = None, "", ""
    if inp.overlay is not None and getattr(inp.overlay, "footprint_wkt", None):
        fp, src = _big(swkt.loads(inp.overlay.footprint_wkt)), "SA7 PLAN OVERLAY"
        lab = f"PROPOSED {DEV_NAME.get(dev, 'STRUCTURE')} (FROM ARCHITECT PLAN, ALIGNMENT APPROXIMATE)"
    elif inp.footprint_wkt:
        fp, src = _big(swkt.loads(inp.footprint_wkt)), inp.footprint_source or "SA8 LAYOUT"
        lab = f"PROPOSED {DEV_NAME.get(dev, 'STRUCTURE')} ({src})"
    else:
        try:        # SA8 layout (may be mid-build): lazy, optional
            import importlib
            m = importlib.import_module("app.agents.sa8_layout")
            f = getattr(m, "plan_footprint_wkt", None)
            w = f(lot_c, dev) if callable(f) else None
            if w:
                fp, src, lab = _big(swkt.loads(w)), "SA8 LAYOUT", f"PROPOSED {DEV_NAME.get(dev, 'STRUCTURE')} (SA8 LAYOUT)"
        except Exception:  # noqa: BLE001
            pass
        if fp is None and env is not None:
            d0 = PRESET_DIMS.get(dev, (12.0, 9.0))
            fp = place_building(env, lot, cl, d0, extra=[(d0[0] * .8, d0[1] * .85)] if dev in ("dwelling_house", "dual_occupancy") else [])
            if fp is not None:
                src = "SA6 PRESET"
                lab = f"PROPOSED {DEV_NAME.get(dev, 'STRUCTURE')} (ILLUSTRATIVE FOOTPRINT)"
                notes.append(f"Footprint is an ILLUSTRATIVE preset ({_dims(fp)}), placed inside the building envelope near the "
                             "crossover. It is an editable drawing default, NOT a compliance limit or a design.")
            else:
                missing["footprint"] = "building footprint: supply an SA7 plan overlay / SA8 layout, or a building envelope large enough for the preset"
    # ---- terrain --------------------------------------------------------------------------------------------
    tin, tin_src = None, ""
    srid = lot_c.mga_srid
    window_poly = None
    base = [g for g in (fp, dpoly, xo) if g is not None]
    if inp.terrain is not None and getattr(inp.terrain, "tin", None) is not None:
        t = inp.terrain.tin
        from app.agents.sa3_terrain.tin import Tin
        V = np.frombuffer(base64.b64decode(t.vertices_f64_b64), "<f8").reshape(-1, 3)
        T = np.frombuffer(base64.b64decode(t.triangles_u32_b64), "<u4").reshape(-1, 3)
        tin = Tin(V, T)
        tin_src = "SA3 TIN from NSW 5 m DEM"
    spots = [tuple(p) for p in inp.survey_points]
    big = lot.area > 20000
    site = Site(inp, lot, nb, env, fp, src, lab, None, "", cl, dpoly, xo, tp, tin, tin_src, spots, None, None, None, None, cites, dev,
                DEV_NAME.get(dev, dev.upper()), big, [s for s in lot_c.segments if s.is_front], {}, notes, missing)
    # road names per segment
    names = []
    for n in lot_c.road_names:
        if n and n.upper() not in [x.upper() for x in names]:
            names.append(n)
    rs = [s for s in lot_c.segments if s.adjoins == "road" or s.is_front]
    for s in rs:
        site.road_name_by_seq[s.seq] = (names[0] if (s.is_front or len(names) < 2) else names[1]) if names else ""
    if not names:
        missing["road names"] = "road names (SA1 road centreline layer returned none)"
    # ---- local DEM for the plan window (native 5 m posts, wider than the lot) ---------------------------------
    if inp.dem_fetch is not None and (base or lot):
        ref = unary_union(base).buffer(max(inp.window_m) / 2 + 20) if base else lot.buffer(40)
        ref = box(*ref.bounds) if big else box(*unary_union([lot] + base).buffer(40).bounds)
        try:
            kw = inp.dem_fetch(ref)
            if kw and len(kw.get("points", [])) >= 6:
                t2, sv = _tin_from_survey(kw, srid, ref)
                site.tin, site.tin_source = t2, "5 m DEM sampled over the plan window"
                site.spots = [tuple(p) for p in kw["points"]]
        except Exception as ex:  # noqa: BLE001
            notes.append(f"Local DEM for plan window unavailable ({type(ex).__name__}); using the lot-wide SA3 TIN.")
    if site.tin is None:
        missing["terrain"] = "survey levels (run with --levels nsw or supply a detail survey) for contours, earthworks and long sections"
    else:
        _design(site)
    return site


def _dims(fp: Polygon) -> str:
    r = list(fp.minimum_rotated_rectangle.exterior.coords)
    a, b = math.dist(r[0], r[1]), math.dist(r[1], r[2])
    return f"{max(a, b):.1f} x {min(a, b):.1f} m"


def _design(site: Site) -> None:
    """FFL, pad, proposed surface, cut/fill, walls (SA3 routines on the local TIN)."""
    from app.agents.sa3_terrain.cutfill import cut_fill, pad_surface
    from app.agents.sa3_terrain.tin import Tin
    from app.agents.sa3_terrain.walls import find_walls
    fp, tin, inp = site.footprint, site.tin, site.inp
    if fp is None:
        return
    z = tin.z_at(*np.array(fp.exterior.coords).T)
    zin = [v for v in z if np.isfinite(v)]
    if inp.ffl_value is not None and inp.ffl_label:
        site.ffl, site.ffl_note = float(inp.ffl_value), inp.ffl_label
    elif zin:
        site.ffl = round(round(float(np.mean(zin)) / 0.05) * 0.05, 2)
        site.ffl_note = "ILLUSTRATIVE FFL = mean existing ground under footprint; design FFL (flood / drainage / architect) TO BE CONFIRMED"
    else:
        return
    pad = fp.buffer(0.9, join_style=2)
    site.pad = pad
    site.surf = pad_surface(tin, pad, site.ffl, 2.0, 3.0)
    try:
        # local sub-TIN around the building for a fine cut/fill grid (the lot-wide TIN may be thin)
        reach = 45.0
        V = tin.vertices
        m = (V[:, 0] > pad.bounds[0] - reach) & (V[:, 0] < pad.bounds[2] + reach) & (V[:, 1] > pad.bounds[1] - reach) & (V[:, 1] < pad.bounds[3] + reach)
        sub = Tin(V[m]) if m.sum() >= 6 else tin
        sf = pad_surface(sub, pad, site.ffl, 2.0, 3.0)
        region = site.lot.intersection(box(pad.bounds[0] - reach, pad.bounds[1] - reach, pad.bounds[2] + reach, pad.bounds[3] + reach))
        acc = inp.levels_accuracy_m if inp.levels_accuracy_m is not None else 5.0
        site.cutfill = cut_fill(sub, sf, region=region, spacing=1.0, footprint=fp, accuracy_m=acc, pad_level=site.ffl)
        site.walls = find_walls(sub, fp, site.ffl, 0.5)
    except Exception as ex:  # noqa: BLE001
        site.notes.append(f"Earthworks quantities not computed ({type(ex).__name__}: {ex})")


def contour_sets(site: Site, window: tuple[float, float, float, float]) -> None:
    """Existing and proposed contours over the plan window (shared interval)."""
    tin = site.tin
    if tin is None:
        return
    x0, y0, x1, y1 = window
    V = tin.vertices
    inw = (V[:, 0] >= x0 - 20) & (V[:, 0] <= x1 + 20) & (V[:, 1] >= y0 - 20) & (V[:, 1] <= y1 + 20)
    zs = V[inw, 2] if inw.any() else V[:, 2]
    relief = float(zs.max() - zs.min())
    site.interval = K.pick_interval(relief, 0.5)
    T = tin.triangles.astype(int)
    site.ex_cont = K.contours_from_mesh(V, T, site.interval, zrange=(float(V[:, 2].min()), float(V[:, 2].max())))
    site.pr_cont = []
    if site.surf is not None and site.pad is not None:
        b = site.pad.buffer(35).bounds
        Vp, Tp = K.grid_mesh(lambda x, y: np.where(np.isfinite(tin.z_at(x, y)), site.surf(x, y), np.nan), b, 0.75)
        if len(Tp):
            site.pr_cont = K.contours_from_mesh(Vp, Tp, site.interval, zrange=(float(Vp[:, 2][np.isfinite(Vp[:, 2])].min()),
                                                                              float(Vp[:, 2][np.isfinite(Vp[:, 2])].max())))

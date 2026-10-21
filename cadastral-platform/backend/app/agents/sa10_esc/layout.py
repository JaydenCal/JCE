"""Deterministic ESCP layout engine (shapely, MGA metres). Same input -> same output; nothing is random.

Rules come only from cited requirements (ReqView). Numbers that are not in the governing documents are never invented:
the element is flagged ``unresolved`` and listed. Pure drawing choices are LayoutParams and are listed as assumptions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import shapely
import shapely.affinity
from shapely import wkt as swkt
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.prepared import prep

from app.common.contracts import DevelopmentType

from .models import EscElement, FlowInfo, Sa10EscInput
from .reqs import ReqView

LAYER = {"fence": "C-ESC-FENC", "return": "C-ESC-FENC", "access": "C-ESC-ACCS", "stockpile": "C-ESC-STOK", "topsoil": "C-ESC-STOK",
         "laydown": "C-ESC-STOK", "washout": "C-ESC-WSHT", "bin": "C-ESC-BINS", "toilet": "C-ESC-BINS", "inlet": "C-ESC-INLT",
         "diversion": "C-ESC-DIVR", "berm": "C-ESC-DIVR", "check_dam": "C-ESC-CHKD", "limit": "C-ESC-LIMT", "nogo": "C-ESC-NOGO"}


def unit(v: tuple[float, float]) -> tuple[float, float]:
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n > 1e-12 else (0.0, 0.0)


def lines_of(g: BaseGeometry | None) -> list[LineString]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    return [x for p in getattr(g, "geoms", []) for x in lines_of(p)]


def polys_of(g: BaseGeometry | None) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [x for p in getattr(g, "geoms", []) for x in polys_of(p)]


def fit_plane(pts: list[tuple[float, float, float]], lot: Polygon, buf: float = 10.0):
    """Least-squares plane z = a x + b y + c over survey points near the lot. Returns (a, b, n) or None."""
    sel = [p for p in pts if lot.buffer(buf).contains(Point(p[0], p[1]))]
    if len(sel) < 4:
        return None
    A = np.asarray(sel, float)
    x0, y0 = A[:, 0].mean(), A[:, 1].mean()
    M = np.c_[A[:, 0] - x0, A[:, 1] - y0, np.ones(len(A))]
    if np.linalg.matrix_rank(M) < 3 or np.ptp(A[:, 0]) < 1 or np.ptp(A[:, 1]) < 1:
        return None
    coef, *_ = np.linalg.lstsq(M, A[:, 2], rcond=None)
    res = A[:, 2] - M @ coef
    rms = float(np.sqrt(np.mean(res ** 2)))
    relief = float(math.hypot(coef[0], coef[1]) * max(np.ptp(A[:, 0]), np.ptp(A[:, 1])))
    return float(coef[0]), float(coef[1]), len(sel), rms, relief


@dataclass
class Layout:
    elements: list[EscElement] = field(default_factory=list)
    flow: FlowInfo | None = None
    quantities: dict = field(default_factory=dict)
    assumptions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    lot: Polygon | None = None
    footprint: Polygon | None = None
    crossover: BaseGeometry | None = None
    drive: BaseGeometry | None = None
    low: Polygon | None = None
    front_normal: tuple[float, float] = (0.0, 1.0)
    elem_used: dict[str, list[str]] = field(default_factory=dict)   # element id -> unresolved keys
    z_plane: tuple[float, float, float] | None = None              # z = a x + b y + c (draping 3D parts)
    drive_axis: tuple[float, float] = (0.0, 0.0)
    bp: tuple[float, float] = (0.0, 0.0)
    diversion_lines: list = field(default_factory=list)


def _wkt(g: BaseGeometry) -> str:
    return shapely.to_wkt(g, rounding_precision=3)


def build_layout(inp: Sa10EscInput, rq: ReqView) -> Layout:
    P = inp.params
    L = Layout()
    lot = swkt.loads(inp.lot.boundary_wkt)
    if lot.is_empty or not lot.is_valid:
        lot = lot.buffer(0)
    lot = max(polys_of(lot), key=lambda p: p.area)
    L.lot = lot
    dt = inp.development_type
    kind_sizes = P.sizes["shed" if dt is DevelopmentType.shed else "dwelling"]
    cx = lot.centroid

    # ---- front segment, road normal
    seg = next((s for s in inp.lot.segments if s.seq == inp.front_segment_seq), None) or next((s for s in inp.lot.segments if s.is_front), None)
    if seg is None:
        seg = max(inp.lot.segments, key=lambda s: s.distance_m)
        L.warnings.append("No front boundary segment flagged; the longest boundary segment is assumed to be the road frontage.")
    fa, fb = seg.start_xy, seg.end_xy
    front = LineString([fa, fb])
    t = unit((fb[0] - fa[0], fb[1] - fa[1]))
    n = (t[1], -t[0])
    mid = front.interpolate(0.5, normalized=True)
    if lot.contains(Point(mid.x + n[0] * 0.5, mid.y + n[1] * 0.5)):
        n = (-n[0], -n[1])                      # n points OUT of the lot, towards the road
    L.front_normal = n

    # ---- footprint
    foot_note = None
    if inp.footprint_wkt:
        fp = unary_union(polys_of(swkt.loads(inp.footprint_wkt)))
    elif inp.lot.envelope_wkt:
        fp = unary_union(polys_of(swkt.loads(inp.lot.envelope_wkt)))
        foot_note = "No building footprint supplied: the building envelope is used as the works area (a footprint will be smaller)."
    else:
        fp = lot.buffer(-max(4.0, 0.2 * math.sqrt(lot.area)))
        foot_note = "No building footprint or envelope supplied: an inset of the lot is used as the works area."
    if foot_note:
        L.warnings.append(foot_note)
    fp = fp.intersection(lot)
    if fp.is_empty:
        fp = lot.buffer(-4.0)
    L.footprint = fp

    # ---- flow direction
    plane = fit_plane(inp.terrain_points, lot) if inp.terrain_points else None
    flow_assumed, slope_pct = True, None
    if plane is not None:
        a, b, npts, rms, relief = plane
        slope_pct = math.hypot(a, b) * 100.0
        if slope_pct >= P.flat_slope_pct:
            d = unit((-a, -b))
            src = f"terrain plane fit ({npts} survey points), fall {slope_pct:.1f}%"
            flow_assumed = False
        else:
            d = n
            src = f"site effectively flat (fitted fall {slope_pct:.2f}% < {P.flat_slope_pct}% layout threshold): flow assumed towards the road frontage"
            L.warnings.append(src)
        sel = [p for p in inp.terrain_points if lot.buffer(10).contains(Point(p[0], p[1]))]
        A = np.asarray(sel, float)
        L.z_plane = (a, b, float(np.mean(A[:, 2]) - a * np.mean(A[:, 0]) - b * np.mean(A[:, 1])))
    else:
        d = n
        src = "flow direction assumed from boundary/road (towards the road frontage), no levels"
        L.warnings.append("No levels supplied: flow direction assumed from boundary/road, no levels. Sediment fence, diversion and check-dam positions are provisional.")
    unc, note, rms_v = False, "", None
    if plane is not None:
        rms_v = rms
        unc = relief < 3 * rms or npts < 12
        note = (f"Plane-fit residual {rms:.2f} m over {relief:.2f} m of fitted relief" +
                ("; direction is UNCERTAIN (coarse 5 m DEM, small relief): fence is placed on the computed downslope side - confirm with a detail survey." if unc
                 else "; source levels are a coarse 5 m DEM: confirm the fall direction on site."))
        if unc:
            L.warnings.append("Fall direction uncertain: " + note)
    L.flow = FlowInfo(direction=d, slope_pct=slope_pct, source=src, assumed=flow_assumed,
                      bearing_deg=(math.degrees(math.atan2(d[0], d[1])) + 360.0) % 360.0, note=note, uncertain=unc, rms_m=rms_v)
    contour = (-d[1], d[0])
    theta = math.degrees(math.atan2(contour[1], contour[0]))

    def proj(p) -> float:
        return p[0] * d[0] + p[1] * d[1]

    # ---- cited values (None => unresolved, never defaulted)
    g = rq.get
    w_min = (g("esc.access.min_width_m") or None)
    len_bb = g("esc.access.min_length_m")
    len_bs = g("esc.access.min_length_building_sites_m")
    h_min, h_pref = g("esc.stockpile.min_distance_from_hazard_m"), g("esc.stockpile.preferred_distance_from_hazard_m")
    wash_buf = g("esc.washout.buffer_around_largest_equipment_m")
    interval = g("esc.sediment_fence.return_interval_m")
    max_site = g("esc.escp.max_site_area_m2")
    for k in ("esc.sediment_fence.offset_from_boundary_m", "esc.sediment_fence.max_length_m", "esc.sediment_fence.return_length_m",
              "esc.stockpile.setback_from_lot_boundary_m", "esc.buffer.min_from_drainage_line_m", "esc.inlet.kerb_trap_dimensions",
              "esc.check_dam.spacing_and_height", "esc.diversion.bund_dimensions_and_grade", "esc.washout.setback_from_boundary_and_size",
              "esc.amenities.toilet_location_setback", "esc.waste.bin_location_setback"):
        rq.miss(k)

    def cites(keys: list[str]) -> list[str]:
        out = []
        for k in keys:
            r = rq.used.get(k)
            if r:
                out.append(f"{k} = {r.value}{(' ' + r.req.unit) if r.req.unit else ''} [{r.tag}]")
        return out

    elems: list[EscElement] = []

    def add(id_, kind, geom, label, status, req_keys, unres_keys, notes=None, quantity=None, unit_=None):
        for k in req_keys:
            rq.get(k)
        keys = [k for k in req_keys if k in rq.used]
        elems.append(EscElement(id=id_, kind=kind, layer=LAYER[kind], label=label, geometry_wkt=_wkt(geom), status=status,
                                req_keys=keys, unresolved_keys=list(unres_keys), citations=cites(keys), notes=notes or [],
                                quantity=None if quantity is None else round(quantity, 2), quantity_unit=unit_))
        L.elem_used[id_] = list(unres_keys)

    # ---- crossover / driveway / access
    xo = swkt.loads(inp.driveway.crossover_wkt) if inp.driveway and inp.driveway.crossover_wkt else None
    cl = swkt.loads(inp.driveway.centreline_wkt) if inp.driveway and inp.driveway.centreline_wkt else None
    L.crossover = xo
    drive_w = inp.driveway.width_m if inp.driveway else 3.0
    L.drive = cl.buffer(drive_w / 2, cap_style=2) if cl is not None and not cl.is_empty else None
    inward = (-n[0], -n[1])
    access_note: list[str] = []
    if cl is not None and not cl.is_empty:
        inter = cl.intersection(front)
        if not inter.is_empty:
            bp = (inter.centroid.x, inter.centroid.y)
        else:
            bp = tuple(front.interpolate(front.project(Point(cl.coords[0]))).coords[0])
        pts = [Point(c) for c in cl.coords]
        # direction: from boundary point along the centreline into the lot
        inside = [c for c in cl.coords if lot.contains(Point(c))]
        tgt = inside[0] if inside else cl.coords[-1]
        axis = unit((tgt[0] - bp[0], tgt[1] - bp[1])) if math.hypot(tgt[0] - bp[0], tgt[1] - bp[1]) > 0.5 else inward
        if axis[0] * inward[0] + axis[1] * inward[1] < 0.2:
            axis = inward
    else:
        off = front.length * 0.5
        bp = tuple(front.interpolate(off).coords[0])
        axis = inward
        access_note.append("No driveway design supplied: the stabilised access is placed at the middle of the frontage (provisional).")
    L.warnings += access_note
    width = max(w_min.value if w_min else 0.0, drive_w if inp.driveway else 0.0, 0.0) or 3.0
    # available length along the axis before the building / far boundary
    ray = LineString([(bp[0] + axis[0] * 0.1, bp[1] + axis[1] * 0.1), (bp[0] + axis[0] * 300, bp[1] + axis[1] * 300)])
    # with no building footprint supplied the works area is only an envelope or an inset of the lot: it is not a building, so it does not shorten the
    # access (the access runs to the far boundary or the cited length, whichever is shorter)
    hits = [ray.intersection(lot.exterior)] + ([ray.intersection(fp.buffer(1.0))] if inp.footprint_wkt else [])
    avail = min((h.distance(Point(bp)) for h in hits if not h.is_empty), default=0.0)
    want = len_bb.value if len_bb else (len_bs.value if len_bs else 3.0)
    alen = min(want, avail) if avail > 0 else 0.0
    if alen < 0.5:
        alen = min(want, 3.0)
    pad_line = LineString([(bp[0] - n[0] * 0.0, bp[1] - n[1] * 0.0), (bp[0] + axis[0] * alen, bp[1] + axis[1] * alen)])
    access = pad_line.buffer(width / 2, cap_style=2).intersection(lot.buffer(0.05))
    unres_a: list[str] = []
    notes_a = [f"Width {width:g} m; aggregate to 'maximum 75 mm' and 'at least ... 200 mm thick' on needle-punched geotextile per cited Blue Book 6.3.9." if rq.get("esc.access.thickness_mm") else
               "Aggregate size/thickness not resolved."]
    status_a = "resolved"
    if len_bb and alen + 1e-6 < len_bb.value:
        status_a = "unresolved"
        notes_a.append(f"Blue Book length {len_bb.value:g} m not achievable ahead of the building (available {alen:.1f} m); length provided {alen:.1f} m "
                       f"(2024 Building Sites minimum {len_bs.value:g} m). To be confirmed by the designer/certifier.")
    if not (len_bb and w_min):
        status_a = "unresolved"
        unres_a.append("esc.access.min_length_m")
    if not inp.driveway:
        status_a = "unresolved"
        notes_a.append("Driveway/crossover not supplied; position provisional.")
    access_keys = ["esc.access.min_width_m", "esc.access.min_length_m", "esc.access.min_length_building_sites_m", "esc.access.max_aggregate_mm",
                   "esc.access.thickness_mm", "esc.access.geotextile_underlay", "esc.access.surface", "esc.access.divert_surface_water",
                   "esc.access.build_on_level_area"]
    add("ACC1", "access", access, "Stabilised site access", status_a, access_keys, unres_a, notes_a, access.area, "m2")
    L.drive_axis, L.bp = axis, bp
    # diversion berm across the access if it slopes toward the road
    slopes_to_road = (d[0] * n[0] + d[1] * n[1]) > 0.3
    if slopes_to_road:
        bpos = (bp[0] + axis[0] * min(1.0, alen), bp[1] + axis[1] * min(1.0, alen))
        perp = (-axis[1], axis[0])
        berm = LineString([(bpos[0] - perp[0] * width / 2 - perp[0] * 0.5, bpos[1] - perp[1] * width / 2 - perp[1] * 0.5),
                           (bpos[0] + perp[0] * width / 2 + perp[0] * 0.5, bpos[1] + perp[1] * width / 2 + perp[1] * 0.5)])
        add("BRM1", "berm", berm, "Diversion berm across access", "unresolved" if flow_assumed else "resolved",
            ["esc.access.diversion_berm_if_sloping_to_road"], ["esc.diversion.bund_dimensions_and_grade"],
            ["Access slopes towards the road"] + (["Fall direction assumed (no levels)"] if flow_assumed else []), berm.length, "m")

    # ---- constraint geometry
    tree_geoms, tree_elems = [], []
    for i, tp in enumerate(inp.tree_points, 1):
        r = tp.protect_radius_m
        tree_geoms.append(Point(tp.xy).buffer(r if r else 3.0))
        tree_elems.append((i, tp, r))
    svc_excl = [swkt.loads(s.exclusion_wkt) for s in inp.services if s.exclusion_wkt]
    drain = [swkt.loads(w) for w in inp.drainage_lines_wkt]
    hazards = [front] + ([xo] if xo is not None else []) + ([L.drive] if L.drive is not None else []) + [access] + drain
    if inp.kerb_inlet_points:
        hazards += [Point(p) for p in inp.kerb_inlet_points]
    H = unary_union(hazards)

    small = max_site is not None and lot.area <= max_site.value
    inset_lot = lot.buffer(-P.boundary_inset_m)
    F = (lot.buffer(-(P.boundary_inset_m + P.low_margin_m)).difference(fp.buffer(1.0)).difference(access.buffer(1.0))
         .difference(unary_union(svc_excl) if svc_excl else Polygon()).difference(unary_union(tree_geoms) if tree_geoms else Polygon()))
    # Search areas for the activity areas.  With a real building footprint the building is always excluded.  With none (only the building envelope, which is not
    # a building) the first search keeps clear of the envelope; when no position there meets the cited clearances the WHOLE lot inside the fence line is searched
    # and an item placed that way is marked unresolved and says so ("+lot" tier), so it is re-checked when the building is set out.
    F_whole = (lot.buffer(-(P.boundary_inset_m + P.low_margin_m)).difference(access.buffer(1.0))
               .difference(unary_union(svc_excl) if svc_excl else Polygon()).difference(unary_union(tree_geoms) if tree_geoms else Polygon()))
    anchor = access.centroid
    core = unary_union([fp, access] + ([L.drive] if L.drive is not None else []))
    window = core.buffer(P.search_radius_m)
    Fw = F.intersection(window)
    Fw_whole = F_whole.intersection(window)
    areas: list[tuple[str, BaseGeometry]] = [("", Fw)] + ([] if inp.footprint_wkt else [("+lot", Fw_whole)])
    proj_limit = proj(fp.centroid.coords[0])
    occupied: list[Polygon] = []

    def place(name, size, id_, kind, label, extra_keys=(), rule_keys_missing=(), need_hazard=True, hazard_override=None, upslope_pref=True):
        Lg, Wd = size
        for suffix, area in areas:
            r, tier = _place_in(area, Lg, Wd, need_hazard, hazard_override, upslope_pref)
            if r is not None:
                return r, tier + suffix
        return None, "none"

    def _place_in(Fw, Lg, Wd, need_hazard, hazard_override, upslope_pref):
        occ = unary_union(occupied) if occupied else None
        step = P.grid_step_m if Fw.area < 4000 else 1.0
        x0, y0, x1, y1 = Fw.bounds if not Fw.is_empty else (0, 0, 0, 0)
        xs, ys = np.arange(x0, x1 + 1e-9, step), np.arange(y0, y1 + 1e-9, step)
        if len(xs) == 0 or len(ys) == 0 or Fw.is_empty:
            return None, "none"
        gx, gy = np.meshgrid(xs, ys)
        gx, gy = gx.ravel(), gy.ravel()
        ok = shapely.contains_xy(Fw, gx, gy)
        gx, gy = gx[ok], gy[ok]
        if not len(gx):
            return None, "none"
        pts = shapely.points(gx, gy)
        hd_arr = shapely.distance(pts, H)
        pr = gx * d[0] + gy * d[1]
        Fp = prep(Fw)
        tiers: list[tuple[float | None, bool, str]] = []
        hp, hm = (h_pref.value if h_pref else None), (h_min.value if h_min else None)
        hz = hazard_override
        if hz is not None:
            tiers = [(hz, True, "rule"), (hz, False, "rule-any-slope")]
        elif need_hazard and hp is not None:
            tiers = [(hp, True, "preferred"), (hp, False, "preferred-downslope"), (hm, True, "minimum"), (hm, False, "minimum-downslope")]
        else:
            tiers = [(0.0, True, "no-rule"), (0.0, False, "no-rule")]
        tiers = [t for t in tiers if t[0] is not None]
        for hd, up, tier in tiers:
            sel = (hd_arr >= hd) & ((pr <= proj_limit + 1e-9) if (up and upslope_pref) else True)
            if not sel.any():
                continue
            cand = np.flatnonzero(sel)
            order = cand[np.argsort(np.hypot(gx[cand] - anchor.x, gy[cand] - anchor.y), kind="stable")]
            for i in order:
                for ang in (theta, theta + 90.0):
                    r = shapely.affinity.rotate(box(-Lg / 2, -Wd / 2, Lg / 2, Wd / 2), ang, origin=(0, 0))
                    r = shapely.affinity.translate(r, gx[i], gy[i])
                    if not Fp.contains(r):
                        continue
                    if r.distance(H) < hd:
                        continue
                    if occ is not None and r.distance(occ) < 1.4:
                        continue
                    occupied.append(r)
                    return r, tier
        return None, "none"

    # ---- stockpiles & activity areas
    placed: dict[str, tuple[Polygon | None, str]] = {}
    spec = [("SP1", "stockpile", "Soil stockpile", "stockpile", ("esc.stockpile.min_distance_from_hazard_m", "esc.stockpile.preferred_distance_from_hazard_m",
             "esc.stockpile.avoid_downslope_of_construction", "esc.stockpile.within_site_behind_sediment_controls", "esc.stockpile.max_height_m",
             "esc.stockpile.upslope_diversion_and_downslope_filter", "esc.stockpile.cover_when_unattended", "esc.stockpile.hazard_areas")),
            ("TS1", "topsoil", "Topsoil stockpile", "topsoil", ("esc.stockpile.min_distance_from_hazard_m", "esc.stockpile.preferred_distance_from_hazard_m",
             "esc.topsoil.strip_depth_min_mm", "esc.topsoil.strip_depth_max_mm", "esc.stockpile.stabilise_if_longer_than_days")),
            ("LD1", "laydown", "Materials laydown / delivery area", "laydown", ("esc.stockpile.min_distance_from_hazard_m", "esc.stockpile.preferred_distance_from_hazard_m",
             "esc.stockpile.not_on_footpath_or_road_reserve")),
            ("WS1", "washout", "Concrete washout / wash-down (bunded)", "washout", ("esc.washout.buffer_around_largest_equipment_m", "esc.washout.bunded",
             "esc.washout.level_area", "esc.washout.not_drain_to_stormwater_or_no_go", "esc.washout.sediment_controls_downslope",
             "esc.washout.collect_and_treat_wastewater", "esc.washout.concrete_pump_plastic_sheet")),
            ("BIN1", "bin", "Waste bin", "bin", ("esc.waste.provide_approved_bins", "esc.waste.bin_clearance_interval")),
            ]
    if dt is not DevelopmentType.shed:
        spec.append(("WC1", "toilet", "Portable toilet", "toilet", ("esc.amenities.staff_facilities_contain_effluent",)))
    lot_wide: list[str] = []
    for id_, kind, label, sk, keys in spec:
        size = kind_sizes[sk]
        if kind == "washout":
            r, tier = place(sk, size, id_, kind, label, hazard_override=(wash_buf.value if wash_buf else None), need_hazard=True)
        elif kind in ("bin", "toilet"):
            r, tier = place(sk, size, id_, kind, label, need_hazard=False)
        else:
            r, tier = place(sk, size, id_, kind, label)
        placed[id_] = (r, tier)
        if r is not None and tier.endswith("+lot"):
            lot_wide.append(label)
        if r is None:
            L.warnings.append(f"{label}: no position satisfies the cited clearances inside the lot; not drawn. To be confirmed by the designer/certifier.")
            for k in keys:
                rq.get(k)
            L.elem_used[id_] = ["placement"]
            continue
        unres: list[str] = []
        notes = [f"Footprint {size[0]:g} x {size[1]:g} m (layout assumption), long axis along the contour."]
        status = "resolved"
        if tier.endswith("+lot"):
            tier = tier[:-4]
            status = "unresolved"
            notes.append("No building footprint was supplied and no position outside the building envelope meets the cited clearances, so the whole lot was searched: this item may sit where "
                         "the building will be. Re-check its position against the building when it is set out.")
        if kind in ("stockpile", "topsoil", "laydown"):
            unres.append("esc.stockpile.setback_from_lot_boundary_m")
            if tier.startswith("minimum"):
                status = "unresolved"
                notes.append(f"Only the minimum {h_min.value:g} m clearance from hazard areas could be achieved (preferred {h_pref.value:g} m).")
            elif tier == "preferred-downslope":
                status = "unresolved"
                notes.append("No position upslope of the building clears the preferred hazard distance; placed beside/downslope. Cover and fence it.")
            elif tier == "minimum-downslope":
                status = "unresolved"
                notes.append("Minimum clearance only and not upslope of the construction: to be confirmed.")
            else:
                notes.append(f"{h_pref.value:g} m (preferred) from drains, driveways, the road and concentrated flow; not downslope of the building.")
            if flow_assumed:
                status = "unresolved"
                notes.append("Upslope/downslope assessed on an assumed flow direction (no levels).")
        elif kind == "washout":
            unres.append("esc.washout.setback_from_boundary_and_size")
            if not wash_buf:
                status = "unresolved"
            if slope_pct is None or slope_pct > P.flat_slope_pct * 6:
                notes.append("Ground must be level at the washout (cited): confirm on site." )
        elif kind == "bin":
            unres.append("esc.waste.bin_location_setback"); status = "unresolved"
        elif kind == "toilet":
            unres.append("esc.amenities.toilet_location_setback"); status = "unresolved"
        add(id_, kind, r, label, status, list(keys), unres, notes, r.area, "m2")

    if lot_wide:
        L.warnings.append(f"No building footprint was supplied and no position outside the building envelope meets the cited clearances: {', '.join(x.lower() for x in lot_wide)} placed by "
                          "searching the whole lot (they may sit where the building will be). Re-check against the building when it is set out.")

    # ---- limit of works / disturbed area
    items = [r for r, _ in placed.values() if r is not None]
    hull_core = unary_union([fp, access] + items + ([L.drive] if L.drive is not None else []))
    est_poly = hull_core.convex_hull.buffer(P.low_margin_m).intersection(inset_lot)
    est_area = inp.disturbed_area_m2 if inp.disturbed_area_m2 is not None else est_poly.area
    if small:
        low = inset_lot
        L.assumptions.append(f"Lot is within the {max_site.value:g} m2 ESCP site-size range: the whole site is treated as the limit of works "
                             f"(fence set in {P.boundary_inset_m:g} m from the boundary).")
    else:
        low = est_poly
    low = max(polys_of(low), key=lambda p: p.area)
    L.low = low
    add("LOW1", "limit", low.exterior, "Limit of works", "resolved", ["esc.nogo.mark_sensitive_areas_and_trees"], [],
        ["Install before work starts; all site personnel to be inducted."], low.length, "m")

    # ---- sediment fence along the downslope edges of the limit of works
    ring = orient(low, 1.0).exterior
    cs = list(ring.coords)
    kinds = []
    for p, q in zip(cs[:-1], cs[1:]):
        e = (q[0] - p[0], q[1] - p[1])
        ln = math.hypot(*e)
        if ln < 1e-9:
            kinds.append(("skip", p, q)); continue
        nn = (e[1] / ln, -e[0] / ln)                       # outward normal (CCW ring)
        c = nn[0] * d[0] + nn[1] * d[1]
        kinds.append(("down" if c > P.edge_cos else "up" if c < -P.edge_cos else "side", p, q))

    def runs(label):
        out, cur = [], []
        seq = kinds + kinds                                 # cyclic
        started = False
        # rotate so that a run is never split across the ring start
        idx0 = next((i for i, k in enumerate(kinds) if k[0] != label), None)
        if idx0 is None:
            return [[(k[1], k[2]) for k in kinds]]
        rot = kinds[idx0:] + kinds[:idx0]
        for k in rot:
            if k[0] == label:
                cur.append((k[1], k[2]))
            elif cur:
                out.append(cur); cur = []
        if cur:
            out.append(cur)
        return out

    def run_line(r):
        pts = [r[0][0]] + [q for _, q in r]
        return LineString(pts)

    down_lines = [run_line(r) for r in runs("down")]
    up_lines = [run_line(r) for r in runs("up")]
    gap = unary_union([access.buffer(0.3)] + ([xo.buffer(0.3)] if xo is not None else []))
    fence_geom = unary_union(down_lines).difference(gap) if down_lines else None
    fence_lines = [l for l in lines_of(fence_geom) if l.length > 0.2]
    fence_len = sum(l.length for l in fence_lines)
    returns: list[LineString] = []
    inside = lot.buffer(-0.05)
    all_fence_lines: list[LineString] = []

    def make_returns(lines, interior=True):
        """Ends angled upslope (cited) and small returns every cited interval along long runs."""
        out_r: list[LineString] = []
        for l in lines:
            cs_ = list(l.coords)
            ends = ((cs_[0], cs_[1]), (cs_[-1], cs_[-2]))
            for end, other in ends:
                tang = unit((end[0] - other[0], end[1] - other[1]))
                dirv = unit((tang[0] - d[0], tang[1] - d[1]))
                r = LineString([end, (end[0] + dirv[0] * P.return_length_m, end[1] + dirv[1] * P.return_length_m)]).intersection(inside)
                out_r += [x for x in lines_of(r) if x.length > 0.1]
            if interior and interval:
                s_ = interval.value
                while s_ < l.length - 1.0:
                    p = l.interpolate(s_)
                    r = LineString([(p.x, p.y), (p.x - d[0] * P.return_length_m, p.y - d[1] * P.return_length_m)]).intersection(inside)
                    out_r += [x for x in lines_of(r) if x.length > 0.1]
                    s_ += interval.value
        return out_r

    fence_keys = ["esc.sediment_fence.place_downslope", "esc.sediment_fence.along_contour", "esc.sediment_fence.ends_turn_upslope",
                  "esc.sediment_fence.return_interval_m", "esc.sediment_fence.post_spacing_m", "esc.sediment_fence.trench_depth_mm",
                  "esc.sediment_fence.joint_overlap_mm", "esc.sediment_fence.not_across_drainage_line", "esc.sediment_fence.no_material_against_fence",
                  "esc.sediment_fence.max_subcatchment_flow_l_s", "esc.sediment_fence.near_source", "esc.sediment_fence.design_life_months"]
    fall_note = (f"Fall {slope_pct:.1f}% towards bearing {L.flow.bearing_deg:.0f} deg (grid). " + L.flow.note) if slope_pct is not None else "Flow direction assumed from boundary/road, no levels."
    fnotes = ["Along the downslope limit of works, following the contour (cited); ends angled upslope; opens at the stabilised access.", fall_note]
    fence_unres = ["esc.sediment_fence.offset_from_boundary_m", "esc.sediment_fence.max_length_m", "esc.sediment_fence.return_length_m"]
    fstatus = "unresolved" if (flow_assumed or L.flow.uncertain) else "resolved"
    n_fence = 0

    def add_fence(id_, label, lines, notes, status, unres):
        lines = [l for l in lines if l.length > 0.2]
        if not lines:
            return
        all_fence_lines.extend(lines)
        returns.extend(make_returns(lines))
        add(id_, "fence", MultiLineString(lines), label, status, fence_keys, unres, notes, sum(l.length for l in lines), "m")

    if fence_lines:
        add_fence("FNC1", "Sediment fence - downslope limit of works", fence_lines, fnotes, fstatus, fence_unres)
    else:
        L.warnings.append("No downslope limit-of-works edge found for the sediment fence.")
    existing = unary_union(fence_lines) if fence_lines else None

    # toe of the works: contour-parallel fence across the full width at the downslope extreme of the disturbed area
    try:
        pmax = max(proj(c_) for c_ in est_poly.exterior.coords)
        cen = est_poly.centroid
        cp = (cen.x + d[0] * (pmax - proj((cen.x, cen.y))), cen.y + d[1] * (pmax - proj((cen.x, cen.y))))
        cl_ = LineString([(cp[0] - contour[0] * 400, cp[1] - contour[1] * 400), (cp[0] + contour[0] * 400, cp[1] + contour[1] * 400)])
        toe = cl_.intersection(inset_lot).difference(gap)
        if existing is not None:
            toe = toe.difference(existing.buffer(2.0))
        toe_lines = [l for l in lines_of(toe) if l.length > 2.0]
        if toe_lines:
            add_fence("FNT1", "Sediment fence - toe of works (along the contour)", toe_lines,
                      ["Contour-parallel line at the downslope edge of the disturbed area / building pad, spanning the lot; ends angled upslope.", fall_note],
                      fstatus, fence_unres)
    except ValueError:
        pass

    for id_, kind in (("SP1", "stockpile"), ("TS1", "topsoil"), ("LD1", "laydown"), ("WS1", "washout")):
        r = placed.get(id_, (None, ""))[0]
        if r is None:
            continue
        rc = r.centroid
        best = None
        cs_ = list(r.exterior.coords)
        for p0, p1 in zip(cs_[:-1], cs_[1:]):
            e = unit((p1[0] - p0[0], p1[1] - p0[1]))
            nn = (e[1], -e[0])
            mid_ = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            if (mid_[0] - rc.x) * nn[0] + (mid_[1] - rc.y) * nn[1] < 0:
                nn = (-nn[0], -nn[1])
            cv = nn[0] * d[0] + nn[1] * d[1]
            if best is None or cv > best[0]:
                best = (cv, p0, p1, nn)
        cv, p0, p1, nn = best
        off = 0.4
        ext = unit((p1[0] - p0[0], p1[1] - p0[1]))
        a0 = (p0[0] + nn[0] * off - ext[0] * 0.5, p0[1] + nn[1] * off - ext[1] * 0.5)
        a1 = (p1[0] + nn[0] * off + ext[0] * 0.5, p1[1] + nn[1] * off + ext[1] * 0.5)
        add_fence(f"SF-{id_}", f"Sediment fence - downslope of {id_}", [LineString([a0, a1]).intersection(lot.buffer(-0.1))] if True else [],
                  [f"On the downslope side of {id_}, just outside the footprint; ends angled upslope (cited).",
                   "Offset from the stockpile (0.4 m drawn) is not stated in the standards: to be confirmed by the designer/certifier.", fall_note],
                  "unresolved", ["esc.sediment_fence.offset_from_stockpile_m"])
        rq.miss("esc.sediment_fence.offset_from_stockpile_m")

    # ---- upslope clean-water diversion
    up_geom = unary_union(up_lines) if up_lines else None
    if up_geom is not None and not up_geom.is_empty:
        dl = [l for l in lines_of(up_geom) if l.length > 1.0]
        dl = [LineString(l.coords) for l in dl]
        if dl:
            # flow along the drain towards the end with lower ground (or away from the access when no levels)
            def zlow(p):
                if L.z_plane is None:
                    return -math.hypot(p[0] - access.centroid.x, p[1] - access.centroid.y)
                return L.z_plane[0] * p[0] + L.z_plane[1] * p[1]
            oriented = []
            for l in dl:
                a_, b_ = l.coords[0], l.coords[-1]
                oriented.append(l if zlow(a_) >= zlow(b_) else LineString(list(l.coords)[::-1]))
            keys = ["esc.diversion.upslope_catch_drain_or_bund", "esc.diversion.graded_bund_option", "esc.diversion.no_discharge_to_neighbour_without_consent",
                    "esc.diversion.no_discharge_toward_access", "esc.diversion.no_straw_bales", "esc.stockpile.upslope_diversion_and_downslope_filter"]
            add("DIV1", "diversion", MultiLineString(oriented), "Clean-water diversion (catch drain / bund)", "unresolved" if flow_assumed else "resolved", keys,
                ["esc.diversion.bund_dimensions_and_grade"],
                ["Direction of arrows = flow along the drain.", "Outlet must not discharge onto a neighbouring property without the owner's written consent, nor towards the access (cited)."]
                + (["Upslope edge assumed (no levels)."] if flow_assumed else []), sum(l.length for l in oriented), "m")
            L.diversion_lines = oriented
            # check dams on sloping sites
            hz_slope = rq.get("esc.stockpile.hazard_slope_pct")
            if slope_pct is not None and hz_slope and slope_pct >= hz_slope.value:
                rq.get("esc.check_dam.install_if_necessary")
                longest = max(oriented, key=lambda l: l.length)
                dams = []
                for f in (1 / 3, 2 / 3):
                    p = longest.interpolate(f, normalized=True)
                    q = longest.interpolate(min(longest.length, longest.length * f + 0.5))
                    tt = unit((q.x - p.x, q.y - p.y))
                    nn = (-tt[1], tt[0])
                    dams.append(LineString([(p.x - nn[0] * 0.6, p.y - nn[1] * 0.6), (p.x + nn[0] * 0.6, p.y + nn[1] * 0.6)]))
                add("CD1", "check_dam", MultiLineString(dams), "Check dams", "unresolved", ["esc.check_dam.install_if_necessary", "esc.check_dam.purpose"],
                    ["esc.check_dam.spacing_and_height"], [f"Fitted fall {slope_pct:.1f}% >= {hz_slope.value:g}% (the only slope threshold in the cited documents, used as an indicative trigger); spacing and height not stated."],
                    len(dams), "no.")
            elif slope_pct is None:
                L.warnings.append("No levels: check dams cannot be assessed for slope and are not shown.")

    # ---- kerb inlet protection
    inlet_pts = [tuple(p) for p in inp.kerb_inlet_points]
    assumed_inlet = False
    if not inlet_pts:
        assumed_inlet = True
        kp = (cl.coords[0] if cl is not None and not cl.is_empty else bp)
        # downslope along the frontage from the crossover
        sgn = 1.0 if (t[0] * d[0] + t[1] * d[1]) >= 0 else -1.0
        off = (width / 2 + P.inlet_trap_offset_m)
        # gutter point: the kerb point if it is outside the lot, else the frontage point pushed out to the road side
        base = kp if not lot.buffer(0.01).contains(Point(kp)) else (bp[0] + n[0] * 3.0, bp[1] + n[1] * 3.0)
        inlet_pts = [(base[0] + t[0] * sgn * off, base[1] + t[1] * sgn * off)]
    traps = []
    for p in inlet_pts:
        h = P.inlet_trap_length_m / 2
        traps.append(LineString([(p[0] - t[0] * h, p[1] - t[1] * h), (p[0] + t[0] * h, p[1] + t[1] * h)]).buffer(0.25, cap_style=2))
    add("INL1", "inlet", unary_union(traps), "Kerb inlet / gutter sediment trap", "unresolved" if assumed_inlet else "resolved",
        ["esc.inlet.protect_downslope_drains_and_gutters", "esc.inlet.downstream_pit_protection", "esc.inlet.methods", "esc.inlet.consult_council_on_method",
         "esc.stockpile.not_on_footpath_or_road_reserve"], ["esc.inlet.kerb_trap_dimensions"],
        (["Stormwater pit locations not supplied: trap shown in the gutter immediately downslope of the crossover as a placeholder; confirm against the actual pits."]
         if assumed_inlet else ["Trap at each supplied kerb inlet."]) + ["Consult council on method (cited)."], len(traps), "no.")

    # fence along the frontage from the access towards the kerb inlet (low point towards the street)
    try:
        sgn_k = 1.0 if (t[0] * d[0] + t[1] * d[1]) >= 0 else -1.0
        s_a = front.project(Point(bp))
        s_i = front.project(Point(inlet_pts[0]))
        s_start = min(max(s_a + sgn_k * (width / 2 + 0.3), 0.0), front.length)
        s_end = min(max(s_i, 0.0), front.length)
        from shapely.ops import substring
        if abs(s_end - s_start) > 1.5 and (s_end - s_start) * sgn_k > 0:
            ln_ = substring(front, s_start, s_end)
            ln_ = shapely.affinity.translate(ln_, -n[0] * P.boundary_inset_m, -n[1] * P.boundary_inset_m)
            cover = unary_union(all_fence_lines).buffer(1.0) if all_fence_lines else None
            kl = [l for l in lines_of(ln_ if cover is None else ln_.difference(cover)) if l.length > 1.5]
            add_fence("FNK1", "Sediment fence - frontage, access to kerb inlet", kl,
                      ["Along the frontage on the downslope side of the access, towards the kerb inlet trap, so flow leaving the works is captured.", fall_note],
                      "unresolved", fence_unres)
    except Exception:  # noqa: BLE001
        pass
    if returns:
        add("FNR1", "return", MultiLineString(returns), "Fence returns", "unresolved", ["esc.sediment_fence.return_interval_m", "esc.sediment_fence.ends_turn_upslope"],
            ["esc.sediment_fence.return_length_m"], ["Symbolic return length (layout assumption); ends angled upslope and spacing per cited 20 m."], sum(r.length for r in returns), "m")
    fence_len = sum(l.length for l in all_fence_lines)
    fence_lines = all_fence_lines

    # ---- tree protection / no-go
    for i, tp, r in tree_elems:
        rr = r if r else 3.0
        add(f"NG{i}", "nogo", Point(tp.xy).buffer(rr), f"No-go / tree protection ({tp.label})", "resolved" if r else "unresolved",
            ["esc.nogo.fence_trees_to_protect", "esc.nogo.no_materials_in_tree_drip_line", "esc.nogo.mark_sensitive_areas_and_trees"],
            [] if r else ["esc.tree.protection_zone_radius_m"],
            [f"Radius {rr:g} m" + (" supplied (drip line)." if r else " is a placeholder: drip-line / protection radius to be confirmed by an arborist.")], math.pi * rr * rr, "m2")
        if not r:
            rq.miss("esc.tree.protection_zone_radius_m")

    # ---- quantities
    post_sp = rq.get("esc.sediment_fence.post_spacing_m")
    posts = sum(math.ceil(l.length / post_sp.value) + 1 for l in fence_lines) if post_sp else None
    thick = rq.get("esc.access.thickness_mm")
    smin, smax = rq.get("esc.topsoil.strip_depth_min_mm"), rq.get("esc.topsoil.strip_depth_max_mm")
    q = dict(site_area_m2=round(lot.area, 1), limit_of_works_area_m2=round(low.area, 1), disturbed_area_estimate_m2=round(est_area, 1),
             disturbed_area_basis=("user supplied" if inp.disturbed_area_m2 is not None else "convex hull of building, driveway/access and activity areas + margin"),
             fence_length_m=round(fence_len, 1), fence_returns_m=round(sum(r.length for r in returns), 1), fence_posts=posts,
             access_length_m=round(alen, 1), access_width_m=round(width, 1), access_area_m2=round(access.area, 1),
             access_aggregate_m3=round(access.area * thick.value / 1000, 1) if thick else None,
             stockpile_area_m2=round(sum(e.quantity or 0 for e in elems if e.kind in ("stockpile", "topsoil", "laydown")), 1),
             diversion_length_m=round(sum(e.quantity or 0 for e in elems if e.kind == "diversion"), 1),
             check_dams=int(sum(e.quantity or 0 for e in elems if e.kind == "check_dam")), inlet_traps=len(traps),
             topsoil_strip_m3=[round(est_area * smin.value / 1000, 1), round(est_area * smax.value / 1000, 1)] if smin and smax else None,
             fall_pct=None if slope_pct is None else round(slope_pct, 2), flow_bearing_deg=round(L.flow.bearing_deg, 1))
    if est_area > (max_site.value if max_site else 1e18):
        L.warnings.append(f"Estimated disturbed area exceeds {max_site.value:g} m2: the 2024 Building Sites guidelines do not apply (a soil and water management plan is needed).")
    mn = rq.get("esc.escp.min_site_area_m2")
    if mn and lot.area < mn.value:
        L.warnings.append(f"Site is smaller than {mn.value:g} m2: the 2024 guidelines say an ESCP may not be required, but the duty to prevent pollution remains.")
    L.quantities = q
    L.elements = elems
    L.assumptions += [
        f"Fence line set in {P.boundary_inset_m:g} m from the lot boundary; works clearance to the fence line {P.low_margin_m:g} m (layout parameters, offset unresolved in the standards).",
        f"Activity-area footprints (stockpile {kind_sizes['stockpile'][0]:g}x{kind_sizes['stockpile'][1]:g} m, washout {kind_sizes['washout'][0]:g}x{kind_sizes['washout'][1]:g} m, "
        f"bin, toilet) are layout sizes, not requirements; items are searched within {P.search_radius_m:g} m of the building/driveway.",
        f"Edges within about 75 degrees of downslope get the fence; edges facing upslope get the diversion (cos threshold {P.edge_cos}).",
        f"Fitted fall below {P.flat_slope_pct}% is treated as flat (flow assumed towards the road).",
    ]
    return L

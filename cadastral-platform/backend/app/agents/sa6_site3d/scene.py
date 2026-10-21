"""build_scene(): orchestrates the builders and assembles views, summary, notes."""
from __future__ import annotations

import numpy as np

from app.common.labels import upper_label

from .build import LAYERS, Builder
from .models import AERIAL_NOTE, Info, Layer, SceneBundle, SceneRequest, Walkable

ISO = {"iso-sw": [-1, -1, 0.8], "iso-ne": [1, 1, 0.8], "iso-se": [1, -1, 0.8]}


def _bbox(parts, labels):
    pts = []
    for p in parts:
        a = p.v if p.v is not None else p.lines
        if a and p.c not in ("context",):
            pts.append(np.asarray(a, float).reshape(-1, 3))
    if not pts:
        return np.zeros(3), np.ones(3)
    P = np.concatenate(pts)
    return P.min(0), P.max(0)


def make_views(lo, hi, front):
    c = (lo + hi) / 2
    diag = float(np.linalg.norm(hi - lo))
    tgt = [round(float(v), 3) for v in c]
    v = {k: {"dir": d, "target": tgt, "dist": round(diag * 0.9, 1)} for k, d in ISO.items()}
    v["plan"] = {"dir": [0, -0.0001, 1], "ortho": True, "target": tgt, "dist": round(diag, 1)}
    v["s"] = {"dir": [0, -1, 0.0001], "ortho": True, "target": tgt, "dist": round(diag, 1)}
    v["w"] = {"dir": [-1, 0, 0.0001], "ortho": True, "target": tgt, "dist": round(diag, 1)}
    if front is not None:
        a, b, d, n = front
        m = (a + b) / 2
        v["frontage"] = {"dir": [round(float(n[0]), 3), round(float(n[1]), 3), 0.45], "target": [round(float(m[0] - n[0] * 12), 3), round(float(m[1] - n[1] * 12), 3), tgt[2]],
                         "dist": round(max(diag * 0.5, 20), 1)}
    else:
        v["frontage"] = {"dir": [-0.6, -1, 0.7], "target": tgt, "dist": round(diag * 0.6, 1)}
    return v


def build_scene(req: SceneRequest) -> SceneBundle:
    b = Builder(req)
    b.boundary_and_road()
    b.retaining_walls()
    b.buildings()
    b.driveway()
    b.services()
    b.tank()
    b.overlays()
    items = b.placed_items()
    b.terrain()                       # last: terrain meshes take the remaining triangle budget
    r, lot = req, b.lot
    layers = [Layer(c=c, n=n, on=on) for c, n, on in LAYERS if c in b.used]
    lo, hi = _bbox(b.parts, b.labels)
    views = make_views(lo, hi, b.front)
    ntri = sum(len(p.v) // 9 for p in b.parts if p.v and p.c != "cutfill")
    # summary
    S = b.summary
    if r.data_status:         # an offline fixture or test-data scene must never read as live data
        S.insert(0, ("Data status", r.data_status))
    if r.development_type is not None:
        S.append(("Development type", r.development_type.label))
    tp = r.terrain_provenance
    if b.no_terrain:
        S.append(("Terrain", "DATA NOT AVAILABLE (ground drawn flat at RL 0.00, placeholder only)"))
        if tp is not None:
            S.append(("Terrain providers tried", " | ".join(tp.notes) if tp.notes else "NONE RETURNED LEVELS"))
    elif tp is not None:
        S += [("Terrain status", upper_label(tp.status)), ("Terrain source", tp.source or "NOT STATED"), ("Terrain resolution", tp.resolution_text),
              ("Terrain capture date", tp.capture_date), ("Terrain vertical accuracy", tp.accuracy), ("Terrain licence", tp.licence), ("Terrain datum", tp.datum)]
        if tp.url:
            S.append(("Terrain service", tp.url))
    elif r.terrain_note:
        S.append(("Terrain source", r.terrain_note))
    if b.contour_basis:
        S.append(("Contours", f"{b.contour_levels} level(s) inside the lot. {b.contour_basis}"))
    if r.aerial is not None:
        a = r.aerial
        S.append(("Aerial imagery", f"{AERIAL_NOTE}. Source: {a.source or 'NOT STATED'}; capture date: {a.capture_date or 'CAPTURE DATE NOT STATED'}; "
                  f"ground pixel: {f'{a.resolution_m:.2f} m' if a.resolution_m else 'NOT STATED'}"
                  + (f"; embedded image: {a.size_px[0]} x {a.size_px[1]} px" if a.size_px else "")))
    if r.lot.neighbours:
        S.append(("Adjoining lots", f"{len(r.lot.neighbours)} from the cadastre (labels as given by the cadastre, not survey)"))
    if getattr(b, "kerb_info", None):
        S.append(("Road and kerb", f"ASSUMED KERB LINE (PLATFORM DEFAULT, NOT SURVEYED): verge depth {b.kerb_info[0]:g} m, road width {b.kerb_info[1]:g} m, no road survey"))
    S.append(("Lot", f"{r.lot.lotplan}, {lot.area:.0f} m2, {r.lot.lga_name}"))
    if b.ffl is not None and b.no_terrain:       # no ground levels exist, so the value is not an AHD level shown against anything
        S.append(("FFL", f"{b.ffl:.2f} (as supplied; NOT SHOWN AGAINST GROUND, TERRAIN DATA NOT AVAILABLE)"))
        if r.ffl_label:
            S.append(("FFL basis", r.ffl_label))
    elif b.ffl is not None:
        S.append(("FFL (AHD)", f"{b.ffl:.2f}"))
        if r.ffl_label:
            S.append(("FFL basis", r.ffl_label))
    if r.cut_fill:
        cf = r.cut_fill
        S.append(("Cut / fill (indicative)", f"cut {cf.cut_volume_m3:.0f} m3, fill {cf.fill_volume_m3:.0f} m3, net {cf.cut_volume_m3 - cf.fill_volume_m3:+.0f} m3"))
    if r.walls:
        S.append(("Retaining walls", f"{len(r.walls)}, max {max(w.height_m for w in r.walls):.1f} m (screening only)"))
    if r.driveway:
        g = getattr(b, "dw_grade", None)
        S.append(("Driveway", f"{r.driveway.width_m:g} m wide, " + (f"avg grade {g:.1f}%" if g is not None else "GRADE DATA NOT AVAILABLE")
                  + f", design vehicle {r.driveway.design_vehicle}"))
    if r.services:
        S.append(("Services", f"{len(r.services)} lines, min cover " + (f"{b.svc_min_cover:.2f} m" if b.svc_min_cover is not None else "DATA NOT AVAILABLE")
                  + (f", DEPTH NOT AVAILABLE for {b.no_depth_count}" if b.no_depth_count else "")))
    if r.rwt:
        S.append(("Rainwater tank", f"{r.rwt.tank_volume_l} L, dia {r.rwt.diameter_m:g} m"))
    if r.buildings:
        S.append(("Buildings", ", ".join(f"{x.name} ({x.roof_type})" for x in r.buildings)))
    if items:
        S.append(("Placed items", f"{len(items)}, {sum(1 for i in items if i.warnings)} with warnings"))
    S.append(("Mesh", f"{ntri} triangles"))
    N = b.notes
    if r.data_status:
        N.insert(0, f"DATA STATUS: {r.data_status}.")
    N.append("This 3D view is a visualisation generated from computed results and uploaded data; it is not survey, "
             "engineering, certified or construction information, and is subject to the platform Terms of Use"
             + ("" if r.terms_version_id else " (Terms version not recorded for this scene)") + ".")
    if b.no_terrain:
        N.append("Coordinates are metres relative to info.origin (MGA E0, N0). No ground levels are available, so no heights in this scene are AHD levels.")
    else:
        N.append("Heights are AHD; coordinates are metres relative to info.origin (MGA E0, N0). Existing ground is from the supplied survey/TIN and was not independently verified.")
        if b.eg.extrapolated or b.dg.extrapolated:
            N.append("EXTRAPOLATED, NOT SURVEYED: some geometry lies outside the extent of the supplied terrain; its levels are taken from the "
                     "nearest terrain point for display only and must not be used for design.")
    if tp is not None:
        N.append(f"TERRAIN: {upper_label(tp.status)}. Terrain notes: " + (" ".join(n if n.rstrip().endswith((".", "!", "?")) else n.rstrip() + "." for n in tp.notes) if tp.notes else "none") + " Ground levels are not survey unless the status says SURVEY (AS SUPPLIED).")
    if r.aerial is not None:
        N.append(AERIAL_NOTE + ". The image is draped on the ground surface for orientation only; it is not survey, it may be dated, and it can sit out of register with the cadastre.")
    if getattr(b, "kerb_info", None):
        N.append("Road carriageway width, the kerb line position (verge depth) and the kerb height are PLATFORM DEFAULT values: no road survey was available. The kerb line is an ASSUMED KERB LINE, NOT SURVEYED.")
    if r.lot.neighbours:
        N.append("Adjoining lots and road reserves are drawn from the cadastre (DCDB) with the LOT and DP labels the cadastre gave; boundaries are not survey and are not verified.")
    if r.services:
        N.append("Underground services are shown from the supplied service data. Where no depth was supplied the service is drawn on the ground surface and labelled "
                 "DEPTH NOT AVAILABLE (no depth is assumed); exclusion buffers use placeholder clearances. Physically verify (pothole) before any excavation.")
    if r.walls:
        N.append("Retaining walls are screening geometry only and are NOT structural design; an engineer must design and certify.")
    if r.driveway:
        N.append("Driveway, crossover and swept path are indicative and not certified; confirm with the council's crossover standard.")
    if b.stats_surface[0] != b.stats_surface[1] if hasattr(b, "stats_surface") else False:
        N.append(f"Design surface decimated from {b.stats_surface[0]} to {b.stats_surface[1]} triangles for display; volumes use the full-resolution results.")
    if r.items:
        N.append("Placed store items are proxies sized from listed dimensions where no 3D model exists; prices are as at capture. Third-party assets and trademarks belong to their owners.")
    stats = {"triangles": ntri, "parts": len(b.parts), "labels": len(b.labels)}
    walk = Walkable(terrain_parts=[p.n for p in b.parts if p.c in ("surface", "existing") and p.v and p.n.startswith(("FS_surface", "EG_"))],
                    floors=b.walk["floors"], colliders=b.walk["colliders"], links=b.walk["links"], spawn=b.spawn())
    info = Info(title=r.project_title, subtitle=r.subtitle, FFL=b.ffl, origin=(b.E0, b.N0, 0.0), srid=r.lot.mga_srid,
                data_status=r.data_status, terrain=(None if tp is None else {
                    "status": upper_label(tp.status), "source": tp.source, "url": tp.url, "resolution": tp.resolution_text, "effective_spacing_m": tp.effective_spacing_m, "capture_date": tp.capture_date,
                    "accuracy": tp.accuracy, "licence": tp.licence, "datum": tp.datum, "notes": tp.notes}))
    if r.aerial is not None and "aerial" in b.used:
        a = r.aerial
        info.ground_texture, info.ground_texture_extent = a.path, a.extent
        info.ground_texture_attribution, info.ground_texture_date = a.attribution or None, a.capture_date
        info.ground_texture_source, info.ground_texture_licence = a.source or None, a.licence or None
        info.ground_texture_resolution_m, info.ground_texture_note = a.resolution_m, AERIAL_NOTE
    return SceneBundle(info=info, layers=layers, parts=b.parts, labels=b.labels, views=views, summary=S, notes=N, walkable=walk, items=items, stats=stats)


def dumps(bundle: SceneBundle) -> str:
    return bundle.model_dump_json(exclude_none=True)

"""build_scene(): orchestrates the builders and assembles views, summary, notes."""
from __future__ import annotations

import numpy as np

from .build import LAYERS, Builder
from .models import Info, Layer, SceneBundle, SceneRequest, Walkable

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
    S.append(("Development type", r.development_type.label))
    S.append(("Lot", f"{r.lot.lotplan}, {lot.area:.0f} m2, {r.lot.lga_name}"))
    if b.ffl is not None:
        S.append(("FFL (AHD)", f"{b.ffl:.2f}"))
        if r.ffl_label:
            S.append(("FFL basis", r.ffl_label))
    if r.cut_fill:
        cf = r.cut_fill
        S.append(("Cut / fill (indicative)", f"cut {cf.cut_volume_m3:.0f} m3, fill {cf.fill_volume_m3:.0f} m3, net {cf.cut_volume_m3 - cf.fill_volume_m3:+.0f} m3"))
    if r.walls:
        S.append(("Retaining walls", f"{len(r.walls)}, max {max(w.height_m for w in r.walls):.1f} m (screening only)"))
    if r.driveway:
        S.append(("Driveway", f"{r.driveway.width_m:g} m wide, avg grade {getattr(b, 'dw_grade', 0):.1f}%, design vehicle {r.driveway.design_vehicle}"))
    if r.services:
        S.append(("Services", f"{len(r.services)} lines, min cover {b.svc_min_cover:.2f} m" + (" (some depths assumed)" if b.assumed_depth else "")))
    if r.rwt:
        S.append(("Rainwater tank", f"{r.rwt.tank_volume_l} L, dia {r.rwt.diameter_m:g} m"))
    if r.buildings:
        S.append(("Buildings", ", ".join(f"{x.name} ({x.roof_type})" for x in r.buildings)))
    if items:
        S.append(("Placed items", f"{len(items)}, {sum(1 for i in items if i.warnings)} with warnings"))
    S.append(("Mesh", f"{ntri} triangles"))
    N = b.notes
    N.append("Illustrative only. This 3D view is a visualisation generated from computed results and uploaded data; it is not survey, "
             "engineering, certified or construction information, and is subject to the platform Terms of Use"
             + ("" if r.terms_version_id else " (Terms version not recorded for this scene)") + ".")
    N.append("Heights are AHD; coordinates are metres relative to info.origin (MGA E0, N0). Existing ground is from the supplied survey/TIN and was not independently verified.")
    N.append("Underground services are shown from DBYD/design data with indicative depths" + (" (some depths ASSUMED where none was given)" if b.assumed_depth else "")
             + "; exclusion buffers use placeholder clearances. Physically verify (pothole) before any excavation.")
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
    info = Info(title=r.project_title, subtitle=r.subtitle, FFL=b.ffl, origin=(b.E0, b.N0, 0.0), srid=r.lot.mga_srid)
    return SceneBundle(info=info, layers=layers, parts=b.parts, labels=b.labels, views=views, summary=S, notes=N, walkable=walk, items=items, stats=stats)


def dumps(bundle: SceneBundle) -> str:
    return bundle.model_dump_json(exclude_none=True)

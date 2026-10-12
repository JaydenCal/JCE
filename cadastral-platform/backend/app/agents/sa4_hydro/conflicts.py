"""Buffer vs feature conflict detection."""
from __future__ import annotations

from shapely import wkt
from shapely.geometry.base import BaseGeometry

from .models import Asset, AssetBuffer, Conflict

# feature kind -> (severity if asset line itself intersects, severity if clearance zone overlaps, if tolerance-only overlap)
_RULES = {
    "slab": ("blocking", "blocking", "warning"),
    "rwt": ("blocking", "blocking", "warning"),
    "excluded_area": ("blocking", "warning", "info"),
    "trench": ("warning", "warning", "info"),
    "driveway": ("warning", "info", "info"),
    "crossover": ("warning", "info", "info"),
}


def detect_conflicts(assets: list[Asset], buffers: list[AssetBuffer], features: list[tuple[str, BaseGeometry]]) -> list[Conflict]:
    bmap = {b.asset_id: b for b in buffers}
    out: list[Conflict] = []
    for a in assets:
        b = bmap[a.asset_id]
        line = wkt.loads(a.geometry_wkt)
        full = wkt.loads(b.geometry_wkt)
        clear = line.buffer(b.clearance_m, cap_style="flat", join_style="mitre", mitre_limit=2.0)
        for kind, g in features:
            if g is None or g.is_empty or not full.intersects(g):
                continue
            s_line, s_clear, s_tol = _RULES.get(kind, ("warning", "warning", "info"))
            hits_line = line.intersects(g)
            hits_clear = clear.intersects(g) and clear.intersection(g).area > 1e-6 or hits_line
            sev = s_line if hits_line else (s_clear if hits_clear else s_tol)
            area = full.intersection(g).area
            what = ("the asset line passes through" if hits_line else
                    "the clearance zone overlaps" if hits_clear else "only the positional-tolerance zone overlaps")
            msg = (f"{a.service} {a.label or a.asset_id} ({b.clearance_m:.1f} m clearance + {b.tolerance_m:.1f} m tolerance): "
                   f"{what} the {kind.replace('_', ' ')} ({area:.1f} m2).")
            if a.depth_m is None:
                msg += " Depth unknown - pothole/confirm with owner agency."
            if b.placeholder:
                msg += " Clearance is a placeholder."
            out.append(Conflict(asset_id=a.asset_id, service=a.service, feature=kind, severity=sev,
                                overlap_area_m2=round(area, 3), line_intersects=hits_line, message=msg))
    return out

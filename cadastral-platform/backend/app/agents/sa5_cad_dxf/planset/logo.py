"""Vectorise the brand logo (alpha channel) into polygons; used for both the PDF and the self-contained DXF."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

GOLD = (0.78, 0.60, 0.16)


@lru_cache(maxsize=4)
def logo_polygons(path: str, simplify_px: float = 0.6) -> tuple[list[Polygon], float]:
    """(polygons with holes, aspect w/h) in unit coordinates: x in 0..aspect, y in 0..1 (y up).  Empty list if unreadable."""
    import cv2
    from PIL import Image
    try:
        im = Image.open(path).convert("RGBA")
    except Exception:  # noqa: BLE001
        return [], 1.0
    a = np.array(im)[:, :, 3]
    # 4x upsample + blur gives smooth contours for the lettering edges
    big = cv2.resize(a, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    m = (big > 110).astype(np.uint8) * 255
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return [], 1.0
    H, W = m.shape
    polys: list[Polygon] = []
    for i, c in enumerate(cnts):
        if hier[0][i][3] != -1 or cv2.contourArea(c) < 40:
            continue
        holes = []
        j = hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cnts[j]) >= 20:
                holes.append(cnts[j])
            j = hier[0][j][0]

        def pts(cc):
            ap = cv2.approxPolyDP(cc, simplify_px * 3, True)[:, 0, :].astype(float)
            return [(x / H, 1 - y / H) for x, y in ap]
        p = Polygon(pts(c), [pts(h) for h in holes if len(h) > 3])
        if not p.is_valid:
            p = p.buffer(0)
        if not p.is_empty:
            polys.append(p)
    return polys, W / H


def logo_in_box(path: str | Path, x0: float, y0: float, w: float, h: float):
    """Polygons scaled to fit (w x h) box anchored left/centre at (x0, y0); returns (polys, used_w, used_h)."""
    polys, asp = logo_polygons(str(path))
    if not polys:
        return [], 0.0, 0.0
    uh = min(h, w / asp)
    uw = uh * asp
    from shapely import affinity
    out = [affinity.translate(affinity.scale(p, uh, uh, origin=(0, 0)), x0, y0 + (h - uh) / 2) for p in polys]
    return out, uw, uh

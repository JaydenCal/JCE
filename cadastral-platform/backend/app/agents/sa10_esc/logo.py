"""Company logo for the ESCP title block (PDF raster with alpha; DXF vectorised on C-ANNO-LOGO). Shared-helper candidate."""
from __future__ import annotations

import io
from functools import lru_cache

import numpy as np
from PIL import Image

from app.branding.brand import Brand


@lru_cache(maxsize=4)
def _rgba(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def logo_png(brand: Brand, max_px: int = 900) -> tuple[bytes, float]:
    """PNG bytes (alpha kept) and width/height aspect ratio."""
    im = _rgba(str(brand.logo_path)).copy()
    im.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), im.width / im.height


def logo_polylines(brand: Brand, width_m: float, eps_frac: float = 0.004) -> list[tuple[list[tuple[float, float]], bool]]:
    """Vectorise the logo: cv2.findContours on the alpha channel -> simplified closed polylines, origin bottom-left, width = width_m."""
    import cv2
    im = _rgba(str(brand.logo_path))
    a = np.asarray(im)[:, :, 3]
    mask = (a > 40).astype(np.uint8) * 255
    cs, hier = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    h, w = mask.shape
    k = width_m / w
    out = []
    for c in cs:
        if cv2.contourArea(c) < 4:
            continue
        ap = cv2.approxPolyDP(c, eps_frac * max(w, h) * 0.5, True)
        if len(ap) < 3:
            continue
        out.append(([(float(p[0][0]) * k, (h - float(p[0][1])) * k) for p in ap], True))
    return out

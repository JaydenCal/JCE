"""Live NSW elevation sampling -> SurveyInput kwargs for sa3_terrain.

Endpoint verified live 2026-10-12: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer
  - exportImage (format=tiff, pixelType=F32, bbox/imageSR 102100, nearest) -> float32 TIFF, one request per site (30-60 s on large areas);
    getSamples works too but is far too slow for spread-out multipoints (40 points over ~1 km took 29 s), so it is NOT used.
  - native cell = 5 web-mercator units (~4.3 m ground at Gunnedah latitude); orthometric (AHD) metres per heightModelInfo.
  - service metadata: "5 metre post spacing elevation derived from stereo imagery", copyright "DFSI 2019", F32, orthometric.
  - NO vertical accuracy and NO licence text is stated in the service JSON or /metadata (checked 2026-10-12).
  - No 1 m LiDAR DEM service exists under maps.six.nsw.gov.au/.../public (only NSW_5M_Elevation; NSW_Elevation is a footprint layer).
The accuracy is therefore UNKNOWN: SurveyInput needs a float, so a pessimistic placeholder (UNKNOWN_ACCURACY_PLACEHOLDER_M)
is used unless the caller passes a user-entered value; both cases are flagged in the warnings. Nothing is interpolated or invented.
"""
from __future__ import annotations

import math
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

from pyproj import Transformer
from shapely import wkt as _wkt

SERVICE = "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer"
NATIVE_WEB = 5.0                       # native cell size in web-mercator units
NODATA = -9999
UNKNOWN_ACCURACY_PLACEHOLDER_M = 5.0   # NOT a stated accuracy; see module docstring
COPYRIGHT_TEXT = "DFSI 2019 (as stated by service copyrightText; no licence text published in service metadata)"


@dataclass
class LiveLevels:
    survey: dict                      # kwargs for SurveyInput
    warnings: list[str] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)


def _export(service: str, bbox: tuple, w: int, h: int, timeout: float = 180.0) -> bytes:
    p = {"bbox": ",".join(f"{v:.3f}" for v in bbox), "bboxSR": 102100, "imageSR": 102100, "size": f"{w},{h}", "format": "tiff",
         "pixelType": "F32", "interpolation": "RSP_NearestNeighbor", "noData": NODATA, "f": "image"}
    req = urllib.request.Request(service + "/exportImage", data=urllib.parse.urlencode(p).encode(), headers={"User-Agent": "sa3-live-levels/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.read()


def fetch_levels(boundary_wkt_mga: str, srid: int, buffer_m: float = 10.0, max_points: int = 2000, max_px: int = 4000,
                 accuracy_m: float | None = None, export=_export, service: str = SERVICE) -> LiveLevels:
    """One exportImage request over the lot bbox + buffer at the native 5-unit cell; pixel centres inside the buffered lot become points.
    If that would exceed max_points the pixel grid is thinned by an integer stride (coarse sampling for large rural lots)."""
    import io

    import numpy as np
    from PIL import Image
    from shapely.geometry import Point
    from shapely.ops import transform as shp_transform
    from shapely.prepared import prep

    lot = _wkt.loads(boundary_wkt_mga)
    area = lot.area
    zone = lot.buffer(buffer_m)
    to_web = Transformer.from_crs(srid, 3857, always_xy=True)
    to_mga = Transformer.from_crs(3857, srid, always_xy=True)
    x0, y0, x1, y1 = shp_transform(to_web.transform, zone).bounds
    x0, y0 = math.floor(x0 / NATIVE_WEB) * NATIVE_WEB, math.floor(y0 / NATIVE_WEB) * NATIVE_WEB   # align to the 5-unit grid
    w, h = min(max_px, math.ceil((x1 - x0) / NATIVE_WEB)), min(max_px, math.ceil((y1 - y0) / NATIVE_WEB))
    bbox = (x0, y0, x0 + w * NATIVE_WEB, y0 + h * NATIVE_WEB)
    data = export(service, bbox, w, h)
    try:
        arr = np.array(Image.open(io.BytesIO(data)), dtype=float)
    except Exception as ex:  # noqa: BLE001
        raise RuntimeError(f"NSW_5M_Elevation exportImage did not return a TIFF: {data[:120]!r}") from ex
    if arr.shape != (h, w):
        raise RuntimeError(f"unexpected raster shape {arr.shape}, wanted {(h, w)}")
    stride = 1
    while ((h + stride - 1) // stride) * ((w + stride - 1) // stride) > max_points * 1.6:   # ~60% of the bbox lies inside a typical lot
        stride += 1
    pz, pts, bad = prep(zone), [], 0
    for r in range(0, h, stride):
        for c in range(0, w, stride):
            z = arr[r, c]
            wx, wy = bbox[0] + (c + 0.5) * NATIVE_WEB, bbox[3] - (r + 0.5) * NATIVE_WEB
            x, y = to_mga.transform(wx, wy)
            if not pz.contains(Point(x, y)):
                continue
            if not math.isfinite(z) or z <= NODATA + 1 or z < -500:
                bad += 1
                continue
            pts.append((round(x, 3), round(y, 3), round(float(z), 3)))
    if not pts:
        raise RuntimeError("no elevation cells inside the lot (outside service coverage?)")
    sp_ground = round(math.sqrt(zone.area / max(1, len(pts))), 1)
    warns = []
    if bad:
        warns.append(f"{bad} cell(s) were NoData and dropped")
    if stride > 1:
        warns.append(f"coarse sampling: every {stride}th cell used (cap {max_points} points) - about {sp_ground:g} m mean spacing")
    if area < 5000:
        warns.append(f"5 m DEM ({len(pts)} points, derived from stereo imagery) is too coarse for detailed cut/fill on a {area:.0f} m2 lot; "
                     "commission a detail survey before relying on earthworks quantities")
    elif area < 20000:
        warns.append("5 m DEM is coarse for detailed earthworks on a lot of this size")
    if accuracy_m is None:
        warns.append(f"vertical accuracy UNKNOWN: not stated in NSW_5M_Elevation metadata; {UNKNOWN_ACCURACY_PLACEHOLDER_M} m placeholder used "
                     "only so uncertainty is not understated (not a stated figure)")
        acc, acc_src = UNKNOWN_ACCURACY_PLACEHOLDER_M, "unknown (placeholder)"
    else:
        acc, acc_src = accuracy_m, "user_entered"
    prov = {"source": "NSW_5M_Elevation ImageServer exportImage", "url": service, "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "copyright": COPYRIGHT_TEXT, "datum": "AHD (orthometric, per service heightModelInfo)", "native_cell_web_mercator_units": NATIVE_WEB,
            "stride": stride, "requests": 1, "points": len(pts), "vertical_accuracy_m": acc, "vertical_accuracy_source": acc_src}
    survey = {"srid": srid, "points": pts, "stated_vertical_accuracy_m": acc,
              "source": f"NSW_5M_Elevation (DFSI 2019, 5 m stereo-derived DEM, accuracy {acc_src}) retrieved {prov['retrieved']}"}
    return LiveLevels(survey, warns, prov)

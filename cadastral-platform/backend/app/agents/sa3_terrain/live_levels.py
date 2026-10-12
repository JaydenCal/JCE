"""Live NSW elevation sampling -> SurveyInput kwargs for sa3_terrain.

Endpoint verified live 2026-10-12: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer
  - getSamples (multipoint, wkid 102100, returnFirstValueOnly) -> samples[].value (AHD, orthometric metres), rasterId, resolution
  - service metadata: "5 metre post spacing elevation derived from stereo imagery", copyright "DFSI 2019", F32, orthometric.
  - NO vertical accuracy and NO licence text is stated in the service JSON or /metadata (checked 2026-10-12).
  - No 1 m LiDAR DEM service exists under maps.six.nsw.gov.au/.../public (only NSW_5M_Elevation; NSW_Elevation is a footprint layer).
The accuracy is therefore UNKNOWN: SurveyInput needs a float, so a pessimistic placeholder (UNKNOWN_ACCURACY_PLACEHOLDER_M)
is used unless the caller passes a user-entered value; both cases are flagged in the warnings. Nothing is interpolated or invented.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

from pyproj import Transformer
from shapely import wkt as _wkt

SERVICE = "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer"
NATIVE_M = 5.0
UNKNOWN_ACCURACY_PLACEHOLDER_M = 5.0   # NOT a stated accuracy; see module docstring
COPYRIGHT_TEXT = "DFSI 2019 (as stated by service copyrightText; no licence text published in service metadata)"


@dataclass
class LiveLevels:
    survey: dict                      # kwargs for SurveyInput
    warnings: list[str] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)


def _post(url: str, params: dict, timeout: float = 60.0) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), headers={"User-Agent": "sa3-live-levels/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return json.loads(r.read())


def fetch_levels(boundary_wkt_mga: str, srid: int, buffer_m: float = 10.0, spacing_m: float | None = None,
                 max_points: int = 1000, batch: int = 200, max_requests: int = 10, accuracy_m: float | None = None,
                 post=_post, service: str = SERVICE) -> LiveLevels:
    """Sample a regular MGA grid over the lot bbox + buffer. spacing defaults to the native 5 m; it is widened only to respect max_points/max_requests."""
    lot = _wkt.loads(boundary_wkt_mga)
    minx, miny, maxx, maxy = lot.buffer(buffer_m).bounds
    cap = min(max_points, batch * max_requests)
    sp = max(NATIVE_M, spacing_m or NATIVE_M)
    w, h = maxx - minx, maxy - miny
    while (int(w // sp) + 1) * (int(h // sp) + 1) > cap:
        sp *= 1.25
    nx, ny = int(w // sp) + 1, int(h // sp) + 1
    xs = [minx + i * sp + (w - (nx - 1) * sp) / 2 for i in range(nx)]
    ys = [miny + j * sp + (h - (ny - 1) * sp) / 2 for j in range(ny)]
    grid = [(x, y) for y in ys for x in xs]
    to_web = Transformer.from_crs(srid, 3857, always_xy=True)
    pts, rasters, res, bad, nreq = [], set(), set(), 0, 0
    for i in range(0, len(grid), batch):
        chunk = grid[i:i + batch]
        web = [list(to_web.transform(x, y)) for x, y in chunk]
        js = post(service + "/getSamples", {"geometry": json.dumps({"points": web, "spatialReference": {"wkid": 102100}}),
                                           "geometryType": "esriGeometryMultipoint", "returnFirstValueOnly": "true", "f": "json"})
        nreq += 1
        if "error" in js:
            raise RuntimeError(f"NSW_5M_Elevation getSamples error: {js['error']}")
        for s in js.get("samples", []):
            try:
                z = float(s["value"])
            except (TypeError, ValueError, KeyError):
                bad += 1
                continue
            if not math.isfinite(z):
                bad += 1
                continue
            x, y = chunk[int(s["locationId"])] if "locationId" in s else chunk[len(pts) % len(chunk)]
            pts.append((round(x, 3), round(y, 3), round(z, 3)))
            rasters.add(s.get("rasterId"))
            res.add(s.get("resolution"))
    warns = []
    if not pts:
        raise RuntimeError("no elevation samples returned (outside coverage?)")
    if bad:
        warns.append(f"{bad} sample(s) returned NoData and were dropped")
    if sp > NATIVE_M + 1e-9:
        warns.append(f"grid spacing widened to {sp:.0f} m (cap {cap} points / {max_requests} requests) vs native {NATIVE_M:g} m")
    area = lot.area
    if area < 5000:
        warns.append(f"5 m DEM ({len(pts)} samples, derived from stereo imagery) is too coarse for detailed cut/fill on a {area:.0f} m2 lot; "
                     "commission a detail survey before relying on earthworks quantities")
    elif area < 20000:
        warns.append("5 m DEM is coarse for detailed earthworks on a lot of this size")
    if accuracy_m is None:
        warns.append(f"vertical accuracy UNKNOWN: not stated in NSW_5M_Elevation metadata; {UNKNOWN_ACCURACY_PLACEHOLDER_M} m placeholder used "
                     "only so uncertainty is not understated (not a stated figure)")
        acc, acc_src = UNKNOWN_ACCURACY_PLACEHOLDER_M, "unknown (placeholder)"
    else:
        acc, acc_src = accuracy_m, "user_entered"
    prov = {"source": "NSW_5M_Elevation ImageServer getSamples", "url": service, "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "copyright": COPYRIGHT_TEXT, "datum": "AHD (orthometric, per service heightModelInfo)", "native_resolution_m": sorted(r for r in res if r) or [NATIVE_M],
            "raster_ids": sorted(r for r in rasters if r is not None), "grid_spacing_m": round(sp, 2), "requests": nreq, "points": len(pts),
            "vertical_accuracy_m": acc, "vertical_accuracy_source": acc_src}
    survey = {"srid": srid, "points": pts, "stated_vertical_accuracy_m": acc,
              "source": f"NSW_5M_Elevation (DFSI 2019, 5 m stereo-derived DEM, accuracy {acc_src}) retrieved {prov['retrieved']}"}
    return LiveLevels(survey, warns, prov)

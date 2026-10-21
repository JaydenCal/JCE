"""Offline fixture: Lot 2 DP227508, Gunnedah (the vacant R2 test lot).

WHY: the NSW data hosts (cadastre, imagery, DEM, zoning, roads) are not reachable from every environment (the cloud sandbox
refuses them with HTTP 403).  This module rebuilds the saved 2026-10-12 live run so that run_site.py, the plan set, the report
and the 3D scene can all be regenerated offline:

  * lot boundary, three adjoining lots and the road name come from the saved plan set (planset.dxf of that run);
  * levels are the 120 spot-level labels of sheet C100 (5 m DEM, Spatial Services), fitted with a plane plus a smooth residual;
    ``export_tiff`` serves them as a 5 m F32 TIFF so ``fetch_levels`` runs unchanged;
  * ``CachedImagery`` serves crops of the two aerials saved by that run (capture date and attribution as the service stated).

It is TEST DATA ONLY: not a survey, not live, and the zone is simplified to R2 (the live run also flagged multi_zone).
Use:  python scripts/run_site.py --offline lot2 --lotplan 2//DP227508 --levels nsw ...   (run_site wires this module in)
Or set IMAGERY_PROVIDER=offline_lot2 so provider_from_env() returns CachedImagery.
"""
from __future__ import annotations

import io
import math
import uuid
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely.geometry import Polygon

from app.agents.sa1_cadastre.models import LotIdentifier, Sa1Result, SegmentDetail, ZoneShare
from app.common.contracts import BoundarySegment, LotContext, NeighbourLot
from app.imagery.provider import ImageMeta, ImageResult

SRID = 7856
LOTPLAN = "2//DP227508"
ROAD_NAME = "Little Bloomfield Street"
DATA_DIR = Path(__file__).resolve().parent / "data" / "lot2"
# cached aerial extents (MGA 56, metres): from the IMAGE entities of the saved planset.dxf
IMAGES = (("aerial_site.png", (238402.95, 6569476.88, 238528.95, 6569615.40)),
          ("aerial_locality.png", (238308.45, 6569411.13, 238623.45, 6569681.13)))
CAPTURE_DATE = "2011-10-18"
ATTRIBUTION = ("Imagery: NSW Spatial Services © Department of Customer Service 2020 "
               "(includes third-party imagery: AAM, Jacobs Group Ausimage, LANDSAT)")

LOT = [(238459.21, 6569521.36), (238488.56, 6569558.47), (238472.59, 6569570.90), (238443.33, 6569533.90)]
NEIGHBOURS = [
    ('LOT 1 DP227508', [(238472.59, 6569570.90), (238456.63, 6569583.32), (238446.15, 6569570.07), (238427.46, 6569546.45), (238443.33, 6569533.90)]),
    ('LOT 3 DP227508', [(238522.07, 6569600.83), (238490.24, 6569625.82), (238459.75, 6569587.27), (238456.63, 6569583.32), (238472.59, 6569570.90), (238488.56, 6569558.47), (238493.70, 6569564.98)]),
    ('LOT 5 DP548460', [(238509.54, 6569552.57), (238493.70, 6569564.98), (238488.56, 6569558.47), (238459.21, 6569521.36), (238474.97, 6569508.86)]),
]
SPOTS = [  # (x, y, z) reconstructed from the 120 spot-level labels on sheet C100 of the saved run
    (238467.6, 6569578.6, 264.4), (238471.9, 6569578.7, 264.3), (238476.1, 6569578.9, 264.3), (238480.4, 6569579.0, 264.2),
    (238463.4, 6569574.3, 264.6), (238467.7, 6569574.4, 264.5), (238472.0, 6569574.5, 264.4), (238476.2, 6569574.6, 264.3),
    (238480.5, 6569574.7, 264.2), (238484.8, 6569574.8, 264.2), (238459.2, 6569569.9, 264.6), (238463.5, 6569570.0, 264.6),
    (238467.8, 6569570.1, 264.5), (238472.1, 6569570.2, 264.4), (238476.4, 6569570.3, 264.3), (238480.6, 6569570.4, 264.2),
    (238484.9, 6569570.5, 264.2), (238489.2, 6569570.6, 264.1), (238455.0, 6569565.5, 264.7), (238459.3, 6569565.6, 264.6),
    (238463.6, 6569565.7, 264.6), (238467.9, 6569565.8, 264.5), (238472.2, 6569565.9, 264.4), (238489.3, 6569566.4, 264.1),
    (238493.6, 6569566.5, 264.1), (238450.8, 6569561.1, 264.9), (238455.1, 6569561.2, 264.8), (238459.4, 6569561.3, 264.7),
    (238463.7, 6569561.5, 264.7), (238468.0, 6569561.6, 264.6), (238472.3, 6569561.7, 264.5), (238489.4, 6569562.1, 264.2),
    (238493.7, 6569562.2, 264.2), (238498.0, 6569562.3, 264.1), (238446.6, 6569556.8, 265.1), (238450.9, 6569556.9, 265.0),
    (238468.1, 6569557.3, 264.7), (238472.4, 6569557.4, 264.6), (238476.7, 6569557.5, 264.5), (238481.0, 6569557.6, 264.4),
    (238485.3, 6569557.7, 264.3), (238489.5, 6569557.8, 264.2), (238493.8, 6569557.9, 264.2), (238498.1, 6569558.0, 264.2),
    (238446.7, 6569552.5, 265.2), (238451.0, 6569552.6, 265.1), (238468.2, 6569553.0, 264.8), (238472.5, 6569553.1, 264.6),
    (238476.8, 6569553.2, 264.6), (238481.1, 6569553.3, 264.5), (238485.4, 6569553.4, 264.4), (238489.6, 6569553.5, 264.3),
    (238493.9, 6569553.7, 264.3), (238498.2, 6569553.8, 264.2), (238442.5, 6569548.1, 265.4), (238446.8, 6569548.2, 265.3),
    (238451.1, 6569548.3, 265.2), (238468.3, 6569548.7, 264.8), (238472.6, 6569548.9, 264.7), (238476.9, 6569549.0, 264.7),
    (238481.2, 6569549.1, 264.6), (238485.5, 6569549.2, 264.5), (238489.8, 6569549.3, 264.5), (238494.0, 6569549.4, 264.5),
    (238438.4, 6569543.7, 265.6), (238442.7, 6569543.8, 265.5), (238446.9, 6569544.0, 265.4), (238451.2, 6569544.1, 265.3),
    (238455.5, 6569544.2, 265.2), (238459.8, 6569544.3, 265.0), (238464.1, 6569544.4, 265.0), (238481.3, 6569544.8, 264.7),
    (238485.6, 6569544.9, 264.7), (238489.9, 6569545.0, 264.7), (238434.2, 6569539.4, 265.7), (238438.5, 6569539.5, 265.7),
    (238442.8, 6569539.6, 265.6), (238447.1, 6569539.7, 265.5), (238451.3, 6569539.8, 265.4), (238455.6, 6569539.9, 265.3),
    (238459.9, 6569540.0, 265.1), (238464.2, 6569540.1, 264.9), (238481.4, 6569540.5, 264.7), (238485.7, 6569540.6, 264.7),
    (238490.0, 6569540.7, 264.7), (238434.3, 6569535.1, 265.7), (238438.6, 6569535.2, 265.7), (238442.9, 6569535.3, 265.6),
    (238447.2, 6569535.4, 265.5), (238451.4, 6569535.5, 265.4), (238455.7, 6569535.6, 265.3), (238460.0, 6569535.7, 265.1),
    (238464.3, 6569535.8, 265.0), (238434.4, 6569530.8, 265.8), (238438.7, 6569530.9, 265.8), (238443.0, 6569531.0, 265.7),
    (238460.1, 6569531.5, 265.3), (238464.4, 6569531.6, 265.1), (238468.7, 6569531.7, 265.1), (238473.0, 6569531.8, 265.1),
    (238477.3, 6569531.9, 265.1), (238481.6, 6569532.0, 265.1), (238434.5, 6569526.6, 265.9), (238438.8, 6569526.7, 265.9),
    (238443.1, 6569526.8, 265.8), (238460.2, 6569527.2, 265.4), (238464.5, 6569527.3, 265.3), (238468.8, 6569527.4, 265.3),
    (238473.1, 6569527.5, 265.2), (238477.4, 6569527.6, 265.2), (238438.9, 6569522.4, 266.0), (238443.2, 6569522.5, 265.9),
    (238447.5, 6569522.6, 265.8), (238451.8, 6569522.7, 265.7), (238456.1, 6569522.8, 265.6), (238460.3, 6569522.9, 265.5),
    (238464.6, 6569523.0, 265.4), (238468.9, 6569523.1, 265.4), (238473.2, 6569523.2, 265.3), (238443.3, 6569518.2, 266.0),
]


def _dms(b: float) -> str:
    d = int(b); m = int((b - d) * 60); s = round(((b - d) * 60 - m) * 60)
    if s == 60:
        s, m = 0, m + 1
    return f"{d}\u00b0{m:02d}'{s:02d}\""


def lot_context() -> LotContext:
    """Lot 2 DP227508 as SA1 would return it (front = the 20.2 m south-west side facing Little Bloomfield Street)."""
    poly = Polygon(LOT)
    adj = ["lot", "lot", "lot", "road"]            # SE (Lot 5), NE (Lot 3), NW (Lot 1), SW front = road
    segs = []
    for i in range(4):
        a, b = LOT[i], LOT[(i + 1) % 4]
        dx, dy = b[0] - a[0], b[1] - a[1]
        brg = math.degrees(math.atan2(dx, dy)) % 360.0
        segs.append(BoundarySegment(seq=i, bearing_deg=brg, bearing_dms=_dms(brg), distance_m=math.hypot(dx, dy), adjoins=adj[i],
                                    is_front=(i == 3), start_xy=a, end_xy=b))
    nb = [NeighbourLot(label=lab, wkt=Polygon(p).wkt) for lab, p in NEIGHBOURS]
    return LotContext(lot_id=uuid.uuid5(uuid.NAMESPACE_URL, "offline:" + LOTPLAN), jurisdiction="NSW", lotplan=LOTPLAN, lga_name="GUNNEDAH",
                      mga_srid=SRID, area_m2_calculated=round(poly.area, 1), area_m2_registered=None, boundary_wkt=poly.wkt, segments=segs,
                      road_names=[ROAD_NAME], zone_code="R2", envelope_wkt=None, neighbours=nb)


def sa1_result() -> Sa1Result:
    lot = lot_context()
    z = ZoneShare(zone_code="R2", zone_name="Low Density Residential", instrument="Gunnedah Local Environmental Plan 2012", is_residential=True,
                  overlap_area_m2=lot.area_m2_calculated, overlap_fraction=1.0, is_dominant=True)
    return Sa1Result(lot=lot, identifier=LotIdentifier.parse(LOTPLAN, "NSW"),
                     segment_details=[SegmentDetail(polygon_index=0, ring_index=0, seq_in_ring=i, seq=i) for i in range(4)],
                     zones=[z], multi_zone=False, is_residential=True, flags=["offline_fixture", "multi_zone_in_saved_live_run"], snapshots=[],
                     boundary_wkt_gda2020="", attributes={"offline_fixture": "lot2"})


# ---- levels ---------------------------------------------------------------------------------------------------------------
_X0, _Y0 = 238465.0, 6569546.0
_S = np.array(SPOTS, float)
_A = np.c_[np.ones(len(_S)), _S[:, 0] - _X0, _S[:, 1] - _Y0]
_C = np.linalg.lstsq(_A, _S[:, 2], rcond=None)[0]
_RES = _S[:, 2] - _A @ _C


def elevation(x, y):
    """Plane fitted to the spot levels plus an inverse-distance residual (smooth, bounded by the residuals seen)."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    base = _C[0] + _C[1] * (x - _X0) + _C[2] * (y - _Y0)
    d2 = (x[..., None] - _S[:, 0]) ** 2 + (y[..., None] - _S[:, 1]) ** 2 + 4.0
    w = 1.0 / d2 ** 1.5
    return base + (w * _RES).sum(-1) / w.sum(-1)


_T = Transformer.from_crs(3857, SRID, always_xy=True)


def export_tiff(service: str, bbox: tuple, w: int, h: int, timeout: float = 0.0) -> bytes:
    """Drop-in for live_levels._export: F32 TIFF of the reconstructed surface over a web-mercator bbox (row 0 = north)."""
    x0, y0, x1, y1 = bbox
    xs = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    ys = y1 - (np.arange(h) + 0.5) * (y1 - y0) / h
    gx, gy = np.meshgrid(xs, ys)
    mx, my = _T.transform(gx, gy)
    arr = elevation(mx, my).astype(np.float32)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="F").save(buf, format="TIFF")
    return buf.getvalue()


# ---- imagery --------------------------------------------------------------------------------------------------------------
class CachedImagery:
    """ImageryProvider over the two aerials saved by the live run; areas outside the saved coverage come back white."""
    name = "nsw_cached_sample"

    def __init__(self) -> None:
        from app.imagery.licence import NSW_LICENCE
        self.licence = NSW_LICENCE
        self._imgs = [(Image.open(DATA_DIR / f).convert("RGB"), bb) for f, bb in IMAGES]

    def fetch(self, bbox, srid: int, size_px, dpi: int = 96) -> ImageResult:
        x0, y0, x1, y1 = bbox
        im, bb = next(((i, b) for i, b in self._imgs if b[0] <= x0 and b[1] <= y0 and b[2] >= x1 and b[3] >= y1), self._imgs[-1])
        W, H = im.size
        sx, sy = W / (bb[2] - bb[0]), H / (bb[3] - bb[1])
        crop = (int((x0 - bb[0]) * sx), int((bb[3] - y1) * sy), int((x1 - bb[0]) * sx), int((bb[3] - y0) * sy))
        canvas = Image.new("RGB", (max(1, crop[2] - crop[0]), max(1, crop[3] - crop[1])), (255, 255, 255))
        src = im.crop((max(crop[0], 0), max(crop[1], 0), min(crop[2], W), min(crop[3], H)))
        canvas.paste(src, (max(0, -crop[0]), max(0, -crop[1])))
        out = canvas.resize((int(size_px[0]), int(size_px[1])), Image.LANCZOS)
        buf = io.BytesIO(); out.save(buf, format="PNG")
        meta = ImageMeta(source="NSW_Imagery (cached sample from the saved 2026-10-12 run)", srid=srid, bbox=tuple(bbox), size_px=tuple(size_px),
                         capture_date=CAPTURE_DATE, licence="verify terms before commercial use", attribution=ATTRIBUTION,
                         resolution_m_per_px=(x1 - x0) / max(1, size_px[0]), cached=True)
        return ImageResult(data=buf.getvalue(), meta=meta)


def provenance_note() -> str:
    return "OFFLINE FIXTURE (Lot 2 DP227508 rebuilt from the saved run; not live data; not a survey)"


def cadastre_window(window):
    """Offline stand-in for the SA1 viewport window query.  The saved run only holds the three adjoining lots, so the window is reported INCOMPLETE:
    the plan sheets then state that the DCDB does not reach the viewport edges (nothing is invented to fill it)."""
    from app.agents.sa5_cad_dxf.planset.data import CadastreWindow
    return CadastreWindow([NeighbourLot(label=lab, wkt=Polygon(p).wkt) for lab, p in NEIGHBOURS], False,
                          "OFFLINE FIXTURE HOLDS ONLY THE ADJOINING LOTS, NO LIVE CADASTRE WINDOW QUERY")

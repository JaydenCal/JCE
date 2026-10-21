"""Offline SA9 layer results for Lot 2 DP227508 (companion of app/offline/lot2.py).

WHY: the NSW planning hosts are not reachable from every environment (the cloud sandbox refuses them with HTTP 403), so the
SA9 constraint layers cannot be queried there. This module is a fake ``LayerLoader`` (the same approach as tests/test_sa9_constraints.py)
that serves a reconstruction of what the live 2026-10-12 run reported for the lot:

  * bush fire prone land: a "Vegetation Buffer" polygon whose nearest edge is 54 m from the lot and a "Vegetation Category 3"
    polygon whose nearest edge is 84 m from the lot (inside the 100 m screening distance, so the layer reads "Within buffer");
  * heritage item: the nearest mapped item is 133 m away (clear);
  * minimum lot size: 650 m2 over 99% of the lot and a 200-399.9 ha class over the remaining 1%;
  * floor space ratio 0.5:1 over 99% of the lot; no height of buildings control; land application of the Resilience and Hazards SEPP;
  * every other layer: nothing mapped within the 150 m search window;
  * contaminated land and road and rail corridors have no endpoint, so SA9 itself reports them as NOT CHECKED.

Geometry is APPROXIMATE (rebuilt from the distances and percentages the live report printed). It is TEST DATA ONLY: not live, not a
survey, not a planning certificate. Use through ``scripts/offline_lot2_report.py`` or construct ``Lot2LayerLoader`` directly in tests.
"""
from __future__ import annotations

import math

from shapely import wkt as _shapely_wkt
from shapely.affinity import translate
from shapely.geometry import Polygon, box
from shapely.geometry.base import BaseGeometry

from app.agents.sa9_constraints.intersect import Feature, LayerData
from app.agents.sa9_constraints.layers import LayerType
from app.offline.lot2 import LOT

FETCHED = "2026-10-12"
LEP = "Gunnedah Local Environmental Plan 2012"
SEPP_RH = "State Environmental Planning Policy (Resilience and Hazards) 2021"
NOTE = "OFFLINE FIXTURE: layer results rebuilt from the saved 2026-10-12 live run; geometry approximate"

_lot = Polygon(LOT)
# unit vectors at the north-east (short) boundary of the lot: _U points away from the lot, _V runs along that boundary
_p1, _p2 = LOT[1], LOT[2]
_mid = ((_p1[0] + _p2[0]) / 2, (_p1[1] + _p2[1]) / 2)
_el = math.hypot(_p2[0] - _p1[0], _p2[1] - _p1[1])
_V = ((_p2[0] - _p1[0]) / _el, (_p2[1] - _p1[1]) / _el)
_U = (-_V[1], _V[0])
if (_U[0] * (_mid[0] - _lot.centroid.x) + _U[1] * (_mid[1] - _lot.centroid.y)) < 0:
    _U = (-_U[0], -_U[1])


def _band(d0: float, d1: float, v0: float, v1: float) -> Polygon:
    """Quadrilateral between d0 and d1 metres from the north-east boundary (along _U), v0..v1 along it, slightly skewed."""
    def pt(d: float, v: float) -> tuple[float, float]:
        return (_mid[0] + _U[0] * d + _V[0] * v, _mid[1] + _U[1] * d + _V[1] * v)
    return Polygon([pt(d0, v0), pt(d0, v1), pt(d1 + 9, v1 + 12), pt(d1, v0 - 10)])


def _feature(g: BaseGeometry, **attrs) -> Feature:
    return Feature(geometry_wkt=g.wkt, attrs=attrs)


def _place_at_distance(shape: BaseGeometry, direction: tuple[float, float], target: float) -> BaseGeometry:
    """Translate ``shape`` along ``direction`` until its distance to the lot is ``target`` metres."""
    c = _lot.centroid                              # start the shape on the lot centroid (the shape is built at the origin, hundreds of kilometres away in MGA)
    shape = translate(shape, c.x - shape.centroid.x, c.y - shape.centroid.y)
    lo, hi = 0.0, 600.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if _lot.distance(translate(shape, direction[0] * mid, direction[1] * mid)) < target:
            lo = mid
        else:
            hi = mid
    return translate(shape, direction[0] * hi, direction[1] * hi)


def _sliver() -> BaseGeometry:
    """About 1% of the lot: a strip of the lot along its south-east boundary."""
    p0, p1 = LOT[0], LOT[1]
    ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    t = 0.01 * _lot.area / ln
    nx, ny = (p1[1] - p0[1]) / ln, -(p1[0] - p0[0]) / ln
    if (nx * (_lot.centroid.x - p0[0]) + ny * (_lot.centroid.y - p0[1])) < 0:
        nx, ny = -nx, -ny
    return Polygon([p0, p1, (p1[0] + nx * t, p1[1] + ny * t), (p0[0] + nx * t, p0[1] + ny * t)])


def _cover() -> BaseGeometry:
    return _lot.buffer(12.0).envelope


def _features(key: str) -> tuple[list[Feature], str | None]:
    """(features, source currency date or None). Nothing mapped -> []."""
    if key == "nsw_bushfire":
        return ([_feature(_band(54.0, 84.0, -150.0, 170.0), Category=2, d_Category="Vegetation Buffer"),
                 _feature(_band(84.0, 150.0, -160.0, 180.0), Category=3, d_Category="Vegetation Category 3")], "2026-10-03")
    if key == "nsw_heritage_item":
        away = (-_U[0], -_U[1])                       # across the road in front of the lot
        item = _place_at_distance(box(0, 0, 22, 18), away, 133.0)
        return [_feature(item, H_NAME="Item (name not used in the report)", SIG="Local", LAY_CLASS="Item - General", EPI_NAME=LEP)], "2012-06-29"
    if key == "nsw_lot_size_map":
        sl = _sliver()
        return ([_feature(_cover().difference(sl), LOT_SIZE=650, UNITS="m²", LAY_CLASS="J", EPI_NAME=LEP),
                 _feature(sl, LOT_SIZE=200, UNITS="ha", LAY_CLASS="200-399.9", EPI_NAME=LEP)], "2024-12-13")
    if key == "nsw_fsr_map":
        return [_feature(_cover().difference(_sliver()), FSR=0.5, LAY_CLASS="I", EPI_NAME=LEP)], "2022-10-21"
    if key == "nsw_sepp_area":
        return [_feature(_cover(), EPI_NAME=SEPP_RH, LAY_CLASS="Land Application")], "2022-03-01"
    return [], None


class Lot2LayerLoader:
    """LayerLoader serving the reconstructed Lot 2 layer set. Accepts the constructor arguments of the real ArcGIS loader."""

    def __init__(self, srid: int = 7856, getter=None, sleep=None, **_kw) -> None:  # noqa: ANN001
        self.srid = srid

    def load(self, layer: LayerType, bbox: tuple[float, float, float, float]) -> LayerData:
        feats, cur = _features(layer.key)
        win = box(*bbox)
        feats = [f for f in feats if _shapely_wkt.loads(f.geometry_wkt).intersects(win)]     # the service returns features meeting the window
        cp = getattr(layer, "copyright", None)
        cur_s = (f"source currency {cur}" if cur else "currency field not returned") + f"; fetched {FETCHED}"
        return LayerData(features=feats, currency=cur_s + (f"; {cp}" if cp else ""))

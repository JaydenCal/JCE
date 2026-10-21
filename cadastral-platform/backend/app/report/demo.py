"""SYNTHETIC DEMO DATA for the planning map extracts.

Everything here is invented to exercise the drawing code (polygons, category fills, labels, legends, multi-zone and not-checked panels).  It describes no
real site, uses no real service and is stamped SYNTHETIC DEMO DATA on every page and figure by ``meta["synthetic_demo"]``.  Never use it as evidence.
"""
from __future__ import annotations

from types import SimpleNamespace

from shapely.geometry import box

from app.agents.sa9_constraints.intersect import LayerResult, MapFeature
from app.agents.sa9_constraints.layers import layers_for
from app.agents.sa9_constraints.triggers import evaluate
from app.report import SiteReportInputs

LOT = box(0, 0, 25, 40)
WIN = (-150.0, -150.0, 175.0, 190.0)            # the search window the synthetic "service" was asked for
NOT_CHECKED = ("nsw_contamination", "nsw_transport_corridor")
CURRENCY = "source currency 2026-01-01; fetched 2026-10-01"


def _mf(g, **a) -> MapFeature:
    return MapFeature(geometry_wkt=g.intersection(box(*WIN)).wkt, attrs=a)


def _res(key: str, label: str, status: str, feats: list[tuple], near: float | None = None) -> LayerResult:
    mf = [_mf(g, **a) for g, a in feats]
    hits = [(g, a) for g, a in feats if g.intersects(LOT)]
    ov = sum(g.intersection(LOT).area for g, _ in hits)
    return LayerResult(key=key, label=label, status=status, overlap_area_m2=ov, pct_of_lot=round(100 * ov / LOT.area, 1), nearest_distance_m=near,
                       attributes=[a for _, a in hits] if hits else [a for _, a in feats], geometries_wkt=[g.wkt for g, _ in (hits or feats)],
                       map_features=mf, map_window=list(WIN), data_currency=CURRENCY)


def demo_results() -> list[LayerResult]:
    out = []
    spec = {
        "nsw_lot_size_map": ("affected", [(box(-150, -150, 175, 24), {"LOT_SIZE": 600, "UNITS": "sq m", "LAY_CLASS": "600"}),
                                           (box(-150, 24, 175, 190), {"LOT_SIZE": 2, "UNITS": "ha", "LAY_CLASS": "2"})], 0.0),
        "nsw_fsr_map": ("affected", [(box(-150, -150, 175, 24), {"FSR": 0.5}), (box(-150, 24, 175, 190), {"FSR": 0.3})], 0.0),
        "nsw_height_map": ("affected", [(box(-150, -150, 175, 190), {"MAX_B_H": 9.0})], 0.0),
        "nsw_flood": ("affected", [(box(-40, -20, 12, 14).union(box(-150, -20, -40, 5)), {"LAY_CLASS": "Flood Planning Area"})], 0.0),
        "nsw_bushfire": ("affected", [(box(20, 30, 90, 70), {"Category": 1, "d_Category": "Vegetation Category 1"}),
                                      (box(5, 45, 20, 70), {"d_Category": "Vegetation Buffer"}), (box(90, 30, 150, 60), {"Category": 3, "d_Category": "Vegetation Category 3"})], 0.0),
        "nsw_acid_sulfate": ("affected", [(box(-150, -150, 175, 12), {"LAY_CLASS": "Class 5"}), (box(-150, 12, 60, 60), {"LAY_CLASS": "Class 3"})], 0.0),
        "nsw_heritage_item": ("not_affected", [(box(60, 5, 75, 20), {"H_NAME": "Synthetic hall"})], 35.0),
        "nsw_riparian": ("affected", [(box(-150, -45, 175, -30), {"LAY_CLASS": "Watercourse (synthetic)"})], 30.0),
        "nsw_biodiversity": ("not_affected", [], None),
    }
    for lt in layers_for("NSW"):
        k = lt.key
        if k in NOT_CHECKED:
            out.append(LayerResult(key=k, label=lt.label, status="not_checked", error="no endpoint configured"))
        elif k in spec:
            st, feats, near = spec[k]
            out.append(_res(k, lt.label, st, feats, near))
        else:
            out.append(LayerResult(key=k, label=lt.label, status="not_affected", map_features=[], map_window=list(WIN), data_currency=CURRENCY))
    return out


def demo_zone_map() -> dict:
    r2, ru1, re1 = box(-250, -250, 275, 26), box(-250, 26, 275, 290).difference(box(60, 60, 140, 120)), box(60, 60, 140, 120)
    polys = [{"code": c, "name": n, "instrument": "SYNTHETIC DEMO PLAN", "wkt": g.wkt, "on_lot": g.intersects(LOT) and g.intersection(LOT).area > 0}
             for c, n, g in (("R2", "Low Density Residential", r2), ("RU1", "Primary Production", ru1), ("RE1", "Public Recreation", re1))]
    return {"polygons": polys, "coverage": [-250, -250, 275, 290], "source": None,
            "zones_on_lot": [{"code": "R2", "name": "Low Density Residential", "instrument": "SYNTHETIC DEMO PLAN", "pct": 65.0},
                             {"code": "RU1", "name": "Primary Production", "instrument": "SYNTHETIC DEMO PLAN", "pct": 35.0}], "multi_zone": True, "zone_code": "R2"}


def demo_inputs() -> SiteReportInputs:
    res = demo_results()
    nb = [SimpleNamespace(label=l, wkt=g.wkt, is_road=r) for l, g, r in (
        ("1", box(-30, 0, -2, 40), False), ("3", box(27, 0, 55, 40), False), ("4", box(0, 42, 25, 80), False), ("5", box(-30, 42, -2, 80), False),
        ("Road", box(-30, -22, 55, -4), True))]
    return SiteReportInputs(meta={"lotplan": "9//DP000000", "lga_name": "Synthetic", "jurisdiction": "NSW", "development_type": "Dwelling house",
                                  "development_type_key": "dwelling_house", "date": "2026-10-21", "zone_code": "R2", "area_m2": 1000.0, "flags": ["multi_zone"],
                                  "synthetic_demo": True},
                            results=res, triggers=evaluate(res, "NSW", None, development_type="dwelling_house"), lot_wkt=LOT.wkt, imagery=None, neighbours=nb,
                            zone_map=demo_zone_map())

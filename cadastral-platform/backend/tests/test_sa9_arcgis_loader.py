import json

import pytest
from pyproj import Transformer

from app.agents.sa9_constraints import layers as L
from app.agents.sa9_constraints.arcgis_loader import ArcGisLayerLoader, esri_to_shapely
from app.agents.sa9_constraints.intersect import check_layer
from shapely.geometry import box

T = Transformer.from_crs(7856, 7844, always_xy=True)


def ring(x0, y0, x1, y1):  # clockwise (esri exterior) in 7844
    pts = [T.transform(*p) for p in [(x0, y0), (x0, y1), (x1, y1), (x1, y0), (x0, y0)]]
    return [list(p) for p in pts]


def feat(r, **a):
    return {"attributes": a, "geometry": {"rings": [r]}}



def test_defaults_loaded_and_env_overrides(monkeypatch):
    d = L.defaults()
    assert d["nsw_bushfire"]["verified"] and d["nsw_bushfire"]["date_verified"]
    lt = L.get_layer("nsw_heritage_conservation")
    assert lt.endpoint and lt.verified and "Conservation" in lt.where and "H_NAME" in lt.attr_fields
    assert L.get_layer("nsw_contamination").endpoint is None and L.get_layer("nsw_transport_corridor").endpoint is None
    monkeypatch.setenv("SA9_ENDPOINT_NSW_BUSHFIRE", "http://override/0")
    o = L.get_layer("nsw_bushfire")
    assert o.endpoint == "http://override/0" and not o.verified and o.where is None


def test_paging_retry_and_intersect():
    calls = []
    pages = [{"features": [feat(ring(-50, -50, 10, 10), Category=1, LastUpdate=1767916800000)], "exceededTransferLimit": True},
             {"features": [feat(ring(500, 500, 520, 520), Category=3)]}]

    def getter(url, p):
        calls.append(p)
        if len(calls) == 1:
            raise TimeoutError("boom")
        return pages[p["resultOffset"] // 2]

    ld = ArcGisLayerLoader(7856, getter=getter, retries=3, page_size=2, sleep=lambda s: None)
    lt = L.get_layer("nsw_bushfire")
    lot = box(0, 0, 20, 30)
    data = ld.load(lt, (-150, -150, 170, 180))
    assert len(data.features) == 2 and "2026-01-09" in data.currency and "BFPL" in data.currency
    assert calls[1]["outSR"] == 7844 and json.loads(calls[1]["geometry"])["spatialReference"]["wkid"] == 7844
    r = check_layer(lt, lot, None, ld)
    assert r.status == "affected" and r.snapshot_sha256 and r.endpoint_verified and r.overlap_area_m2 > 0
    assert r.attributes[0] == {"Category": 1}


def test_error_response_and_page_cap_not_checked():
    ld = ArcGisLayerLoader(7856, getter=lambda u, p: {"error": {"code": 400, "message": "bad"}}, retries=2, sleep=lambda s: None)
    r = check_layer(L.get_layer("nsw_bushfire"), box(0, 0, 20, 30), None, ld)
    assert r.status == "not_checked" and "bad" in r.error
    ld = ArcGisLayerLoader(7856, getter=lambda u, p: {"features": [], "exceededTransferLimit": True}, max_pages=2, sleep=lambda s: None)
    with pytest.raises(RuntimeError):
        ld.load(L.get_layer("nsw_bushfire"), (0, 0, 1, 1))


def test_holes():
    outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
    hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]
    assert esri_to_shapely({"rings": [outer, hole]}).area == pytest.approx(64)

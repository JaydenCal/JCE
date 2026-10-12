import json
import math
from pathlib import Path

import pytest
from pyproj import Transformer
from shapely.geometry import mapping, box, LineString

from app.agents.base import AgentError
from app.agents.sa1_cadastre import Sa1Cadastre, Sa1Request
from app.agents.sa1_cadastre import clients as C
from app.agents.sa1_cadastre import persist
from app.agents.sa1_cadastre.agent import RoadConfig, Sa1Config
from app.agents.sa1_cadastre.geometry import (area_mismatch, bearing_deg, compute_segments, mga_srid_for_lon,
                                              parse_polygonal, to_dms)
from app.agents.sa1_cadastre.models import LotIdentifier
from app.agents.sa1_cadastre.zoning import ZoningConfig, is_residential

INV = Transformer.from_crs(7856, 7844, always_xy=True)


def ll_ring(x0, y0, w, h):
    pts = [(x0, y0), (x0, y0 + h), (x0 + w, y0 + h), (x0 + w, y0), (x0, y0)]
    return [list(INV.transform(x, y)) for x, y in pts]


def poly_feat(x0, y0, w, h, props):
    return {"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ll_ring(x0, y0, w, h)]}}


# 20 x 50 m lot (hand-computable) near Hornsby (MGA56 ~ E 325000 N 6265000) and Brisbane
NSW_LOT = poly_feat(325000, 6265000, 20, 50, {"lotidstring": "12//DP345678", "plan_lot_area": 1000.0,
                                               "lganame": "HORNSBY", "suburbname": "HORNSBY"})
QLD_LOT = poly_feat(502000, 6960000, 20, 50, {"lotplan": "1RP12345", "lot_area": 1100.0, "shire_name": "BRISBANE",
                                              "locality": "KENMORE"})
ROAD = {"type": "Feature", "properties": {"roadname": "Pacific Hwy"},
        "geometry": {"type": "LineString", "coordinates": [list(INV.transform(325000 - 20, 6265000 - 10)),
                                                          list(INV.transform(325000 + 40, 6265000 - 10))]}}


def fc(*f):
    return json.dumps({"type": "FeatureCollection", "features": list(f)}).encode()


def zone(x0, y0, w, h, code):
    return poly_feat(x0, y0, w, h, {"SYM_CODE": code, "LAY_CLASS": "Zone " + code, "EPI_NAME": "Hornsby LEP 2013"})


class Mock:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def __call__(self, url, params):
        self.calls.append((url, params))
        for k, v in self.routes.items():
            if k in url:
                return v, 'W/"etag1"'
        raise ConnectionError("no route " + url)


def nsw_agent(zones, roads=True):
    cfg = Sa1Config()
    cfg.roads = {"NSW": RoadConfig(layer=C.LayerConfig("http://roads/0", "x", "roads", "x", "NSW"))} if roads else {}
    routes = {"NSW_Cadastre": fc(NSW_LOT), "EPI_Primary": fc(*zones), "roads/0": fc(ROAD)}
    m = Mock(routes)
    return Sa1Cadastre(cfg, C.ArcGISClient(fetcher=m, sleep=lambda s: None)), m


# ---- identifiers
@pytest.mark.parametrize("txt,lotplan", [("12//DP345678", "12//DP345678"), ("12/DP345678", "12//DP345678"),
                                         ("12/-/DP345678", "12//DP345678"), ("12/3/dp345678", "12/3/DP345678"),
                                         ("12 / SP 99", "12//SP99")])
def test_nsw_parse(txt, lotplan):
    assert LotIdentifier.parse(txt, "NSW").lotplan == lotplan


@pytest.mark.parametrize("txt", ["1RP12345", "DP345678", "12//XX345678", "12//DP", ""])
def test_nsw_invalid(txt):
    with pytest.raises(AgentError) as e:
        LotIdentifier.parse(txt, "NSW")
    assert e.value.error_code == "SA1_BAD_IDENTIFIER"


def test_qld_parse():
    i = LotIdentifier.parse("1RP12345", "QLD")
    assert (i.lot, i.plan_type, i.plan_number, i.lotplan) == ("1", "RP", "12345", "1RP12345")
    assert LotIdentifier.parse("13/sp123456", "QLD").lotplan == "13SP123456"
    for bad in ["RP12345", "1DP12345", "12//DP345678", "1RP"]:
        with pytest.raises(AgentError):
            LotIdentifier.parse(bad, "QLD")


def test_request_needs_exactly_one():
    with pytest.raises(ValueError):
        Sa1Request(jurisdiction="NSW")
    with pytest.raises(ValueError):
        Sa1Request(jurisdiction="NSW", lot_identifier="1/DP1", point=(151, -33))


# ---- geometry
def test_zone_by_longitude():
    assert mga_srid_for_lon(143.9) == 7854
    assert mga_srid_for_lon(144.0) == 7855
    assert mga_srid_for_lon(149.99) == 7855
    assert mga_srid_for_lon(151.1) == 7856 and mga_srid_for_lon(153.0) == 7856
    with pytest.raises(AgentError):
        mga_srid_for_lon(100)


def test_bearing_and_dms():
    assert bearing_deg(0, 0, 0, 10) == 0 and bearing_deg(0, 0, 10, 0) == 90
    assert bearing_deg(0, 0, 0, -10) == 180 and bearing_deg(0, 0, -10, 0) == 270
    b = bearing_deg(0, 0, 4, 3)  # atan(4/3) = 53.1301 -> 53 07 48
    assert to_dms(b) == "53°07'48\""
    assert to_dms(36.8698976) == "36°52'12\""
    assert to_dms(359.99999) == "0°00'00\""


def test_segments_distance_bearing_front():
    g = box(0, 0, 20, 50)
    road = LineString([(-20, -10), (40, -10)])
    segs, det, names = compute_segments(g, [("Pacific Hwy", road)], 15)
    assert len(segs) == 4 and names == ["Pacific Hwy"]
    assert sorted(round(s.distance_m, 3) for s in segs) == [20.0, 20.0, 50.0, 50.0]
    front = [s for s in segs if s.is_front]
    assert len(front) == 1 and front[0].distance_m == 20.0
    assert front[0].start_xy[1] == 0 and front[0].end_xy[1] == 0
    assert front[0].bearing_deg in (90.0, 270.0)
    assert [d.seq_in_ring for d in det] == [0, 1, 2, 3]


def test_interior_ring_segments():
    g = box(0, 0, 40, 40).difference(box(10, 10, 20, 20))
    segs, det, _ = compute_segments(g)
    assert len(segs) == 8 and {d.ring_index for d in det} == {0, 1}


def test_invalid_geometry_rejected():
    bow = {"type": "Polygon", "coordinates": [[[151, -33], [151.001, -33.001], [151.001, -33], [151, -33.001], [151, -33]]]}
    with pytest.raises(AgentError) as e:
        parse_polygonal(bow)
    assert e.value.error_code == "SA1_INVALID_GEOMETRY"
    for bad in (None, {"type": "Point", "coordinates": [151, -33]}):
        with pytest.raises(AgentError):
            parse_polygonal(bad)


def test_area_mismatch():
    assert not area_mismatch(1000, 1005) and area_mismatch(1000, 1100) and not area_mismatch(1000, None)


def test_residential_tables():
    assert is_residential("R2", "NSW") and is_residential("RU5", "NSW") and not is_residential("E1", "NSW")
    assert is_residential("LDR", "QLD") and not is_residential("IN1", "QLD")


# ---- clients
def test_retry_paging_and_hash():
    page1 = json.dumps({"features": [NSW_LOT], "exceededTransferLimit": True}).encode()
    page2 = fc(NSW_LOT)
    seq = [ConnectionError("boom"), page1, page2]
    calls = []

    def f(url, params):
        calls.append(params)
        r = seq.pop(0)
        if isinstance(r, Exception):
            raise r
        return r, None

    sl = []
    cl = C.ArcGISClient(fetcher=f, sleep=sl.append)
    r = cl.query(C.nsw_lot_layer(), where="1=1")
    assert len(r.features) == 2 and len(sl) == 1
    assert calls[2]["resultOffset"] == 1000
    import hashlib
    assert r.snapshot.response_sha256 == hashlib.sha256(page1 + page2).hexdigest()


def test_upstream_error_and_exhausted_retries():
    cl = C.ArcGISClient(fetcher=lambda u, p: (b'{"error":{"code":400,"message":"bad"}}', None), sleep=lambda s: None)
    with pytest.raises(AgentError) as e:
        cl.query(C.nsw_lot_layer())
    assert e.value.error_code == "SA1_UPSTREAM_ERROR"

    def down(u, p):
        raise ConnectionError("x")
    with pytest.raises(AgentError) as e:
        C.ArcGISClient(fetcher=down, retries=2, sleep=lambda s: None).query(C.nsw_lot_layer())
    assert e.value.error_code == "SA1_UPSTREAM_UNAVAILABLE"


# ---- full agent
def test_agent_nsw_full():
    agent, m = nsw_agent([zone(324990, 6264990, 40, 100, "R2")])
    res = agent.run(Sa1Request(jurisdiction="NSW", lot_identifier="12/DP345678"))
    lc = res.lot
    assert lc.mga_srid == 7856 and lc.lotplan == "12//DP345678" and lc.zone_code == "R2"
    assert lc.area_m2_calculated == pytest.approx(1000, abs=0.5)
    assert lc.road_names == ["Pacific Hwy"] and sum(s.is_front for s in lc.segments) == 1
    assert res.is_residential and not res.multi_zone and not res.area_mismatch
    assert lc.lga_name == "HORNSBY"
    assert any("lotidstring='12//DP345678'" in c[1]["where"] for c in m.calls)
    assert len(res.snapshots) == 3 or len(res.snapshots) == 2


def test_agent_multizone_and_by_point():
    agent, _ = nsw_agent([zone(324990, 6264990, 40, 30, "R2"), zone(324990, 6265020, 40, 80, "E1")], roads=False)
    res = agent.run(Sa1Request(jurisdiction="NSW", point=(151.1, -33.7)))
    assert res.multi_zone and res.lot.zone_code == "E1"  # 60% E1
    assert [z.is_dominant for z in res.zones] == [True, False]
    assert sum(z.overlap_fraction for z in res.zones) == pytest.approx(1, abs=1e-3)
    assert "multi_zone" in res.flags and "no_road_data_front_unknown" in res.flags


def test_agent_qld_geojson_zoning_and_area_mismatch(tmp_path):
    zf = tmp_path / "z.geojson"
    zf.write_text(fc(poly_feat(501990, 6959990, 40, 100, {"SYM_CODE": "LDR", "LAY_CLASS": "Low density", "EPI_NAME": "Brisbane City Plan 2014"})).decode())
    cfg = Sa1Config()
    cfg.zoning = {"QLD": ZoningConfig(geojson_path=str(zf))}
    m = Mock({"LandParcel": fc(QLD_LOT)})
    agent = Sa1Cadastre(cfg, C.ArcGISClient(fetcher=m))
    res = agent.run(Sa1Request(jurisdiction="QLD", lot_identifier="1RP12345"))
    assert res.lot.zone_code == "LDR" and res.is_residential
    assert res.area_mismatch and "area_mismatch" in res.flags


def test_persist_builders():
    agent, _ = nsw_agent([zone(324990, 6264990, 40, 100, "R2")])
    res = agent.run(Sa1Request(jurisdiction="NSW", lot_identifier="12//DP345678"))
    stmts = persist.build_all(res)
    sqls = [s for s, _ in stmts]
    assert sqls[0].startswith("INSERT INTO cadastre.source_snapshots")
    assert sum("lot_boundary_segments" in s for s in sqls) == 4
    assert any("planning.lot_zoning" in s for s in sqls)
    for sql, params in stmts:
        assert sql.count("%s") == len(params)
    assert isinstance(stmts[0][1][6], bytes) and len(stmts[0][1][6]) == 32
    assert res.snapshots[0].response_sha256 == stmts[0][1][6].hex()


def test_address_geocode():
    cfg = Sa1Config()
    cfg.geocoders = {"NSW": "http://geo/GeocodeServer"}
    cfg.zoning = {}
    lon, lat = INV.transform(325010, 6265025)
    m = Mock({"findAddressCandidates": json.dumps({"candidates": [{"location": {"x": lon, "y": lat}}]}).encode(),
              "NSW_Cadastre": fc(NSW_LOT)})
    res = Sa1Cadastre(cfg, C.ArcGISClient(fetcher=m)).run(Sa1Request(jurisdiction="NSW", address="1 Test St Hornsby"))
    assert res.lot.lotplan == "12//DP345678"
    with pytest.raises(AgentError):
        Sa1Cadastre(Sa1Config(), C.ArcGISClient(fetcher=m)).run(Sa1Request(jurisdiction="QLD", address="x"))

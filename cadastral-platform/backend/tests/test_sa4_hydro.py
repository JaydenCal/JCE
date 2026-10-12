import math
from uuid import uuid4

import pytest
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from shapely import wkt
from shapely.geometry import LineString, Polygon, box

from app.agents.base import AgentError
from app.agents.sa4_hydro.agent import Sa4Hydro
from app.agents.sa4_hydro.buffers import build_buffers
from app.agents.sa4_hydro.conflicts import detect_conflicts
from app.agents.sa4_hydro.connections import propose_sewer, propose_water
from app.agents.sa4_hydro.dbyd_parse import parse_dbyd
from app.agents.sa4_hydro.models import Asset, DigitisedAsset, RainfallTable, RwtInput, RwtDemand, Sa4Request
from app.agents.sa4_hydro.rwt import size_rwt, simulate
from app.orchestrator.registry import default_registry
from app.common.contracts import AgentCode

E0, N0, DEN = 330000.0, 6260000.0, 500
S = DEN * 0.0254 / 72


def mga(x, y):
    return (E0 + x * S, N0 + y * S)


def make_pdf(path, raster=False):
    c = canvas.Canvas(str(path), pagesize=(595, 842))
    if raster:
        c.drawString(100, 100, "scan")
        c.save()
        return
    c.setLineWidth(2)
    c.setStrokeColor(HexColor("#0000ff")); c.line(100, 300, 400, 300)
    c.setStrokeColor(HexColor("#008000")); c.line(150, 200, 150, 500)
    c.setStrokeColor(HexColor("#0000ff")); c.line(20, 800, 50, 800)
    c.setStrokeColor(HexColor("#008000")); c.line(20, 780, 50, 780)
    c.setFillColor(HexColor("#000000"))
    c.drawString(60, 797, "Water main"); c.drawString(60, 777, "Sewer")
    c.drawString(250, 308, "DN100 CICL depth 0.9"); c.drawString(160, 450, "150mm VC")
    c.save()


def lot_dict(w=30.0, d=40.0, x0=None, y0=None):
    x0 = mga(100, 220)[0] if x0 is None else x0
    y0 = mga(100, 220)[1] if y0 is None else y0
    ring = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + d), (x0, y0 + d)]
    segs = []
    for i in range(4):
        p, q = ring[i], ring[(i + 1) % 4]
        segs.append(dict(seq=i + 1, bearing_deg=90.0, bearing_dms="90", distance_m=math.dist(p, q), is_front=(i == 0),
                         start_xy=p, end_xy=q))
    poly = Polygon(ring)
    return dict(lot_id=uuid4(), jurisdiction="NSW", lotplan="1//DP1", lga_name="X", mga_srid=7856, area_m2_calculated=poly.area,
                area_m2_registered=poly.area, boundary_wkt=poly.wkt, segments=segs)


CPS = [((100, 100), mga(100, 100)), ((500, 100), mga(500, 100)), ((100, 700), mga(100, 700))]


def test_parse_and_georef(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p)
    assets, geo = parse_dbyd(p.read_bytes(), control_points=CPS, scale_denominator=DEN)
    assert geo.rmse_m < 0.05
    by = {a.service: a for a in assets}
    assert set(by) == {"water", "sewer"}  # legend swatches excluded
    w = wkt.loads(by["water"].geometry_wkt)
    assert w.distance(LineString([mga(100, 300), mga(400, 300)])) < 0.1
    assert abs(w.length - 300 * S) < 0.1
    assert by["water"].diameter_mm == 100 and by["water"].material == "CICL"
    assert by["water"].depth_m == 0.9 and by["water"].depth_basis == "plan_indicated"
    assert by["sewer"].diameter_mm == 150 and by["sewer"].depth_m is None and by["sewer"].depth_basis == "unknown"
    assert by["sewer"].position_tolerance_m == 1.0


def test_raster_unsupported(tmp_path):
    p = tmp_path / "r.pdf"; make_pdf(p, raster=True)
    with pytest.raises(AgentError) as e:
        parse_dbyd(p.read_bytes(), control_points=CPS, scale_denominator=DEN)
    assert e.value.error_code == "DBYD_RASTER_UNSUPPORTED"


def _assets():
    return [Asset(service="sewer", geometry_wkt="LINESTRING(0 0, 0 40)", diameter_mm=150, position_tolerance_m=1.0),
            Asset(service="water", geometry_wkt="LINESTRING(-10 -5, 30 -5)", diameter_mm=100, depth_m=0.9)]


def test_buffers_and_conflicts():
    a = _assets()
    b = build_buffers(a)
    assert b[0].total_m == pytest.approx(b[0].clearance_m + 1.0) and b[0].placeholder and "PLACEHOLDER" in b[0].rule_source
    assert wkt.loads(b[0].geometry_wkt).distance(LineString([(0, 0), (0, 40)])) == 0
    feats = [("slab", box(1.5, 10, 10, 20)), ("slab", box(10, 10, 20, 20)), ("driveway", box(-1, -10, 1, 0))]
    cs = detect_conflicts(a, b, feats)
    sl = [c for c in cs if c.feature == "slab" and c.asset_id == a[0].asset_id]
    assert len(sl) == 1 and sl[0].severity in ("blocking", "warning")  # far slab has no conflict
    through = detect_conflicts(a, b, [("slab", box(-1, 10, 1, 20))])
    assert through[0].severity == "blocking" and through[0].line_intersects and "Depth unknown" in through[0].message
    dw = [c for c in cs if c.feature == "driveway"]
    assert dw and all(c.severity != "blocking" for c in dw)


def test_connections():
    a = _assets()
    s = propose_sewer((10, 20), a, outlet_invert_m=10.0, main_invert_m=8.0)
    assert s.length_m == pytest.approx(10) and s.grade_pct == pytest.approx(20) and s.grade_ok and s.verify_with_authority
    s2 = propose_sewer((10, 20), a)
    assert s2.grade_ok is None and s2.required_fall_m == pytest.approx(s2.required_min_grade_pct * 10 / 100)
    bad = propose_sewer((10, 20), a, outlet_invert_m=8.05, main_invert_m=8.0)
    assert bad.grade_ok is False and any(c.severity == "blocking" for c in bad.checks)
    w = propose_water((0.5, 2), a)
    assert w.kind == "water" and w.length_m == pytest.approx(7) and w.to_service_line().is_proposed
    assert any(c.kind == "clearance" and c.service == "sewer" for c in w.checks)
    assert propose_sewer((0, 0), [a[1]]) is None


RAIN = RainfallTable(station_id="066062", monthly_mm=[100, 120, 130, 100, 90, 110, 70, 60, 70, 80, 85, 80])


def _inp(roof=150.0, **kw):
    return RwtInput(roof_area_m2=roof, rainfall=RAIN, demand=RwtDemand(occupants=4, garden_area_m2=0), **kw)


def test_rwt_mass_balance():
    inp = _inp()
    rel = [simulate(inp, v)[0] for v in (300, 1000, 2000, 3000)]
    r = [x.reliability_pct for x in rel]
    assert all(x <= y + 1e-9 for x, y in zip(r, r[1:])) and r[-1] > r[0]
    for t in rel:
        assert t.storage_change_l == pytest.approx(t.annual_inflow_l - t.annual_yield_l - t.annual_overflow_l, abs=1e-6)
        assert 0 <= t.reliability_pct <= 100
    z = simulate(_inp(roof=0.0), 5000)[0]
    assert z.annual_yield_l == 0 and z.reliability_pct == 0
    assert simulate(_inp(), 5000)[0].annual_inflow_l == pytest.approx(
        sum(m.inflow_l for m in simulate(_inp(), 5000)[1]))


def test_rwt_sizing_and_placement():
    lot = box(0, 0, 20, 30)
    slab = box(5, 8, 15, 20)
    s = size_rwt(_inp(), lot_wkt=lot.wkt, slab_wkt=slab.wkt, envelope_wkt=box(2, 5, 18, 25).wkt)
    assert s.verify_against_current_instrument and s.chosen.volume_l in _inp().candidate_sizes_l
    assert s.target_met and len(s.monthly_trace) == 12 and s.diameter_m > 0
    from shapely.geometry import Point
    circ = Point(s.location_xy).buffer(s.diameter_m / 2)
    assert lot.contains(circ) and not circ.intersects(box(2, 5, 18, 25))
    strict = size_rwt(_inp(roof=10.0), regimes=None)
    assert strict.chosen.volume_l == max(_inp().candidate_sizes_l) or strict.target_met


def test_agent_run(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p)
    lot = lot_dict()
    x0, y0 = mga(100, 220)
    slab = box(x0 + 10, y0 + 10, x0 + 20, y0 + 25)
    req = Sa4Request(lot=lot, pdf_path=str(p), control_points=CPS, scale_denominator=DEN, slab_wkt=slab.wkt,
                     outlet_xy=(x0 + 15, y0 + 12), rwt=_inp(downpipe_xy=(x0 + 10, y0 + 12)))
    ag = Sa4Hydro()
    assert ag.code == AgentCode.SA4_HYDRO
    res = ag.run(req)
    assert res.status == "unverified" and len(res.assets) == 2
    assert {c.kind for c in res.connections} == {"sewer", "water"}
    svc = res.to_cad_services()
    assert any(s.is_proposed for s in svc) and any(s.exclusion_wkt for s in svc if not s.is_proposed)
    rw = res.to_cad_rwt()
    assert rw and rw.tank_volume_l == res.rwt.chosen.volume_l
    res.model_dump_json()
    # digitised path
    req2 = Sa4Request(lot=lot, digitised_assets=[DigitisedAsset(service="water", coords=[(x0, y0 - 5), (x0 + 30, y0 - 5)], depth_m=1.0)])
    r2 = ag.run(req2)
    assert r2.assets[0].extraction_method == "user_digitised" and r2.connections
    assert isinstance(default_registry().get(AgentCode.SA4_HYDRO), Sa4Hydro)

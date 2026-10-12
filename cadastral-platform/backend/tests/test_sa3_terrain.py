import base64
import uuid

import ezdxf
import numpy as np
import pytest
from shapely.geometry import Polygon, box

from app.agents.sa3_terrain.agent import Sa3Terrain
from app.agents.sa3_terrain.cutfill import cut_fill, pad_surface
from app.agents.sa3_terrain.ingest import ingest
from app.agents.sa3_terrain.models import PadDesign, Sa3TerrainRequest, SurveyInput
from app.agents.sa3_terrain.tin import Tin, build_tin
from app.agents.sa3_terrain.walls import find_walls
from app.common.contracts import LotContext

X0, Y0 = 330000.0, 6250000.0


def grid_tin(f, w=20, h=20, step=2.0):
    xs, ys = np.meshgrid(np.arange(0, w + 1e-9, step), np.arange(0, h + 1e-9, step))
    x, y = xs.ravel() + X0, ys.ravel() + Y0
    return Tin(np.column_stack([x, y, f(x - X0, y - Y0)]))


def test_planar_slope_volumes():
    ex = grid_tin(lambda x, y: 100 + 0.1 * x)
    r = cut_fill(ex, lambda x, y: np.full(np.shape(x), 101.0), spacing=1.0)
    assert r.cut_volume_m3 == pytest.approx(100, rel=1e-6)
    assert r.fill_volume_m3 == pytest.approx(100, rel=1e-6)
    assert r.stated_uncertainty_pct > 0


def test_zero_line_split_oblique():
    ex = grid_tin(lambda x, y: 100 + 0.1 * (x + y) / 2, step=5.0)
    r = cut_fill(ex, lambda x, y: np.full(np.shape(x), 101.0), spacing=2.0)
    assert r.cut_volume_m3 == pytest.approx(r.fill_volume_m3, rel=1e-6)


def test_pyramid_volume():
    c = [(0, 0), (10, 0), (10, 10), (0, 10)]
    base = np.array([(X0 + a, Y0 + b, 0) for a, b in c] + [(X0 + 5, Y0 + 5, 0)])
    pyr = base.copy(); pyr[4, 2] = 3.0
    r = cut_fill(Tin(base), Tin(pyr), spacing=0.5)
    assert r.fill_volume_m3 == pytest.approx(100.0, rel=0.03)
    assert r.cut_volume_m3 == pytest.approx(0, abs=1e-6)


def test_known_box_pad():
    ex = grid_tin(lambda x, y: 0 * x + 100, step=5)
    fp = box(X0 + 5, Y0 + 5, X0 + 15, Y0 + 15)
    r = cut_fill(ex, pad_surface(ex, fp, 101.0, 2, 3), footprint=fp, spacing=0.5)
    # pad box 10x10x1 + batter wedge: 4 sides (10*1*3/2) + 4 corner cones (pi*3^2*1/4/3)
    exp = 100 + 4 * 15 + np.pi * 9 / 3
    assert r.fill_volume_m3 == pytest.approx(exp, rel=0.04)


def test_tin_exact_at_vertices_and_bytes():
    rng = np.random.default_rng(1)
    p = np.column_stack([X0 + rng.uniform(0, 50, 80), Y0 + rng.uniform(0, 50, 80), rng.uniform(10, 20, 80)])
    t = Tin(p)
    z = t.z_at(t.vertices[:, 0], t.vertices[:, 1])
    assert np.allclose(z, t.vertices[:, 2], atol=1e-9)
    vb, tb = t.to_bytes()
    assert len(vb) == 24 * len(t.vertices) and len(tb) == 12 * len(t.triangles)
    assert np.isnan(t.z_at(0.0, 0.0))
    s, a = t.slope_aspect()
    assert len(s) == len(t.triangles)


def test_slope_aspect():
    t = grid_tin(lambda x, y: 100 - 0.1 * y)  # falls to north? z decreases with y -> faces north
    s, a = t.slope_aspect()
    assert np.allclose(s, np.degrees(np.arctan(0.1)), atol=1e-6)
    assert np.allclose(a, 0, atol=1e-6) or np.allclose(a, 360, atol=1e-6)


def test_boundary_clip_and_breakline():
    lot = box(X0, Y0, X0 + 20, Y0 + 20)
    pts = np.array([(X0 + i * 5, Y0 + j * 5, 10.0) for i in range(-6, 11) for j in range(-6, 11)], float)
    from app.agents.sa3_terrain.ingest import Survey
    bl = np.array([(X0 + 2, Y0 + 3, 10.0), (X0 + 17, Y0 + 11, 12.0)])
    sv = Survey(points=pts, breaklines=[bl])
    t = build_tin(sv, lot, max_spacing=2.0, buffer_m=3.0)
    assert t.vertices[:, 0].min() >= X0 - 3 - 1e-6 and t.vertices[:, 1].max() <= Y0 + 23 + 1e-6
    assert t.build_params["breaklines_honoured_pct"] >= 90
    assert t.z_at(X0 + 2, Y0 + 3) == pytest.approx(10.0)


def test_dxf_ingest(tmp_path):
    d = ezdxf.new(); m = d.modelspace()
    m.add_lwpolyline([(X0, Y0), (X0 + 30, Y0), (X0 + 30, Y0 + 10)], dxfattribs={"elevation": 50.0})
    m.add_polyline3d([(X0, Y0 + 5, 51.0), (X0 + 10, Y0 + 5, 52.0)])
    m.add_point((X0 + 3, Y0 + 3, 50.5))
    m.add_text("50.75", dxfattribs={"insert": (X0 + 4, Y0 + 4)})
    f = tmp_path / "s.dxf"; d.saveas(f)
    s = ingest(SurveyInput(srid=7856, dxf_path=str(f), dxf_include_text=True, source="dxf"), 7856)
    assert len(s.contours) == 1 and s.contours[0][0, 2] == 50.0
    assert len(s.breaklines) == 1 and len(s.points) == 2
    with pytest.raises(Exception):
        ingest(SurveyInput(srid=7855, dxf_path=str(f)), 7856)


def test_csv_dupes(tmp_path):
    f = tmp_path / "p.csv"
    f.write_text(f"x,y,z\n{X0},{Y0},1\n{X0},{Y0},1\n{X0+1},{Y0},2\n{X0},{Y0+1},3\n")
    s = ingest(SurveyInput(srid=7856, csv_path=str(f)))
    assert len(s.points) == 3 and any("duplicate" in w for w in s.warnings)


def test_wall_detection():
    ex = grid_tin(lambda x, y: 100 + 0.2 * x)  # +-1 m across a 10 m pad
    fp = box(X0 + 5, Y0 + 5, X0 + 15, Y0 + 15)
    w = find_walls(ex, fp, 102.0, 0.5)
    modes = {s.mode for s in w.segments}
    assert modes == {"cut", "fill"}
    assert w.max_retained_height_m == pytest.approx(1.0, abs=0.05)
    assert w.assumptions.phi_deg == 28 and "NOT" in w.disclaimer
    w2 = find_walls(ex, fp, 102.0, 1.2)
    assert w2.segments == []
    w3 = find_walls(ex, fp, 102.5, 0.5)
    assert w3.engineer_certification_required


def test_end_to_end_612_lot():
    x0, y0, W, L = X0, Y0, 18.0, 34.0  # 612 m2
    lotp = box(x0, y0, x0 + W, y0 + L)
    segs = []
    pts = [(x0, y0), (x0 + W, y0), (x0 + W, y0 + L), (x0, y0 + L)]
    lot = LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="1/DP1", lga_name="X", mga_srid=7856,
                     area_m2_calculated=612.0, boundary_wkt=lotp.wkt, segments=[])
    contours = [{"z": 100 + 0.15 * (x - x0), "coords": [[x, y0 - 12], [x, y0 + L + 12]]}
                for x in np.arange(x0 - 12, x0 + W + 12.1, 1.0)]
    req = Sa3TerrainRequest(
        lot=lot, survey=SurveyInput(srid=7856, contours=contours, stated_vertical_accuracy_m=0.05, source="test"),
        design=PadDesign(pad_level_m=100 + 0.15 * 9, footprint_wkt=box(x0 + 4, y0 + 7, x0 + 14, y0 + 27).wkt))
    r = Sa3Terrain().run(req)
    assert r.status == "unverified" and r.lot_coverage_pct > 99
    cf = r.cut_fill
    assert cf.cut_volume_m3 > 20 and cf.fill_volume_m3 > 20
    assert cf.net_volume_m3 == pytest.approx(cf.cut_volume_m3 - cf.fill_volume_m3)
    # cut ~ fill on a balanced plane through the pad centre (batters add a little)
    assert abs(cf.net_volume_m3) < 0.3 * (cf.cut_volume_m3 + cf.fill_volume_m3)
    assert r.walls.max_retained_height_m == pytest.approx(0.15 * 5, abs=0.05) and cf.zones
    n = r.tin.vertex_count
    assert len(base64.b64decode(r.tin.vertices_f64_b64)) == 24 * n
    assert len(r.mesh.indices) % 3 == 0 and len(r.mesh.vertices) % 3 == 0
    assert r.model_dump_json()

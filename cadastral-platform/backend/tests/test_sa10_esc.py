"""SA10 ESC (erosion and sediment control plan) tests on a synthetic sloping lot."""
from __future__ import annotations

import json
import math
from pathlib import Path
from uuid import uuid4

import ezdxf
import pymupdf
import pytest
from shapely import wkt as swkt
from shapely.geometry import LineString, Point, Polygon, box

from app.agents.requirements.models import Requirement, RequirementSet, Source
from app.agents.sa10_esc import AGENT_CODE_NAME, Sa10Esc, Sa10EscInput
from app.agents.sa10_esc.layers import ESC_LAYER_NAMES
from app.agents.sa10_esc.models import DISCLAIMER, TreePoint
from app.common.contracts import BoundarySegment, DevelopmentType, DrivewayDesign, LotContext

E0, N0 = 334000.0, 6263000.0
W, D = 20.0, 40.0                     # frontage 20 m (south), depth 40 m (north)


def lot_ctx() -> LotContext:
    pts = [(E0, N0), (E0 + W, N0), (E0 + W, N0 + D), (E0, N0 + D)]
    segs = [BoundarySegment(seq=i + 1, bearing_deg=0, bearing_dms="0", distance_m=math.dist(a, b), start_xy=a, end_xy=b, is_front=(i == 0),
                            adjoins="road" if i == 0 else "lot") for i, (a, b) in enumerate(zip(pts, pts[1:] + pts[:1]))]
    return LotContext(lot_id=uuid4(), jurisdiction="NSW", lotplan="2/-/DP227508", lga_name="Gunnedah", mga_srid=7856, area_m2_calculated=W * D,
                      boundary_wkt=Polygon(pts).wkt, segments=segs, road_names=["Test St"], zone_code="R2")


def terrain(fall_north_pct=0.0, fall_east_pct=0.0, z0=100.0):
    """Grid of survey points. Positive fall_north => ground LOWER to the north."""
    return [(E0 + x, N0 + y, z0 - fall_north_pct / 100 * y - fall_east_pct / 100 * x) for x in range(-5, 26, 5) for y in range(-5, 46, 5)]


def drive() -> DrivewayDesign:
    return DrivewayDesign(centreline_wkt=LineString([(E0 + 6, N0 - 4), (E0 + 6, N0 + 6)]).wkt, width_m=3.0,
                          crossover_wkt=box(E0 + 4.5, N0 - 4, E0 + 7.5, N0).wkt)


def run(tmp_path, **kw):
    base = dict(lot=lot_ctx(), development_type=DevelopmentType.dwelling_house, project_title="Test lot ESCP", output_dir=str(tmp_path),
                footprint_wkt=box(E0 + 4, N0 + 8, E0 + 16, N0 + 20).wkt, driveway=drive(), terrain_points=terrain(8.0))
    base.update(kw)
    return Sa10Esc().run(Sa10EscInput(**base))


def el(out, kind):
    return [e for e in out.elements if e.kind == kind]


def test_agent_code_and_interface():
    a = Sa10Esc()
    assert a.code == AGENT_CODE_NAME == "SA10_ESC"
    assert a.input_model is Sa10EscInput and a.version


def test_fence_on_downslope_boundary(tmp_path):
    out = run(tmp_path)                                  # falls 8% to the north (rear)
    assert not out.flow.assumed and 7.0 < out.flow.slope_pct < 9.0
    assert out.flow.direction[1] > 0.99                  # flows north
    fence = swkt.loads(el(out, "fence")[0].geometry_wkt)
    fp = box(E0 + 4, N0 + 8, E0 + 16, N0 + 20)
    ys = [c[1] for ln in fence.geoms for c in ln.coords] if hasattr(fence, "geoms") else [c[1] for c in fence.coords]
    assert min(ys) > fp.bounds[3]                        # entirely downslope (north) of the building
    assert abs(max(ys) - (N0 + D)) < 1.5                 # lies along the rear (downslope) boundary
    lot = swkt.loads(lot_ctx().boundary_wkt)
    assert fence.distance(lot.exterior) < 1.5
    q = out.quantities
    assert 15.0 < q["fence_length_m"] < 22.0             # the full rear edge (20 m minus inset)


def test_fence_follows_slope_direction_east(tmp_path):
    out = run(tmp_path, terrain_points=terrain(0.0, 8.0))   # lower to the east
    fence = swkt.loads(el(out, "fence")[0].geometry_wkt)
    xs = [c[0] for g in getattr(fence, "geoms", [fence]) for c in g.coords]
    assert min(xs) > E0 + 16 and max(xs) > E0 + W - 1.5


def test_access_at_crossover(tmp_path):
    out = run(tmp_path)
    acc = swkt.loads(el(out, "access")[0].geometry_wkt)
    xo = swkt.loads(drive().crossover_wkt)
    assert acc.distance(xo) < 0.8
    assert acc.bounds[2] - acc.bounds[0] >= 3.0 - 1e-6          # at least the cited 3 m width
    e = el(out, "access")[0]
    assert "esc.access.min_length_m" in e.req_keys and "esc.access.min_width_m" in e.req_keys
    assert e.status == "resolved" and abs(out.quantities["access_length_m"] - 15.0) < 0.2
    # fence is not drawn across the access
    fence = swkt.loads(el(out, "fence")[0].geometry_wkt)
    assert fence.distance(acc) > 0.2


def test_stockpile_clear_of_hazards_and_boundary(tmp_path):
    out = run(tmp_path)
    sp = swkt.loads(el(out, "stockpile")[0].geometry_wkt)
    lot = swkt.loads(lot_ctx().boundary_wkt)
    front = LineString([(E0, N0), (E0 + W, N0)])
    xo = swkt.loads(drive().crossover_wkt)
    acc = swkt.loads(el(out, "access")[0].geometry_wkt)
    e = el(out, "stockpile")[0]
    assert e.status == "resolved"
    assert sp.distance(front) >= 5.0 - 1e-6 and sp.distance(xo) >= 5.0 - 1e-6 and sp.distance(acc) >= 5.0 - 1e-6   # preferred distance, cited
    assert sp.distance(lot.exterior) >= 1.5                                  # behind the fence line
    fp = box(E0 + 4, N0 + 8, E0 + 16, N0 + 20)
    assert sp.centroid.y <= fp.centroid.y + 1e-6                             # not downslope of the building (slope is north)
    fence = swkt.loads(el(out, "fence")[0].geometry_wkt)
    assert sp.distance(fence) > 0.5                                          # no build-up against the fence
    assert "esc.stockpile.preferred_distance_from_hazard_m" in e.req_keys
    assert any("esc.stockpile.setback_from_lot_boundary_m" in u["key"] for u in out.unresolved)


def test_stockpile_avoids_drainage_line_and_service_buffers(tmp_path):
    drain = LineString([(E0 - 5, N0 + 6), (E0 + 25, N0 + 6)]).wkt
    out = run(tmp_path, drainage_lines_wkt=[drain], terrain_points=terrain(0.0, 0.0))
    sp = swkt.loads(el(out, "stockpile")[0].geometry_wkt)
    assert sp.distance(swkt.loads(drain)) >= 2.0 - 1e-6
    from app.common.contracts import ServiceLine
    ex = box(E0 + 1, N0 + 22, E0 + 19, N0 + 30)
    out2 = run(tmp_path / "svc", services=[ServiceLine(service="sewer", label="S", geometry_wkt=LineString([(E0 + 1, N0 + 26), (E0 + 19, N0 + 26)]).wkt, exclusion_wkt=ex.wkt)])
    for k in ("stockpile", "topsoil", "washout", "laydown"):
        for e in el(out2, k):
            assert not swkt.loads(e.geometry_wkt).intersects(ex)


def test_no_levels_warns_and_flags_unresolved(tmp_path):
    out = run(tmp_path, terrain_points=[])
    assert out.flow.assumed and any("no levels" in w.lower() for w in out.warnings)
    assert "flow direction assumed from boundary/road" in out.flow.source
    assert el(out, "fence")[0].status == "unresolved"
    assert not el(out, "check_dam")


def test_check_dams_on_steep_site(tmp_path):
    out = run(tmp_path, terrain_points=terrain(12.0))
    assert el(out, "check_dam") and el(out, "diversion")
    assert el(out, "check_dam")[0].status == "unresolved"
    out2 = run(tmp_path / "flat", terrain_points=terrain(3.0))
    assert not el(out2, "check_dam")


def test_unresolved_requirements_surfaced(tmp_path):
    out = run(tmp_path, tree_points=[TreePoint(xy=(E0 + 18, N0 + 25), label="T1")])
    keys = {u["key"] for u in out.unresolved}
    for k in ("esc.sediment_fence.max_length_m", "esc.buffer.min_from_drainage_line_m", "esc.inlet.kerb_trap_dimensions",
              "esc.check_dam.spacing_and_height", "esc.tree.protection_zone_radius_m"):
        assert k in keys, k
    assert el(out, "nogo")[0].status == "unresolved"
    for u in out.unresolved:
        assert u["prompt"]
    # every resolved key is a cited requirement with a quote
    rs = RequirementSet(requirements=[Requirement.model_validate(r) for r in json.loads((Path(__file__).parents[1] / "knowledge/esc/requirements.json").read_text())["requirements"]])
    for k in out.resolved_keys:
        r = rs.get_requirement(k)
        assert r.source and r.source.quote and r.source.page and r.source.sha256


def test_every_element_carries_cited_keys(tmp_path):
    out = run(tmp_path)
    kinds = {e.kind for e in out.elements}
    assert {"fence", "access", "stockpile", "topsoil", "washout", "bin", "toilet", "inlet", "diversion", "limit"} <= kinds
    for e in out.elements:
        if e.kind not in ("limit",):
            assert e.req_keys and e.citations, e.id
        assert e.status in ("resolved", "unresolved")
    assert not el(run(tmp_path / "shed", development_type=DevelopmentType.shed), "toilet")


def test_pdf_contents(tmp_path):
    out = run(tmp_path)
    doc = pymupdf.open(out.files["pdf"])
    assert doc.page_count == 1 and abs(doc[0].rect.width - 420 / 25.4 * 72) < 2
    txt = doc[0].get_text()
    for needle in ("LEGEND", "GENERAL NOTES", "MAINTENANCE", DISCLAIMER.upper(), "Sediment fence", "Stabilised site access", "Kerb inlet", "to be confirmed by the designer/certifier".split()[0]):
        assert needle in txt, needle
    assert "Blue Book" in txt and "Building Sites 2024" in txt          # sheet notes carry their source
    assert len(doc[0].get_drawings()) > 200                              # vector symbols, not a raster
    assert doc[0].get_pixmap(dpi=40).width > 100


def test_dxf_audit_and_layers(tmp_path):
    out = run(tmp_path)
    d = ezdxf.readfile(out.files["dxf"])
    assert not d.audit().errors
    names = {l.dxf.name for l in d.layers}
    assert set(ESC_LAYER_NAMES) <= names
    used = {e.dxf.layer for e in d.modelspace()}
    for ly in ("C-ESC-FENC", "C-ESC-ACCS", "C-ESC-STOK", "C-ESC-DIVR", "C-ESC-INLT", "C-ESC-WSHT", "C-ESC-NOTE"):
        assert ly in used, ly
    sql = (Path(__file__).parents[2] / "db" / "005_esc_layers.sql").read_text()
    assert all(n in sql for n in ESC_LAYER_NAMES) and "ON CONFLICT" in sql


def test_geojson_parts_and_report(tmp_path):
    out = run(tmp_path)
    gj = json.loads(Path(out.files["geojson"]).read_text())
    assert gj["features"] and all(f["properties"]["layer"] == "esc" for f in gj["features"])
    parts = json.loads(Path(out.files["scene_parts"]).read_text())
    assert parts["layer"]["c"] == "esc" and parts["parts"] and all(p["c"] == "esc" for p in parts["parts"])
    rpt = Path(out.files["report"]).read_text()
    assert "Source citations" in rpt and "Unresolved" in rpt and "Blue Book" in rpt and DISCLAIMER in rpt


def test_deterministic(tmp_path):
    a, b = run(tmp_path / "a"), run(tmp_path / "b")
    assert [e.geometry_wkt for e in a.elements] == [e.geometry_wkt for e in b.elements]

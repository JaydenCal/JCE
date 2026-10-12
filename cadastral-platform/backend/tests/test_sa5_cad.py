"""SA5 CAD & annotation pipeline tests (DXF + PDF)."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
from uuid import uuid4

import ezdxf
import pymupdf
import pytest
from shapely.geometry import LineString, Point, Polygon

from app.agents.base import AgentError
from app.agents.sa5_cad_dxf import Sa5CadDxf
from app.agents.sa5_cad_dxf.annotate import (Annotation, format_dms, resolve_collisions, upright_rotation,
                                             level_spot_annotations)
from app.agents.sa5_cad_dxf.layers import LAYERS
from app.agents.sa5_cad_dxf.model import CadRequestSa5
from app.common.contracts import AckKind

ORIGIN = (334000.0, 6263000.0)
THETA = math.radians(90 - 87.241667)       # frontage bearing 87d14'30"
UU = (math.cos(THETA), math.sin(THETA))
UV = (math.sin(THETA), -math.cos(THETA))   # depth direction (to the right of the frontage)
W = 15.24
DEPTH = (612.0 + 4.5) / W                  # 3 x 3 m corner splay removed -> 612.0 m2


def mga(u: float, v: float) -> tuple[float, float]:
    return (ORIGIN[0] + u * UU[0] + v * UV[0], ORIGIN[1] + u * UU[1] + v * UV[1])


def wkt_poly(pts) -> str:
    pts = [mga(*p) for p in pts]
    pts.append(pts[0])
    return "POLYGON((" + ", ".join(f"{x:.4f} {y:.4f}" for x, y in pts) + "))"


def wkt_line(pts) -> str:
    return "LINESTRING(" + ", ".join("{:.4f} {:.4f}".format(*mga(*p)) for p in pts) + ")"


def dms(deg: float) -> str:
    return format_dms(deg)


def make_request(tmp_path: Path, scale: int = 250, acks=None, formats=("dxf", "pdf")) -> CadRequestSa5:
    ring = [(0, 0), (W, 0), (W, DEPTH - 3), (W - 3, DEPTH), (0, DEPTH)]
    segs = []
    for i, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1]), start=1):
        p0, p1 = mga(*a), mga(*b)
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        bearing = math.degrees(math.atan2(dx, dy)) % 360
        segs.append(dict(seq=i, bearing_deg=bearing, bearing_dms=dms(bearing), distance_m=math.hypot(dx, dy),
                         adjoins="road" if i == 1 else "lot", is_front=(i == 1), start_xy=p0, end_xy=p1))
    lot_poly = Polygon([mga(*p) for p in ring])
    env_local = Polygon([(0.9, 4.5), (W - 0.9, 4.5), (W - 0.9, DEPTH - 3 - 0.5), (W - 3 - 0.5, DEPTH - 3.0), (0.9, DEPTH - 3.0)])
    slab = [(3, 8), (12, 8), (12, 24), (3, 24)]
    overlay = dict(
        overlay_id=uuid4(), upload_id=uuid4(), scale_denominator_used=100, scale_source="title_block_text",
        scale_confidence=0.95, metres_per_point=0.0352778, rotation_rad=0.04,
        transform=(1, 0, 0, 1, 0, 0), matrix_3x3=[1, 0, 0, 0, 1, 0, 0, 0, 1], reflection_applied=False,
        control_point_count=4, rmse_m=0.06, max_residual_m=0.09, footprint_wkt=wkt_poly(slab),
        footprint_area_m2=144.0, outcome="accepted_unverified")
    req = dict(
        project_id=uuid4(), mga_srid=7856, drawing_scale_denominator=scale,
        lot=dict(lot_id=uuid4(), jurisdiction="NSW", lotplan="12//DP345678", lga_name="Hornsby", mga_srid=7856,
                 area_m2_calculated=lot_poly.area, area_m2_registered=612.0, boundary_wkt=lot_poly.wkt,
                 segments=segs, road_names=["Wattle Street"], zone_code="R2",
                 envelope_wkt=Polygon([mga(*p) for p in env_local.exterior.coords]).wkt),
        overlay=overlay,
        driveway=dict(
            centreline_wkt=wkt_line([(10.5, -3), (10.5, 8)]), width_m=3.0,
            crossover_wkt=wkt_poly([(8.5, -3), (12.5, -3), (12.0, 0), (9.0, 0)]), max_grade_pct=12.5,
            council_standard_label="Hornsby Council Driveway Design Guide",
            turning_path_wkt=wkt_poly([(1, 1), (7, 1), (7, 7), (1, 7)]),
            turning_circle_centre_xy=mga(4.0, 4.0), turning_circle_radius_m=3.0,
            dimensions=[("Crossover width", mga(8.5, -3), mga(12.5, -3)), ("Garage setback", mga(10.5, 0), mga(10.5, 8))]),
        services=[
            dict(service="water", label="Water main", geometry_wkt=wkt_line([(1, -7), (14, -7)]), diameter_mm=100, depth_m=0.9),
            dict(service="sewer", label="Sewer", geometry_wkt=wkt_line([(6, DEPTH - 1), (6, 28), (9, 20)]), diameter_mm=150, depth_m=2.1),
            dict(service="stormwater", label="SW pipe", geometry_wkt=wkt_line([(2, DEPTH - 1), (2, 30)]), diameter_mm=225,
                 depth_m=1.2, exclusion_wkt=wkt_poly([(1, 30), (3, 30), (3, DEPTH - 1), (1, DEPTH - 1)])),
            dict(service="electricity", label="Proposed U/G", geometry_wkt=wkt_line([(0.5, -9), (14.5, -9)]), depth_m=0.6, is_proposed=True),
        ],
        rwt=dict(tank_volume_l=5000, location_xy=mga(13, 14), diameter_m=2.4, regime="BASIX", note="Roof catchment to tank"),
        council_overlays=[
            dict(label="Bushfire BAL-12.5", kind="bushfire", geometry_wkt=wkt_poly([(-1, DEPTH - 12), (W + 1, DEPTH - 12), (W + 1, DEPTH + 2), (-1, DEPTH + 2)])),
            dict(label="Heritage curtilage", kind="heritage", geometry_wkt=wkt_poly([(-16, -14), (-6, -14), (-6, -8), (-16, -8)])),
        ],
        council_name="Hornsby Shire Council", export_formats=list(formats),
        acknowledgements_present=list(AckKind) if acks is None else acks,
        project_title="Proposed Dwelling - 12 Wattle Street, Hornsby", drawn_by="J. Example",
        output_path=str(tmp_path / "plan"),
        level_spots=[(*mga(8, 12), 54.32), (*mga(2, 36), 52.10)])
    return CadRequestSa5(**req)


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("sa5")
    req = make_request(tmp)
    agent = Sa5CadDxf()
    res = agent.run(req)
    return req, res, agent


def test_lot_area_realistic():
    req = make_request(Path("."))
    assert abs(req.lot.area_m2_calculated - 612.0) < 0.05


def test_result_hashes_and_files(run):
    _, res, _ = run
    for p, h in ((res.dxf_path, res.dxf_sha256), (res.pdf_path, res.pdf_sha256)):
        assert hashlib.sha256(Path(p).read_bytes()).hexdigest() == h
    assert res.annotation_count > 10


def test_dxf_layers_and_audit(run):
    _, res, _ = run
    doc = ezdxf.readfile(res.dxf_path)
    assert doc.dxfversion == "AC1032"
    assert doc.header["$INSUNITS"] == 6
    for l in LAYERS:
        assert l.name in doc.layers
    lay = doc.layers.get("C-PROP-BDY")
    assert lay.dxf.color == 3 and lay.dxf.lineweight == 50
    assert doc.layers.get("C-ZONE-SBAK").dxf.linetype == "DASHED2"
    assert "DASHED2" in doc.linetypes and "DASHDOT" in doc.linetypes
    for needed in ("C-PROP-BDY", "C-ANNO-BRNG", "C-ANNO-LOTN", "C-ANNO-ROAD", "C-ZONE-ENVL", "A-BLDG-SLAB", "C-DRIV-XOVR",
                   "C-DRIV-TURN", "C-ANNO-DIMS", "C-UTIL-WATR", "C-UTIL-SEWR", "C-UTIL-STRM", "C-UTIL-ELEC", "C-UTIL-EXCL",
                   "C-UTIL-RWTK", "C-ZONE-OVLY", "C-ANNO-SERV", "C-ANNO-LEVL", "C-ANNO-NOTE"):
        assert needed in res.layers_used, needed
    auditor = doc.audit()
    assert not auditor.errors, [e.message for e in auditor.errors]
    assert not auditor.has_errors


def test_dxf_entities_and_real_coordinates(run):
    req, res, _ = run
    doc = ezdxf.readfile(res.dxf_path)
    msp = doc.modelspace()
    assert len(msp.query("CIRCLE[layer=='C-DRIV-TURN']")) == 1
    circ = msp.query("CIRCLE[layer=='C-DRIV-TURN']").first
    assert circ.dxf.radius == pytest.approx(3.0)
    dims = msp.query("DIMENSION")
    # frontage + 2 driveway + driveway width not duplicated + setbacks + radius
    assert len(dims) >= 6
    assert any(d.dxf.layer == "C-ANNO-DIMS" for d in dims)
    assert len(msp.query("HATCH[layer=='C-ZONE-OVLY']")) == 2
    bdy = msp.query("LWPOLYLINE[layer=='C-PROP-BDY']").first
    xs = [p[0] for p in bdy.get_points()]
    ys = [p[1] for p in bdy.get_points()]
    assert 333900 < min(xs) and max(xs) < 334100 and 6262900 < min(ys) and max(ys) < 6263100
    assert res.entity_counts["TEXT"] == len(msp.query("TEXT"))
    assert res.entity_counts["DIMENSION"] == len(dims)
    # dashed exclusion layer carries dashed linetype
    assert doc.layers.get("C-UTIL-EXCL").dxf.linetype == "DASHED"
    # paper space
    assert "A3 Plan" in doc.layouts
    psp = doc.layout("A3 Plan")
    vps = psp.query("VIEWPORT")
    assert len(vps) >= 1
    texts = " ".join(t.dxf.text for t in psp.query("TEXT"))
    assert "Indicative only. Not a survey." in texts
    model_texts = " ".join(t.dxf.text for t in msp.query("TEXT[layer=='C-ANNO-NOTE']"))
    assert "Verify setbacks with council." in model_texts
    assert "DP345678" in texts and "1:250" in texts and "J. Example" in texts and "Hornsby" in texts
    assert "ACKNOWLEDGEMENTS ON FILE" in texts
    assert (psp.dxf.paper_width, psp.dxf.paper_height) == (420.0, 297.0)


def test_bearing_text_rotations_upright(run):
    req, res, _ = run
    doc = ezdxf.readfile(res.dxf_path)
    brng = list(doc.modelspace().query("TEXT[layer=='C-ANNO-BRNG']"))
    assert len(brng) == len(req.lot.segments)
    for t in brng:
        assert -90.0 < t.dxf.rotation <= 90.0
    assert any(t.dxf.text.startswith(req.lot.segments[0].bearing_dms) for t in brng)
    for t in doc.modelspace().query("TEXT"):
        r = t.dxf.rotation
        assert -90.0 < r <= 90.0 or r == 0


def test_text_not_overlapping_in_model(run):
    from app.agents.sa5_cad_dxf.annotate import generate_annotations
    from app.agents.sa5_cad_dxf.model import build_plan_model
    req, _, agent = run
    aset = generate_annotations(build_plan_model(req), 250)
    assert aset.unresolved == 0
    boxes = [a.box() for a in aset.items if a.kind in ("bearing_distance", "lot_label", "area", "road_name")]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            assert not a.intersects(b)


def test_pdf_content(run):
    req, res, _ = run
    doc = pymupdf.open(res.pdf_path)
    assert doc.page_count == 1
    page = doc[0]
    assert page.rect.width == pytest.approx(1190.55, abs=0.6) and page.rect.height == pytest.approx(841.89, abs=0.6)
    text = page.get_text()
    flat = " ".join(text.split())
    assert "LOT 12 DP345678" in flat
    assert req.lot.segments[0].bearing_dms in flat
    assert "Frontage 15.24 m" in flat
    assert "R3.00 m" in flat
    assert "Crossover width 4.00 m" in flat
    assert "Indicative only. Not a survey." in flat
    assert "Verify setbacks with council." in flat
    assert "WATER DN100" in flat and "RWT 5000 L" in flat and "WATTLE STREET" in flat
    assert "SCALE 1:250" in flat and "LEGEND" in flat
    assert page.get_images() == []                      # vector only
    assert len(page.get_drawings()) > 100
    fonts = {f[3] for f in page.get_fonts()}
    assert fonts <= {"Helvetica", "Helvetica-Bold"}
    # no upside-down text: every span direction has non-negative x-component
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            assert ln["dir"][0] > -1e-6 or abs(ln["dir"][1]) > 0.99


def test_pdf_png_render(run, tmp_path):
    _, res, _ = run
    pix = pymupdf.open(res.pdf_path)[0].get_pixmap(dpi=110)
    out = tmp_path / "preview.png"
    pix.save(str(out))
    assert out.stat().st_size > 10_000


def test_gate_blocks_when_ack_missing(tmp_path):
    acks = [a for a in AckKind if a is not AckKind.hydrology_not_certified]
    req = make_request(tmp_path, acks=acks)
    with pytest.raises(AgentError) as ei:
        Sa5CadDxf().run(req)
    assert ei.value.error_code == "EXPORT_GATE_BLOCKED"
    assert "missing: hydrology_not_certified" in str(ei.value)
    assert not list(tmp_path.glob("plan.*"))


def test_pdf_only_and_fit_warning(tmp_path):
    req = make_request(tmp_path, scale=50, formats=("pdf",))
    agent = Sa5CadDxf()
    res = agent.run(req)
    assert res.dxf_path is None and res.pdf_path
    assert agent.last_run_info["fits_a3"] is False
    assert agent.last_run_info["suggested_scale_denominator"] in (100, 125, 150, 200, 250)
    assert any("suggested scale" in w for w in agent.last_run_info["warnings"])
    assert pymupdf.open(res.pdf_path).page_count == 1


def test_upright_rotation_and_dms():
    for raw in (-540, -270, -180, -90.0, -89.9999, 0, 45, 90, 90.0004, 135, 180, 269.9, 359):
        assert -90.0 < upright_rotation(raw) <= 90.0
    assert upright_rotation(-90) == 90.0 and upright_rotation(180) == 0.0
    assert format_dms(87 + 14 / 60 + 30 / 3600) == "87°14'30\""
    assert format_dms(359.99999) == "0°00'00\""


def test_collision_resolver_pushes_and_gives_up():
    a = Annotation("user_note", "ABCDEFGH", 0, 0, 0, 1.0, "C-ANNO-NOTE", fixed=True)
    b = Annotation("user_note", "ABCDEFGH", 0, 0, 0, 1.0, "C-ANNO-NOTE", push_dir=(0, 1))
    assert resolve_collisions([a, b], max_tries=6) == 0
    assert not a.box().intersects(b.box()) and b.y > 0
    c = Annotation("user_note", "ABCDEFGH", 0, 0, 0, 1.0, "C-ANNO-NOTE", push_dir=(0, 1))
    wall = LineString([(-50, -50), (-50, 50), (50, 50), (50, -50), (-50, -50)]).buffer(0.1).union(Polygon([(-40, -40), (40, -40), (40, 40), (-40, 40)]))
    assert resolve_collisions([c], obstacles=[wall], max_tries=3) == 1
    assert (c.x, c.y) == (0, 0)


def test_level_spots():
    ls = level_spot_annotations([(1.0, 2.0, 12.346)], 250)
    assert ls[0].content == "12.35" or ls[0].content == "12.34"
    assert ls[0].kind == "level_spot"

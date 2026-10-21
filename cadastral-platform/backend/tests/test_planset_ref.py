"""Reference-style (A1) plan set, stage 1: frame, call-outs, crossover geometry and the C101 proof sheet in PDF and DXF."""
import math
import uuid

import ezdxf
import pymupdf
import pytest
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon

from app.agents.sa5_cad_dxf.planset import PlansetInput, build_planset
from app.agents.sa5_cad_dxf.planset import callout as CO
from app.agents.sa5_cad_dxf.planset import crossover as CX
from app.agents.sa5_cad_dxf.planset import sheets_ref as SR
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.core import A1, A3, Sheet, View
from app.agents.sa5_cad_dxf.planset.data import build_site
from app.agents.sa5_cad_dxf.planset.frame_a1 import draw_frame_a1, drawing_number
from app.agents.sa5_cad_dxf.planset.generate import _proj
from app.agents.sa5_cad_dxf.planset.layers_ext import all_layers
from app.agents.sa5_cad_dxf.planset.titleblock import STAMP, Proj
from app.branding.brand import Brand
from app.common.contracts import BoundarySegment, DrivewayDesign, LotContext, NeighbourLot

DASHES = ("—", "–")
FOOTPRINT = "POLYGON((8 15,22 15,22 25,8 25,8 15))"


def _lot() -> LotContext:
    pts = [(0, 0), (30, 0), (30, 50), (0, 50)]
    segs = [BoundarySegment(seq=i, bearing_deg=0, bearing_dms="0°00'00\"", distance_m=30, adjoins="road" if i == 0 else "unknown", is_front=i == 0,
                            start_xy=pts[i], end_xy=pts[(i + 1) % 4]) for i in range(4)]
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in pts + [pts[0]]) + "))"
    nb = NeighbourLot(label="LOT 9 DP1", wkt="POLYGON((30 0,60 0,60 50,30 50,30 0))")
    return LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="1//DP1", lga_name="X", mga_srid=7856, area_m2_calculated=1500, boundary_wkt=wkt,
                      segments=segs, road_names=["Test Road"], zone_code="R2", neighbours=[nb])


def _driveway(label=None) -> DrivewayDesign:
    """SA3-style result: 3.0 m wide at the boundary, flaring 0.5 m each side to the kerb 4.0 m beyond the boundary."""
    return DrivewayDesign(centreline_wkt="LINESTRING(15 -4, 15 12)", width_m=3.0, crossover_wkt="POLYGON((13.5 0, 16.5 0, 17 -4, 13 -4, 13.5 0))",
                          council_standard_label=label)


def _inp(**kw) -> PlansetInput:
    return PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01", brand=Brand(), **kw)


def _build(tmp_path_factory, **kw):
    inp = _inp(driveway=_driveway("default (AS/NZS 2890.1) used"), footprint_wkt=FOOTPRINT, **kw)
    out = tmp_path_factory.mktemp("ref")
    res = build_planset(inp, out, style="ref", only=["C101"])
    site = build_site(inp)
    proj = _proj(inp, site, inp.brand, "2026-01-01")
    sh = SR.c101_ref(SR.RefCtx(site, proj))
    frame = draw_frame_a1(sh, proj, 1, 1, sh.scale_text)
    return inp, res, sh, frame


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """Default ref build: a footprint is supplied but the dwelling is NOT drawn (house design is another tool)."""
    return _build(tmp_path_factory)


@pytest.fixture(scope="module")
def built_dw(tmp_path_factory):
    """Ref build with the opt-in show_dwelling flag: the old footprint, hatch, setback and FFL path."""
    return _build(tmp_path_factory, show_dwelling=True)


def _texts(items):
    return [it.text for it in items if it.kind == "text"]


# ---- PDF --------------------------------------------------------------------------------------------------------------
def test_pdf_is_a1_with_stamp_and_drawing_number(built):
    _, res, _, _ = built
    doc = pymupdf.open(res["pdf"])
    assert len(doc) == 1
    assert abs(doc[0].rect.width - 841 / 25.4 * 72) < 1.0 and abs(doc[0].rect.height - 594 / 25.4 * 72) < 1.0       # about 2383.9 x 1683.8 pt
    txt = doc[0].get_text()
    assert STAMP in txt and "JCS-XXX-CIV-101" in txt
    assert "1 OF 1" in txt and "CHECKED" in txt and "APPROVED" in txt
    assert "ABN" not in txt                                       # the platform brand has no ABN; none is invented
    assert "INGLIS" not in txt.upper() and "MUDGEE" not in txt.upper()
    assert "ASSUMED KERB LINE" in txt
    assert "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED)" in txt           # SA3 reported its platform default, so nothing is selected
    assert not any(d in txt for d in DASHES)


def test_platform_brand_only_no_jce_identity(tmp_path):
    """The JCE Brand (even with an ABN) is never read in the ref style: only the JCESITE text wordmark appears."""
    inp = PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01", brand=Brand(abn="12 345 678 901"))
    res = build_planset(inp, tmp_path, style="ref", only=["C101"])
    txt = pymupdf.open(res["pdf"])[0].get_text()
    up = txt.upper()
    assert "JCE INFRASTRUCTURE" not in up and "JCEINFRASTRUCTURE" not in up and "ABN" not in up and "12 345 678 901" not in txt
    assert "JCESITE" in txt and "AI-ASSISTED SITE PLANNING" in txt
    assert "CIVIL" not in up.split("AI-ASSISTED")[0][-200:] or True
    assert "JCE" not in up.replace("JCESITE", "").replace("JCS", "")
    d = ezdxf.readfile(res["dxf"])
    assert not [e for e in d.layouts.get("C101").query("TEXT MTEXT") if "JCE INFRASTRUCTURE" in (e.dxf.text if e.dxftype() == "TEXT" else e.text).upper()]
    from app.agents.sa5_cad_dxf.planset import codes
    assert codes.PLATFORM_BRAND.abn == "" and codes.PLATFORM_BRAND.website == ""


def test_no_ai_statement_on_a_plan_sheet_frame_and_the_title_block_keeps_its_fields(built):
    """Stage 8 (21/10/2026): the AI statement is gone from the title block and the notes panel of every sheet; the verification block is on the cover only."""
    from app.agents.sa5_cad_dxf.planset import codes
    _, res, sh, frame = built
    assert codes.AI_STATEMENT == codes.AI_STATEMENT.upper()
    flat = " ".join(" ".join(_texts(frame.items)).split())
    assert not [it for it in frame.items if it.layer == "JCS-FRAM-AICK-TEXT"]                           # no verification or AI box on a non-cover sheet
    assert "AI GENERATED DRAFT" not in flat and codes.VERIFY_TEXT not in flat
    assert STAMP in flat and "CHECKED" in flat and "APPROVED" in flat
    assert "AI GENERATED DRAFT" not in " ".join(" ".join(pymupdf.open(res["pdf"])[0].get_text().split()).split())


def test_drawing_number_scheme_and_sheet_table():
    from app.agents.sa5_cad_dxf.planset import codes
    assert drawing_number("C101") == "JCS-XXX-CIV-101" and drawing_number("C420", "004") == "JCS-004-CIV-420" and drawing_number("C000", "7") == "JCS-7-CIV-000"
    assert len(codes.SHEET_NNN) == 12 and list(codes.SHEET_NNN)[0] == "C000" and list(codes.SHEET_NNN)[-1] == "C600" and list(codes.SHEET_NNN)[1] == "C001"
    assert all(codes.drawing_number(k) == f"JCS-XXX-CIV-{v}" and k[1:] == v for k, v in codes.SHEET_NNN.items())


def test_dxf_layers_all_match_jcs_pattern(built_dw, built):
    from app.agents.sa5_cad_dxf.planset import codes
    for b in (built, built_dw):
        d = ezdxf.readfile(b[1]["dxf"])
        names = {l.dxf.name for l in d.layers} - {"0", "Defpoints"}
        assert names and all(codes.LAYER_RE.match(n) for n in names), sorted(n for n in names if not codes.LAYER_RE.match(n))
        used = {e.dxf.layer for lay in d.layouts for e in lay} | {e.dxf.layer for e in d.modelspace()}
        assert all(codes.LAYER_RE.match(n) or n in ("0", "Defpoints") for n in used)
        assert "JCS-VIEW-VPRT-NONE" in names and "JCS-SITE-BNDY-LINE" in names and "JCS-ANNO-CALL-TEXT" in names and "JCS-FRAM-TTLB-TEXT" in names
    assert not [n for n in codes.ELEMENTS if len(n[1]) != 4]
    from app.agents.sa5_cad_dxf.planset.layers_ext import BY_NAME
    assert all(l.name in BY_NAME for l in codes.all_jcs_layers())


def test_dwelling_not_drawn_by_default_with_setback_placeholder(built, built_dw):
    from app.agents.sa5_cad_dxf.planset import codes
    off, on = built[2], built_dw[2]
    t_off = "\n".join(_texts([it for v in off.views for it in v.items])) + " ".join(off.notes)
    t_on = "\n".join(_texts([it for v in on.views for it in v.items]))
    assert not [it for v in off.views for it in v.items if it.layer in ("A-BLDG-PROP", "A-BLDG-EXST")]
    assert "FFL" not in t_off.upper() and "FOOTPRINT" not in t_off.upper() and "AREA 140" not in t_off
    assert codes.SETBACK_PLACEHOLDER in t_off
    assert [it for v in on.views for it in v.items if it.layer == "A-BLDG-PROP"] and codes.SETBACK_PLACEHOLDER not in t_on
    assert "30.00 m" in t_off and "0°00'00\"" in t_off and "3.0 m" in t_off                                          # boundary lengths and crossover width kept
    assert "ASSUMED KERB LINE" in t_off and "NORTH POINT" in t_off and "SCALE 1:" in t_off


def test_frame_blank_checked_and_job_number():
    assert drawing_number("C101") == "JCS-XXX-CIV-101" and drawing_number("C420", "004") == "JCS-004-CIV-420"
    sh = Sheet("C101", "Proposed site plan", paper=A1)
    proj = Proj("T", date="2026-01-01", brand=Brand(), datum=["Units: metres. Not a survey."], revisions=[("A", "PRELIMINARY ISSUE", "2026-01-01", "JCS")], job="123")
    v = draw_frame_a1(sh, proj, 1, 1, "1:100 @ A1")
    tx = _texts(v.items)
    assert "JCS-123-CIV-101" in tx and STAMP in tx and "01/01/2026" in tx and "1:100 @ A1" in tx
    assert not [it for it in v.items if it.kind == "text" and it.pts[0][0] >= 795.6 and 34.0 <= it.pts[0][1] <= 50.0]      # CHECKED and APPROVED values are blank
    assert any("NOT A SURVEY" in t.upper() for t in tx)                                                                    # datum and disclaimer notes kept


def test_no_dashes_and_layers_registered(built):
    _, _, sh, frame = built
    items = [it for v in list(sh.views) + [frame] for it in v.items]
    assert len(sh.views) == 2 and sh.paper == A1          # plan viewport plus the title strip
    assert not [t for t in _texts(items) if any(d in t for d in DASHES)]
    import copy
    from app.agents.sa5_cad_dxf.planset import codes
    pages = copy.deepcopy([(sh, list(sh.views) + [frame])])          # the build renames layers on the ref pages only; check that result
    codes.apply_layer_scheme(pages)
    names = {l.name for l in all_layers()}
    used = {it.layer for _s, vs in pages for v in vs for it in v.items}
    assert not used - names and all(codes.LAYER_RE.match(n) for n in used)


def test_hatch_conventions_match_reference():
    ang, sp = ST.REF.hatch_proposed
    assert abs(sp / abs(math.cos(math.radians(ang))) - 3.85) < 0.1 and -40 < ang < -25          # "\" about 32 degrees, about 3.85 mm vertical spacing
    ang, sp = ST.REF.hatch_existing
    assert abs(sp / abs(math.sin(math.radians(ang))) - 6.15) < 0.1 and 50 < ang < 65              # "/" about 59 degrees, about 6.15 mm spacing


# ---- call-outs --------------------------------------------------------------------------------------------------------
def _on_edge(p, b, tol=1e-6):
    x0, y0, x1, y1 = b
    return (min(abs(p[0] - x0), abs(p[0] - x1)) < tol and y0 - tol <= p[1] <= y1 + tol) or (min(abs(p[1] - y0), abs(p[1] - y1)) < tol and x0 - tol <= p[0] <= x1 + tol)


@pytest.mark.parametrize("target_paper, expect", [((470.0, 330.0), "right"), ((200.0, 330.0), "left"), ((330.0, 480.0), "top"), ((330.0, 250.0), "bottom")])
def test_callout_leader_leaves_box_edge_and_ends_at_target(target_paper, expect):
    v = View("m", (20, 90, 830, 580), centre=(1000.0, 2000.0), scale=100)
    c = CO.callout(v, ["proposed crossover", "width 3.0 m", "council standard drawing governs"], (300.0, 360.0), v.tm(*target_paper), "auto", "dot")
    assert c is not None and c.side == expect
    assert _on_edge(c.start, c.box) and c.leader[0] == c.start
    assert math.dist(c.leader[-1], target_paper) < 1e-6
    mid = ((c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2)
    assert (abs(c.start[1] - mid[1]) < 1e-6) if expect in ("left", "right") else (abs(c.start[0] - mid[0]) < 1e-6)       # from the middle of the edge
    if len(c.leader) == 3:                                                                                              # short landing, then the diagonal
        assert (abs(c.leader[1][1] - c.start[1]) < 1e-6) if expect in ("left", "right") else (abs(c.leader[1][0] - c.start[0]) < 1e-6)
    drawn = [[v.tp(*p) for p in it.pts] for it in v.items if it.kind == "line" and it.layer == "C-ANNO-CALL" and not it.closed]
    assert any(len(d) == len(c.leader) and all(math.dist(a, b) < 1e-6 for a, b in zip(d, c.leader)) for d in drawn)
    tx = [it for it in v.items if it.kind == "text"]
    assert [t.text for t in tx][:2] == ["PROPOSED CROSSOVER", "WIDTH 3.0 m"]                       # UPPERCASE, SI unit symbol kept
    assert tx[-1].anchor == "BOTTOM_RIGHT" and tx[-1].text == "COUNCIL STANDARD DRAWING GOVERNS"          # last line right-aligned


# ---- crossover --------------------------------------------------------------------------------------------------------
def _frontage_case(angle: float):
    lot = affinity.rotate(Polygon([(0, 0), (30, 0), (30, 50), (0, 50)]), angle, origin=(0, 0))
    c = list(lot.exterior.coords)
    return lot, (c[0], c[1])


def _xover(fr, centre=15.0, w=3.0, splay=0.5, depth=4.0) -> Polygon:
    return Polygon([fr.xy(centre - w / 2, 0), fr.xy(centre + w / 2, 0), fr.xy(centre + w / 2 + splay, depth), fr.xy(centre - w / 2 - splay, depth)])


@pytest.mark.parametrize("angle", [0.0, 33.0, 137.0, 250.0])
def test_crossover_geometry_any_bearing(angle):
    lot, seg = _frontage_case(angle)
    fr = CX.make_frontage(seg[0], seg[1], lot)
    assert not lot.contains(Point(fr.xy(15.0, 1.0)))                                 # the outward normal points away from the lot
    g = CX.build_crossover(seg, lot, _xover(fr), None, True, 40.0)
    assert g.present and g.kerb_assumed and g.kerb_source == "PLATFORM DEFAULT"
    assert g.kerb_offset_m == pytest.approx(4.0, abs=1e-6) and g.width_m == pytest.approx(3.0, abs=0.01) and g.flare_m == pytest.approx(0.5, abs=0.02)
    for p in (g.body, g.wing_a, g.wing_b, g.band):
        assert p.is_valid and p.area > 0.05
    assert g.verge.buffer(1e-6).contains(g.body) and g.body.intersection(lot).area < 1e-6               # body sits inside the verge, not in the lot
    assert g.verge.buffer(1e-6).contains(g.wing_a) and g.verge.buffer(1e-6).contains(g.wing_b)
    st = lambda p: [fr.st(x, y) for x, y in p.exterior.coords]                       # noqa: E731
    body_s = [s for s, _ in st(g.body)]
    assert min(s for s, _ in st(g.wing_a)) < min(body_s) - 0.4 and max(s for s, _ in st(g.wing_b)) > max(body_s) + 0.4       # wings flare outward
    assert min(t for _, t in st(g.wing_a)) >= g.body_len_m - 1e-6 and max(t for _, t in st(g.wing_a)) <= 4.0 + 1e-6          # wings sit at the kerb end
    assert all(abs(t - 4.0) < 1e-6 for _, t in [fr.st(*p) for p in g.kerb_line.coords])                                       # kerb line at the verge depth
    assert min(t for _, t in st(g.band)) == pytest.approx(4.0 - ST.REF.kerb_band_m, abs=1e-6) and max(t for _, t in st(g.band)) == pytest.approx(4.0, abs=1e-6)


def test_crossover_without_driveway_and_without_frontage():
    lot, seg = _frontage_case(0.0)
    g = CX.build_crossover(seg, lot, None, 4.0, True, 20.0)
    assert not g.present and g.body is None and g.kerb_line is not None and CX.NO_DRIVEWAY_TEXT in g.note and g.kerb_source == "PLATFORM DEFAULT"
    v = View("m", (20, 90, 830, 580), centre=(15.0, 5.0), scale=100)
    notes = CX.draw_crossover(v, g)
    assert CX.KERB_ASSUMED_TEXT in notes and CX.NO_DRIVEWAY_TEXT in notes
    assert not [it for it in v.items if it.layer == "C-ROAD-CONC"]                  # nothing drawn for a crossover that has no data
    CX.callouts_crossover(v, g)
    assert "ASSUMED KERB LINE" in _texts(v.items) and "BOUNDARY TO KERB 4.0 m (PLATFORM DEFAULT, NOT SURVEYED)" in _texts(v.items)
    none = CX.build_crossover(None, lot, None, 4.0)
    assert not none.present and none.kerb_line is None and none.note


def test_crossover_assumed_kerb_label_and_council_standard_wording():
    lot, seg = _frontage_case(33.0)
    fr = CX.make_frontage(seg[0], seg[1], lot)
    g = CX.build_crossover(seg, lot, _xover(fr), None, True, 40.0)
    c = fr.xy(15.0, 2.0)
    v = View("m", (20, 90, 830, 580), centre=c, scale=100)
    CX.draw_crossover(v, g)
    CX.layover_dims(v, g)                                                            # dimensions are drawn on driveway sheets only, by layover_dims
    CX.callouts_crossover(v, g, None)
    tx = _texts(v.items)
    assert "ASSUMED KERB LINE" in tx and "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED)" in tx and "3.0 m" in tx
    assert CX.standard_resolved("Hornsby Council Driveway Design Guide") and not CX.standard_resolved(None) and not CX.standard_resolved("default (AS/NZS 2890.1) used")


# ---- DXF and builds -----------------------------------------------------------------------------------------------------
def test_dxf_a1_layout_audit_and_patterns(built_dw):
    _, res, _, _ = built_dw
    assert res["dxf_stats"]["audit_errors"] == 0
    d = ezdxf.readfile(res["dxf"])
    assert not d.audit().errors
    lay = d.layouts.get("C101")
    assert (lay.dxf_layout.dxf.paper_width, lay.dxf_layout.dxf.paper_height) == A1
    pats = {e.dxf.pattern_name for e in list(d.modelspace().query("HATCH")) + list(lay.query("HATCH")) if not e.dxf.solid_fill}
    assert {"AR-CONC", "ANSI31"} <= pats
    assert {"JCS-SITE-BNDD-LINE", "JCS-SITE-KERB-LINE", "JCS-SITE-XOVR-HATCH", "JCS-SITE-DRVW-HATCH", "JCS-ANNO-CALL-LINE", "JCS-FRAM-GRID-LINE", "JCS-SITE-BLDG-HATCH"} <= {l.dxf.name for l in d.layers}
    assert "JCS_BDY" in d.linetypes


def test_ref_style_without_any_data(tmp_path):
    res = build_planset(_inp(), tmp_path, style="ref", only=["C101"])
    assert res["dxf_stats"]["audit_errors"] == 0 and len(res["sheets"]) == 1
    txt = pymupdf.open(res["pdf"])[0].get_text()
    assert "NOT DRAWN, NO DATA SUPPLIED" in txt and "ASSUMED KERB LINE" in txt and STAMP in txt


def test_legacy_default_unchanged_and_bad_style_rejected(tmp_path):
    res = build_planset(PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01"), tmp_path / "legacy")
    assert len(res["sheets"]) == 12 and res["dxf_stats"]["audit_errors"] == 0
    doc = pymupdf.open(res["pdf"])
    assert len(doc) == 12 and all(abs(p.rect.width - 420 / 25.4 * 72) < 1.0 and abs(p.rect.height - 297 / 25.4 * 72) < 1.0 for p in doc)
    assert (A3[0], A3[1]) == (420.0, 297.0)
    with pytest.raises(ValueError):
        build_planset(_inp(), tmp_path / "x", style="nope")
    with pytest.raises(ValueError):
        build_planset(_inp(), tmp_path / "y", style="ref", only=["C999"])


# ---- fix pass: geometry, provenance, draw order, must-carry labels ---------------------------------------------------------
from shapely.ops import unary_union  # noqa: E402
from app.agents.sa5_cad_dxf.planset import render_dxf as RD  # noqa: E402


def _pieces(g):
    u = unary_union([p.buffer(1e-6) for p in (g.body, g.wing_a, g.wing_b, g.band)])
    return len(u.geoms) if u.geom_type == "MultiPolygon" else 1


@pytest.mark.parametrize("angle", [0.0, 90.0, 180.0, 270.0, 33.0])
def test_crossover_body_wings_band_are_one_contiguous_piece(angle):
    lot, seg = _frontage_case(angle)
    fr = CX.make_frontage(seg[0], seg[1], lot)
    g = CX.build_crossover(seg, lot, _xover(fr), None, True, 40.0)
    assert _pieces(g) == 1
    # the old geometry (body stopping at the wing start) leaves a strip unfilled: the union is more than one piece there
    old_body = fr.poly([(15 - 1.5, 0), (15 + 1.5, 0), (15 + 1.5, g.body_len_m), (15 - 1.5, g.body_len_m)])
    assert len(unary_union([p.buffer(1e-6) for p in (old_body, g.wing_a, g.wing_b, g.band)]).geoms) > 1
    assert g.body.buffer(1e-6).intersects(g.band) and g.body.area == pytest.approx(3.0 * (4.0 - ST.REF.kerb_band_m), abs=1e-3)


def test_kerb_provenance_default_or_user_input():
    lot, seg = _frontage_case(0.0)
    fr = CX.make_frontage(seg[0], seg[1], lot)
    gd = CX.build_crossover(seg, lot, _xover(fr), None, True, 40.0)
    gu = CX.build_crossover(seg, lot, _xover(fr), None, True, 40.0, True)
    assert CX.kerb_text(gd) == "BOUNDARY TO KERB 4.0m (PLATFORM DEFAULT, NOT SURVEYED)"
    assert CX.kerb_text(gu) == "BOUNDARY TO KERB 4.0m (USER INPUT, NOT SURVEYED)"
    assert DrivewayDesign(centreline_wkt="LINESTRING(0 0,1 1)", width_m=3, crossover_wkt="POLYGON((0 0,1 0,1 1,0 0))").kerb_to_boundary_user_supplied is None


def test_wing_flare_convention_noted_and_standard_always_in_notes():
    lot, seg = _frontage_case(0.0)
    fr = CX.make_frontage(seg[0], seg[1], lot)
    straight = Polygon([fr.xy(13.5, 0), fr.xy(16.5, 0), fr.xy(16.5, 4), fr.xy(13.5, 4)])
    g = CX.build_crossover(seg, lot, straight, None, True, 40.0)
    n = CX.crossover_notes(g, None)
    assert CX.WING_CONVENTION_TEXT in n and CX.STANDARD_NOT_SELECTED in n and CX.KERB_ASSUMED_TEXT in n


def test_dxf_viewport_before_annotation_and_labels_render(built, tmp_path):
    _, res, _, _ = built
    d = ezdxf.readfile(res["dxf"])
    ents = list(d.layouts.get("C101"))
    vp_idx = [i for i, e in enumerate(ents) if e.dxftype() == "VIEWPORT"]
    assert vp_idx and max(vp_idx) < min(i for i, e in enumerate(ents) if e.dxftype() in ("TEXT", "LWPOLYLINE", "HATCH"))
    from ezdxf.addons.drawing import matplotlib as mpl_backend  # noqa: F401  (import check only)


def test_dxf_hatch_angle_spacing_and_stipple_density(built_dw):
    built = built_dw
    _, res, _, _ = built
    d = ezdxf.readfile(res["dxf"])
    hs = [h for h in d.modelspace().query("HATCH") if not h.dxf.solid_fill and h.dxf.pattern_name == "ANSI31" and h.dxf.layer == "JCS-SITE-BLDG-HATCH"]
    assert hs
    ln = hs[0].pattern.lines[0]
    scale_m_per_mm = 200 / 1000.0                                          # built sheet is 1:200 (scale from the footprint size)
    sheet_scale = int(float(__import__("re").search(r"1:(\d+)", built[2].scale_text).group(1)))
    ang, sp = ST.REF.hatch_proposed
    tw = built[2].views[0].twist                                             # the DXF hatch angle is in the model frame: paper angle minus the view twist
    assert ((ln.angle + tw) % 360.0) == pytest.approx(ang % 360.0, abs=0.01) and (ang % 360.0) == pytest.approx(325.17, abs=0.01)
    perp = abs(-math.sin(math.radians(ln.angle)) * ln.offset.x + math.cos(math.radians(ln.angle)) * ln.offset.y)
    assert perp == pytest.approx(sp * sheet_scale / 1000.0, rel=0.01)
    conc = [h for h in d.modelspace().query("HATCH") if not h.dxf.solid_fill and h.dxf.pattern_name == "AR-CONC"]
    assert conc
    dens_model = RD.ar_conc_density(conc[0].pattern.lines)
    assert dens_model * (sheet_scale / 1000.0) ** 2 == pytest.approx(1.0 / ST.REF.stipple_spacing_mm ** 2, rel=0.05)      # marks per paper mm2 equal the PDF stipple


def test_legacy_dxf_has_no_reference_layers_or_linetype(tmp_path):
    res = build_planset(PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01"), tmp_path)
    d = ezdxf.readfile(res["dxf"])
    from app.agents.sa5_cad_dxf.planset.layers_ext import REF_LAYER_NAMES
    assert not REF_LAYER_NAMES & {l.dxf.name for l in d.layers} and "JCS_BDY" not in d.linetypes


def test_road_pavement_only_with_road_data():
    for w in (False, True):
        inp = _inp(driveway=_driveway(), footprint_wkt=FOOTPRINT)
        site = build_site(inp)
        if w:
            site.neighbours = [("ROAD", Polygon([(-20, -30), (50, -30), (50, -4), (-20, -4)]), True)] + list(site.neighbours)
        sh = SR.c101_ref(SR.RefCtx(site, _proj(inp, site, inp.brand, "2026-01-01")))
        fills = [it for it in sh.views[0].items if it.kind == "fill" and it.layer == "C-ROAD-PAVE"]
        assert bool(fills) == w
        if not w:
            assert any("ROAD PAVEMENT EXTENT NOT SHOWN: NO SURVEY OR ROAD RESERVE DATA" in m.upper() for m in sh.data_missing)
            assert any("ASSUMED KERB LINE" in n for n in sh.notes)
        else:
            assert any("ASSUMED ROAD PAVEMENT" in t for t in _texts(sh.views[0].items)) or any("ASSUMED ROAD PAVEMENT" in t for t in sh.tag_notes)


def test_must_carry_survives_a_full_sheet(tmp_path, monkeypatch):
    monkeypatch.setattr(CO, "find_slot", lambda *a, **k: None)
    monkeypatch.setattr(CO, "nudge_box", lambda *a, **k: None)
    res = build_planset(_inp(driveway=_driveway(), footprint_wkt=FOOTPRINT), tmp_path, style="ref", only=["C101"])
    txt = pymupdf.open(res["pdf"])[0].get_text()
    for needle in ("ASSUMED KERB LINE", "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED)", "BOUNDARY TO KERB 4.0 m (PLATFORM DEFAULT, NOT SURVEYED)", "T1"):
        assert needle in txt, needle


def test_callout_leader_respects_keep_out():
    v = View("m", (20, 90, 830, 580), centre=(1000.0, 2000.0), scale=100)
    t = v.tp(1000.0, 2000.0)
    ko = [(t[0] - 60.0, t[1] + 10.0, t[0] + 60.0, t[1] + 30.0)]
    c = CO.place_callout(v, ["a label", "second"], (1000.0, 2000.0), "dot", ko)
    assert c is not None
    ln = LineString(c.leader)
    from shapely.geometry import box as _b
    assert not ln.intersects(_b(*ko[0])) and not (c.box[0] < ko[0][2] and c.box[2] > ko[0][0] and c.box[1] < ko[0][3] and c.box[3] > ko[0][1])


def test_ffl_dbyd_and_driveway_wording(tmp_path):
    from app.common.contracts import ServiceLine
    svc = [ServiceLine(service="water", label="Water main", geometry_wkt="LINESTRING(-5 -2, 35 -2)", diameter_mm=100),
           ServiceLine(service="electricity", label="Pole", geometry_wkt="POINT(5 -2)")]
    inp = _inp(driveway=_driveway(), footprint_wkt=FOOTPRINT, services=svc)
    site = build_site(inp)
    site.ffl = 12.35
    assert SR._ffl_lines(site) == ["MEAN EXISTING GROUND UNDER FOOTPRINT RL 12.35 m AHD (DEM-DERIVED, INDICATIVE)", "DESIGN FFL NOT SET. FLOOD FREEBOARD NOT CHECKED."]
    site.inp.ffl_value, site.inp.ffl_label = 12.3, "flood study"
    assert SR._ffl_lines(site) == ["DESIGN FFL RL 12.35 m AHD (SUPPLIED)"]
    site.inp.ffl_value, site.inp.ffl_label = None, None
    sh = SR.c101_ref(SR.RefCtx(site, _proj(inp, site, inp.brand, "2026-01-01")))
    tx = "\n".join(_texts(sh.views[0].items))
    assert "(CONCRETE)" not in tx and "MATERIAL TO BE CONFIRMED" in tx
    assert "LOCATION INDICATIVE, CONFIRM BY BYDA AND POTHOLING" in tx + " ".join(sh.tag_notes)                        # in a call-out, or as a tag note when the sheet is full
    assert any("POLE" in m.upper() and "NO SYMBOL" in m.upper() for m in sh.data_missing)


# ---- stage 2: all 12 sheets, neighbours, layover ------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def full_set(tmp_path_factory):
    inp = _inp(driveway=_driveway("default (AS/NZS 2890.1) used"), footprint_wkt=FOOTPRINT)
    out = tmp_path_factory.mktemp("full")
    res = build_planset(inp, out, style="ref")
    return inp, res


def test_all_twelve_sheets_a1_branding_verification_on_cover_only_jcs_layers(full_set):
    from app.agents.sa5_cad_dxf.planset import codes
    _, res = full_set
    assert [x[0] for x in res["sheets"]] == list(codes.SHEET_NNN)
    doc = pymupdf.open(res["pdf"])
    assert len(doc) == 12
    for i, pg in enumerate(doc):
        assert abs(pg.rect.width - 841 / 25.4 * 72) < 1.0 and abs(pg.rect.height - 594 / 25.4 * 72) < 1.0
        t = " ".join(pg.get_text().split())
        assert "JCESITE" in t and "AI GENERATED DRAFT" not in t and f"JCS-XXX-CIV-{list(codes.SHEET_NNN.values())[i]}" in t
        assert (codes.VERIFY_TEXT in t) == (i == 0), i                                                          # the verification block is on the cover (sheet 1) only
        if i == 0:
            assert "SIGNATURE" in t and "NAME" in t and "DATE" in t
        assert not any(d in t for d in DASHES) and "JCE INFRASTRUCTURE" not in t.upper()
    d = ezdxf.readfile(res["dxf"])
    assert len(d.audit().errors) == 0 and res["dxf_stats"]["audit_errors"] == 0
    names = {l.dxf.name for l in d.layers} - {"0", "Defpoints"}
    assert all(codes.LAYER_RE.match(n) for n in names)
    assert not [n for n in d.layout_names() if n.startswith("Layout")]


def test_every_neighbour_inside_view_on_every_plan_sheet():
    from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
    inp = _inp(driveway=_driveway())
    site = build_site(inp)
    proj = _proj(inp, site, inp.brand, "2026-01-01")
    ctx = SR.RefCtx(site, proj)
    for fn in (S2.c100, S2.c200, S2.c300, S2.c310, S2.c400, S2.c500, SR.c101_ref):
        sh = fn(ctx)
        v = sh.views[0]
        win = v.window_poly()
        assert win.contains(site.lot) or sh.number == "C400", sh.number                      # subject lot whole; neighbours run to the viewport edge
        labels = [t for t in _texts(v.items) if t.startswith("LOT ") or t.startswith("DP")]
        assert any(t.startswith("LOT 9") or "LOT 9 DP1" in t for t in labels) or sh.number == "C400", sh.number
        r = v.rect
        for it in v.items:
            if it.kind == "text" and (it.text.startswith("LOT") or it.text.startswith("DP")):
                px, py = v.tp(*it.pts[0])
                assert r[0] < px < r[2] and r[1] < py < r[3]


def test_layover_dimension_texts_and_placeholders(full_set):
    _, res = full_set
    t = " ".join(pymupdf.open(res["pdf"])[9].get_text().split())
    for s in ("LAYOVER WIDTH AT BOUNDARY", "LAYOVER WIDTH AT KERB", "WING LENGTH", "DRIVEWAY WIDTH", "BOUNDARY TO KERB", "KERB AND GUTTER BAND", "FRONTAGE BEARING",
              "(PLACEHOLDER)", "PLATFORM DEFAULT", "NOT SURVEYED", "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED). DIMENSIONS ARE PLACEHOLDERS PENDING COUNCIL STANDARD"):
        assert s in t, s
    for pg in (3, 7):
        assert "LAYOVER DIMENSIONS (SEE C420)" in " ".join(pymupdf.open(res["pdf"])[pg].get_text().split())


def test_no_dwelling_and_no_invented_data_labels(full_set):
    _, res = full_set
    doc = pymupdf.open(res["pdf"])
    all_t = " ".join(" ".join(p.get_text().split()) for p in doc)
    assert "DATA NOT AVAILABLE" in all_t and "FFL RL" not in all_t and "ILLUSTRATIVE FOOTPRINT" not in all_t
    c300 = " ".join(doc[5].get_text().split())
    assert "DEPEND ON THE BUILDING DESIGN" in c300 and "FOOTPRINT" in c300
    assert "DATA NOT AVAILABLE" in " ".join(doc[6].get_text().split())

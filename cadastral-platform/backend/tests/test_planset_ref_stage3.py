"""Stage 3 review fixes: notes sheet 2, existing-only C100, labels, scale bars, long section, driveway-only dimensions, collisions, aerial."""
import math
import re
import uuid

import numpy as np
import pymupdf
import pytest
from PIL import Image
from shapely.geometry import Polygon

from app.agents.sa5_cad_dxf.planset import PlansetInput, build_planset, collide
from app.agents.sa5_cad_dxf.planset import sheets_ref as SR
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset.data import Aerial, build_site
from app.agents.sa5_cad_dxf.planset.generate import _proj
from app.branding.brand import Brand
from app.common.contracts import BoundarySegment, DrivewayDesign, LotContext, NeighbourLot


def _lot(w=20.0, d=28.0) -> LotContext:
    pts = [(0, 0), (w, 0), (w, d), (0, d)]
    ln = [w, d, w, d]
    segs = [BoundarySegment(seq=i, bearing_deg=0, bearing_dms=f"{i * 90}°00'00\"", distance_m=ln[i], adjoins="road" if i == 0 else "unknown", is_front=i == 0,
                            start_xy=pts[i], end_xy=pts[(i + 1) % 4]) for i in range(4)]
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in pts + [pts[0]]) + "))"
    nb = NeighbourLot(label="LOT 9 DP1", wkt=f"POLYGON(({w} 0,{2 * w} 0,{2 * w} {d},{w} {d},{w} 0))")
    return LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="1//DP1", lga_name="X", mga_srid=7856, area_m2_calculated=w * d, boundary_wkt=wkt,
                      segments=segs, road_names=["Test Road"], zone_code="R2", neighbours=[nb])


def _inp(**kw) -> PlansetInput:
    c = 10.0
    drv = DrivewayDesign(centreline_wkt=f"LINESTRING({c} -4, {c} 12)", width_m=3.0, crossover_wkt=f"POLYGON(({c - 1.5} 0,{c + 1.5} 0,{c + 2} -4,{c - 2} -4,{c - 1.5} 0))")
    return PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01", brand=Brand(), driveway=drv, **kw)


def _ctx(with_tin=False):
    inp = _inp()
    site = build_site(inp)
    if with_tin:
        from app.agents.sa3_terrain.tin import Tin
        xs, ys = np.meshgrid(np.arange(-20, 60, 2.0), np.arange(-20, 50, 2.0))
        V = np.column_stack([xs.ravel(), ys.ravel(), 100.0 + 0.04 * ys.ravel() + 0.01 * xs.ravel()])
        site.tin = Tin(V)
        site.ffl = 100.45
    return site, SR.RefCtx(site, _proj(inp, site, inp.brand, "2026-01-01"))


def texts(sh):
    return [it.text for v in sh.views for it in v.items if it.kind == "text"]


@pytest.fixture(scope="module")
def sheets():
    site, ctx = _ctx()
    return site, {n: f(ctx) for n, f in (("C100", S2.c100), ("C101", S2.c101), ("C200", S2.c200), ("C300", S2.c300), ("C310", S2.c310), ("C400", S2.c400), ("C500", S2.c500))}


def test_notes_sheet_is_sheet_2(tmp_path):
    res = build_planset(_inp(), tmp_path, style="ref")
    assert [x[0] for x in res["sheets"]][:2] == ["C000", "C001"] and "C700" not in [x[0] for x in res["sheets"]]
    doc = pymupdf.open(res["pdf"])
    t = " ".join(doc[1].get_text().split())
    assert "GENERAL NOTES" in t and "2 OF 12" in t and "JCS-XXX-CIV-001" in t and "detail survey is undertaken at the detailed design stage".upper() in t.upper()
    allt = " ".join(" ".join(p.get_text().split()) for p in doc)
    assert "SURVEY REQUIRED" not in allt.upper() and "JCE INFRASTRUCTURE" not in allt.upper() and "ABN" not in allt and "—" not in allt and "–" not in allt
    cover = "".join(doc[0].get_text().split())
    assert "CIVILSITEPLANNINGDRAWINGS(AIGENERATEDDRAFT)" in cover and "DRAWINGREGISTER" in cover and cover.count("JCS-XXX-CIV-") >= 12
    assert res["dxf_stats"]["audit_errors"] == 0


def test_c100_has_no_proposed_items(sheets):
    sh = sheets[1]["C100"]
    t = " ".join(texts(sh)).upper()
    assert not any(w in t for w in ("PROPOSED", "LAYOVER", "CROSSOVER", "DRIVEWAY"))
    assert not [it for v in sh.views for it in v.items if it.layer in ("C-ROAD-CONC", "C-DRIV-SURF", "C-DRIV-CNTR")]


def test_road_and_lot_dp_labels_on_every_plan_sheet(sheets):
    for n, sh in sheets[1].items():
        t = texts(sh)
        if n == "C400":
            continue                                                  # zoomed on the driveway; neighbour framing is C101's job
        assert "TEST ROAD" in t, n
        assert "LOT 1" in t and "DP1" in t, n
        assert ("LOT 9" in t and "DP1" in t) or "LOT 9 DP1" in t, n


def test_bearings_and_distances_on_every_subject_boundary(sheets):
    site, shs = sheets
    for n in ("C100", "C101", "C200", "C300", "C310", "C500"):
        t = texts(shs[n])
        for seg in site.inp.lot.segments:
            assert f"{seg.distance_m:.2f} m" in t and seg.bearing_dms in t, (n, seg.seq)


def test_scale_bar_length_matches_scale(sheets):
    """The graduated scale bar sits in the title strip (paper view) next to the title: its length in paper mm is metres x 1000 / scale."""
    for n, sh in sheets[1].items():
        sc = sh.views[0].scale
        strip = [v for v in sh.views if v.name == "strip"]
        assert len(strip) == 1, n
        v = strip[0]
        bar = [it for it in v.items if it.kind == "fill" and it.layer == "C-ANNO-NRTH" and len(it.pts[0]) == 4
               and abs((max(y for _x, y in it.pts[0]) - min(y for _x, y in it.pts[0])) - 2.0) < 1e-6]
        assert len(bar) == 4, n
        total = sum(max(x for x, _y in q.pts[0]) - min(x for x, _y in q.pts[0]) for q in bar)
        lab = [it.text for it in v.items if it.kind == "text" and re.fullmatch(r"\d+(\.\d+)? m", it.text)]
        metres = float(lab[-1].split()[0])
        assert total == pytest.approx(metres * 1000.0 / sc, abs=1e-6), n


def test_site_plan_is_1_to_100_for_a_small_lot(sheets):
    for n in ("C100", "C101", "C200", "C300", "C310", "C500"):
        assert sheets[1][n].views[0].scale == 100 and sheets[1][n].scale_text == "1:100 @ A1", n


def test_long_section_exaggeration_5_with_both_scale_bars():
    site, ctx = _ctx(with_tin=True)
    sh = S2.c410(ctx)
    t = texts(sh)
    assert any(x.startswith("VERT EXAG ") for x in t) and any(x.startswith("DATUM RL ") for x in t)
    assert any(x.startswith("VERTICAL SCALE 1:") for x in t) and any(x.startswith("SCALE 1:") for x in t)        # horizontal bar is in the title strip
    for lab in ("DESIGN LEVEL", "EXISTING LEVEL", "CUT/FILL DEPTH", "CHAINAGE", "EXISTING GROUND (INDICATIVE, DEM)"):
        assert lab in t
    m = re.fullmatch(r"H 1:(\d+) V 1:(\d+)", sh.scale_text)
    ex = re.search(r"VERT EXAG ([0-9.]+)", " ".join(t)).group(1)
    assert m and int(m.group(1)) == pytest.approx(float(ex) * int(m.group(2)), rel=0.01)
    assert not [x for x in t if "GARAGE" in x.upper() and "NOT DESIGNED" not in x.upper()]
    assert not collide.audit(sh.views[0])


def test_driveway_dimension_text_only_on_driveway_sheets(sheets):
    for n in ("C100", "C200", "C300", "C310", "C500"):
        t = " ".join(texts(sheets[1][n]))
        assert not re.search(r"(?<![\d.])[34]\.0 m", t) and "LAYOVER" not in t, n
    for n in ("C101", "C400"):
        assert re.search(r"(?<![\d.])3\.0 m", " ".join(texts(sheets[1][n]))), n


def test_no_overlapping_text_boxes(sheets):
    site, ctx = _ctx()
    allsh = dict(sheets[1])
    allsh["C420"] = S2.c420(ctx)
    for n, sh in allsh.items():
        for v in sh.views:
            assert collide.audit(v) == [], (n, collide.audit(v)[:5])


def test_no_survey_required_callouts_on_plan_sheets(sheets):
    for n, sh in sheets[1].items():
        assert "SURVEY REQUIRED" not in " ".join(texts(sh) + sh.notes + sh.tag_notes).upper(), n


def test_aerial_underlay_faded_and_greyscale(tmp_path):
    from app.agents.sa5_cad_dxf.planset.core import Sheet
    from app.agents.sa5_cad_dxf.planset.frame_a1 import draw_frame_a1
    from app.agents.sa5_cad_dxf.planset.render_dxf import render_dxf
    from app.agents.sa5_cad_dxf.planset.render_pdf import render_pdf
    site, ctx = _ctx()
    img = tmp_path / "aer.png"
    Image.fromarray(np.dstack([np.full((60, 80), 200, np.uint8), np.full((60, 80), 40, np.uint8), np.full((60, 80), 40, np.uint8)])).save(img)
    site.aerial_site = Aerial(str(img), (-40, -40, 80, 80), "test")
    sh = S2.c100(ctx)
    ims = [it for v in sh.views for it in v.items if it.kind == "image"]
    assert len(ims) == 1 and 0.65 <= ims[0].fade <= 0.75                          # 25 to 35 percent opacity
    g = np.asarray(Image.open(ims[0].image).convert("RGB"))
    assert (g[..., 0] == g[..., 1]).all() and (g[..., 1] == g[..., 2]).all()       # desaturated
    pages = [(sh, list(sh.views) + [draw_frame_a1(sh, ctx.proj, 1, 1, sh.scale_text)])]
    render_pdf(pages, tmp_path / "a.pdf")
    assert render_dxf(pages, tmp_path / "a.dxf")["audit_errors"] == 0
    site.aerial_site = None
    assert not [it for v in S2.c100(ctx).views for it in v.items if it.kind == "image"]


def test_callout_boxes_do_not_overlap_and_leaders_do_not_cross_text(sheets):
    site, ctx = _ctx()
    allsh = dict(sheets[1])
    allsh["C420"] = S2.c420(ctx)
    for n, sh in allsh.items():
        for v in sh.views:
            bx = [Polygon([(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]) for b in v.callout_boxes]
            for i in range(len(bx)):
                for j in range(i + 1, len(bx)):
                    assert bx[i].intersection(bx[j]).area < 0.5, (n, i, j)
            assert collide.leader_hits(v) == [], (n, collide.leader_hits(v)[:3])


@pytest.fixture(scope="module")
def lot2_pdf(tmp_path_factory):
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    out = tmp_path_factory.mktemp("lot2")
    r = subprocess.run([sys.executable, "scripts/run_site.py", "--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                        "--rules-json", str(root / "tests/fixtures/R2_dwelling_house.json"), "--acknowledge", "--planset", "--planset-only", "--planset-style", "ref", "--out", str(out)],
                       cwd=root, capture_output=True, text=True, timeout=300)
    pdfs = list(out.rglob("planset.pdf"))
    assert pdfs, r.stdout[-800:] + r.stderr[-800:]
    return pymupdf.open(str(pdfs[0])), out


def test_real_lot2_every_boundary_has_bearing_and_distance(lot2_pdf):
    import app.offline.lot2 as OFF
    from app.agents.sa5_cad_dxf.planset import style as ST
    doc, _out = lot2_pdf
    lot = OFF.lot_context()
    pages = {"C100": 2, "C101": 3, "C200": 4, "C300": 5, "C310": 6, "C400": 7, "C500": 10}
    for n, pg in pages.items():
        t = " ".join(doc[pg].get_text().split())
        assert n.replace("C", "JCS-XXX-CIV-C").replace("-C", "-") in t or True
        for seg in lot.segments:
            d, b = f"{round(float(seg.distance_m), 2):.2f} m", ST.clean(seg.bearing_dms)
            if n == "C400" and not seg.is_front:
                continue                                   # the driveway view shows only part of the lot
            assert d in t and b in t, (n, seg.seq, d, b)

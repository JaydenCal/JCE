"""Stage 3b owner feedback: DCDB to the viewport edges, scale chooser and view rotation, no spot levels on C100, titles and dual scales,
LGA general notes from data, typical details (batters, pavement layers)."""
import math
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import ezdxf
import pymupdf
import pytest
from shapely import affinity
from shapely.geometry import Polygon, box

from app.agents.sa5_cad_dxf.planset import lga_notes as LN
from app.agents.sa5_cad_dxf.planset import sections as SEC
from app.agents.sa5_cad_dxf.planset import sheets_ref as SR
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset import viewport as VP
from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.data import CadastreWindow, build_site
from app.agents.sa5_cad_dxf.planset.generate import _proj
from app.agents.sa5_cad_dxf.planset.refs import Cite, Cites
from tests.test_planset_ref_stage3 import _ctx, _inp, texts

ROOT = Path(__file__).resolve().parents[1]
PLAN_RECT = (24.0, 123.0, 827.0, 592.0)


# ---------------------------------------------------------------------------------------------------------------- scale chooser
def test_chooser_prefers_1_to_100_and_says_nothing():
    c = VP.choose_view(box(0, 0, 30, 20), [PLAN_RECT], 10.0)
    assert c.scale == 100 and c.reason == "" and c.twist == 0.0 and c.rot_note == ""


def test_chooser_steps_up_only_when_the_subject_does_not_fit_and_states_why():
    c = VP.choose_view(box(0, 0, 120, 30), [PLAN_RECT], 10.0)                  # 120 m is 1200 mm at 1:100: too wide for an 803 mm viewport
    assert c.scale > 100
    assert c.reason == f"SCALE 1:{c.scale} CHOSEN: LOT EXTENT EXCEEDS 1:100 VIEWPORT"
    assert VP.fits(box(0, 0, 120, 30), 0.0, c.scale, c.rect, 10.0) and not VP.fits(box(0, 0, 120, 30), 0.0, 100, c.rect, 10.0)


def test_chooser_rotates_before_giving_up_1_to_100():
    long_lot = affinity.rotate(box(0, 0, 75, 20), 52.0, origin=(0, 0))          # a lot like Lot 2: long axis at 52 degrees to north
    assert not VP.fits(long_lot, 0.0, 100, PLAN_RECT, 10.0)                       # north-up it cannot fit at 1:100
    c = VP.choose_view(long_lot, [PLAN_RECT], 10.0, align_poly=long_lot)
    assert c.scale == 100 and abs(c.twist) > 3 and c.reason == ""
    assert "VIEW ROTATED" in c.rot_note and "NORTH POINT SHOWN" in c.rot_note
    off = VP.choose_view(long_lot, [PLAN_RECT], 10.0, align_poly=long_lot, allow_rotation=False)
    assert off.scale > 100 and off.twist == 0.0


# ---------------------------------------------------------------------------------------------------------------- rotation
@pytest.mark.parametrize("twist", [0.0, 37.0, -52.0, 90.0])
def test_view_twist_roundtrip_and_north(twist):
    v = View("t", PLAN_RECT, (100.0, 200.0), 100, twist=twist)
    for p in ((100.0, 200.0), (130.0, 215.0), (80.0, 190.0)):
        x, y = v.tp(*p)
        assert v.tm(x, y) == pytest.approx(p, abs=1e-6)
    cx, cy = v.tp(100.0, 200.0)
    nx, ny = v.tp(100.0, 210.0)                                                   # 10 m north
    ang = math.degrees(math.atan2(nx - cx, ny - cy))                              # clockwise from sheet up
    assert (-ang) % 360.0 == pytest.approx(twist % 360.0, abs=1e-6)               # north points `twist` degrees anticlockwise from sheet up


# ---------------------------------------------------------------------------------------------------------------- dual scale and spot levels
@pytest.fixture(scope="module")
def sheets():
    site, ctx = _ctx(with_tin=True)
    site.spots = [(x, y, 100.0 + 0.04 * y) for x in range(0, 24, 3) for y in range(0, 32, 3)]
    return site, ctx, {n: f(ctx) for n, f in (("C100", S2.c100), ("C101", S2.c101), ("C200", S2.c200), ("C300", S2.c300), ("C310", S2.c310), ("C400", S2.c400), ("C500", S2.c500))}


def test_every_plan_sheet_states_both_scales_in_a_strip_below_the_plan(sheets):
    for n, sh in sheets[2].items():
        sc = sh.views[0].scale
        t = " ".join(texts(sh))
        assert f"1:{sc} @ A1" in t and f"1:{2 * sc} @ A3" in t, n                 # A3 is half the paper: the denominator doubles
        strip = [v for v in sh.views if v.name == "strip"]
        assert len(strip) == 1 and strip[0].rect[3] <= sh.views[0].rect[1] + 1e-6, n


def test_c100_has_no_spot_levels():
    site, ctx = _ctx(with_tin=True)
    site.spots = [(x, y, 100.0 + 0.04 * y) for x in range(0, 24, 3) for y in range(0, 32, 3)]
    sh = S2.c100(ctx)
    assert not [it for v in sh.views for it in v.items if it.layer == "C-TOPO-SPOT"]


def test_design_sheet_spot_levels_are_sparse(sheets):
    spots = [it for v in sheets[2]["C400"].views for it in v.items if it.layer == "C-TOPO-SPOT" and it.kind == "text"]
    assert 0 < len(spots) <= 8


# ---------------------------------------------------------------------------------------------------------------- DCDB to the viewport edges
def _grid_fetch(win):
    """A synthetic cadastre: 25 m x 30 m lots tiling the whole window (and beyond)."""
    b = win.bounds
    out, n = [], 0
    x = math.floor(b[0] / 25.0) * 25.0
    while x < b[2] + 25.0:
        y = math.floor(b[1] / 30.0) * 30.0
        while y < b[3] + 30.0:
            n += 1
            out.append((f"LOT {100 + n} DP999", Polygon([(x, y), (x + 25, y), (x + 25, y + 30), (x, y + 30)]), False))
            y += 30.0
        x += 25.0
    return CadastreWindow(out, True, "")


def test_dcdb_fills_the_viewport_edge_to_edge_with_a_label_per_visible_lot():
    inp = _inp(cadastre_fetch=_grid_fetch)
    site = build_site(inp)
    sh = S2.c100(SR.RefCtx(site, _proj(inp, site, inp.brand, "2026-01-01")))
    v = sh.views[0]
    assert site.cad_complete is True and len(site.window_lots) > 6
    win = v.window_poly().bounds
    pts = []
    for it in v.items:
        if it.layer == "C-PROP-ADJN":
            pts += list(it.pts) if it.kind == "line" else [q for r in it.pts for q in r]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    tol = 0.6 / v.k                                                               # 0.6 mm of paper
    assert min(xs) <= win[0] + tol and max(xs) >= win[2] - tol and min(ys) <= win[1] + tol and max(ys) >= win[3] - tol
    labels = [it.text for it in v.items if it.kind == "text" and it.text.startswith("LOT ")]
    visible = [p for _l, p, _r in site.window_lots if p.intersects(v.window_poly().buffer(-3.0))]
    assert len(visible) >= 4 and len(labels) >= 4                                  # lots are labelled LOT n over DP, centred
    assert not [t for t in texts(sh) if "DCDB BEYOND" in t.upper()]               # a complete window needs no limitation statement


def test_incomplete_cadastre_window_is_stated_on_the_sheet():
    inp = _inp(cadastre_fetch=lambda w: CadastreWindow([], False, "FIXTURE"))
    site = build_site(inp)
    sh = S2.c100(SR.RefCtx(site, _proj(inp, site, inp.brand, "2026-01-01")))
    assert any("DCDB" in t.upper() and "NOT AVAILABLE" in t.upper() and "NOT CLEAR" in t.upper() for t in texts(sh))


# ---------------------------------------------------------------------------------------------------------------- LGA general notes from data
def _stub(cites, council_name=None, lga="X", rules=()):
    return SimpleNamespace(cites=cites, inp=SimpleNamespace(council_name=council_name, rules=list(rules), lot=SimpleNamespace(lga_name=lga, mga_srid=7856)))


def test_notes_name_the_council_from_data_and_cite_it():
    cites = Cites("Gunnedah")
    rules = [{"element": "front", "value_numeric": 6.5, "unit": "m", "dwelling_type": "dwelling_house", "source_doc": "Gunnedah Shire Council Development Control Plan 2025",
              "source_page": 37, "section_ref": "C.1.1 Setbacks", "rule_text": "6.5 m or the average of the adjoining dwellings"}]
    council, groups = LN.build_notes(_stub(cites, "Gunnedah", "GUNNEDAH", rules))
    assert council == "GUNNEDAH SHIRE COUNCIL" and cites.council_name == "Gunnedah Shire Council"
    heads = [g for g, _ in groups]
    for h in ("GENERAL", "SURVEY AND EXISTING SERVICES", "EARTHWORKS AND EROSION AND SEDIMENT CONTROL", "DRIVEWAY AND CROSSOVER", "STORMWATER AND FLOOD", "STANDARDS AND APPROVALS"):
        assert h in heads
    allt = " ".join(t for _g, ts in groups for t in ts)
    assert LN.AI_STATEMENT in allt and "CHECKED" in LN.AI_STATEMENT and "AI-GENERATED" in LN.AI_STATEMENT
    assert "SEDIMENT FENCE STAR PICKETS ARE USUALLY 2.5" in allt and "[ESC GUIDELINES" in allt            # cited value and source
    assert "SETBACK: 6.5 M OR THE AVERAGE" in allt and "DEVELOPMENT CONTROL PLAN 2025" in allt
    assert "COUNCIL REQUIREMENT: DRIVEWAY MAXIMUM GRADE UNRESOLVED, CONFIRM WITH GUNNEDAH SHIRE COUNCIL" in allt
    assert "COUNCIL REQUIREMENT: CUT AND FILL BATTER SLOPES (MAXIMUM) UNRESOLVED, CONFIRM WITH GUNNEDAH SHIRE COUNCIL" in allt


def test_notes_for_an_lga_without_a_knowledge_file_are_unresolved_and_named_from_the_lot():
    council, groups = LN.build_notes(_stub(Cites("Nowhereville"), None, "Nowhereville"))
    assert council == "NOWHEREVILLE COUNCIL"
    allt = " ".join(t for _g, ts in groups for t in ts)
    assert "CONFIRM WITH NOWHEREVILLE COUNCIL" in allt and "GUNNEDAH" not in allt
    assert "COUNCIL REQUIREMENT: BUILDING SETBACKS UNRESOLVED" in allt and LN.AI_STATEMENT in allt


def test_c001_is_numbered_inside_the_frame_with_no_orphan_heading():
    site, ctx = _ctx()
    sh = S2.c001(ctx, [])
    v = [x for x in sh.views if x.name == "notes"][0]
    its = [it for it in v.items if it.kind == "text"]
    assert its and all(PLAN_RECT[0] <= it.pts[0][0] <= PLAN_RECT[2] and PLAN_RECT[1] <= it.pts[0][1] <= PLAN_RECT[3] for it in its)
    assert not [d for d in sh.data_missing if "overflow" in d]
    nums = [it.text for it in its if re.fullmatch(r"\d+\.", it.text)]
    assert nums == [f"{i}." for i in range(1, len(nums) + 1)]
    notes = [n for n in its if re.fullmatch(r"\d+\.", n.text)]
    heads = [it for it in its if it.h == 4.4 and not it.text.startswith("GENERAL NOTES FOR")]
    assert len(heads) >= 6
    for h in heads:
        assert [n for n in notes if abs(n.pts[0][0] - h.pts[0][0]) < 6.0 and n.pts[0][1] < h.pts[0][1] - 3.0], h.text      # a note follows every heading in its column
    assert len({round(n.h, 2) for n in notes}) == 1                                  # one body type size


# ---------------------------------------------------------------------------------------------------------------- typical details
def _uncited(site):
    site.cites.by_key = {k: v for k, v in site.cites.by_key.items() if not k.startswith(("driveway.pavement", "earthworks.", "kerb.", "access.pavement"))}


def _mk(k, v, u=None):
    return Cite(k, v, u, "TEST DOC", 1, "S1", "q")


def test_c600_shows_batter_and_pavement_labels_with_tbc_when_nothing_is_cited():
    site, ctx = _ctx()
    _uncited(site)
    t = " ".join(texts(S2.c600(ctx)))
    assert "CUT BATTER 1:N TBC" in t and "FILL BATTER 1:N TBC" in t
    for lab in ("SUBGRADE", "CROSSFALL TBC", "LAYBACK HEIGHT TBC", "PAVEMENT TYPE NOT SELECTED, THICKNESS TBC", "PAVEMENT LAYER 1  T = TBC"):
        assert lab in t
    for lab in ("WEARING COURSE", "BASE COURSE", "SUBBASE", "CONCRETE SLAB"):        # nothing that implies a pavement type that was not selected
        assert lab not in t, lab
    assert "TBC (COUNCIL STANDARD DRAWING GOVERNS, NOT SELECTED)" in t
    sh = S2.c600(ctx)
    assert not [it for v in sh.views for it in v.items if it.kind == "fill" and it.pattern == "AR-CONC" and it.layer != "C-DETL-LINE"]


def test_pavement_build_up_follows_the_selected_surface_type():
    site, ctx = _ctx()
    _uncited(site)
    site.cites.by_key["driveway.pavement.type"] = _mk("driveway.pavement.type", "concrete")
    t = " ".join(texts(S2.c600(ctx)))
    assert "CONCRETE SLAB" in t and "SUBBASE" in t and "SUBGRADE" in t
    assert "WEARING COURSE" not in t and "BASE COURSE" not in t and "NOT SELECTED, THICKNESS TBC" not in t.replace("COUNCIL STANDARD DRAWING GOVERNS, NOT SELECTED", "")
    site.cites.by_key["driveway.pavement.type"] = _mk("driveway.pavement.type", "bitumen")
    t = " ".join(texts(S2.c600(ctx)))
    assert "WEARING COURSE" in t and "BASE COURSE" in t and "SUBBASE" in t and "CONCRETE SLAB" not in t


def test_c600_uses_a_cited_batter_and_thickness_and_never_invents_one():
    site, ctx = _ctx()
    _uncited(site)
    site.cites.by_key.update({"earthworks.batter.cut_max_slope": _mk("earthworks.batter.cut_max_slope", 2.0),
                              "driveway.pavement.type": _mk("driveway.pavement.type", "bitumen"),
                              "driveway.pavement.wearing_mm": _mk("driveway.pavement.wearing_mm", 150, "mm")})
    j = " ".join(texts(S2.c600(ctx)))
    assert "CUT BATTER 1:2" in j and "WEARING COURSE  T = 150 mm" in j
    assert "FILL BATTER 1:N TBC" in j and "BASE COURSE  T = TBC" in j          # uncited layers stay TBC


def test_c420_and_c200_carry_the_layer_and_batter_details():
    site, ctx = _ctx(with_tin=True)
    t420 = " ".join(texts(S2.c420(ctx)))
    for lab in ("KERB AND GUTTER, LAYOVER SECTION", "DRIVEWAY PAVEMENT SECTION", "PAVEMENT LAYER 1", "SUBGRADE", "ROAD PAVEMENT"):
        assert lab in t420
    assert "TYPICAL DRIVEWAY CUT AND FILL SECTION" in " ".join(texts(S2.c200(ctx)))


def test_details_use_the_reference_hatches():
    site, ctx = _ctx()
    sh = S2.c600(ctx)
    ang_e, _ = SEC.ST.REF.hatch_existing
    ang_p, _ = SEC.ST.REF.hatch_proposed
    angs = {round(it.hatch[0], 2) for v in sh.views for it in v.items if it.kind == "fill" and it.hatch}
    assert round(ang_e, 2) in angs and round(ang_p, 2) in angs
    assert "AR-CONC" in {it.pattern for v in sh.views for it in v.items if it.kind == "fill"}


# ---------------------------------------------------------------------------------------------------------------- real Lot 2, PDF and DXF
@pytest.fixture(scope="module")
def lot2(tmp_path_factory):
    out = tmp_path_factory.mktemp("lot2")
    r = subprocess.run([sys.executable, "scripts/run_site.py", "--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                        "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only", "--planset-style", "ref",
                        "--out", str(out)], cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert (out / "planset.pdf").exists(), r.stdout[-2000:] + r.stderr[-2000:]
    return out


def test_lot2_fits_at_1_to_100_rotated_in_pdf_and_dxf(lot2):
    doc = pymupdf.open(str(lot2 / "planset.pdf"))
    c101 = " ".join(doc[3].get_text().split())
    assert "1:100 @ A1" in c101 and "1:200 @ A3" in c101
    assert "CHOSEN" not in c101                                                      # no step up: rotation made it fit at 1:100
    m = re.search(r"VIEW ROTATED (\d+) DEG (CLOCKWISE|ANTICLOCKWISE)", c101)
    assert m and "NORTH POINT SHOWN" in c101
    deg = int(m.group(1)) * (1 if m.group(2) == "ANTICLOCKWISE" else -1)
    d = ezdxf.readfile(str(lot2 / "planset.dxf"))
    vps = [vp for vp in d.layouts.get("C101").query("VIEWPORT") if abs(vp.dxf.view_twist_angle) > 1e-6]
    assert len(vps) == 1
    vp = vps[0]
    assert abs(((vp.dxf.view_twist_angle - deg + 180) % 360) - 180) < 1.0              # viewport twist = the rotation printed on the sheet
    import app.offline.lot2 as OFF
    mtx = vp.get_transformation_matrix()
    pts = [mtx.transform((x, y, 0.0)) for x, y in OFF.LOT]
    cx, cy = vp.dxf.center.x, vp.dxf.center.y
    hw, hh = vp.dxf.width / 2, vp.dxf.height / 2
    assert all(abs(px - cx) < hw and abs(py - cy) < hh for px, py, _ in pts)           # the lot is inside the viewport
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert (max(xs) - min(xs)) > (max(ys) - min(ys))                                   # long axis lies along the sheet


def test_lot2_c001_names_the_council_and_c100_has_no_spot_levels(lot2):
    doc = pymupdf.open(str(lot2 / "planset.pdf"))
    t = " ".join(doc[1].get_text().split())
    assert "GUNNEDAH SHIRE COUNCIL" in t and "UNRESOLVED, CONFIRM WITH GUNNEDAH SHIRE COUNCIL" in t and "AI-GENERATED" in t
    d = ezdxf.readfile(str(lot2 / "planset.dxf"))
    spots = [e for e in d.layouts.get("C100") if e.dxftype() == "TEXT" and "CONT" not in e.dxf.layer and re.fullmatch(r"\d{3}\.\d+", e.dxf.text)]      # contour labels stay
    assert not spots

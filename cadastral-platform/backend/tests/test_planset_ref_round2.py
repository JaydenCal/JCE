"""Round 2 review fixes, checked on the REAL Lot 2 run (in-process run_site) and on small synthetic cases:

collision audit, outside-view, leader and linework hits on every sheet, readable requirement text (no raw keys or booleans), no building words or
values, platform screening wording, identical view centre on the plan sheets, datum panel inside the strip band, uppercase title block, derived
falls-to-lot note, SA1 truncation flag.
"""
import re
from pathlib import Path

import ezdxf
import pymupdf
import pytest

from app.agents.sa5_cad_dxf.planset import collide
from app.agents.sa5_cad_dxf.planset import generate as G
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset.frame_a1 import notes_layout

ROOT = Path(__file__).resolve().parents[1]
PLAN_SHEETS = ("C100", "C101", "C200", "C300", "C310", "C500")
# linework that text must never cross (boundary, kerb, dimension, detail and batter lines); driveway centrelines and neighbour boundaries are
# deliberate underlay and are not blocking
BLOCKING = ("BNDY", "BNDD", "KERB", "DIMS", "DETL", "EART", "BATR")
STRIP_TOP = 123.0


def _run(out, extra=()):
    from scripts.run_site import build_parser, run_site
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out), *extra])
    run_site(args)
    pdf = next(out.rglob("planset.pdf"))
    dxf = next(out.rglob("planset.dxf"))
    doc = pymupdf.open(pdf)
    pages = [" ".join(p.get_text().split()) for p in doc]
    return SimpleNs(sheets=dict(G.LAST_SHEETS), proj=G.LAST_PROJ, pages=pages, dxf=dxf, out=out)


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    return _run(tmp_path_factory.mktemp("lot2_round2"))


@pytest.fixture(scope="module")
def real_ffl(tmp_path_factory):
    """The same run with a user entered 1% AEP flood level, so a finished floor level (flood level plus freeboard) and a driveway end level exist: the cut and fill section is drawn."""
    return _run(tmp_path_factory.mktemp("lot2_round2_ffl"), ("--flood-level-ahd", "265.5"))


class SimpleNs:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _views(real):
    return [(n, v) for n, sh in real.sheets.items() for v in sh.views]


# ---------------------------------------------------------------------------------------------------------------- collisions on the real run
def test_real_run_has_no_overlapping_text_on_any_view(real):
    for n, v in _views(real):
        assert collide.audit(v) == [], (n, v.name, collide.audit(v)[:4])


def test_real_run_has_no_text_outside_its_view(real):
    for n, v in _views(real):
        assert collide.outside(v) == [], (n, v.name, collide.outside(v)[:4])


def test_real_run_leaders_do_not_cross_text(real):
    for n, v in _views(real):
        assert collide.leader_hits(v) == [], (n, v.name, collide.leader_hits(v)[:4])


def test_real_run_text_does_not_sit_on_blocking_linework(real):
    for n, v in _views(real):
        hits = collide.line_hits(v, BLOCKING)
        assert hits == [], (n, v.name, hits[:5])


def test_c200_section_is_inside_its_frame_with_attached_extension_lines(real_ffl):
    real = real_ffl
    sec = [v for v in real.sheets["C200"].views if v.name == "section"]
    assert len(sec) == 1
    v = sec[0]
    r = v.rect
    for it in v.items:
        if it.kind in ("line", "text") and it.pts and it.layer != "JCS-FRAM-TABL-LINE":
            for x, y in it.pts:
                assert r[0] - 0.01 <= x <= r[2] + 0.01 and r[1] - 0.01 <= y <= r[3] + 0.01, (it.kind, it.layer, x, y)
    ext = [it for it in v.items if it.kind == "line" and "DIMS" in it.layer and len(it.pts) == 2 and abs(it.pts[0][0] - it.pts[1][0]) < 1e-6]
    assert len(ext) >= 2


# ---------------------------------------------------------------------------------------------------------------- sheet text
def test_no_raw_keys_booleans_or_unit_noise_anywhere(real):
    allt = " ".join(real.pages)
    assert not re.search(r"\b[a-z]{2,}\.[a-z_]{2,}(\.[a-z_0-9]+)*\b", allt), re.findall(r"\b[a-z]{2,}\.[a-z_]{2,}(?:\.[a-z_0-9]+)*\b", allt)[:5]
    assert not re.search(r"CITED: [a-z]", allt)
    for bad in (": TRUE", ": FALSE", "(PERCENT)", "RATIO (1 IN N)", "HABITABLE", "GRADE (1 IN)", "MAX_GRADE", "MIN_COVER"):
        assert bad not in allt, bad


def test_c001_items_are_sentences_with_a_short_source(real):
    c001 = real.pages[1]
    assert "STAR PICKETS ARE USUALLY" in c001 and "[ESC GUIDELINES" in c001
    assert not re.search(r":\s*(TRUE|FALSE)\b", c001)


def test_no_building_words_or_values_on_any_sheet_or_in_the_dxf(real):
    pat = re.compile(r"GARAGE|\bFFL\b|FINISHED FLOOR|FOOTPRINT RL|HABITABLE|DWELLING FOOTPRINT|SETBACK 6\.50|GARAGE SETBACK", re.I)
    for i, t in enumerate(real.pages):
        hits = [m.group(0) for m in pat.finditer(t) if not re.search(r"CARPORTS AND GARAGES", t[max(0, m.start() - 14): m.end() + 4])]      # a cited document title is not a drawn value
        assert hits == [], (i, hits)
    d = ezdxf.readfile(real.dxf)
    for lay in d.layouts:
        if lay.name in ("C000", "C001"):                       # cited document titles (CARPORTS AND GARAGES fact sheet) are listed there
            continue
        for e in lay.query("TEXT MTEXT"):
            t = e.dxf.text if e.dxftype() == "TEXT" else e.text
            assert not re.search(r"GARAGE|\bFFL\b|HABITABLE", t, re.I), (lay.name, t)


def test_platform_screening_is_not_presented_as_compliance(real):
    for i in (7, 8):                                   # C400 and C410
        t = real.pages[i]
        assert "NOT A COUNCIL COMPLIANCE CHECK" in t and "PLATFORM SCREENING" in t
        assert not re.search(r"\bPASS(ED)?\b|\bFAIL(ED)?\b|MAX_GRADE|LIMIT 25\.0", t), i
        assert "UNRESOLVED" in t or "COUNCIL MAXIMUM DRIVEWAY GRADE" in t
        assert "NOT EVALUATED" in t or "NOT AVAILABLE" in t              # no driveway end level is supplied or assumed: the checks are said not to have run


def test_scale_reason_text_and_nts_follow_the_actual_scale(real):
    c400, c001 = real.pages[7], real.pages[1]
    m = re.search(r"SO THE SUBJECT FITS AT 1:(\d+)", c400)
    assert m and int(m.group(1)) == 50                  # C400 is drawn at 1:50, so the reason says 1:50, never 1:100
    assert "AS SHOWN" not in c001 and " NTS" in c001
    assert "1:n" not in " ".join(real.pages) and ("T = TBC" in real.pages[11] or "READING CONFIDENCE BELOW 1.0" in real.pages[11])          # C600: TBC legend (no council typicals) or the cited details (stage 8b)


def test_title_block_text_is_uppercase(real):
    assert "LOT 2 DP227508 SITE WORKS" in real.pages[3]          # the project name, never the raw run label
    assert "TEST RUN" not in real.pages[3].upper() and "2//DP227508" not in real.pages[3]


def test_falls_to_lot_note_is_on_c400_and_c410_and_computed_from_the_profile(real):
    for i in (7, 8):
        assert "INDICATIVE PROFILE FALLS TOWARDS THE LOT" in real.pages[i]
        assert "ROAD RUNOFF EXCLUSION TO BE CHECKED BY A QUALIFIED PERSON" in real.pages[i]
    assert re.search(r"\(3\.\d% FROM THE KERB LINE TO THE PROPERTY BOUNDARY\)", real.pages[7])


def _fake_profile(zk, zb):
    return {"st": [(0.0, zk, S2.KERB_STATION), (4.0, zb, S2.BDY_STATION)]}


def test_falls_note_appears_only_when_the_data_falls_towards_the_lot(monkeypatch):
    monkeypatch.setattr(S2, "ref_profile", lambda s: _fake_profile(265.73, 265.59))
    n = S2.falls_to_lot_note(None)
    assert n and "3.5%" in n and "FALLS TOWARDS THE LOT" in n
    monkeypatch.setattr(S2, "ref_profile", lambda s: _fake_profile(265.59, 265.73))      # rising: no note
    assert S2.falls_to_lot_note(None) is None
    monkeypatch.setattr(S2, "ref_profile", lambda s: _fake_profile(265.73, 265.72))      # flat within tolerance: no note
    assert S2.falls_to_lot_note(None) is None
    monkeypatch.setattr(S2, "ref_profile", lambda s: None)
    assert S2.falls_to_lot_note(None) is None


# ---------------------------------------------------------------------------------------------------------------- framing
def test_plan_sheets_overlay_exactly(real):
    ref = None
    for n in PLAN_SHEETS:
        v = real.sheets[n].views[0]
        key = (round(v.centre[0], 6), round(v.centre[1], 6), v.scale, round(v.twist, 6))
        ref = ref or key
        assert key == ref, (n, key, ref)


def test_datum_panel_stays_inside_the_strip_band(real):
    for n, sh in real.sheets.items():
        rect, _ = notes_layout(real.proj, sh.notes, getattr(sh, "tag_notes", ()), min_x0=getattr(sh, "strip_end", 392.0) + 8.0)
        assert rect[3] <= STRIP_TOP + 0.01, (n, rect)
        if n not in ("C000", "C001"):
            assert rect[0] >= getattr(sh, "strip_end", 0.0) - 0.01, (n, rect[0], sh.strip_end)


# ---------------------------------------------------------------------------------------------------------------- SA1 window truncation
def _client(pages):
    import json
    from app.agents.sa1_cadastre.clients import ArcGISClient
    from app.agents.sa1_cadastre.agent import Sa1Config
    layer = Sa1Config().lot_layers["NSW"]
    calls = iter(pages)
    cl = ArcGISClient(fetcher=lambda u, p: (json.dumps(next(calls)).encode(), None), sleep=lambda s: None)
    return cl, layer


def test_sa1_truncation_flag_comes_from_the_last_page_not_the_feature_count():
    n = 1000                                              # exactly 1000 features and the service says nothing more exists: NOT truncated
    cl, layer = _client([{"features": [{}] * n}])
    assert cl.query(layer).truncated is False
    cl, layer = _client([{"features": [{}] * 10, "exceededTransferLimit": True}] * layer_pages())      # still more after the last allowed page
    assert cl.query(layer).truncated is True
    cl, layer = _client([{"features": [{}] * 10, "exceededTransferLimit": True}] + [{"features": [{}] * 3}])      # the last page is short and complete
    assert cl.query(layer).truncated is False


def layer_pages():
    from app.agents.sa1_cadastre.agent import Sa1Config
    return Sa1Config().lot_layers["NSW"].max_pages


def test_dxf_linetype_and_drawn_by_use_the_platform_name(real):
    d = ezdxf.readfile(real.dxf)
    names = {lt.dxf.name for lt in d.linetypes}
    assert "JCS_BDY" in names and "JCE_BDY" not in names
    src = (ROOT / "scripts/run_site.py").read_text()
    assert 'drawn_by="JCE"' not in src

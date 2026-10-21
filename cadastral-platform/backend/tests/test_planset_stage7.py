"""Stage 7: the civil plan set clean-up (C400 call-outs and chainage, C410 fill, C600 detail scale, C420 tag notes panel, C500 ESC panel, one type
scale, legend completeness, register titles).  Real Lot 2 offline run (in-process run_site) plus small synthetic cases."""
import dataclasses
import re
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from shapely.geometry import LineString

from app.agents.sa5_cad_dxf.planset import codes, collide
from app.agents.sa5_cad_dxf.planset import generate as G
from app.agents.sa5_cad_dxf.planset import legend as LG
from app.agents.sa5_cad_dxf.planset import panels as PN
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset.core import View
from app.agents.sa5_cad_dxf.planset.sheets_ref import RefCtx

ROOT = Path(__file__).resolve().parents[1]


def stext(sh) -> str:
    return " ".join(it.text for v in sh.views for it in v.items if it.kind == "text")


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    from scripts.run_site import build_parser, run_site
    out = tmp_path_factory.mktemp("lot2_stage7")
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out)])
    run_site(args)
    sheets = dict(G.LAST_SHEETS)
    return NS(sheets=sheets, site=G.LAST_SITE, proj=G.LAST_PROJ, text={k: stext(v) for k, v in sheets.items()}, out=out)


def _views(real):
    return [(n, v) for n, sh in real.sheets.items() for v in sh.views]


def _flat(t: str) -> str:
    return re.sub(r"\s+", " ", t)


# ============================================================================================================ 1 leaders: no crossings
def test_real_run_no_two_leaders_cross_on_any_view(real):
    for n, v in _views(real):
        assert collide.leader_crossings(v) == [], (n, v.name, collide.leader_crossings(v)[:3])


def test_real_run_no_leader_runs_through_another_call_out_box(real):
    for n, v in _views(real):
        assert collide.leaders_through_boxes(v) == [], (n, v.name, collide.leaders_through_boxes(v)[:3])


def test_leader_crossing_check_catches_a_synthetic_crossing():
    v = View("p", (0, 0, 100, 100))
    v.leaders = [[(0, 0), (50, 50)], [(0, 50), (50, 0)]]
    assert collide.leader_crossings(v) == [(0, 1)]
    v.leaders = [[(0, 0), (20, 20)], [(30, 0), (50, 20)]]
    assert collide.leader_crossings(v) == []
    v.leaders = [[(0, 0), (20, 20)]]
    v.callout_boxes = [(0, 0, 5, 5), (10, 10, 30, 30)]
    assert collide.leaders_through_boxes(v) == [(0, 1)]


# ============================================================================================================ 2 chainage never dropped silently
def test_c400_every_chainage_station_is_labelled_or_listed(real):
    L = real.site.drive_cl.length
    sh = real.sheets["C400"]
    t = _flat(real.text["C400"] + " " + " ".join(sh.notes))
    listed = re.findall(r"CHAINAGE LABEL NOT PLACED \(([^)]*)\)", t)
    listed = listed[0] if listed else ""
    step = 2.0 if re.search(r"\bCH 2\b", t) else 5.0
    for d in S2._chainage_stations(L, step):
        lab = "DRIVEWAY END" if abs(d - L) < 1e-6 else f"CH {d:g}"
        assert lab in t or lab in listed, (lab, step)


def test_c400_unplaceable_chainage_labels_are_listed_on_the_sheet(real, monkeypatch):
    ctx = RefCtx(real.site, real.proj)
    monkeypatch.setattr(S2.ST, "label_masked", lambda *a, **k: False)
    sh = S2.c400(ctx)
    t = _flat(stext(sh) + " " + " ".join(sh.notes))
    assert "CHAINAGE LABEL NOT PLACED" in t and "CH 0" in t


# ============================================================================================================ 3 C410 chart fills the sheet
def test_c410_chart_fills_the_sheet(real):
    sh = real.sheets["C410"]
    chart = [v for v in sh.views if v.name in ("section", "chart", "long")] or [v for v in sh.views if v.paper]
    xs, ys = [], []
    for v in sh.views:
        if v.name.startswith("title"):
            continue
        for it in v.items:
            if it.kind == "line":
                for p in it.pts:
                    xs.append(p[0]); ys.append(p[1])
    assert xs and ys
    assert max(xs) - min(xs) > 0.6 * (594.0 - 20.0)           # the profile spans most of the A1 width
    assert max(ys) - min(ys) > 0.45 * (420.0 - 20.0)          # and no large empty band: the drawing uses more than half of the sheet height
    assert chart is not None


# ============================================================================================================ 4 C420 tag notes
def test_c420_tag_notes_are_a_proper_list_not_wrapped_in_the_datum_panel(real):
    sh = real.sheets["C420"]
    t = _flat(real.text["C420"])
    if sh.tag_notes:                                          # only when no free rectangle fitted
        assert PN.TAG_NOTES_TITLE not in t
    elif "NOTES FOR TAGS" in t:
        assert PN.TAG_NOTES_TITLE in t


def test_tag_notes_panel_places_a_boxed_list_in_free_space():
    v = View("p", (0, 0, 400, 300))
    r = PN.place_notes_panel(v, ["TAG 1: LONG NOTE " * 6, "TAG 2: SHORT NOTE"], avoid=None, w=120.0)
    assert r is not None
    x0, y0, x1, y1 = r
    assert 0 <= x0 < x1 <= 400 and 0 <= y0 < y1 <= 300
    txt = " ".join(it.text for it in v.items if it.kind == "text")
    assert PN.TAG_NOTES_TITLE in txt and "TAG 2" in txt
    assert collide.audit(v) == [] and collide.outside(v) == []


def test_tag_notes_panel_returns_none_when_no_room():
    v = View("p", (0, 0, 60, 40))
    assert PN.place_notes_panel(v, ["A NOTE " * 30], avoid=None, w=120.0) is None


# ============================================================================================================ 5 C500 stockpiles and laydown
def test_c500_draws_the_stockpiles_and_laydown_and_flags_the_unresolved_position(real):
    t = _flat(real.text["C500"])
    for lab in ("SOIL STOCKPILE", "TOPSOIL STOCKPILE", "LAYDOWN"):
        assert lab in t, lab
    assert "POSITION UNRESOLVED" in t
    assert "WHOLE LOT WAS SEARCHED" in t or "NO POSITION OUTSIDE THE BUILDING ENVELOPE" in t


# ============================================================================================================ 6 one type scale
def test_text_heights_are_from_the_type_scale_except_the_cover_and_general_notes(real):
    allowed = {ST.TXT.SMALL, ST.TXT.BODY, ST.TXT.LABEL, ST.TXT.HEAD, ST.TXT.DETAIL_TITLE, 4.8, 5.2}      # 4.8 and 5.2 are the title strip sheet name and number
    stray = {}
    for n, sh in real.sheets.items():
        for v in sh.views:
            for it in v.items:
                if it.kind == "text" and round(it.h, 2) not in {round(a, 2) for a in allowed}:
                    stray.setdefault(n, {}).setdefault(round(it.h, 2), 0)
                    stray[n][round(it.h, 2)] += 1
    for n, hs in stray.items():
        assert min(hs) >= ST.TXT.SMALL - 1e-9, (n, hs)         # nothing below the small size anywhere
    plan = {n: hs for n, hs in stray.items() if n in ("C100", "C101", "C200", "C300", "C310", "C400", "C410", "C420", "C500", "C600")}
    assert not plan, plan                                      # the plan, section and detail sheets use the scale only


# ============================================================================================================ 7 legend covers every symbol
def test_legend_has_an_entry_for_every_symbol_class_used(real):
    names = " ".join(str(e[1]).upper() for e in LG.entries_for(real.site, True))
    for need in ("CENTRELINE", "CALL-OUT", "DIMENSION", "SPOT LEVEL", "NORTH POINT", "SWEPT PATH", "SECTION LINE", "SEDIMENT FENCE"):
        assert need in names, need
    plain = " ".join(str(e[1]).upper() for e in LG.entries_for(real.site, False))
    assert "SWEPT PATH" not in plain                           # a swept path is only in the legend when one is drawn
    assert len(LG.entries_for(None)) < len(LG.entries_for(real.site, True))


def test_c001_legend_text_is_on_the_sheet(real):
    t = _flat(real.text["C001"])
    assert "LEGEND" in t and "CENTRELINE" in t


# ============================================================================================================ 8 titles: strip = title block = register
def test_strip_title_and_register_match_the_sheet_titles_exactly(real):
    reg = _flat(real.text["C000"])
    for n, sh in real.sheets.items():
        title = ST.clean(codes.SHEET_TITLES[n]).upper()
        assert title in _flat(real.text[n]), (n, title)
        if n != "C000":
            assert title in reg, (n, title)


def test_panel_up_keeps_si_unit_symbols_lower_case():
    assert PN.up("3.0 m wide, 5 m DEM, 15 m2") == "3.0 m WIDE, 5 m DEM, 15 m2"
    assert PN.up("model") == "MODEL"

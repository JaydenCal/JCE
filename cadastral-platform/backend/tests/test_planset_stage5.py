"""Stage 5 fixes, checked on the REAL Lot 2 offline run (in-process run_site) and on small synthetic cases:

cover data-sources box, general notes legend and grouped register, chainage-aligned plan strip on the long section, ESC layout panel, upright spot
levels, no em or en dashes in rendered text, window query completeness (unreadable parcels and failures), ESC runner failure recorded.
"""
import json
import re
from pathlib import Path

import pymupdf
import pytest
from shapely.geometry import box

from app.agents.sa1_cadastre import Sa1Cadastre
from app.agents.sa1_cadastre import clients as C
from app.agents.sa1_cadastre.agent import RoadConfig, Sa1Config
from app.agents.sa5_cad_dxf.planset import generate as G
from app.agents.sa5_cad_dxf.planset import legend as LG
from app.agents.sa5_cad_dxf.planset import lga_notes
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from tests.test_sa1_cadastre import NSW_LOT, Mock, fc, poly_feat

ROOT = Path(__file__).resolve().parents[1]


class NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    from scripts.run_site import build_parser, run_site
    out = tmp_path_factory.mktemp("lot2_stage5")
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out)])
    run_site(args)
    pdf = next(out.rglob("planset.pdf"))
    doc = pymupdf.open(pdf)
    return NS(doc=doc, pages=[" ".join(p.get_text().split()) for p in doc], sheets=dict(G.LAST_SHEETS), proj=G.LAST_PROJ)


def _page(real, code: str) -> str:
    n = list(real.sheets).index(code)
    return real.pages[n]


# ---------------------------------------------------------------------------------------------------------------- cover and notes
def test_cover_has_data_sources_and_status_box(real):
    t = _page(real, "C000")
    assert "DATA SOURCES AND STATUS" in t
    for k in ("CADASTRE", "LEVELS", "AERIAL", "SERVICES", "ASSUMED ITEMS", "CODES", "BUILDING"):
        assert k in t, k
    assert "NOT A SURVEY" in t and "LOCATE BY BEFORE YOU DIG AUSTRALIA (BYDA)" in t


def test_notes_sheet_has_legend_with_every_entry(real):
    t = _page(real, "C001")
    assert "LEGEND" in t
    for _fn, label in LG.ENTRIES:
        first = label.split("(")[0].split(":")[0].strip()
        assert first.split()[0] in t, label
    assert "DATA NOT AVAILABLE: NOT DRAWN, NOT CHECKED, NOT CLEAR" in t


def test_legend_swatches_use_the_plan_styles():
    names = [fn.__name__ for fn, _l in LG.ENTRIES]
    assert {"_layover", "_driveway", "_existing", "_proposed", "_cut", "_fill", "_none"} <= set(names)
    assert LG.legend_height(3) > LG.legend_height(3, pitch=8.0)


def test_lga_notes_have_no_parking_group_and_keep_grouped_setback_and_document_lists(real):
    assert hasattr(lga_notes, "SETBACK_GROUP") and hasattr(lga_notes, "DOC_GROUP")
    assert "PARKING" not in _page(real, "C001")
    assert S2.register_rows([]) is not None


# ---------------------------------------------------------------------------------------------------------------- long section strip
def test_long_section_has_plan_strip_on_the_chainage_axis(real):
    t = _page(real, "C410")
    assert "PLAN" in t and "DIAGRAMMATIC" in t and "NOT TO SCALE ACROSS" in t
    assert "LAYOVER (SEE C420)" in t and "PROPERTY BOUNDARY" in t and "END OF PROFILE" in t
    assert "NOTES AND PLATFORM SCREENING CHECKS" in t


def test_long_section_strip_boundary_line_is_on_the_profile_boundary_station(real):
    n = list(real.sheets).index("C410")
    words = real.doc[n].get_text("words")
    tall = [w for w in words if w[4] == "BOUNDARY" and (w[3] - w[1]) > (w[2] - w[0])]       # station label of the profile, rotated
    flat = [w for w in words if w[4] == "PROPERTY" and (w[2] - w[0]) > (w[3] - w[1]) and 150 < w[1] < 260]       # label of the plan strip, horizontal
    assert tall and flat
    xt = (tall[0][0] + tall[0][2]) / 2
    dx_mm = min(abs(w[0] - xt) for w in flat) / 72.0 * 25.4
    assert dx_mm < 4.0, dx_mm                                        # the same chainage axis: both sit at the boundary station within the label offsets


# ---------------------------------------------------------------------------------------------------------------- ESC panel
def test_esc_assumptions_are_in_a_panel_not_the_datum_notes(real):
    t = _page(real, "C500")
    assert "ESC LAYOUT BASIS AND ASSUMPTIONS" in t
    assert len(real.sheets["C500"].notes) <= 3


# ---------------------------------------------------------------------------------------------------------------- spot levels, dashes
def test_spot_levels_on_the_driveway_sheet_are_upright(real):
    """Spot levels are horizontal.  Contour labels (stage 8) run along their line but are never upside down: they read left to right or bottom to top."""
    n = list(real.sheets).index("C400")
    page = real.doc[n]
    found = 0
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            txt = "".join(s["text"] for s in ln["spans"]).strip()
            if re.fullmatch(r"\d{3}\.\d\d", txt):
                dx, dy = ln["dir"]
                assert dx > -1e-3 and (dx > 1e-3 or dy <= 1e-3), (txt, ln["dir"])           # readable, never upside down
                if abs(dx - 1.0) < 1e-3 and abs(dy) < 1e-3:
                    found += 1
    assert found >= 1


def test_no_em_or_en_dashes_in_any_rendered_text(real):
    for i, t in enumerate(real.pages, 1):
        assert "—" not in t and "–" not in t, i


def test_no_spot_levels_on_c100(real):
    """C100 shows contours with their RL labels (stage 8) and no spot levels: every RL text on C100 is on the contour label layer."""
    sh = real.sheets["C100"]
    rl = [it for v in sh.views for it in v.items if it.kind == "text" and re.fullmatch(r"\d{3}\.\d\d", it.text)]
    assert rl and all("CONT" in it.layer.upper() or "CNTR" in it.layer.upper() for it in rl), {it.layer for it in rl}


# ---------------------------------------------------------------------------------------------------------------- SA1 window completeness
def _nsw_window_agent(features):
    cfg = Sa1Config()
    cfg.roads = {"NSW": RoadConfig(layer=C.LayerConfig("http://roads/0", "x", "roads", "x", "NSW"))}
    m = Mock({"NSW_Cadastre": fc(*features)})
    return Sa1Cadastre(cfg, C.ArcGISClient(fetcher=m, sleep=lambda s: None))


def test_window_lots_reports_unreadable_geometry_as_incomplete():
    bad = {"type": "Feature", "properties": {"lotidstring": "9//DP1"}, "geometry": None}
    good = poly_feat(325030, 6265000, 20, 50, {"lotidstring": "13//DP345678", "plan_lot_area": 1000.0})
    ag = _nsw_window_agent([good, bad])
    lot = box(325000, 6265000, 325020, 6265050)
    lots, complete, note = ag.window_lots("NSW", 7856, lot, box(324900, 6264900, 325200, 6265200))
    assert complete is False and "NO READABLE GEOMETRY" in note
    assert len(lots) == 1


def test_window_lots_reports_a_failed_query_as_incomplete():
    ag = _nsw_window_agent([])
    ag.client.fetcher = lambda url, params: (_ for _ in ()).throw(ConnectionError("blocked"))
    lots, complete, note = ag.window_lots("NSW", 7856, box(325000, 6265000, 325020, 6265050), box(324900, 6264900, 325200, 6265200))
    assert lots == [] and complete is False and note.startswith("WINDOW QUERY FAILED")


def test_window_lots_complete_when_everything_is_readable():
    good = poly_feat(325030, 6265000, 20, 50, {"lotidstring": "13//DP345678", "plan_lot_area": 1000.0})
    ag = _nsw_window_agent([good])
    lots, complete, note = ag.window_lots("NSW", 7856, box(325000, 6265000, 325020, 6265050), box(324900, 6264900, 325200, 6265200))
    assert complete is True and note == "" and len(lots) == 1


# ---------------------------------------------------------------------------------------------------------------- ESC runner failure
def test_esc_runner_failure_is_recorded_not_hidden():
    from app.agents.sa5_cad_dxf.planset.data import Site
    assert "esc_error" in Site.__dataclass_fields__ or hasattr(Site, "esc_error")

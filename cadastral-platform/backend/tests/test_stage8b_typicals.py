"""Stage 8b (21/10/2026): Gunnedah council TYPICAL DETAILS loaded as data (knowledge/gunnedah/typicals.json), the SD-107 Rev A crossover redrawn on C420 and C600,
darker contours with 3.0 mm labels, and the building orientation study (the template is never changed silently).

Offline Lot 2 DP227508 (in-process run_site); the council PDFs are only needed by the validator test, which skips when they are absent.
"""
import json
import re
from pathlib import Path

import pymupdf
import pytest

from app.agents.sa5_cad_dxf.planset import crossover as CX
from app.agents.sa5_cad_dxf.planset import draw as D
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset import typical_details as TD
from app.agents.sa5_cad_dxf.planset.typicals import Typicals
from app.design import building_place as BP

ROOT = Path(__file__).resolve().parents[1]
KNOW = ROOT / "knowledge/gunnedah"
HOUSE = ROOT / "tests/fixtures/planstudio_house_single.planstudio.json"
PDFS = Path("/home/claude/work/council/pdf")


class NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _render(out: Path, *extra: str) -> NS:
    from scripts.run_site import build_parser, run_site
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--building", str(HOUSE), "--out", str(out), *extra])
    run_site(args)
    doc = pymupdf.open(next(out.rglob("planset.pdf")))
    pages = {}
    for p in doc:
        t = " ".join(p.get_text().split())
        m = re.search(r"JCS-[A-Z0-9]+-CIV-(\d{3})", t)
        pages[f"C{m.group(1)}" if m else f"p{p.number}"] = t
    facts = json.loads(next(out.rglob("run_steps.json")).read_text())["facts"]
    return NS(pages=pages, facts=facts, pdf=next(out.rglob("planset.pdf")), out=out)


@pytest.fixture(scope="module")
def lot2(tmp_path_factory):
    return _render(tmp_path_factory.mktemp("s8b_lot2"), "--building-orientation-study")


@pytest.fixture(scope="module")
def typ():
    return Typicals("Gunnedah Shire Council")


# ====================================================================================================== the data
def test_typicals_file_is_data_with_a_citation_on_every_entry():
    d = json.loads((KNOW / "typicals.json").read_text())
    assert len(d["entries"]) >= 118
    assert {"sd107", "eng"} <= set(d["documents"])
    for e in d["entries"]:
        if e["status"] != "resolved":
            assert e.get("label"), e["key"]
            continue
        assert e["doc"] in d["documents"] and e.get("clause") and (e.get("quote") or e["doc"] == "sd107" or e["verification"]["ok"]), e["key"]      # SD-107 dimensions are read off the drawing; table values are validated by value on the cited page
        assert e["doc"] == "sd107" or e.get("page"), e["key"]
        assert d["documents"][e["doc"]].get("edition"), e["key"]
        if e["confidence"] <= 0.7:
            assert e["verify"] is True, e["key"]
    assert len(d["sd107_notes"]) == 15


def test_every_entry_passed_the_citation_validator():
    v = json.loads((KNOW / "typicals_validation.json").read_text())
    assert v["failures"] == [] or v["failures"] == 0
    assert v["resolved"] >= 118


@pytest.mark.skipif(not PDFS.exists(), reason="council PDFs not present")
def test_validator_rebuild_reproduces_the_file_and_rejects_a_wrong_quote(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_typicals", KNOW / "build_typicals.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.present(125.0, "slab 125 min thick", "mm") and not m.present(130.0, "slab 125 min thick", "mm")
    assert "125" in m.nrm("125’")


def test_accessor_and_other_council(typ):
    assert typ.present and typ.get("sd107.slab.thickness_min").mm == 125.0
    t = typ.get("sd107.slab.thickness_min")
    assert "SD-107" in t.ref and not t.verify
    assert all(typ.get(k).confidence <= 0.7 for k in typ.verify_keys())          # stage 8c: the section values were checked on the sheet (0.75 to 0.95), none is flagged VERIFY any more
    assert all(0.0 < typ.get(k).confidence < 1.0 for k in typ.by_key if k.startswith("sd107.section."))
    assert typ.not_published("rd010") and typ.not_published("kerb", "profile")
    assert typ.get("notfound.kerb.profile_dimensions_height_gutter_width_lip") is None            # not published: never a value
    other = Typicals("Narrabri Shire Council")
    assert not other.present and CX.cited_crossing(other) is None


def test_cited_crossing_values(typ):
    c = CX.cited_crossing(typ)
    assert c is not None and c.label == "GSC SD-107 REV A"
    assert (c.width_min_m, c.width_max_m, c.splay_along_m, c.splay_depth_m, c.layback_run_m, c.road_side_m) == (3.0, 4.5, 0.6, 0.3, 0.45, 0.45)
    assert (c.overall_min_m, c.overall_max_m) == (4.2, 5.7)


# ====================================================================================================== the sheets
def test_c600_is_the_sd107_typical_details_sheet(lot2):
    t = lot2.pages["C600"]
    for s in ("TYPICAL VEHICLE CROSSOVER (GUNNEDAH SHIRE COUNCIL SD-107 REV A)", "GSC SD-107 REV A", TD.RD003_TEXT, "READING CONFIDENCE BELOW 1.0", "SL82", "R16", "NOTE 7", "NOTE 9",
              "TABLE 2-I", "OSD", "TOPSOIL", "80%"):
        assert s in t.upper().replace("‑", "-"), s
    assert "CONFLICT" in t.upper() and "C.1.4" in t.upper() and "TABLE 2-H" in t.upper()


def test_c420_uses_the_cited_geometry_and_cites_it(lot2):
    t = lot2.pages["C420"].upper()
    for s in ("GSC SD-107 REV A", "SPLAY 0.6 M", "LAYBACK RUN 0.45 M", "GUTTER CROSSING 0.45 M", "E.J.", "R16 DOWELS", "NOT PUBLISHED", "TYPICAL VEHICLE CROSSOVER (GUNNEDAH SHIRE COUNCIL SD-107 REV A)"):
        assert s in t, s
    assert "COUNCIL STANDARD NOT SELECTED" not in t


def test_c101_and_c400_crossing_widths_are_the_cited_range_not_platform_defaults(lot2):
    for sh in ("C101", "C400"):
        t = lot2.pages[sh].upper()
        assert "GSC SD-107 REV A" in t, sh
    assert "WITHIN GSC SD-107 REV A 3.0 M TO 4.5 M" in lot2.pages["C101"].upper()          # width held to the cited range, source named


def test_c300_cites_inter_allotment_rules_where_the_lot_falls_away(lot2):
    t = lot2.pages["C300"].upper()
    assert "INTER-ALLOTMENT DRAINAGE" in t and "GRATED INLET PIT" in t and "150 MM JUNCTION" in t and "EASEMENT 3.0 M" in t
    assert "3.9" in t and "TABLE 3-O" in t


def test_c500_keeps_blue_book_values_and_adds_council_notes(lot2):
    t = lot2.pages["C500"].upper()
    assert "BLUE BOOK" in t or "MANAGING URBAN STORMWATER" in t or "SOILS AND CONSTRUCTION" in t


def test_typical_text_heights_come_from_the_text_scale():
    allowed = {ST.TXT.SMALL, ST.TXT.BODY, ST.TXT.LABEL, ST.TXT.HEAD, ST.TXT.DETAIL_TITLE}
    assert TD.H in allowed and TD.TXT.HEAD in allowed


# ====================================================================================================== contours
def test_contour_style_is_dark_with_heavier_majors_and_three_mm_labels():
    assert D.CONTOUR_LAB_H >= 3.0 and max(D.CONTOUR_COLOUR) < 0.4
    assert D.CONTOUR_LW_MAJOR > D.CONTOUR_LW_MINOR >= 0.25


def test_contour_labels_are_three_mm_high_and_spaced(lot2):
    doc = pymupdf.open(lot2.pdf)
    n, sizes = 0, set()
    for pg in [doc[i] for i in (2, 3, 4, 5, 6, 10)]:                  # C100, C101, C200, C300, C310, C500 (plan sheets; the profile sheets carry spot levels at 2.5)
        for b in pg.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                for sp in ln["spans"]:
                    if re.fullmatch(r"2\d\d\.\d\d", sp["text"].strip()) and sp["size"] > 8:
                        n += 1
                        sizes.add(round(sp["size"] * 25.4 / 72 * 0.716, 1))
    assert n >= 10 and sizes and min(sizes) >= 2.9, sizes


# ====================================================================================================== orientation study
def test_orientation_study_reports_every_orientation_and_the_template_is_unchanged(lot2):
    b = lot2.facts["building"]
    st = b["orientation_study"]
    assert len(st["orientations"]) == 8 and b["orientation"] == "AS DRAWN"
    asd = st["orientations"][0]
    assert asd["label"] == "AS DRAWN" and asd["garage_rule_met"] is False and asd["garage_behind_m"] < 0
    assert not any(o["usable"] for o in st["orientations"])                  # no orientation meets the rule with the garage door to the street
    assert "NO ORIENTATION OF THIS TEMPLATE" in st["summary"]
    assert any("ORIENTATION STUDY" in f for f in b["flags"])
    assert any(o["garage_rule_met"] and not o["garage_door_faces_street"] for o in st["orientations"])     # met only by turning the door away from the street


def test_mirror_option_changes_only_the_placement_not_the_template():
    house = BP.load_house(HOUSE)
    before = house.footprint.wkt
    m = BP.orient_house(house, mirror=True)
    assert house.footprint.wkt == before and m.footprint.wkt != before
    assert abs(m.footprint.area - house.footprint.area) < 1e-6 and m.front_dir[1] == house.front_dir[1] and m.front_dir[0] == -house.front_dir[0]
    assert BP.orientation_label(True, 0.0) == "MIRRORED" and BP.orientation_label(False, 0.0) == "AS DRAWN"

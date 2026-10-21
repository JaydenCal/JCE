"""Stage 8c: fixes from the review of stages 8 and 8b (design vehicle, SD-107 section, citation clipping, units, dates, wording).  Unit level, no pipeline run."""
import re

from app.agents.sa3_driveway.profile import check_profile, vehicle_template
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.typicals import Typicals, clip_clause, refs_short

GUN = "Gunnedah Shire Council"


def test_design_vehicle_is_read_from_the_council_typicals_and_falls_back_to_none():
    dv = Typicals(GUN).design_vehicle()
    assert dv is not None and dv[0] == "B99" and "2.8.7" in dv[1].ref and "p.44" in dv[1].ref
    assert Typicals("Nowhere Council").design_vehicle() is None              # the caller then keeps B85 as a labelled PLATFORM DEFAULT


def test_b99_template_differs_from_b85_and_the_check_names_the_vehicle():
    t99, n99 = vehicle_template("B99")
    t85, n85 = vehicle_template("B85")
    assert n99 == "B99" and n85 == "B85" and t99 != t85
    st = [(0.0, 100.0, "kerb"), (0.45, 100.10, "layback"), (4.0, 100.17, "boundary"), (10.0, 99.9, "end")]
    c99 = [c for c in check_profile(st, vehicle="B99") if c.name == "b85_scraping_clearance"][0]
    c85 = [c for c in check_profile(st, vehicle="B85") if c.name == "b85_scraping_clearance"][0]
    assert c99.note.startswith("B99") and c85.note.startswith("B85") and c99.value != c85.value


def test_b99_can_change_a_scraping_result_only_when_the_margin_is_marginal():
    # a profile whose B85 margin is a few millimetres positive: B99 (longer wheelbase and overhang) turns it negative
    flips = 0
    for g1 in (0.08,):
        for g2 in (-0.06,):
            st = [(0.0, 100.0, "kerb"), (0.45, 100.10, "layback"), (4.0, 100.10 + g1 * 3.55, "boundary"), (10.0, 100.10 + g1 * 3.55 + g2 * 6.0, "end")]
            a = [c for c in check_profile(st, vehicle="B85") if c.name == "b85_scraping_clearance"][0]
            b = [c for c in check_profile(st, vehicle="B99") if c.name == "b85_scraping_clearance"][0]
            flips += a.passed != b.passed
            assert abs(a.value - b.value) < 0.02
    assert flips == 1


def test_clip_clause_never_leaves_an_open_bracket_or_a_dangling_connector():
    assert clip_clause("2.8.7 Vehicular crossings and accesses") == "2.8.7 Vehicular crossings"
    assert clip_clause("SD-107 section (nominal kerb line to expansion joint at back of layback)") == "SD-107 section"
    assert clip_clause("3.10.6.1") == "3.10.6.1" and clip_clause("C.1.4(b)") == "C.1.4(b)"
    for c in ("2.8.7 Vehicular crossings and accesses", "SD-107 section (nominal kerb line to the back)", "Table 2-I, Allotment filling and more words here"):
        r = clip_clause(c)
        assert r.count("(") == r.count(")") and not re.search(r"\b(and|or|of|to|the|for)$", r, re.I)


def test_every_short_reference_of_the_typicals_is_clean():
    T = Typicals(GUN)
    for t in list(T.by_key.values()):
        r = t.ref_short
        assert r.count("(") == r.count(")"), r
        assert not re.search(r"\b(and|or|of|to|the|for),", r, re.I), r
        assert "(DCP 2025" not in r, r


def test_refs_short_names_a_document_once():
    T = Typicals(GUN)
    a, b = T.get("eng.inter_allotment.min_pipe_diameter"), T.get("eng.inter_allotment.easement_width")
    r = refs_short([a, b])
    assert r.count("GSC ENGINEERING STANDARDS V1 (APR 2025)") == 1 and ";" in r
    assert refs_short([a, a]) == a.ref_short


def test_sd107_section_dimensions_are_in_the_data():
    T = Typicals(GUN)
    assert T.get("sd107.section.flowline_radius") is not None
    assert T.mm("sd107.section.slab_thickness_at_road_side_edge_of_gutter_crossing") == 190
    assert T.mm("sd107.section.gutter_crossing_fall_edge_to_flowline") == 40
    assert T.mm("sd107.section.layback_top_above_road_side_edge") == 60
    assert T.mm("sd107.layback.run_behind_nominal_kerb_line") == 450
    d = T.get("sd107.section.layback_rise_flowline_to_back_derived")
    assert d is not None and "60 mm rise over 450 mm run" in " ".join([str(d.description), str(d.value)] + list(d.quote))


def test_units_symbols_and_casing():
    assert fonts.units("25 MPA 2 L/S/HA 956 m2 3 m3 5 KPA") == "25 MPa 2 L/s/ha 956 m² 3 m³ 5 kPa"
    assert fonts.units("25 MPa") == "25 MPa"


def test_long_dates_are_written_dd_mm_yyyy_in_the_report_text():
    from app.report import fmt
    assert fmt.clean("Last updated 15 August 2023 and adopted 18 June 2025") == "Last updated 15/08/2023 and adopted 18/06/2025"


def test_dcp_edition_is_the_adoption_date():
    T = Typicals(GUN)
    assert T.docs["dcp"]["edition"] == "adopted 18/06/2025"


def test_stage8c_text_has_no_ai_statement_in_the_soee_method():
    from app.pack import soee_site as S
    assert not re.search(r"\bAI\b|language model|extracted by", S.METHOD_TEXT, re.I)


def test_soee_design_vehicle_sentence_cites_the_council_or_says_platform_default():
    from app.pack import soee_site as S
    a = S._veh_sentence({"design_vehicle": "B99", "design_vehicle_source": "Gunnedah Shire Council Engineering Design Minimum Standards (Version 1, April 2025), 2.8.7, p.44"})
    assert "required by the council" in a and "Minimum Standards (Version 1, April 2025)" in a and a.count("(") == a.count(")")
    b = S._veh_sentence({"design_vehicle": "B85"})
    assert "platform default" in b and "required by the council" not in b

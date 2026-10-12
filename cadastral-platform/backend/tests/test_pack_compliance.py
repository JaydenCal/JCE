"""Compliance table: citations, numeric-only PASS/FAIL, unresolved handling, real Gunnedah outputs."""
import json
from pathlib import Path

import pytest

from app.agents.sa11_pathway import assess_pathway
from app.agents.sa11_pathway.models import Status
from app.flood.levels import FloodCheck
from app.pack.compliance import ProposalFacts, build_compliance_table, load_requirements
from app.pack.samples import ROOT, pathway_for_run

RUNS = ROOT


def rep(run):
    p = RUNS / run / "constraints_report.json"
    if not p.exists():
        pytest.skip("test-run outputs not present")
    return json.loads(p.read_text())


def r2(**kw):
    base = dict(dev_type="dwelling_house", zone="R2", lga="Gunnedah", lot_area_m2=955.8)
    base.update(kw)
    return ProposalFacts(**base)


def test_setback_rows_pass_fail_with_exact_quote():
    t = build_compliance_table(r2(setbacks_m={"front": 7.0, "side": 0.5, "rear": 3.0}), "da")
    side, front, rear = t.row("Setback: side"), t.row("Setback: front (primary frontage)"), t.row("Setback: rear")
    assert front.status == Status.PASS and front.required_value == 6.5
    assert side.status == Status.FAIL and side.required_value == 0.9 and "TO BE COMPLETED" in side.variation_note
    assert rear.status == Status.PASS
    assert front.citation.page == 37 and "6.5m" in front.citation.quote and front.citation.sha256 and "Development Control Plan" in front.citation.document_title


def test_front_setback_below_6_5_is_unresolved_until_neighbour_average_given():
    t = build_compliance_table(r2(setbacks_m={"front": 5.0}), "da")
    assert t.row("Setback: front (primary frontage)").status == Status.UNRESOLVED
    t = build_compliance_table(r2(setbacks_m={"front": 5.0}, neighbour_avg_front_m=4.8), "da")
    row = t.row("Setback: front (primary frontage)")
    assert row.status == Status.PASS and row.required_value == 4.8
    t = build_compliance_table(r2(setbacks_m={"front": 4.0}, neighbour_avg_front_m=4.8), "da")
    assert t.row("Setback: front (primary frontage)").status == Status.FAIL


def test_no_value_means_unresolved_never_pass():
    t = build_compliance_table(r2(), "da")
    for r in t.rows:
        assert r.status != Status.PASS, r.control
    assert t.row("Setback: side").status == Status.UNRESOLVED
    assert t.row("Setback: side").required_value == 0.9          # requirement known, proposal not


def test_boolean_requirements_never_auto_pass():
    t = build_compliance_table(r2(stormwater_strategy="to street", basix_certificate_ref="BX-123"), "da")
    assert t.row("Stormwater / on-site detention").status == Status.UNRESOLVED
    assert t.row("BASIX certificate").status == Status.UNRESOLVED and t.row("BASIX certificate").proposed_value == "BX-123"


def test_parking_and_driveway_numeric():
    t = build_compliance_table(r2(parking_spaces=1, crossover_width_m=5.0, crossover_corner_separation_m=7.0), "da")
    assert t.row("Car parking").status == Status.FAIL and t.row("Car parking").required_value == 2
    assert t.row("Driveway / crossover width").status == Status.FAIL
    assert t.row("Crossover separation from corner/intersection").status == Status.PASS
    assert t.row("Driveway maximum grade").status == Status.UNRESOLVED       # no cited grade limit in the Gunnedah documents


def test_flood_row_from_flood_check_and_from_sa9():
    chk = FloodCheck(result="FAIL", min_ffl=100.5, flood_level_ahd=100.0, freeboard_m=0.5, proposed_ffl=100.2, event="1% AEP")
    t = build_compliance_table(r2(flood=chk), "da")
    row = t.row("Flood: habitable floor level")
    assert row.status == Status.FAIL and row.required_value == 100.5 and row.proposed_value == 100.2
    assert row.citation and "Floor levels of habitable rooms" in row.citation.quote
    t = build_compliance_table(r2(flood_affected=False), "da")
    assert t.row("Flood: habitable floor level").status == Status.NOT_APPLICABLE
    t = build_compliance_table(r2(), "da")
    assert t.row("Flood: habitable floor level").status == Status.UNRESOLVED


def test_secondary_dwelling_rows():
    f = ProposalFacts(dev_type="secondary_dwelling", zone="R2", lga="Gunnedah", lot_area_m2=700, floor_area_m2=55, principal_floor_area_m2=150,
                      private_open_space_m2=20, private_open_space_depth_m=3.5, setbacks_m={"front": 7, "side": 1, "rear": 4})
    t = build_compliance_table(f, "da")
    fa = t.row("Secondary dwelling floor area")
    assert fa.status == Status.PASS and fa.required_value == 60
    assert t.row("Private open space").status == Status.PASS and t.row("Private open space minimum depth").status == Status.PASS
    f2 = f.model_copy(update={"floor_area_m2": 70, "principal_floor_area_m2": 300})        # 25% of 300 = 75 allowed
    assert build_compliance_table(f2, "da").row("Secondary dwelling floor area").status == Status.PASS
    f3 = f.model_copy(update={"floor_area_m2": 70, "principal_floor_area_m2": 100})
    assert build_compliance_table(f3, "da").row("Secondary dwelling floor area").status == Status.FAIL


def test_shed_rows_r2_and_ru1():
    f = ProposalFacts(dev_type="shed", zone="R2", lga="Gunnedah", lot_area_m2=956, building_height_m=5.0, outbuilding_cumulative_area_m2=90, setbacks_m={"front": 6})
    t = build_compliance_table(f, "da")
    assert t.row("Building height").status == Status.FAIL and t.row("Building height").required_value == 4.8
    assert t.row("Outbuilding cumulative area").status == Status.PASS and t.row("Outbuilding cumulative area").required_value == 100
    assert t.row("Setback: side").status == Status.UNRESOLVED                           # DCP gives no R2 outbuilding side/rear value
    f = ProposalFacts(dev_type="shed", zone="RU1", lga="Gunnedah", lot_area_m2=509264, building_height_m=5.0, setbacks_m={"front": 30, "side": 12, "rear": 12})
    t = build_compliance_table(f, "da")
    assert t.row("Setback: front (primary frontage)").required_value == 25 and t.row("Setback: front (primary frontage)").status == Status.PASS
    assert t.row("Outbuilding cumulative area").status == Status.UNRESOLVED


def test_cdc_table_uses_code_rows_with_citations():
    inp = dict(dev_type="dwelling_house", zone="R2", lga="Gunnedah", lot_area_m2=956)
    f = r2(building_height_m=9.0, gfa_m2=300)
    from app.agents.sa11_pathway import make_input
    pr = assess_pathway(make_input("dwelling_house", None, lga="Gunnedah", zone="R2", lot_area_m2=956, building_height_m=9.0, gfa_m2=300, lot_type="standard"))
    t = build_compliance_table(f, "cdc", pathway_result=pr)
    h = t.row("Maximum building height 8.5 m")
    assert h.status == Status.FAIL and h.citation.page == 2 and "8.5m" in h.citation.quote
    g = t.row("Maximum gross floor area (by lot area)")
    assert g.status == Status.PASS and round(g.required_value) == 389
    assert any(r.control == "Bushfire" for r in t.rows)


def test_real_lot2_dwelling_fsr_from_sa9_layer():
    report = rep("lot2_dwelling")
    t = build_compliance_table(ProposalFacts(dev_type="dwelling_house", zone="R2", lga="Gunnedah", lot_area_m2=955.827, gfa_m2=400, constraints=report,
                                             bushfire_prone=True, flood_affected=False), "da")
    fsr = t.row("Floor space ratio")
    assert fsr.required_value == 0.5 and fsr.status == Status.PASS and "0.5" in fsr.citation.quote and fsr.citation.sha256
    assert t.row("Bushfire").status == Status.UNRESOLVED
    assert t.row("Flood: habitable floor level").status == Status.NOT_APPLICABLE
    assert t.counts()["PASS"] >= 1 and all(r.status != Status.PASS or r.required_value is not None for r in t.rows)


def test_real_quia_granny_rows_have_citations():
    report = rep("quia_granny")
    t = build_compliance_table(ProposalFacts(dev_type="secondary_dwelling", zone="RU1", lga="Gunnedah", lot_area_m2=509264.46, constraints=report), "da")
    front = t.row("Setback: front (primary frontage)")
    assert front.required_value == 25 and front.status == Status.UNRESOLVED and "Table 6" in front.citation.section_ref or front.citation.page
    assert t.row("Floor space ratio").status == Status.UNRESOLVED
    for r in t.rows:
        if r.required_value is not None:
            assert r.citation is not None and r.citation.quote, r.control


def test_requirements_load():
    assert len(load_requirements().requirements) >= 100

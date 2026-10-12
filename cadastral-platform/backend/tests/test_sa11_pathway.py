"""SA11 approval pathway: rule-set integrity, synthetic cases and the real Gunnedah test-run outputs."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.agents.requirements.models import Source
from app.agents.sa11_pathway import (DevType, PathwayInput, PathwayStatus, Pill, RuleSet, Status, assess_pathway, default_ruleset, make_input)
from app.agents.sa11_pathway.rules import Rule

BACKEND = Path(__file__).resolve().parents[1]
RUNS = BACKEND.parent / "test-runs"
KN = BACKEND / "knowledge" / "pathway"

ALL_FALSE = dict(heritage_conservation_area=False, land_reserved_public_purpose=False, acid_sulfate_class_1_or_2=False, buffer_area=False, riverfront_area=False,
                 ecologically_sensitive_area=False, protected_area=False, coastal_hazard=False, foreshore_area=False, anef_25_or_higher=False,
                 unsewered_drinking_water_catchment=False, special_area=False, environmentally_sensitive_area=False, state_heritage_item=False,
                 heritage_item=False, critical_habitat_or_wilderness=False, flood_control_lot=False, easements_present=False, bushfire_prone=False)


def dwelling(**kw):
    base = dict(dev_type=DevType.DWELLING_HOUSE, lga="Gunnedah", zone="R2", lot_area_m2=956, lot_width_m=20, lot_type="standard", storeys=2, building_height_m=8.0,
                gfa_m2=380, setback_primary_m=4.5, setback_side_m=1.5, wall_height_side_m=3.0, setback_rear_m=5.0, wall_height_rear_m=3.0, parking_spaces=2,
                existing_dwelling_houses_on_lot=0, lep_permissibility="permitted_with_consent", **ALL_FALSE)
    base.update(kw)
    return PathwayInput(**base)


# ---------------------------------------------------------------- rule set integrity
def test_every_resolved_rule_has_full_citation():
    rs = default_ruleset()
    resolved = [r for r in rs.rules if r.status == "resolved"]
    assert len(resolved) >= 50
    for r in resolved:
        c = r.citation
        assert c.quote and c.sha256 and c.document_title and c.page and c.source_url is not None, r.id
    for r in rs.rules:
        if r.status == "unresolved":
            assert r.prompt and r.citation is None


def test_resolved_rule_without_citation_is_rejected():
    with pytest.raises(ValueError):
        Rule(id="x", code="c", pathway="cdc", label="l", category="standard", dev_types=["shed"], status="resolved")


@pytest.mark.skipif(not shutil.which("pdftotext") or not (KN / "raw").exists(), reason="raw documents not downloaded")
def test_quotes_exist_on_cited_pages():
    from app.agents.sa2_dcp_rag.extract import norm
    rs = default_ruleset()
    checked = 0
    for r in rs.rules:
        c = r.citation
        if not c or not c.source_url:
            continue
        files = {Path(p).name: p for p in (KN / "raw").glob("*.pdf")}
        for f in files.values():
            pass
        # locate by sha256 against sources.json
        src = next((s for s in json.loads((KN / "sources.json").read_text())["sources"] if s["sha256"] == c.sha256), None)
        if not src or not src["file"].endswith(".pdf"):
            continue
        txt = subprocess.run(["pdftotext", "-f", str(c.page), "-l", str(c.page), "-layout", str(KN / "raw" / src["file"]), "-"], capture_output=True, text=True).stdout
        txt2 = subprocess.run(["pdftotext", "-f", str(c.page), "-l", str(c.page), str(KN / "raw" / src["file"]), "-"], capture_output=True, text=True).stdout
        assert norm(c.quote) in norm(txt) or norm(c.quote) in norm(txt2), r.id
        checked += 1
    assert checked > 20


def test_inland_lga_list():
    rs = default_ruleset()
    assert len(rs.inland_lgas) == 69 and rs.is_inland("Gunnedah") and rs.is_inland("Gunnedah Shire Council") and rs.is_inland("Sydney") is False
    assert rs.is_inland(None) is None
    assert "30 Gunnedah" in rs.inland_citation.quote


# ---------------------------------------------------------------- synthetic
def test_dwelling_all_criteria_met_is_eligible_but_only_recommends_verification():
    r = assess_pathway(dwelling())
    cdc = r.card("cdc")
    assert cdc.status == PathwayStatus.ELIGIBLE and cdc.pill == Pill.POSSIBLE
    assert r.card("exempt").pill == Pill.NOT_APPLICABLE
    assert r.card("da").pill == Pill.POSSIBLE
    assert r.suggested_pathway == "cdc"
    assert "verify with council or a certifier" in r.summary
    assert "approved" not in r.summary.lower().replace("not an approval", "")


def test_height_fail_reports_failing_criterion_with_citation():
    r = assess_pathway(dwelling(building_height_m=9.0))
    cdc = r.card("cdc")
    assert cdc.status == PathwayStatus.NOT_ELIGIBLE and cdc.pill == Pill.NOT_APPLICABLE
    f = cdc.failing
    assert f.rule_id == "inland.res.height" and f.required_value == 8.5 and f.proposed_value == 9.0
    assert "8.5m" in f.citation.quote and f.citation.page == 2 and f.citation.sha256
    assert r.card("da").pill == Pill.REQUIRED          # exempt N/A and CDC not eligible
    assert r.suggested_pathway == "da"


def test_gfa_band_formula_and_boundaries():
    ok = assess_pathway(dwelling(lot_area_m2=956, gfa_m2=25 / 100 * 956 + 150))      # exactly on the limit
    assert ok.card("cdc").status == PathwayStatus.ELIGIBLE
    bad = assess_pathway(dwelling(lot_area_m2=956, gfa_m2=25 / 100 * 956 + 150 + 0.5))
    f = bad.card("cdc").failing
    assert f.rule_id == "inland.res.gfa" and round(f.required_value, 2) == 389.0
    small = assess_pathway(dwelling(lot_area_m2=240, gfa_m2=190, lot_width_m=8))      # 78% of 240 = 187.2
    assert small.card("cdc").failing.rule_id == "inland.res.gfa" and round(small.card("cdc").failing.required_value, 1) == 187.2


def test_side_setback_above_4_5m_uses_height_minus_3():
    ok = assess_pathway(dwelling(wall_height_side_m=7.0, setback_side_m=4.0))
    assert ok.card("cdc").status == PathwayStatus.ELIGIBLE
    bad = assess_pathway(dwelling(wall_height_side_m=7.0, setback_side_m=3.9)).card("cdc").failing      # (7 - 3) = 4.0 required
    assert bad.rule_id == "inland.res.side_setback_high" and bad.required_value == 4.0


def test_missing_data_is_unresolved_not_defaulted():
    r = assess_pathway(dwelling(building_height_m=None))
    c = r.card("cdc")
    assert c.status == PathwayStatus.UNRESOLVED and c.pill == Pill.UNRESOLVED
    h = next(x for x in c.criteria if x.rule_id == "inland.res.height")
    assert h.status == Status.UNRESOLVED and "building_height_m" in h.prompt and h.required_value == 8.5


def test_unknown_lga_is_unresolved_code_selection():
    r = assess_pathway(dwelling(lga=None))
    sel = next(x for x in r.card("cdc").criteria if x.rule_id == "code.selection")
    assert sel.status == Status.UNRESOLVED


def test_non_inland_lga_uses_housing_code_and_leaves_standards_unresolved():
    r = assess_pathway(dwelling(lga="Blacktown"))
    c = r.card("cdc")
    assert "housing_code" in c.codes and "inland_code" not in c.codes
    assert c.status == PathwayStatus.UNRESOLVED
    assert any(x.rule_id == "housing.other_standards" for x in c.unresolved)


def test_exclusions_fail_with_citation():
    r = assess_pathway(dwelling(heritage_item=True))
    f = r.card("cdc").failing
    assert f.rule_id == "cdc.general.excl.heritage_item" and "heritage item" in f.citation.quote
    r = assess_pathway(dwelling(lep_permissibility="prohibited"))
    assert r.card("da").pill == Pill.NOT_APPLICABLE and r.card("cdc").status == PathwayStatus.NOT_ELIGIBLE


def test_lep_permissibility_unknown_stays_unresolved():
    r = assess_pathway(dwelling(lep_permissibility=None))
    assert r.card("cdc").status == PathwayStatus.UNRESOLVED
    assert any(x.rule_id == "cdc.lep_permissibility" for x in r.card("cdc").unresolved)


def test_rural_dwelling_min_lot_size_from_lep_map():
    base = dict(zone="RU1", lot_area_m2=509264, lot_type="standard", lot_width_m=None, building_height_m=9, storeys=2, setback_primary_m=60, setback_side_m=20,
                setback_rear_m=20, watercourse_distance_m=100, primary_road_sealed=True)
    r = assess_pathway(dwelling(**base, lep_min_lot_size_m2=2_000_000))
    assert r.card("cdc").failing.rule_id == "inland.rural.lot_area_min" and r.card("cdc").failing.required_value == 2_000_000
    r = assess_pathway(dwelling(**base, lep_min_lot_size_m2=None, lep_min_lot_size_specified=None))
    assert next(x for x in r.card("cdc").criteria if x.rule_id == "inland.rural.lot_area_min").status == Status.UNRESOLVED
    r = assess_pathway(dwelling(**base, lep_min_lot_size_m2=None, lep_min_lot_size_specified=False))
    assert next(x for x in r.card("cdc").criteria if x.rule_id == "inland.rural.lot_area_min").status == Status.PASS
    r = assess_pathway(dwelling(**{**base, "setback_primary_m": 40}, lep_min_lot_size_specified=False))
    assert r.card("cdc").failing.rule_id == "inland.rural.primary_setback"


def sec(**kw):
    base = dict(dev_type=DevType.SECONDARY_DWELLING, lga="Gunnedah", zone="R2", lot_area_m2=700, principal_dwelling_present=True, lot_is_strata_or_community=False,
                involves_subdivision=False, lep_permissibility="permitted_with_consent", **ALL_FALSE)
    base.update(kw)
    return PathwayInput(**base)


def test_secondary_dwelling_cases():
    r = assess_pathway(sec())
    c = r.card("cdc")
    assert c.status == PathwayStatus.UNRESOLVED                     # Schedule 1 standards not obtained: never ELIGIBLE
    assert any(x.rule_id == "sd.standards" for x in c.unresolved)
    f = assess_pathway(sec(lot_area_m2=400)).card("cdc").failing
    assert f.rule_id == "sd.lot_area" and f.required_value == 450 and "450 m" in f.citation.quote
    assert assess_pathway(sec(lot_area_m2=400, within_existing_dwelling=True)).card("cdc").failing is None
    fz = assess_pathway(sec(bal="BAL-FZ", bushfire_prone=True)).card("cdc").failing
    assert fz.rule_id == "sd.bushfire_flame_zone" and "flames" in fz.citation.quote
    assert assess_pathway(sec(involves_subdivision=True)).card("cdc").failing.rule_id == "sd.no_subdivision"
    ru1 = assess_pathway(sec(zone="RU1"))
    z = next(x for x in ru1.card("cdc").criteria if x.rule_id == "sd.zone")
    assert z.status == Status.UNRESOLVED


def test_shed_exempt_farm_building_rules():
    base = dict(dev_type=DevType.SHED, lga="Gunnedah", zone="RU1", lot_area_m2=509264, farm_building=True, building_height_m=6, footprint_m2=90, setback_primary_m=25,
                setback_side_m=15, distance_to_other_building_m=10, watercourse_distance_m=80, engineer_design_provided=True, lep_permissibility="permitted_without_consent", **ALL_FALSE)
    r = assess_pathway(PathwayInput(**base))
    ex = r.card("exempt")
    # every encoded criterion passes, but the aggregate-footprint/siting columns are not encoded: never ELIGIBLE on partial rules
    assert ex.status == PathwayStatus.UNRESOLVED and [u.rule_id for u in ex.unresolved] == ["farm_ex.aggregate_and_siting"] and ex.failing is None
    assert sum(c.status == Status.PASS for c in ex.criteria) >= 8
    assert r.suggested_pathway is None and r.card("da").pill == Pill.POSSIBLE
    f = assess_pathway(PathwayInput(**{**base, "footprint_m2": 250})).card("exempt").failing
    assert f.rule_id == "farm_ex.footprint" and f.required_value == 200
    f = assess_pathway(PathwayInput(**{**base, "building_height_m": 8})).card("exempt").failing   # landholding > 10 ha: 10 m allowed
    assert f is None
    f = assess_pathway(PathwayInput(**{**base, "lot_area_m2": 50000, "building_height_m": 8})).card("exempt").failing
    assert f.rule_id == "farm_ex.height_lt10" and f.required_value == 7
    # non-farm shed: no numbers obtainable -> unresolved
    nf = assess_pathway(PathwayInput(**{**base, "farm_building": False}))
    assert nf.card("exempt").status == PathwayStatus.UNRESOLVED
    assert any(x.rule_id == "shed.exempt_standards" for x in nf.card("exempt").unresolved)


def test_blocked_documents_reported():
    r = assess_pathway(dwelling())
    assert any("Exempt and Complying Development Codes" in b for b in r.blocked_documents)
    assert any("Housing" in b for b in r.blocked_documents)
    assert r.currency_warning and "2018" in r.currency_warning


# ---------------------------------------------------------------- real test-run outputs
def run_input(run, **extra):
    d = RUNS / run
    if not (d / "constraints_report.json").exists():
        pytest.skip(f"{run} outputs not present")
    facts = json.loads((d / "run_steps.json").read_text())["facts"]
    rep = json.loads((d / "constraints_report.json").read_text())
    return make_input(facts["development_type"], rep, lga="Gunnedah", zone=facts["zone"], lot_area_m2=facts["area_m2"], **extra), rep


def test_real_lot2_dwelling():
    inp, rep = run_input("lot2_dwelling")
    assert inp.bushfire_prone is True and inp.heritage_item is False and inp.lep_min_lot_size_m2 is None     # two lot-size entries -> not guessed
    r = assess_pathway(inp)
    assert r.card("exempt").pill == Pill.NOT_APPLICABLE
    cdc = r.card("cdc")
    assert cdc.status == PathwayStatus.UNRESOLVED and cdc.failing is None
    assert next(x for x in cdc.criteria if x.rule_id == "inland.res.lot_area_min").status == Status.PASS
    assert next(x for x in cdc.criteria if x.rule_id == "cdc.bushfire").status == Status.UNRESOLVED
    g = next(x for x in cdc.criteria if x.rule_id == "inland.res.gfa")
    assert round(g.required_value, 1) == 389.0 and g.status == Status.UNRESOLVED      # limit known from the lot area, proposal GFA missing
    ui = r.ui_model()
    assert {c["pill"] for c in ui["cards"]} <= {"Required", "Possible", "Not applicable", "Unresolved"}
    assert "verify with council or a certifier" in ui["recommendation"]


def test_real_quia_granny():
    inp, _ = run_input("quia_granny")
    r = assess_pathway(inp)
    assert inp.dev_type == DevType.SECONDARY_DWELLING and inp.zone == "RU1"
    cdc = r.card("cdc")
    assert cdc.status == PathwayStatus.UNRESOLVED and cdc.failing is None
    assert next(x for x in cdc.criteria if x.rule_id == "sd.lot_area").status == Status.PASS
    assert next(x for x in cdc.criteria if x.rule_id == "sd.zone").status == Status.UNRESOLVED       # RU1: LEP decides
    assert any(x.rule_id == "sd.rural_cl_5_5" for x in r.card("da").criteria)


def test_real_quia_shed():
    inp, _ = run_input("quia_shed")
    r = assess_pathway(inp)
    assert inp.dev_type == DevType.SHED
    assert r.card("exempt").status == PathwayStatus.UNRESOLVED and r.card("cdc").status == PathwayStatus.UNRESOLVED
    assert any(x.rule_id == "farm_ex.zone" or x.rule_id == "shed.exempt_standards" for x in r.card("exempt").criteria)

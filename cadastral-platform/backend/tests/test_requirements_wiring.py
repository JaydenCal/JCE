"""SA4 / SA3 consuming a resolved RequirementSet (and refusing to default when unresolved)."""
import pytest
from shapely.geometry import box

from app.agents.requirements import LocalFolderSource, LotRequirementContext, RequirementsResolver
from app.agents.requirements.models import RequirementSet
from app.agents.sa3_driveway.agent import Sa3Driveway
from app.agents.sa3_driveway.crossover import council_standard
from app.agents.sa4_hydro.agent import Sa4Hydro
from app.agents.sa4_hydro.models import RainfallTable, RwtDemand, RwtInput, Sa4Request
from test_requirements import CTX, make_docs
from test_sa3_driveway import make_req
from test_sa4_hydro import CPS, DEN, _inp, lot_dict, make_pdf, mga

STAMP = "PLACEHOLDER, NOT A REQUIREMENT"


@pytest.fixture(scope="module")
def reqset(tmp_path_factory):
    d = tmp_path_factory.mktemp("gd")
    make_docs(d)
    nsw = RequirementsResolver(CTX, LocalFolderSource(d)).resolve()
    council = RequirementsResolver(CTX.model_copy(update={"lga": "Testville"}), LocalFolderSource(d)).resolve()
    nsw.requirements += [r for r in council.requirements if r.key.startswith("driveway.")]
    return nsw


def sa4_req(tmp_path, explicit_rwt=False, **kw):
    p = tmp_path / "d.pdf"
    make_pdf(p)
    x0, y0 = mga(100, 220)
    rwt = _inp(downpipe_xy=(x0 + 10, y0 + 12))
    if explicit_rwt:        # stage 7: every mass balance input entered by the caller (USER), so no placeholder is used and none is unresolved
        rwt = RwtInput(roof_area_m2=150.0, rainfall=RainfallTable(station_id="066062", monthly_mm=[100] * 12, wet_day_fraction=0.3), downpipe_xy=(x0 + 10, y0 + 12),
                       runoff_coeff=0.85, first_flush_mm=2.0, candidate_sizes_l=[2000, 3000, 4500, 5000], tank_height_m=2.0, boundary_offset_m=0.45,
                       demand=RwtDemand(occupants=4, toilet_l_pp_day=18.0, laundry_l_pp_day=20.0, garden_area_m2=0.0, garden_l_m2_day=2.0,
                                        garden_monthly_factor=[1.0] * 12, use_toilet=True, use_laundry=True, use_garden=True))
    return Sa4Request(lot=lot_dict(), pdf_path=str(p), control_points=CPS, scale_denominator=DEN,
                      slab_wkt=box(x0 + 10, y0 + 10, x0 + 20, y0 + 25).wkt, outlet_xy=(x0 + 15, y0 + 12),
                      rwt=rwt, **kw)


def test_sa4_uses_cited_requirements(tmp_path, reqset):
    res = Sa4Hydro().run(sa4_req(tmp_path, explicit_rwt=True, requirements=reqset))
    assert res.unresolved == [] and res.verifiable and not res.placeholders_used
    by = {b.service: b for b in res.buffers}
    assert by["sewer"].clearance_m == 1.2 and by["water"].clearance_m == 1.5 and not by["sewer"].placeholder
    assert "Sydney Water" in by["sewer"].rule_source and "| Sewer | up to 300" in by["sewer"].rule_source
    assert res.rwt.target_reliability_pct == 40 and not res.rwt.placeholder and res.rwt.chosen.volume_l >= 2000
    sewer = next(c for c in res.connections if c.kind == "sewer")
    water = next(c for c in res.connections if c.kind == "water")
    assert sewer.required_min_grade_pct == 2.0 and water.cover_m == 0.75
    assert res.requirement_citations and STAMP not in " ".join(sewer.notes + water.notes + res.warnings)


def test_sa4_unresolved_never_defaults(tmp_path):
    res = Sa4Hydro().run(sa4_req(tmp_path, requirements=RequirementSet()))
    keys = {i.key for i in res.unresolved}
    assert {"util.clearance_m", "sewer.min_grade_pct", "water.min_cover_m", "rwt.water_target_pct"} <= keys
    assert all(i.prompt for i in res.unresolved) and not res.verifiable and not res.placeholders_used
    assert res.buffers == [] and res.rwt.chosen is None and res.rwt.target_reliability_pct is None
    assert res.to_cad_rwt() is None
    sewer = next(c for c in res.connections if c.kind == "sewer")
    assert sewer.required_min_grade_pct is None and sewer.grade_ok is None
    assert next(c for c in res.connections if c.kind == "water").cover_m is None


def test_sa4_explicit_placeholders_are_stamped(tmp_path):
    res = Sa4Hydro().run(sa4_req(tmp_path, requirements=RequirementSet(), use_placeholders=True))
    assert res.placeholders_used and not res.verifiable and res.unresolved
    assert all(b.placeholder and STAMP in b.rule_source for b in res.buffers) and res.buffers
    assert res.rwt.placeholder and STAMP in " ".join(res.rwt.messages)
    assert any(STAMP in n for c in res.connections for n in c.notes)
    legacy = Sa4Hydro().run(sa4_req(tmp_path))                    # no RequirementSet: legacy path, stamped, unverifiable
    assert legacy.placeholders_used and not legacy.verifiable and STAMP in " ".join(legacy.warnings)


def test_sa3_uses_cited_standard_and_blocks_on_unresolved(reqset):
    lot = make_req().lot.model_copy(update={"lga_name": "Testville"})
    res = Sa3Driveway().run(make_req(lot=lot, requirements=reqset, parking="double", width_m=6.5))
    assert res.driveway.council_standard_label.startswith("Resolved requirements")
    assert res.driveway.width_m == 5.5 and any("council maximum 5.50" in w for w in res.warnings)
    mg = next(c for c in res.checks if c.name == "max_grade")
    assert mg.limit == 20.0 and res.requirement_citations
    assert [i.key for i in res.unresolved] == ["driveway.min_separation_m"] and not res.verifiable
    RequirementsResolver.user_enter(reqset, "driveway.min_separation_m", 8.0, who="jayden", unit="m", lga="Testville")
    ok = Sa3Driveway().run(make_req(lot=lot, requirements=reqset))
    assert ok.unresolved == [] and ok.verifiable and not ok.placeholders_used
    reqset.requirements.pop()


def test_sa3_empty_set_does_not_default():
    res = Sa3Driveway().run(make_req(requirements=RequirementSet()))
    assert len(res.unresolved) == 5 and not res.verifiable
    mg = next(c for c in res.checks if c.name == "max_grade")
    assert mg.passed is None and mg.limit is None
    assert all(c.passed is None for c in res.checks if c.name.startswith("change_of_grade"))
    flagged = Sa3Driveway().run(make_req(requirements=RequirementSet(), use_placeholders=True))
    assert flagged.placeholders_used and STAMP in " ".join(flagged.warnings)
    assert next(c for c in flagged.checks if c.name == "max_grade").limit == 25.0
    legacy = Sa3Driveway().run(make_req())
    assert legacy.placeholders_used and not legacy.verifiable and STAMP in " ".join(legacy.warnings)
    assert council_standard("x").source_label == "default (AS/NZS 2890.1) used"

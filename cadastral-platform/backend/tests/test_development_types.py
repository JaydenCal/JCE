"""Development type (dwelling_house | secondary_dwelling | shed | dual_occupancy stub) threading."""
from __future__ import annotations

from uuid import uuid4

import pytest
from shapely import wkt as shw
from shapely.geometry import box

from app.agents.sa2_dcp_rag.extract import parse_setback_table
from app.agents.sa2_dcp_rag.models import Chunk
from app.agents.sa3_driveway.envelope import build_envelope
from app.agents.sa3_driveway.models import SetbackRule
from app.agents.sa6_glide3d import build_scene
from app.agents.sa6_glide3d import sample as S
from app.agents.sa6_glide3d.presets import (DEFAULTS_NOTE, building_preset, default_dims, place_rectangle,
                                            preset_footprint)
from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.triggers import evaluate
from app.common.contracts import DevelopmentType
from app.orchestrator.adapters.params import SiteParams
from app.orchestrator.inputs import RunRequest, run_params
from test_sa3_driveway import lot_from

DT = DevelopmentType


def test_enum_and_params_mapping():
    assert DT.shed.rule_dwelling_type == "outbuilding" and DT.secondary_dwelling.rule_dwelling_type == "secondary_dwelling"
    assert not DT.shed.habitable and DT.dwelling_house.habitable
    assert SiteParams().development_type is DT.dwelling_house and SiteParams().rule_dwelling_type == "dwelling_house"
    p = SiteParams.model_validate(run_params(RunRequest(project_id=uuid4(), development_type="shed")))
    assert p.rule_dwelling_type == "outbuilding"
    assert SiteParams(dwelling_type="garage").rule_dwelling_type == "garage"        # explicit override kept
    with pytest.raises(ValueError):
        RunRequest(project_id=uuid4(), development_type="mansion")


def _rules():
    mk = lambda e, v, d=None: SetbackRule(rule_id=str(uuid4()), element=e, value_numeric=v, dwelling_type=d)  # noqa: E731
    return [mk("front", 6, "dwelling_house"), mk("side", 0.9, "dwelling_house"), mk("rear", 3, "dwelling_house"),
            mk("side", 0.5, "outbuilding"), mk("rear", 0.5, "outbuilding"), mk("front", 5, "outbuilding"),
            mk("site_cover_max", 50, "dwelling_house"), mk("height_max", 4.5, "outbuilding")]


def test_envelope_selects_matching_rules_and_reports_unresolved():
    lot = lot_from([(0, 0), (20, 0), (20, 30), (0, 30)])
    shed = build_envelope(lot, _rules(), dwelling_type="outbuilding")
    assert shed.setbacks_m["side"] == 0.5 and shed.max_height_m == 4.5
    assert shed.unresolved_elements == ["site_cover_max"] and shed.max_site_cover_pct is None
    assert any("UNRESOLVED" in w and "site_cover_max" in w for w in shed.warnings)
    house = build_envelope(lot, _rules(), dwelling_type="dwelling_house")
    assert house.setbacks_m["side"] == 0.9 and house.unresolved_elements == ["height_max"]
    # no rules at all for secondary_dwelling: nothing silently borrowed from dwelling_house
    sec = build_envelope(lot, _rules(), dwelling_type="secondary_dwelling")
    assert {"front", "side", "rear"} <= set(sec.unresolved_elements) and sec.applied_rule_ids == []


def test_sa2_table_not_relabelled_for_other_type():
    plain = Chunk(chunk_id="c1", page_from=1, page_to=1, kind="table",
                  content="| Zone | Front | Side | Rear |\n|---|---|---|---|\n| R2 | 6 m | 0.9 m | 3 m |")
    assert parse_setback_table(plain, "R2", "dwelling_house")
    assert parse_setback_table(plain, "R2", "secondary_dwelling") == []
    typed = Chunk(chunk_id="c2", page_from=1, page_to=1, kind="table",
                  content="| Zone | Dwelling type | Front | Side |\n|---|---|---|---|\n| R2 | Secondary dwelling | 5 m | 0.9 m |\n"
                          "| R2 | Dwelling house | 6 m | 1.2 m |")
    r = parse_setback_table(typed, "R2", "secondary_dwelling")
    assert {x.element: x.value_numeric for x in r} == {"front": 5.0, "side": 0.9}


def test_presets_and_scene():
    assert default_dims(DT.dwelling_house) is None and "NOT compliance" in DEFAULTS_NOTE
    req = S.sample_request()
    env = req.lot.boundary_wkt
    fp = preset_footprint(DT.shed, env)
    assert fp and shw.loads(fp).within(shw.loads(env).buffer(1e-6))
    assert place_rectangle(box(0, 0, 3, 3).wkt, 6, 4) is None            # does not fit: reported, not shrunk
    shed = building_preset(DT.shed, fp, 100.0)
    assert not shed.habitable and shed.roller_door and shed.roof_type in ("gable", "skillion")
    gf = building_preset(DT.secondary_dwelling, preset_footprint(DT.secondary_dwelling, env), 100.0)
    assert gf.habitable and gf.roller_door is None
    with pytest.raises(ValueError):
        building_preset(DT.dwelling_house, fp, 100.0)
    b = build_scene(req.model_copy(update={"buildings": [shed], "development_type": DT.shed}))
    assert any(p.n.endswith("RollerDoor") for p in b.parts)
    assert ("Development type", DT.shed.label) in b.summary
    assert any("Class 10a" in l.t for l in b.labels)


def test_sa9_dev_type_rules_unresolved():
    bf = LayerResult(key="nsw_bushfire", label="Bushfire", status="affected", attributes=[])
    for dt, rid in (("dwelling_house", "bushfire.habitable"), ("shed", "bushfire.class10a")):
        t = [x for x in evaluate([bf], "NSW", development_type=dt) if x.layer_key == "nsw_bushfire"]
        assert [x.rule_id for x in t] == [rid]
    shed = evaluate([], "NSW", development_type="shed")
    assert [t.rule_id for t in shed] == ["pathway.shed"]
    sec = evaluate([], "NSW", development_type="secondary_dwelling")
    assert {t.rule_id for t in sec} == {"pathway.secondary_dwelling", "services.secondary_dwelling"}
    items = {c.item for t in sec for c in t.consequences}
    assert {"sewer_connection", "water_connection", "electricity_connection", "exempt_development_eligibility"} <= items
    assert all(t.unresolved and all(c.status == "to_be_confirmed" and c.value is None for c in t.consequences) for t in sec + shed)
    assert evaluate([], "NSW", development_type="dwelling_house") == []


def test_sa4_demand_by_development_type():
    from types import SimpleNamespace as NS

    from app.agents.sa4_hydro.models import RainfallTable, RwtInput
    from app.orchestrator.adapters.nodes import dev_rwt
    from app.orchestrator.adapters.params import DbydParams
    rwt = RwtInput(roof_area_m2=60, rainfall=RainfallTable(station_id="T", monthly_mm=[50.0] * 12))

    def node(dt, **kw):
        return NS(params=SiteParams(development_type=dt, dbyd=DbydParams(rwt=rwt, **kw)))
    assert dev_rwt(node(DT.dwelling_house)).demand.occupants == 3
    assert dev_rwt(node(DT.secondary_dwelling, occupants=2)).demand.occupants == 2
    s = dev_rwt(node(DT.shed)).demand
    assert s.occupants == 0 and not s.use_toilet and not s.use_laundry
    assert dev_rwt(NS(params=SiteParams(development_type=DT.shed))) is None


def test_sa5_title_block_shows_development_type(tmp_path):
    import pymupdf

    from app.agents.sa5_cad_dxf import Sa5CadDxf
    from test_sa5_cad import make_request
    req = make_request(tmp_path, formats=("pdf",)).model_copy(update={"development_type": DT.shed})
    res = Sa5CadDxf().run(req)
    flat = " ".join(pymupdf.open(res.pdf_path)[0].get_text().split())
    assert "DEVELOPMENT" in flat and "Shed / outbuilding (Class 10a)" in flat

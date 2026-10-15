"""Stage 11: an engine derived parameter can only be saved when a first design result of the project backs it, computed from the SAVED design and the inputs it was computed from (docs/22)."""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

import ai_support as S
import site_support as H
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import SITE_DESIGN_FILE, site_design_access, site_rules_dep
from app.design import ai_candidates as AC
from app.design import derived_ledger as DL
from app.design import terrain_source as TS
from app.design.site_design import SiteDesign

T = S.terrain()


def storage():
    return S.design(*S.site_objects(), S.pt("dp1", "discharge_point", 9, -2, discharge_kind="kerb_outlet"), S.pt("osd1", "osd", 15, 25, width_m=1.0, length_m=2.0))


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    TS.clear_cache()
    monkeypatch.setattr("app.api.site_design.istore.check_design", lambda *a, **k: None)      # the synthetic building has no stored import; this file tests the ledger only
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: S.fake_rules()
    pid = uuid.uuid4()
    H.write_bundle(tmp_path, pid, H.bundle(z=S.SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    return TestClient(app), pid, tmp_path


def derived_in(d: SiteDesign):
    return DL.engine_derived(d)


def save(c, pid, d: SiteDesign | dict) -> dict:
    """The page saves: PUT the design at the stored version (0 when nothing is stored)."""
    doc = d.dump() if isinstance(d, SiteDesign) else d
    cur = c.get(f"/projects/{pid}/site-design").json()["version"]
    r = c.put(f"/projects/{pid}/site-design", json={**doc, "version": cur})
    assert r.status_code == 200, r.text
    return r.json()


def first_design(c, pid, d: SiteDesign, **kw):
    return c.post(f"/projects/{pid}/ai/first-design", json={"design": d.dump(), **kw})


def with_main_depth(d: SiteDesign, depth: float) -> SiteDesign:
    doc = d.dump()
    for o in doc["objects"]:
        if o["id"] == "sewer_main":
            o["params"]["depth_m"]["value"] = depth
    return SiteDesign.model_validate(doc)


def test_first_design_refuses_a_design_that_is_not_the_saved_one_and_records_nothing(api):
    c, pid, base = api
    d = storage()
    r = first_design(c, pid, d)                                                      # nothing is saved yet
    assert r.status_code == 409 and r.json()["code"] == "DESIGN_NOT_SAVED"
    assert not (base / str(pid) / DL.LEDGER_FILE).exists()
    save(c, pid, d)
    assert first_design(c, pid, with_main_depth(d, 0.5)).status_code == 409           # a client design with another depth of the main
    assert not (base / str(pid) / DL.LEDGER_FILE).exists()
    assert first_design(c, pid, d).status_code == 200


def test_first_design_result_is_recorded_and_its_batch_can_be_saved(api):
    c, pid, base = api
    d = storage()
    v1 = save(c, pid, d)
    r = first_design(c, pid, d)
    assert r.status_code == 200
    batch = r.json()["batch"]
    assert (base / str(pid) / DL.LEDGER_FILE).is_file()
    applied = AC.apply_steps(SiteDesign.model_validate(v1), batch)
    assert derived_in(applied), "the rules batch writes engine derived parameters"
    put = c.put(f"/projects/{pid}/site-design", json={**applied.dump(), "version": v1["version"]})
    assert put.status_code == 200, put.text


def test_a_forged_derived_parameter_is_refused_and_nothing_is_written(api):
    c, pid, base = api
    d = storage()
    v1 = save(c, pid, d)
    batch = first_design(c, pid, d).json()["batch"]
    applied = AC.apply_steps(SiteDesign.model_validate(v1), batch).dump()
    # change the value of an engine derived parameter: the ledger no longer backs it
    forged = json.loads(json.dumps(applied))
    hit = None
    for o in forged["objects"]:
        for k, p in o["params"].items():
            if p.get("basis") == "derived" and isinstance(p.get("value"), str):
                p["value"], hit = "invented_target", (o["id"], k)
                break
        if hit:
            break
    assert hit
    r = c.put(f"/projects/{pid}/site-design", json={**forged, "version": v1["version"]})
    assert r.status_code == 422 and r.json()["code"] == DL.CODE and f"{hit[0]}.{hit[1]}" in r.json()["parameters"]
    assert c.get(f"/projects/{pid}/site-design").json()["version"] == v1["version"]


def test_derived_values_computed_from_a_fake_main_depth_cannot_be_saved_with_the_real_depth(api):
    """The forgery: save a FAKE depth of the main, let the engine derive from it, then PUT the REAL design with the derived values. The ledger ties the values to the inputs they
    were computed from, so the real design is refused; the design with the fake depth they belong to is not."""
    c, pid, base = api
    real = storage()
    fake = with_main_depth(real, 0.5)
    v1 = save(c, pid, fake)
    batch = first_design(c, pid, fake).json()["batch"]
    applied_fake = AC.apply_steps(SiteDesign.model_validate(v1), batch)
    assert derived_in(applied_fake)
    applied_real = with_main_depth(applied_fake, 2.5).dump()                          # the same derived values, the real depth of the main
    r = c.put(f"/projects/{pid}/site-design", json={**applied_real, "version": v1["version"]})
    assert r.status_code == 422 and r.json()["code"] == DL.CODE and r.json()["parameters"]
    assert c.put(f"/projects/{pid}/site-design", json={**applied_fake.dump(), "version": v1["version"]}).status_code == 200    # the inputs it was computed from


def test_a_derived_parameter_without_any_first_design_is_refused(api):
    c, pid, base = api
    d = storage()
    v1 = save(c, pid, d)
    batch = first_design(c, pid, d).json()["batch"]
    applied = AC.apply_steps(SiteDesign.model_validate(v1), batch).dump()
    (base / str(pid) / DL.LEDGER_FILE).unlink()                                      # another project, or a design from nowhere
    assert c.put(f"/projects/{pid}/site-design", json={**applied, "version": v1["version"]}).status_code == 422


def test_a_value_already_saved_stays_saveable_without_the_ledger(api):
    c, pid, base = api
    d = storage()
    v1 = save(c, pid, d)
    batch = first_design(c, pid, d).json()["batch"]
    applied = AC.apply_steps(SiteDesign.model_validate(v1), batch).dump()
    v2 = save(c, pid, applied)
    (base / str(pid) / DL.LEDGER_FILE).unlink()                                      # the ledger is gone: the unchanged saved values may still be saved again
    assert c.put(f"/projects/{pid}/site-design", json={**v2, "version": v2["version"]}).status_code == 200


def test_first_design_runs_by_the_rules_are_rate_limited_per_project(api, monkeypatch):
    c, pid, base = api
    monkeypatch.setenv("JCESITE_AI_RATE_PER_MIN", "3")
    d = storage()
    save(c, pid, d)
    codes = [first_design(c, pid, d, use_ai=False).status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200] and codes[3:] == [429, 429]
    r = first_design(c, pid, d, use_ai=False)
    assert r.json()["code"] == "RATE_LIMITED"
    assert first_design(c, pid, d, estimate=True).status_code == 200                  # an estimate is not a run


def test_unbacked_lists_only_engine_derived_pairs(tmp_path):
    d = storage()
    assert DL.unbacked(d, tmp_path) == []                                            # a design with no derived parameter
    step = {"op": "set_param", "args": {"id": "dp1", "key": "drains_to_id", "value": "osd1", "basis": "derived", "ref": "AI FIRST DESIGN x"}}
    assert DL.batch_entries([{"op": "set_param", "args": {"id": "a", "key": "drains_to_id", "value": "b", "basis": "derived", "ref": "AI FIRST DESIGN x"}},
                             {"op": "set_param", "args": {"id": "a", "key": "width_m", "value": 3, "basis": "user"}}]) == [["a", "drains_to_id", "b"]]
    assert DL.record_batch(tmp_path, d, [step]) == 1
    assert DL.touched([step]) == {"dp1": {"drains_to_id"}}
    assert DL.inputs_hash(d) == DL.inputs_hash(d.model_copy(update={"version": 9}))     # the version is not an input
    assert DL.inputs_hash(d) != DL.inputs_hash(with_main_depth(d, 0.5))                  # the depth of a main is

"""Stage 11 pipeline integration: the SA6 node of the orchestrator is the real scene agent (terrain chain and provenance, written bundle), the DAG and the registry say so,
and POST /projects/{id}/scene/rebuild creates a SA6 run (a fake orchestrator stands in for the database)."""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.offline.lot2 as OFF
from app.agents.sa6_site3d import SceneBundle
from app.api.app import create_app
from app.api.scene import scene_access
from app.api.settings import Settings
from app.common.contracts import AgentCode, DevelopmentType
from app.orchestrator.adapters import Sa3Dispatch, Sa6Adapter, Sa6Result
from app.orchestrator.adapters.sa6 import Sa6Node
from app.orchestrator.dag import DAG
from app.orchestrator.registry import default_registry
from scripts.run_site import _user_rules_sa2


def node(tmp_path: Path, **kw) -> Sa6Node:
    sa1 = OFF.sa1_result()
    dev = DevelopmentType.dwelling_house
    sa2 = _user_rules_sa2([{"element": "front", "value_numeric": 6.0, "unit": "m"}, {"element": "side", "value_numeric": 0.9, "unit": "m"},
                           {"element": "rear", "value_numeric": 6.0, "unit": "m"}], sa1.lot.zone_code or "R2", dev.rule_dwelling_type)
    params = {"development_type": dev.value}
    env = Sa3Dispatch().run(Sa3Dispatch.input_model.model_validate({"node": "ENV", "env": {"sa1": sa1.model_dump(mode="json"), "sa2": sa2.model_dump(mode="json"), "params": params}}))
    return Sa6Node.model_validate({"project_id": str(uuid.uuid4()), "project_title": "Lot 2 offline", "sa1": sa1.model_dump(mode="json"), "env": env.model_dump(mode="json"),
                                   "params": params, "output_path": str(tmp_path / "out"), **kw})


def test_adapter_writes_a_valid_bundle_with_the_terrain_provenance(tmp_path):
    out = Sa6Adapter(env={"JCESITE_ENV": "test", "JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_AERIAL": "auto"}).run(node(tmp_path))
    assert isinstance(out, Sa6Result) and out.parts > 5
    p = Path(out.scene_bundle_path)
    assert p == tmp_path / "out" / "scene_bundle.json" and p.is_file()
    b = SceneBundle.model_validate_json(p.read_text())                                      # the file validates
    info = json.loads(p.read_text())["info"]
    assert out.terrain_status and out.terrain_status == info["terrain"]["status"]
    assert "OFFLINE FIXTURE" in out.terrain_source                                          # an offline run never reads as live
    assert out.aerial is True and out.status == "unverified"
    assert len(b.parts) == out.parts


def test_adapter_without_terrain_or_aerial_still_builds_and_says_not_available(tmp_path):
    out = Sa6Adapter(env={"JCESITE_ENV": "test", "JCESITE_OFFLINE_FIXTURE": "lot2"}).run(node(tmp_path, terrain_mode="none", aerial_mode="none"))
    assert out.parts > 0 and out.aerial is False
    assert "NOT" in out.terrain_status.upper()


def test_environment_selects_the_modes_when_the_node_does_not(tmp_path):
    out = Sa6Adapter(env={"JCESITE_ENV": "test", "JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_AERIAL": "none"}).run(node(tmp_path))
    assert out.aerial is False


def test_registry_and_dag_wire_the_real_scene_agent():
    reg = default_registry()
    assert not reg.is_stub(AgentCode.SA6_SITE3D) and isinstance(reg.get(AgentCode.SA6_SITE3D), Sa6Adapter)
    spec = DAG["SA6"]
    assert set(spec.deps) == {"SA1", "ENV"} and spec.tolerate_after_failure and spec.export_gate
    assert {"SA3", "SA4"} <= set(spec.after)


# ---- the rebuild route
class FakeOrchestrator:
    pool = object()

    def __init__(self) -> None:
        self.requests: list = []
        self.executed: list = []

    def create_run(self, user_id, request):
        self.requests.append((user_id, request))
        class R:                                                                               # noqa: E306
            run_id = uuid.uuid4()
            status = "queued"
        return R

    def execute_run(self, run_id, user_id):
        self.executed.append(run_id)


def test_rebuild_route_creates_a_sa6_run_and_returns_the_bundle_url(tmp_path):
    fake = FakeOrchestrator()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object(), orchestrator=fake)
    uid = uuid.uuid4()
    app.dependency_overrides[scene_access] = lambda: uid
    c = TestClient(app)
    pid = uuid.uuid4()
    r = c.post(f"/projects/{pid}/scene/rebuild", json={"params": {"lot_identifier": "2/DP1"}, "development_type": "dwelling_house"})
    assert r.status_code == 202
    j = r.json()
    assert j["scene_bundle_url"] == f"/projects/{pid}/scene-bundle" and j["run_id"]
    (who, req), = fake.requests
    assert who == uid and req.targets == ["SA6"] and req.project_id == pid and req.params == {"lot_identifier": "2/DP1"}
    assert len(fake.executed) == 1                                                            # the background task ran
    assert c.post(f"/projects/{pid}/scene/rebuild", json={"surprise": 1}).status_code == 422

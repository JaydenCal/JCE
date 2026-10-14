"""GET /projects/{id}/scene-bundle (no database needed: the Terms/project access dependency is overridden)."""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.agents.sa6_site3d import build_scene, dumps
from app.agents.sa6_site3d import sample as S
from app.api.app import create_app
from app.api.scene import NO_BUNDLE_DETAIL, SCENE_BUNDLE_FILE, scene_access
from app.api.settings import Settings
from app.common.statement import AI_DRAFT_STATEMENT


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[scene_access] = lambda: uuid.uuid4()
    return TestClient(app), tmp_path


def test_missing_bundle_is_404_data_not_available(client):
    c, _ = client
    r = c.get(f"/projects/{uuid.uuid4()}/scene-bundle")
    assert r.status_code == 404 and r.json() == {"detail": "DATA NOT AVAILABLE: no scene bundle for this project"}
    assert r.json()["detail"] == NO_BUNDLE_DETAIL


def test_serves_bundle_from_export_dir(client):
    c, tmp = client
    pid = uuid.uuid4()
    (tmp / str(pid)).mkdir()
    (tmp / str(pid) / SCENE_BUNDLE_FILE).write_text(dumps(build_scene(S.sample_request())))
    r = c.get(f"/projects/{pid}/scene-bundle")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    j = r.json()
    assert "statement" not in j["info"] and j["parts"] and j["walkable"]["spawn"]
    assert c.get(f"/projects/{uuid.uuid4()}/scene-bundle").status_code == 404      # another project: still not found


def test_env_dir_overrides_and_old_bundle_still_served(client, tmp_path_factory, monkeypatch):
    c, _ = client
    d = tmp_path_factory.mktemp("bundles")
    monkeypatch.setenv("SCENE_BUNDLE_DIR", str(d))
    pid = uuid.uuid4()
    (d / str(pid)).mkdir()
    old = json.loads(dumps(build_scene(S.sample_request())))
    old["info"]["statement"] = AI_DRAFT_STATEMENT       # a bundle written before stage 3 carried the field
    (d / str(pid) / SCENE_BUNDLE_FILE).write_text(json.dumps(old))
    r = c.get(f"/projects/{pid}/scene-bundle")
    assert r.status_code == 200 and r.json()["parts"]


def test_statement_in_a_file_is_not_forced_or_added(client):
    c, tmp = client
    pid = uuid.uuid4()
    (tmp / str(pid)).mkdir()
    b = json.loads(dumps(build_scene(S.sample_request())))
    (tmp / str(pid) / SCENE_BUNDLE_FILE).write_text(json.dumps(b))
    assert "statement" not in c.get(f"/projects/{pid}/scene-bundle").json()["info"]


def test_invalid_bundle_on_disk_is_500_not_served(client):
    c, tmp = client
    pid = uuid.uuid4()
    (tmp / str(pid)).mkdir()
    (tmp / str(pid) / SCENE_BUNDLE_FILE).write_text("{not json")
    assert c.get(f"/projects/{pid}/scene-bundle").status_code == 500


def test_requires_user_when_not_overridden(tmp_path):
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    r = TestClient(app).get(f"/projects/{uuid.uuid4()}/scene-bundle")
    assert r.status_code == 401

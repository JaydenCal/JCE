"""Router tests against the scratch DB (skipped unless TEST_DATABASE_URL and 001+002 are loaded)."""
import uuid

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box

from app.api.app import create_app
from app.api.settings import Settings
from app.design.placement import PlacementContext
from app.design.product_import import HttpResponse, ProductImporter
from test_orch_support import make_orch, make_project, make_user, pool, dsn  # noqa: F401
from test_design_import import OG, OG_NODIMS, NOW

URL = "https://www.bunnings.com.au/oak-table_p9"


class Fake:
    def __init__(self, page):
        self.page = page

    def get(self, url):
        return HttpResponse(200, "" if url.endswith("robots.txt") else self.page, url)


@pytest.fixture
def env(pool, tmp_path):
    with pool.connection() as c:
        if c.execute("SELECT to_regclass('design.placed_items') AS t").fetchone()["t"] is None:
            pytest.skip("db/002_design.sql not loaded")
    app = create_app(Settings(upload_dir=str(tmp_path), export_dir=str(tmp_path)), pool=pool,
                     orchestrator=make_orch(pool)[0])
    app.state.design_importer = ProductImporter(Fake(OG), allowlist=("bunnings.com.au",), now=lambda: NOW)
    app.state.design_context = lambda conn, pid, lvl: (7856, PlacementContext(
        boundary=box(0, 0, 50, 50), dbyd_buffers=[("b", box(30, 30, 35, 35))]))
    return app, TestClient(app)


def H(u):
    return {"X-User-Id": str(u)}


def test_gated(env, pool):
    _, c = env
    u = make_user(pool, accepted=False)
    for m, url in [("get", "/catalogue"), ("post", "/catalogue/import"),
                   ("get", f"/projects/{uuid.uuid4()}/items"), ("get", f"/projects/{uuid.uuid4()}/shopping-list")]:
        r = getattr(c, m)(url, headers=H(u), **({"json": {"url": URL}} if m == "post" else {}))
        assert r.status_code == 403 and r.json()["code"] == "TERMS_NOT_ACCEPTED"


def test_import_place_list_delete(env, pool):
    app, c = env
    u = make_user(pool)
    p = make_project(pool, u)
    r = c.post("/catalogue/import", headers=H(u), json={"url": URL})
    assert r.status_code == 200 and r.json()["item"]["model_kind"] == "proxy_box"
    cid = r.json()["item"]["catalogue_item_id"]
    assert c.post("/catalogue/import", headers=H(u), json={"url": URL}).json()["item"]["catalogue_item_id"] == cid
    assert any(i["catalogue_item_id"] == cid for i in c.get("/catalogue", headers=H(u), params={"q": "Oak"}).json()["items"])

    a = c.post(f"/projects/{p}/items", headers=H(u), json={"catalogue_item_id": cid, "x": 32, "y": 32, "z": 1, "yaw_deg": 20})
    assert a.status_code == 201, a.text
    it = a.json()
    assert it["yaw_deg"] == 15 and [k["check_kind"] for k in it["checks"]] == ["dbyd_buffer"]
    assert c.post(f"/projects/{p}/items", headers=H(u), json={"catalogue_item_id": cid, "x": 80, "y": 1}).json()["code"] == "PLACEMENT_BLOCKED"

    iid = it["placed_item_id"]
    b = c.patch(f"/projects/{p}/items/{iid}", headers=H(u), json={"x": 10, "y": 10, "locked": True})
    assert b.status_code == 200 and b.json()["checks"] == []
    assert c.patch(f"/projects/{p}/items/{iid}", headers=H(u), json={"x": 11}).json()["code"] == "ITEM_LOCKED"
    assert len(c.get(f"/projects/{p}/items", headers=H(u)).json()["items"]) == 1

    js = c.get(f"/projects/{p}/shopping-list", headers=H(u)).json()
    assert js["lines"][0]["qty"] == 1 and js["lines"][0]["price_as_at"] == "2026-10-12"
    assert "retailer" in c.get(f"/projects/{p}/shopping-list", headers=H(u), params={"format": "csv"}).text

    # another user cannot see or touch the project
    o = make_user(pool)
    assert c.get(f"/projects/{p}/items", headers=H(o)).status_code == 404
    assert c.delete(f"/projects/{p}/items/{iid}", headers=H(u)).status_code == 204


def test_import_dimensions_required(env, pool):
    app, c = env
    app.state.design_importer = ProductImporter(Fake(OG_NODIMS), allowlist=("bunnings.com.au",), now=lambda: NOW)
    u = make_user(pool)
    r = c.post("/catalogue/import", headers=H(u), json={"url": URL + "2"})
    assert r.json()["status"] == "dimensions_required"
    r = c.post("/catalogue/import", headers=H(u), json={"url": URL + "2", "width_m": 1, "depth_m": 1, "height_m": 1})
    assert r.json()["status"] == "ok"
    r = c.post("/catalogue/import", headers=H(u), json={"url": "https://evil.example/x"})
    assert r.status_code == 403 and r.json()["code"] == "RETAILER_NOT_ALLOWED"

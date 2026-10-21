"""Stage 8: the BYDA client (fake transport, token refresh, lodge payload, rate limit, no secrets in logs), the webhook, the private plan upload, the vector parse to draft
objects, and the DBYD API routes. No call leaves the machine: the transport is a fake. The credentials in this file are FAKE test strings.
"""
from __future__ import annotations

import json
import logging
import uuid

import pytest
from fastapi.testclient import TestClient
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

import site_support as H
from app.api import dbyd as D
from app.api.app import create_app
from app.api.settings import Settings
from app.api.site_design import site_design_access
from app.design import terrain_source as TS
from app.integrations.byda import mapping as M
from app.integrations.byda.client import BydaClient, BydaError
from app.integrations.byda.config import BydaConfig, Secret
from app.integrations.byda.limiter import RateLimited, RateLimiter

CID, CSECRET, WSECRET = "fake-client-id-0001", "fake-client-secret-0002", "fake-webhook-secret-0003"
TOKEN1, TOKEN2 = "fake-access-token-AAA", "fake-access-token-BBB"


class Fake:
    """A scripted transport: records every call; ``routes`` maps (method, path) to a function(call_no, headers, body) -> (status, headers, bytes)."""

    def __init__(self, routes=None):
        self.calls = []
        self.routes = routes or {}
        self.tokens = [TOKEN1, TOKEN2, "fake-access-token-CCC"]
        self.issued = 0

    def __call__(self, method, url, headers, body, timeout):
        path = url.split("smarterwx.byda.com.au", 1)[1].split("?")[0]
        self.calls.append({"method": method, "path": path, "headers": dict(headers), "body": json.loads(body) if body else None, "url": url})
        if (method, path) == ("POST", "/api/community/auth/tokens"):
            tok = self.tokens[self.issued]
            self.issued += 1
            return 200, {}, json.dumps({"access_token": tok, "expires_in": 300}).encode()
        fn = self.routes.get((method, path))
        if fn is None:
            return 404, {}, b"{}"
        return fn(len(self.calls), headers, body)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def cfg(**kw):
    base = dict(client_id=Secret(CID), client_secret=Secret(CSECRET), webhook_secret=Secret(WSECRET), allow_live=True)       # live calls allowed: the transport is a fake
    base.update(kw)
    return BydaConfig(**base)


ENQ = ("POST", "/api/community/enquiries")


def ok_enquiry(n, h, b):
    return 201, {}, json.dumps({"id": "enq-1", "jobNumber": "J123", "status": "open"}).encode()


# ---------------------------------------------------------------------------------------------------------------------------------- client
def test_token_request_shape_and_reuse_until_expiry_then_refresh():
    f, clk = Fake({ENQ: ok_enquiry}), Clock()
    c = BydaClient(cfg(), f, clk)
    c.lodge_enquiry({"geometry": {}})
    c.lodge_enquiry({"geometry": {}})
    tok_calls = [x for x in f.calls if x["path"] == "/api/community/auth/tokens"]
    assert len(tok_calls) == 1 and tok_calls[0]["body"] == {"clientId": CID, "clientSecret": CSECRET} and tok_calls[0]["method"] == "POST"
    assert f.calls[1]["headers"]["Authorization"] == "Bearer " + TOKEN1
    clk.t += 400                                                            # past the stated lifetime (300 s) minus the skew
    c.lodge_enquiry({"geometry": {}})
    assert len([x for x in f.calls if x["path"] == "/api/community/auth/tokens"]) == 2 and f.calls[-1]["headers"]["Authorization"] == "Bearer " + TOKEN2


def test_a_401_renews_the_token_once_and_retries():
    seen = []

    def route(n, h, b):
        seen.append(h["Authorization"])
        return (401, {}, b"{}") if h["Authorization"].endswith("AAA") else ok_enquiry(n, h, b)
    f = Fake({ENQ: route})
    rec = BydaClient(cfg(), f, Clock()).lodge_enquiry({"geometry": {}})
    assert rec["id"] == "enq-1" and rec["job_number"] == "J123" and seen == ["Bearer " + TOKEN1, "Bearer " + TOKEN2]
    always = Fake({ENQ: lambda n, h, b: (401, {}, b"{}")})
    with pytest.raises(BydaError) as e:
        BydaClient(cfg(), always, Clock()).lodge_enquiry({})
    assert e.value.code == "BYDA_AUTH_FAILED" and len([x for x in always.calls if x["path"].endswith("tokens")]) == 2


def test_not_configured_and_bad_credentials_and_unexpected_responses():
    with pytest.raises(BydaError) as e:
        BydaClient(BydaConfig(), Fake(), Clock()).lodge_enquiry({})
    assert e.value.code == "BYDA_NOT_CONFIGURED"
    deny = lambda *a: (401, {}, b"{}")                                       # noqa: E731
    with pytest.raises(BydaError) as e2:
        BydaClient(cfg(), deny, Clock()).token()
    assert e2.value.code == "BYDA_AUTH_FAILED" and CSECRET not in str(e2.value)
    bad = Fake({ENQ: lambda *a: (200, {}, b"[1,2]")})
    with pytest.raises(BydaError) as e3:
        BydaClient(cfg(), bad, Clock()).lodge_enquiry({})
    assert e3.value.code == "BYDA_UNEXPECTED_RESPONSE"
    html = Fake({("GET", "/api/community/enquiries/e/responses/r/files/f"): lambda *a: (200, {"Content-Type": "text/html"}, b"<html>")})
    with pytest.raises(BydaError) as e4:
        BydaClient(cfg(), html, Clock()).download_response_file("e", "r", "f")
    assert "UPLOAD THE PLAN" in e4.value.message


def test_list_enquiries_responses_and_file_download_when_the_api_serves_files():
    f = Fake({("GET", "/api/community/enquiries"): lambda *a: (200, {}, json.dumps({"items": [{"enquiryId": "e1", "referenceNumber": "J9", "state": "closed"}]}).encode()),
              ("GET", "/api/community/enquiries/e1/responses"): lambda *a: (200, {}, json.dumps([{"id": "r1", "assetOwner": "Hunter Water", "files": [{"id": "f1", "fileName": "plan.pdf", "size": 10}]}]).encode()),
              ("GET", "/api/community/enquiries/e1/responses/r1/files/f1"): lambda *a: (200, {"Content-Type": "application/pdf"}, b"%PDF-1.4 x")})
    c = BydaClient(cfg(), f, Clock())
    assert c.list_enquiries() == [{"id": "e1", "job_number": "J9", "status": "closed", "created_at": None, "expires_at": None}]
    r = c.list_responses("e1")
    assert r[0]["owner"] == "Hunter Water" and r[0]["files"][0]["name"] == "plan.pdf"
    assert c.download_response_file("e1", "r1", "f1") == (b"%PDF-1.4 x", "application/pdf")
    assert "e1/responses" in [x for x in f.calls if "responses" in x["path"]][0]["url"]
    missing = BydaClient(cfg(), Fake(), Clock())
    with pytest.raises(BydaError) as e:
        missing.download_response_file("e1", "r1", "f1")
    assert e.value.code == "BYDA_NOT_FOUND"                                   # the API does not serve the file: the plans arrive by email and are uploaded by hand


def test_no_credentials_or_tokens_are_logged_or_shown(caplog):
    caplog.set_level(logging.DEBUG)
    f = Fake({ENQ: ok_enquiry})
    c = BydaClient(cfg(), f, Clock())
    c.lodge_enquiry({"geometry": {}})
    with pytest.raises(BydaError):
        BydaClient(cfg(), lambda *a: (500, {}, b"boom"), Clock()).token()
    with pytest.raises(BydaError):
        BydaClient(cfg(), Fake({ENQ: lambda *a: (500, {}, b"x")}), Clock()).lodge_enquiry({})
    text = caplog.text + repr(cfg()) + str(cfg()) + repr(c.token())
    for s in (CID, CSECRET, WSECRET, TOKEN1, TOKEN2):
        assert s not in text
    assert "byda call=lodge_enquiry status=201" in caplog.text


def test_config_from_env_reads_the_variables(monkeypatch):
    monkeypatch.setenv("BYDA_CLIENT_ID", CID)
    monkeypatch.setenv("BYDA_CLIENT_SECRET", CSECRET)
    monkeypatch.setenv("BYDA_MODE", "commercial")
    c = BydaConfig.from_env()
    assert c.configured and c.client_id.reveal() == CID and c.mode == "COMMERCIAL" and c.rate_max == 90 and c.rate_window_s == 900
    monkeypatch.delenv("BYDA_CLIENT_ID")
    assert not BydaConfig.from_env().configured and BydaConfig.from_env().mode == "COMMERCIAL"
    monkeypatch.delenv("BYDA_MODE")
    assert BydaConfig.from_env().mode == "SANDBOX"


def test_rate_limiter_allows_ninety_per_fifteen_minutes_per_user():
    clk = Clock()
    lim = RateLimiter(90, 900, clk)
    for _ in range(90):
        lim.hit("u1")
    with pytest.raises(RateLimited) as e:
        lim.hit("u1")
    assert 1 <= e.value.retry_after_s <= 901
    lim.hit("u2")                                                           # another user is not affected
    assert lim.remaining("u1") == 0 and lim.remaining("u2") == 89
    clk.t += 901
    lim.hit("u1")
    assert lim.remaining("u1") == 89


def test_lodge_payload_is_a_closed_counter_clockwise_geojson_polygon():
    terrain = TS.terrain_from_bundle(H.bundle(z=lambda x, y: 100.0 + 0 * x, extent=(-10.0, 28.0, -10.0, 44.0)))
    ring = D.lot_polygon_lonlat(terrain, 5.0)
    assert ring[0] == ring[-1] and len(ring) >= 5
    assert all(110 < lon < 155 and -45 < lat < -9 for lon, lat in ring)
    from shapely.geometry import Polygon
    assert Polygon(ring).exterior.is_ccw
    wider, lot = Polygon(ring), Polygon(D.lot_polygon_lonlat(terrain, 0.0))
    assert wider.area > lot.area                                            # the margin is added
    body = M.enquiry_payload(ring, description="new house", start_date="2026-11-01", end_date=None)
    assert body["geometry"]["type"] == "Polygon" and body["geometry"]["coordinates"] == [ring] and body["workDescription"] == "new house" and "endDate" not in body


# ---------------------------------------------------------------------------------------------------------------------------------- API
@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    user = uuid.uuid4()
    app.dependency_overrides[site_design_access] = lambda: user
    f = Fake({ENQ: ok_enquiry, ("GET", "/api/community/enquiries"): lambda *a: (200, {}, json.dumps([{"id": "enq-1", "status": "responded"}]).encode())})
    client = BydaClient(cfg(), f, Clock())
    app.dependency_overrides[D.byda_client] = lambda: client
    lim = RateLimiter(3, 900, Clock())
    app.dependency_overrides[D.byda_limiter] = lambda: lim
    app.dependency_overrides[D.byda_config] = lambda: cfg()
    pid = uuid.uuid4()
    H.write_bundle(tmp_path, pid, H.bundle(z=lambda x, y: 100.0 + 0 * x, extent=(-10.0, 28.0, -10.0, 44.0)))
    return TestClient(app), tmp_path, pid, f, app


def test_enquiry_route_needs_confirmation_lodges_stores_and_rate_limits(api):
    c, tmp, pid, f, app = api
    url = f"/projects/{pid}/dbyd/enquiry"
    assert c.post(url, json={"confirm": False, "margin_m": 5}).status_code == 422
    assert c.post(url, json={"confirm": True}).status_code == 422                       # the margin has no default
    r = c.post(url, json={"confirm": True, "margin_m": 5, "work_description": "new house", "start_date": "2026-11-01"})
    assert r.status_code == 201 and r.json()["job_number"] == "J123" and r.json()["mode"] == "SANDBOX" and r.json()["endpoints"] == "UNCONFIRMED"
    sent = [x for x in f.calls if x["path"] == "/api/community/enquiries"][0]["body"]
    assert sent["geometry"]["type"] == "Polygon" and sent["startDate"] == "2026-11-01"
    lst = c.get(f"/projects/{pid}/dbyd/enquiries").json()
    assert [e["id"] for e in lst["enquiries"]] == ["enq-1"]
    assert CSECRET not in r.text and TOKEN1 not in r.text and CSECRET not in json.dumps(lst)
    c.post(url, json={"confirm": True, "margin_m": 5})
    c.post(url, json={"confirm": True, "margin_m": 5})
    over = c.post(url, json={"confirm": True, "margin_m": 5})
    assert over.status_code == 429 and over.json()["code"] == "RATE_LIMITED"
    refreshed = c.get(f"/projects/{pid}/dbyd/enquiries?refresh=true").json()
    assert refreshed["enquiries"][0]["status"] == "responded" and refreshed["mode"] == "SANDBOX"
    other = uuid.uuid4()
    assert c.get(f"/projects/{other}/dbyd/enquiries").json()["enquiries"] == []             # enquiries are private to the project


def test_enquiry_route_without_credentials_or_lot_is_a_plain_error(api, tmp_path):
    c, tmp, pid, f, app = api
    app.dependency_overrides[D.byda_client] = lambda: BydaClient(BydaConfig(), Fake(), Clock())
    r = c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5})
    assert r.status_code == 503 and r.json()["code"] == "BYDA_NOT_CONFIGURED"
    app.dependency_overrides[D.byda_client] = lambda: BydaClient(cfg(), Fake(), Clock())
    nob = c.post(f"/projects/{uuid.uuid4()}/dbyd/enquiry", json={"confirm": True, "margin_m": 5})
    assert nob.status_code == 409 and nob.json()["code"] == "LOT_NOT_AVAILABLE"


def pdf_bytes(tmp_path, raster=False):
    p = tmp_path / "d.pdf"
    c = canvas.Canvas(str(p), pagesize=(595, 842))
    if raster:
        c.drawString(100, 100, "scan")
        c.save()
        return p.read_bytes()
    c.setLineWidth(2)
    c.setStrokeColor(HexColor("#0000ff")); c.line(100, 300, 400, 300)
    c.setStrokeColor(HexColor("#008000")); c.line(150, 200, 150, 500)
    c.setStrokeColor(HexColor("#0000ff")); c.line(20, 800, 50, 800)
    c.setStrokeColor(HexColor("#008000")); c.line(20, 780, 50, 780)
    c.setFillColor(HexColor("#000000"))
    c.drawString(60, 797, "Water main"); c.drawString(60, 777, "Sewer")
    c.drawString(250, 308, "DN100 CICL depth 0.9"); c.drawString(160, 450, "150mm VC")
    c.save()
    return p.read_bytes()


E0, N0, DEN = 330000.0, 6260000.0, 500
S = DEN * 0.0254 / 72
mga = lambda x, y: [E0 + x * S, N0 + y * S]                                 # noqa: E731
CPS = [[[100, 100], mga(100, 100)], [[500, 100], mga(500, 100)], [[100, 700], mga(100, 700)]]


def upload(c, pid, name, data, ctype="application/pdf", **form):
    return c.post(f"/projects/{pid}/dbyd/plans", files={"file": (name, data, ctype)}, data=form)


def test_plan_upload_checks_size_type_and_content_and_is_private(api, tmp_path, monkeypatch):
    c, tmp, pid, f, app = api
    data = pdf_bytes(tmp_path)
    ok = upload(c, pid, "../../evil name.pdf", data, job_number="J123", asset_owner="Hunter Water", plan_date="2026-09-01")
    assert ok.status_code == 201 and ok.json()["kind"] == "pdf" and "/" not in ok.json()["name"] and ok.json()["job_number"] == "J123" and ok.json()["size_bytes"] == len(data)
    assert upload(c, pid, "x.exe", b"MZ").status_code == 415
    assert upload(c, pid, "x.pdf", b"not a pdf at all").status_code == 422                      # first bytes must match
    assert upload(c, pid, "x.pdf", data, ctype="image/png").status_code == 415                   # the declared type contradicts the file
    assert upload(c, pid, "x.pdf", data, ctype="application/octet-stream").status_code == 201
    assert upload(c, pid, "x.dxf", b"  0\nSECTION\n  2\nHEADER\n", ctype="image/vnd.dxf").status_code == 201
    assert upload(c, pid, "x.dxf", b"%PDF-1.4", ctype="application/octet-stream").status_code == 422
    assert upload(c, pid, "x.dwf", b"(DWF V06.00)xyz", ctype="model/vnd.dwf").status_code == 201
    assert upload(c, pid, "x.pdf", b"").status_code == 422
    assert upload(c, pid, "x.pdf", data, plan_date="01/09/2026").status_code == 422             # dates are stored as ISO
    monkeypatch.setattr(D, "MAX_PLAN_BYTES", 100)
    big = upload(c, pid, "big.pdf", b"%PDF-" + b"0" * 500)
    assert big.status_code == 413
    plans = c.get(f"/projects/{pid}/dbyd/plans").json()["plans"]
    assert len(plans) == 4
    assert c.get(f"/projects/{uuid.uuid4()}/dbyd/plans").json()["plans"] == []                   # private to the project
    assert c.get(f"/projects/{uuid.uuid4()}/dbyd/plans/{plans[0]['plan_id']}/page").status_code == 404


def test_parse_vector_pdf_returns_draft_service_existing_objects(api, tmp_path):
    c, tmp, pid, f, app = api
    plan = upload(c, pid, "dbyd.pdf", pdf_bytes(tmp_path), job_number="J123", asset_owner="Hunter Water", plan_date="2026-09-01").json()
    r = c.post(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/parse", json={"scale_denominator": DEN, "control_points": CPS})
    assert r.status_code == 200
    body = r.json()
    objs = body["objects"]
    assert {o["params"]["service_kind"]["value"] for o in objs} == {"water", "sewer"} and all(o["type"] == "service_existing" and o["origin"] == "dbyd" and o["verified"] is False and o["status"] == "existing" for o in objs)
    w = [o for o in objs if o["params"]["service_kind"]["value"] == "water"][0]
    assert w["params"]["diameter_mm"]["value"] == 100 and w["params"]["material"]["value"] == "CICL" and w["params"]["depth_m"]["value"] == 0.9 and w["params"]["depth_basis"]["value"] == "plan_indicated"
    assert w["params"]["asset_owner"]["value"] == "Hunter Water" and w["params"]["dbyd_job_number"]["value"] == "J123" and w["params"]["plan_date"]["value"] == "2026-09-01"
    # nothing is invented: no tolerance, no expiry, no depth reference unless given
    assert "position_tolerance_m" not in w["params"] and "plan_expiry_date" not in w["params"] and "depth_reference" not in w["params"]
    assert "UNVERIFIED" in body["label"] and body["georeference"]["control_points"] == 3
    # drafts are valid site design objects
    from app.design.site_design import SiteDesign
    SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": objs})
    given = c.post(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/parse", json={"scale_denominator": DEN, "control_points": CPS, "tolerance_m": 0.5, "plan_expiry_date": "2026-12-01"}).json()["objects"][0]
    assert given["params"]["position_tolerance_m"]["value"] == 0.5 and given["params"]["plan_expiry_date"]["value"] == "2026-12-01"


def test_parse_raster_dwf_and_dxf_say_to_trace_manually(api, tmp_path):
    c, tmp, pid, f, app = api
    raster = upload(c, pid, "scan.pdf", pdf_bytes(tmp_path, raster=True)).json()
    r = c.post(f"/projects/{pid}/dbyd/plans/{raster['plan_id']}/parse", json={"scale_denominator": DEN, "control_points": CPS}).json()
    assert r["objects"] == [] and r["code"] == "DBYD_RASTER_UNSUPPORTED" and "TRACE" in r["message"]
    dxf = upload(c, pid, "x.dxf", b"  0\nSECTION\n  2\nHEADER\n", ctype="image/vnd.dxf").json()
    r2 = c.post(f"/projects/{pid}/dbyd/plans/{dxf['plan_id']}/parse", json={}).json()
    assert r2["objects"] == [] and "TRACE" in r2["message"]
    assert c.post(f"/projects/{pid}/dbyd/plans/{raster['plan_id']}/parse", json={"control_points": [CPS[0]]}).status_code == 422
    assert c.post(f"/projects/{pid}/dbyd/plans/{'0' * 32}/parse", json={}).status_code == 404
    assert c.post(f"/projects/{pid}/dbyd/plans/{raster['plan_id']}/parse", json={"plan_date": "01/09/2026"}).status_code == 422


def test_plan_page_renders_a_png_with_the_page_size(api, tmp_path):
    c, tmp, pid, f, app = api
    plan = upload(c, pid, "dbyd.pdf", pdf_bytes(tmp_path)).json()
    r = c.get(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/page?width_px=800")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n" and float(r.headers["x-page-width-pt"]) == pytest.approx(595, abs=1) and r.headers["x-page-count"] == "1"
    assert c.get(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/page?page=2").status_code == 422
    assert c.get(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/page?width_px=99999").status_code == 422
    dxf = upload(c, pid, "x.dxf", b"  0\nSECTION\n  2\nHEADER\n", ctype="image/vnd.dxf").json()
    assert c.get(f"/projects/{pid}/dbyd/plans/{dxf['plan_id']}/page").status_code == 415


# ---------------------------------------------------------------------------------------------------------------------------------- webhook
_DELIVERY = iter(range(1, 10_000))


def fresh_headers(**extra):
    """The shared secret plus a current timestamp and a delivery id that has not been used."""
    import time
    return {"X-JCE-Webhook-Secret": WSECRET, "X-JCE-Webhook-Timestamp": str(int(time.time())), "X-JCE-Webhook-Delivery-Id": f"d-{next(_DELIVERY)}", **extra}


def test_webhook_needs_the_shared_secret_and_a_project_with_an_enquiry(api):
    c, tmp, pid, f, app = api
    url = f"/integrations/byda/webhook/{pid}"
    body = json.dumps({"enquiryId": "enq-1", "status": "responded", "event": "response.received"})
    assert c.post(url, content=body).status_code == 401                                          # no secret
    assert c.post(url, content=body, headers={"X-JCE-Webhook-Secret": "wrong"}).status_code == 401
    ok_h = fresh_headers()
    assert c.post(url, content=body, headers=ok_h).status_code == 404                           # no enquiry lodged for this project yet
    c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5})
    ok_h = fresh_headers()
    r = c.post(url, content=body, headers=ok_h)
    assert r.status_code == 202 and r.json() == {"received": True}
    e = c.get(f"/projects/{pid}/dbyd/enquiries").json()["enquiries"][0]
    assert e["status"] == "responded" and e["last_event_at"]
    assert c.post(url, content=b"x" * (300 * 1024), headers=fresh_headers()).status_code == 413
    app.dependency_overrides[D.byda_config] = lambda: cfg(webhook_secret=Secret(""))
    assert c.post(url, content=body, headers=fresh_headers()).status_code == 503                           # no secret configured: the route refuses everything


def test_webhook_hmac_is_checked_only_when_configured(api):
    import hashlib
    import hmac
    c, tmp, pid, f, app = api
    c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5})
    app.dependency_overrides[D.byda_config] = lambda: cfg(webhook_hmac_header="X-Signature")
    body = json.dumps({"enquiryId": "enq-1"}).encode()
    url = f"/integrations/byda/webhook/{pid}"
    h = fresh_headers()
    sig = hmac.new(WSECRET.encode(), f"{h['X-JCE-Webhook-Timestamp']}.{h['X-JCE-Webhook-Delivery-Id']}.".encode() + body, hashlib.sha256).hexdigest()      # covers the replay headers and the body
    assert c.post(url, content=body, headers=h).status_code == 401
    assert c.post(url, content=body, headers={**h, "X-Signature": "0" * 64}).status_code == 401
    assert c.post(url, content=body, headers={**h, "X-Signature": hmac.new(WSECRET.encode(), body, hashlib.sha256).hexdigest()}).status_code == 401      # a body only signature no longer passes
    assert c.post(url, content=body, headers={**h, "X-Signature": "sha256=" + sig}).status_code == 202


def test_dbyd_routes_without_a_user_are_401(tmp_path):
    t = TestClient(create_app(Settings(export_dir=str(tmp_path)), pool=object()))
    assert t.post(f"/projects/{uuid.uuid4()}/dbyd/enquiry", json={"confirm": True, "margin_m": 1}).status_code == 401
    assert t.get(f"/projects/{uuid.uuid4()}/dbyd/plans").status_code == 401

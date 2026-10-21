"""Stage 8 review fixes for the BYDA package and the DBYD routes: sandbox, redirects, lodgement records, webhook replay, atomic stores, paging, upload and time limits, bases.
The transport is a fake; no call leaves the machine."""
from __future__ import annotations

import asyncio
import http.server
import json
import multiprocessing as mp
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import pytest

import lock_worker
import site_support as H
from app.api import dbyd as D
from app.common import filestore as FS
from app.common.timeboxed import ChildError, TimedOut, run_timeboxed
from app.design.site_design import SiteDesign
from app.integrations.byda import client as CL
from app.integrations.byda import mapping as M
from app.integrations.byda.client import BydaClient, BydaError
from app.integrations.byda.config import BydaConfig
from app.integrations.byda.store import UNKNOWN_STATUS, DbydStore
from test_byda_stage8 import CSECRET, ENQ, TOKEN1, WSECRET, Clock, Fake, api, cfg, fresh_headers, ok_enquiry, pdf_bytes, upload  # noqa: F401

LIST = ("GET", "/api/community/enquiries")


def stored(tmp, pid):
    return json.loads((tmp / str(pid) / "dbyd" / "enquiries.json").read_text())


# ---------------------------------------------------------------------------------------------------------------------------------- 3 sandbox
def test_allow_live_comes_from_the_environment_and_defaults_to_off(monkeypatch):
    monkeypatch.delenv("BYDA_ALLOW_LIVE", raising=False)
    monkeypatch.delenv("BYDA_MODE", raising=False)
    c = BydaConfig.from_env()
    assert c.mode == "SANDBOX" and c.allow_live is False and c.live_blocked is True
    monkeypatch.setenv("BYDA_ALLOW_LIVE", "true")
    assert BydaConfig.from_env().live_blocked is False
    monkeypatch.setenv("BYDA_ALLOW_LIVE", "yes")
    assert BydaConfig.from_env().allow_live is False                            # only the word true switches it on
    monkeypatch.delenv("BYDA_ALLOW_LIVE")
    monkeypatch.setenv("BYDA_MODE", "commercial")
    assert BydaConfig.from_env().live_blocked is False                          # commercial mode is live by definition


def test_sandbox_mode_refuses_to_lodge_and_to_refresh_unless_live_is_allowed(api):
    c, tmp, pid, f, app = api
    off = BydaClient(cfg(allow_live=False), f, Clock())
    app.dependency_overrides[D.byda_client] = lambda: off
    r = c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5})
    assert r.status_code == 403 and r.json()["code"] == "BYDA_LIVE_OFF" and "SANDBOX" in r.json()["message"] and "BYDA_ALLOW_LIVE" in r.json()["message"]
    assert f.calls == [] and not (tmp / str(pid) / "dbyd" / "enquiries.json").exists()      # nothing was sent and nothing was recorded
    got = c.get(f"/projects/{pid}/dbyd/enquiries?refresh=true").json()
    assert f.calls == [] and "SANDBOX" in got["refresh_error"] and got["live_calls"] is False and got["mode"] == "SANDBOX"
    on = BydaClient(cfg(allow_live=True), f, Clock())
    app.dependency_overrides[D.byda_client] = lambda: on
    assert c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5}).status_code == 201
    live = c.get(f"/projects/{pid}/dbyd/enquiries?refresh=true").json()
    assert live["live_calls"] is True and live["refresh_error"] is None
    com = BydaClient(cfg(allow_live=False, mode="COMMERCIAL"), f, Clock())
    app.dependency_overrides[D.byda_client] = lambda: com
    assert c.get(f"/projects/{pid}/dbyd/enquiries").json()["live_calls"] is True


def test_the_real_transport_is_never_reached_in_sandbox_mode(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a live call was attempted")
    monkeypatch.setattr(CL, "_OPENER", type("O", (), {"open": boom})())
    off = BydaClient(cfg(allow_live=False))                                      # no injected transport: the real one
    with pytest.raises(BydaError) as e:
        off.token()
    assert e.value.code == "BYDA_LIVE_OFF"
    with pytest.raises(BydaError):
        off.lodge_enquiry({"geometry": {}})
    with pytest.raises(BydaError):
        off.list_enquiries()


# ---------------------------------------------------------------------------------------------------------------------------------- 6 redirects
def test_redirects_are_not_followed_and_are_an_error(monkeypatch):
    import urllib.request as ur
    assert not any(type(h) is ur.HTTPRedirectHandler for h in CL._OPENER.handlers) and any(isinstance(h, CL._NoRedirect) for h in CL._OPENER.handlers)
    assert CL._NoRedirect().redirect_request(ur.Request("https://a.example/"), None, 302, "Found", {}, "https://evil.example/") is None

    class Opener:
        def open(self, req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 302, "Found", {"Location": "https://evil.example/"}, None)
    monkeypatch.setattr(CL, "_OPENER", Opener())
    with pytest.raises(BydaError) as e:
        CL.urllib_transport("POST", "https://smarterwx.byda.com.au/api/community/enquiries", {"Authorization": "Bearer x"}, b"{}", 5)
    assert e.value.code == "BYDA_REDIRECT_REFUSED" and "evil" not in e.value.message


def test_a_real_redirect_is_not_followed_and_the_target_gets_no_request():
    hits = []

    class Target(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(dict(self.headers))
            self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
        log_message = lambda *a: None                                           # noqa: E731
    target = http.server.HTTPServer(("127.0.0.1", 0), Target)

    class Redirector(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302); self.send_header("Location", f"http://127.0.0.1:{target.server_port}/stolen"); self.end_headers()
        log_message = lambda *a: None                                           # noqa: E731
    redirector = http.server.HTTPServer(("127.0.0.1", 0), Redirector)
    for srv in (target, redirector):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{redirector.server_port}/x", headers={"Authorization": "Bearer secret"})
        with pytest.raises(urllib.error.HTTPError) as e:
            CL._OPENER.open(req, timeout=5)
        assert e.value.code == 302 and hits == []                              # the bearer token never went to the redirect target
    finally:
        target.shutdown(); redirector.shutdown()


# ---------------------------------------------------------------------------------------------------------------------------------- 7 lodgement records
def lodge(c, pid, **kw):
    return c.post(f"/projects/{pid}/dbyd/enquiry", json={"confirm": True, "margin_m": 5, **kw})


def test_a_pending_record_with_a_client_reference_exists_before_the_call_and_becomes_lodged(api):
    c, tmp, pid, f, app = api
    seen = {}

    def route(n, h, b):
        seen["rows"] = stored(tmp, pid)
        return ok_enquiry(n, h, b)
    f.routes[ENQ] = route
    r = lodge(c, pid)
    assert r.status_code == 201 and r.json()["lodge_state"] == "lodged" and r.json()["job_number"] == "J123" and r.json()["client_ref"]
    assert len(seen["rows"]) == 1 and seen["rows"][0]["lodge_state"] == "pending" and seen["rows"][0]["client_ref"] == r.json()["client_ref"]
    assert len(stored(tmp, pid)) == 1


@pytest.mark.parametrize("answer", [
    lambda n, h, b: (200, {}, b"{}"),                                            # 2xx without an id
    lambda n, h, b: (200, {}, b"not json"),
    lambda n, h, b: (200, {}, b"[1]"),
    lambda n, h, b: (502, {}, b"bad gateway"),                                   # a 5xx after the request was sent
    lambda n, h, b: (_ for _ in ()).throw(BydaError("BYDA_UNREACHABLE", "BYDA COULD NOT BE REACHED", after_send=True)),         # timeout after send
], ids=["no_id", "not_json", "not_object", "5xx", "timeout_after_send"])
def test_an_ambiguous_lodgement_is_kept_as_unknown_and_blocks_a_second_lodgement(api, answer):
    c, tmp, pid, f, app = api
    f.routes[ENQ] = answer
    r = lodge(c, pid)
    assert r.status_code == 502 and r.json()["code"] == "LODGEMENT_OUTCOME_UNKNOWN" and UNKNOWN_STATUS in r.json()["message"]
    rows = stored(tmp, pid)
    assert len(rows) == 1 and rows[0]["lodge_state"] == "unknown" and rows[0]["status"] == "LODGEMENT OUTCOME UNKNOWN, CHECK BYDA PORTAL" and rows[0]["client_ref"]
    calls = len([x for x in f.calls if x["path"] == "/api/community/enquiries"])
    again = lodge(c, pid)
    assert again.status_code == 409 and again.json()["code"] == "LODGEMENT_OUTCOME_UNKNOWN" and "CHECK BYDA PORTAL" in again.json()["message"]
    assert len([x for x in f.calls if x["path"] == "/api/community/enquiries"]) == calls          # no automatic re-lodge
    lst = c.get(f"/projects/{pid}/dbyd/enquiries").json()
    assert lst["unresolved_lodgement"] == rows[0]["client_ref"]
    other = uuid.uuid4()
    H.write_bundle(tmp, other, H.bundle(z=lambda x, y: 100.0 + 0 * x, extent=(-10.0, 28.0, -10.0, 44.0)))
    f.routes[ENQ] = ok_enquiry
    assert lodge(c, other).status_code == 201                                      # another project is not blocked


def test_the_user_resolves_an_unknown_lodgement_before_a_new_one_is_allowed(api):
    c, tmp, pid, f, app = api
    f.routes[ENQ] = lambda n, h, b: (200, {}, b"{}")
    lodge(c, pid)
    ref = stored(tmp, pid)[0]["client_ref"]
    res = f"/projects/{pid}/dbyd/enquiries/{ref}/resolve"
    assert c.post(res, json={"outcome": "lodged"}).status_code == 422             # the job number read off the portal is needed
    assert c.post(res, json={"outcome": "maybe"}).status_code == 422
    assert c.post(f"/projects/{pid}/dbyd/enquiries/{'0' * 32}/resolve", json={"outcome": "not_lodged"}).status_code == 404
    r = c.post(res, json={"outcome": "not_lodged"})
    assert r.status_code == 200 and r.json()["lodge_state"] == "failed"
    assert c.post(res, json={"outcome": "not_lodged"}).status_code == 409            # already resolved
    f.routes[ENQ] = ok_enquiry
    assert lodge(c, pid).status_code == 201                                         # resolved as not lodged: a new lodgement is allowed


def test_a_user_recorded_job_number_is_marked_as_entered_by_the_user(api):
    c, tmp, pid, f, app = api
    f.routes[ENQ] = lambda n, h, b: (_ for _ in ()).throw(BydaError("BYDA_UNREACHABLE", "x", after_send=True))
    lodge(c, pid)
    ref = stored(tmp, pid)[0]["client_ref"]
    r = c.post(f"/projects/{pid}/dbyd/enquiries/{ref}/resolve", json={"outcome": "lodged", "job_number": "J777"})
    assert r.status_code == 200 and r.json()["job_number"] == "J777" and r.json()["reference_source"] == "ENTERED BY THE USER" and r.json()["lodge_state"] == "lodged"
    f.routes[ENQ] = ok_enquiry
    assert lodge(c, pid).status_code == 201


def test_a_definite_refusal_is_not_ambiguous_and_allows_another_try(api):
    c, tmp, pid, f, app = api
    f.routes[ENQ] = lambda n, h, b: (400, {}, b"{}")
    r = lodge(c, pid)
    assert r.status_code == 502 and r.json()["code"] == "BYDA_ERROR"
    assert stored(tmp, pid)[0]["lodge_state"] == "failed"
    f.routes[ENQ] = ok_enquiry
    assert lodge(c, pid).status_code == 201


def test_a_stale_pending_record_becomes_unknown_and_blocks(api, monkeypatch):
    c, tmp, pid, f, app = api
    st = DbydStore(tmp / str(pid))
    rec = st.begin_lodgement({"lodged_by": "u"})
    assert st.blocking_lodgement()["lodge_state"] == "pending"
    import types

    import app.integrations.byda.store as store_mod
    monkeypatch.setattr(store_mod, "time", types.SimpleNamespace(time=lambda: rec["requested_epoch"] + 500))        # more than the stale limit later
    assert st.blocking_lodgement()["lodge_state"] == "unknown"


def test_error_classes_say_when_the_outcome_is_ambiguous():
    assert BydaError("X", "m", 500, after_send=True).ambiguous and BydaError("X", "m", None, after_send=True).ambiguous
    assert not BydaError("X", "m", 400, after_send=True).ambiguous and not BydaError("X", "m", 429, after_send=True).ambiguous and not BydaError("X", "m").ambiguous


# ---------------------------------------------------------------------------------------------------------------------------------- 8 webhook replay and atomic stores
def hook(c, pid, body=b'{"enquiryId": "enq-1"}', **hdr):
    h = fresh_headers()
    h.update(hdr)
    for k in [k for k, v in h.items() if v is None]:
        del h[k]
    return c.post(f"/integrations/byda/webhook/{pid}", content=body, headers=h)


def test_webhook_needs_a_fresh_timestamp_and_rejects_a_repeated_delivery_id(api):
    c, tmp, pid, f, app = api
    lodge(c, pid)
    def at(offset: int) -> str:                               # the server clock is read when each request is sent, so a slow run cannot move a case across the five minute limit
        return str(int(time.time()) + offset)
    assert hook(c, pid).status_code == 202
    h = fresh_headers()
    assert c.post(f"/integrations/byda/webhook/{pid}", content=b"{}", headers=h).status_code == 202
    again = c.post(f"/integrations/byda/webhook/{pid}", content=b"{}", headers=h)                       # the very same delivery
    assert again.status_code == 409 and again.json()["code"] == "WEBHOOK_REPLAY"
    same_id_new_time = c.post(f"/integrations/byda/webhook/{pid}", content=b"{}", headers={**h, "X-JCE-Webhook-Timestamp": at(5)})
    assert same_id_new_time.status_code == 409
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": None}).status_code == 401                          # a timestamp is required
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": "yesterday"}).status_code == 401
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": at(-310)}).json()["code"] == "WEBHOOK_STALE"
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": at(310)}).status_code == 401
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": at(-200)}).status_code == 202                 # inside five minutes
    assert hook(c, pid, **{"X-JCE-Webhook-Delivery-Id": None}).json()["code"] == "WEBHOOK_DELIVERY_ID_REQUIRED"
    assert hook(c, pid, **{"X-JCE-Webhook-Delivery-Id": "has space"}).status_code == 401
    iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    assert hook(c, pid, **{"X-JCE-Webhook-Timestamp": iso}).status_code == 202                           # an ISO time with a zone is read too
    assert hook(c, pid, **{"X-JCE-Webhook-Secret": "wrong"}).status_code == 401


def test_delivery_ids_are_remembered_for_a_while_then_forgotten_and_survive_a_new_store_object(tmp_path):
    st = DbydStore(tmp_path)
    assert st.claim_delivery("a", now=1000.0) and not st.claim_delivery("a", now=1010.0)
    assert not DbydStore(tmp_path).claim_delivery("a", now=1020.0)                  # kept on disk
    assert DbydStore(tmp_path).claim_delivery("a", now=1000.0 + 4000)               # forgotten after the retention time


def test_file_lock_serialises_read_modify_write_across_processes(tmp_path):
    target = tmp_path / "counter.json"
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=lock_worker.increment, args=(str(target), 25)) for _ in range(4)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(120)
        assert p.exitcode == 0
    assert json.loads(target.read_text()) == 100                                    # no lost update
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []


def test_atomic_write_leaves_the_old_file_when_the_write_fails_and_uses_unique_temp_names(tmp_path, monkeypatch):
    p = tmp_path / "x.json"
    FS.atomic_write_json(p, [1])
    monkeypatch.setattr(FS.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(OSError):
        FS.atomic_write_json(p, [2])
    assert json.loads(p.read_text()) == [1] and [q.name for q in tmp_path.iterdir() if q.name.endswith(".tmp")] == []


# ---------------------------------------------------------------------------------------------------------------------------------- 9 paging
def paged_transport(pages, calls):
    """A transport that serves ``pages`` (page number -> body) for GET /enquiries and issues a token."""
    def t(method, url, headers, body, timeout):
        if url.endswith("/auth/tokens"):
            return 200, {}, json.dumps({"access_token": TOKEN1, "expires_in": 300}).encode()
        calls.append(url)
        q = dict(x.split("=") for x in url.split("?", 1)[1].split("&")) if "?" in url else {}
        key = q.get("page") or q.get("cursor") or "1"
        return 200, {}, json.dumps(pages[key]).encode()
    return t


def page(ids, **meta):
    return {"items": [{"id": i, "jobNumber": f"J{i}", "status": "open"} for i in ids], **meta}


def test_list_enquiries_follows_the_paging_fields_up_to_the_limit():
    calls = []
    pages = {"1": page(["a", "b"], page=1, totalPages=3), "2": page(["c"], page=2, totalPages=3), "3": page(["d"], page=3, totalPages=3)}
    got = BydaClient(cfg(), paged_transport(pages, calls), Clock()).list_enquiries()
    assert [r["id"] for r in got] == ["a", "b", "c", "d"] and len(calls) == 3 and calls[1].endswith("?page=2") and calls[2].endswith("?page=3")
    # the paging fields in an envelope, hasMore and nextPage styles
    env = {"1": {"items": [{"id": "a"}], "pagination": {"hasMore": True}}, "2": {"items": [{"id": "b"}], "pagination": {"hasMore": False}}}
    assert [r["id"] for r in BydaClient(cfg(), paged_transport(env, []), Clock()).list_enquiries()] == ["a", "b"]
    nxt = {"1": page(["a"], nextPage=2), "2": page(["b"], nextPage=None)}
    assert [r["id"] for r in BydaClient(cfg(), paged_transport(nxt, []), Clock()).list_enquiries()] == ["a", "b"]
    cur = {"1": page(["a"], nextCursor="zz"), "zz": page(["b"])}
    c2 = []
    assert [r["id"] for r in BydaClient(cfg(), paged_transport(cur, c2), Clock()).list_enquiries()] == ["a", "b"] and c2[1].endswith("?cursor=zz")
    bare = []
    assert len(BydaClient(cfg(), paged_transport({"1": [{"id": "a"}]}, bare), Clock()).list_enquiries()) == 1 and len(bare) == 1         # a bare list is the whole list


def test_paging_is_bounded_and_stops_on_a_repeated_or_empty_page():
    calls = []
    endless = {str(n): page([f"id{n}"], page=n, hasMore=True) for n in range(1, 50)}
    items, truncated = BydaClient(cfg(), paged_transport(endless, calls), Clock()).list_enquiries_paged(max_pages=4)
    assert len(items) == 4 and len(calls) == 4 and truncated is True
    stuck_calls = []
    stuck = {"1": page(["a"], hasMore=True), "2": page(["a"], hasMore=True)}                       # the server ignores the page number
    items2, trunc2 = BydaClient(cfg(), paged_transport(stuck, stuck_calls), Clock()).list_enquiries_paged()
    assert [r["id"] for r in items2] == ["a"] and len(stuck_calls) == 2 and trunc2 is False
    empty = {"1": page(["a"], hasMore=True), "2": page([], hasMore=True)}
    assert len(BydaClient(cfg(), paged_transport(empty, []), Clock()).list_enquiries()) == 1
    assert M.next_request(page(["a"], totalPages=1, page=1), 1) is None and M.next_request("x", 1) is None


def test_refresh_merges_an_enquiry_that_is_on_a_later_page(api):
    c, tmp, pid, f, app = api
    lodge(c, pid)                                                                  # enq-1 / J123
    pages = {"1": page(["zzz"], page=1, totalPages=2), "2": {"items": [{"id": "enq-1", "jobNumber": "J123", "status": "responded"}], "page": 2, "totalPages": 2}}
    app.dependency_overrides[D.byda_client] = lambda: BydaClient(cfg(), paged_transport(pages, []), Clock())
    got = c.get(f"/projects/{pid}/dbyd/enquiries?refresh=true").json()
    assert [e["status"] for e in got["enquiries"]] == ["responded"] and got["refresh_error"] is None


# ---------------------------------------------------------------------------------------------------------------------------------- 10 upload cap and time limits
def test_the_plan_upload_is_cut_off_while_it_streams(api, monkeypatch):
    c, tmp, pid, f, app = api
    chunk = b"0" * (1024 * 1024)
    consumed = 0
    total_offered = 100
    boundary = "xBOUNDARYx"
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"big.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n").encode()
    sent = []

    async def run():
        nonlocal consumed
        chunks = iter([head + chunk] + [chunk] * (total_offered - 1))

        async def receive():
            nonlocal consumed
            await asyncio.sleep(0)
            try:
                b = next(chunks)
            except StopIteration:
                return {"type": "http.request", "body": b"", "more_body": False}
            consumed += 1
            return {"type": "http.request", "body": b, "more_body": True}

        async def send(msg):
            sent.append(msg)
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": f"/projects/{pid}/dbyd/plans", "raw_path": f"/projects/{pid}/dbyd/plans".encode(),
                 "query_string": b"", "root_path": "", "scheme": "http", "server": ("test", 80), "client": ("test", 1),
                 "headers": [(b"content-type", f"multipart/form-data; boundary={boundary}".encode()), (b"host", b"test")], "app": app, "state": {}}
        await app(scope, receive, send)
    asyncio.run(run())
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    assert status == 413
    assert consumed <= 27, f"{consumed} chunks were read before the upload was refused"        # the 25 MB cap plus framing, not the 100 MB offered
    assert not (tmp / str(pid) / "dbyd" / "plans.json").exists()


def test_run_timeboxed_returns_kills_and_reports_child_errors():
    assert run_timeboxed(lock_worker.quick_job, 21, timeout_s=60) == 42
    t0 = time.monotonic()
    with pytest.raises(TimedOut):
        run_timeboxed(lock_worker.sleep_job, 60, timeout_s=3)
    assert time.monotonic() - t0 < 30                                              # the sleeping worker was killed, not waited for
    with pytest.raises(ChildError) as e:
        run_timeboxed(lock_worker.failing_job, timeout_s=60)
    assert e.value.error_code == "SOME_CODE"


def test_a_pdf_render_or_parse_over_the_time_limit_is_422(api, tmp_path, monkeypatch):
    c, tmp, pid, f, app = api
    plan = upload(c, pid, "dbyd.pdf", pdf_bytes(tmp_path)).json()
    monkeypatch.setattr(D, "PDF_TIME_LIMIT_S", 0.01)                                # shorter than a worker process can start
    page_ = c.get(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/page?width_px=400")
    assert page_.status_code == 422 and page_.json()["code"] == "PDF_TIMEOUT"
    parsed = c.post(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/parse", json={})
    assert parsed.status_code == 422 and parsed.json()["code"] == "PDF_TIMEOUT"


# ---------------------------------------------------------------------------------------------------------------------------------- 11 bases of parsed values
def test_parsed_values_are_plan_indicated_and_the_users_entries_stay_user(api, tmp_path):
    from test_byda_stage8 import CPS, DEN
    c, tmp, pid, f, app = api
    plan = upload(c, pid, "dbyd.pdf", pdf_bytes(tmp_path), job_number="J123", asset_owner="Hunter Water", plan_date="2026-09-01").json()
    objs = c.post(f"/projects/{pid}/dbyd/plans/{plan['plan_id']}/parse", json={"scale_denominator": DEN, "control_points": CPS, "tolerance_m": 0.5}).json()["objects"]
    w = [o for o in objs if o["params"]["service_kind"]["value"] == "water"][0]
    for k in ("service_kind", "diameter_mm", "material", "depth_m", "depth_basis", "source_file"):
        assert w["params"][k]["basis"] == "plan_indicated" and w["params"][k]["ref"], k
    for k in ("asset_owner", "dbyd_job_number", "plan_date", "position_tolerance_m"):
        assert w["params"][k]["basis"] == "user", k
    d = SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": objs})
    from app.design.param_basis import Reader
    from app.design.service_model import read_service
    s = read_service(d.objects[0], Reader(None))
    assert s.kind in ("water", "sewer") and s.basis == "plan_indicated"


# ---------------------------------------------------------------------------------------------------------------------------------- 4 verification on PUT
def _verified(depth=1.2, by="J Citizen", pts=((330000.0, 6260000.0), (330010.0, 6260000.0))):
    return {"id": "s1", "type": "service_existing", "status": "existing", "origin": "user", "verified": True, "verified_on": "2026-09-05",
            "geometry": {"kind": "polyline", "pts": [list(p) for p in pts]},
            "params": {"service_kind": {"value": "water", "basis": "user"}, "depth_m": {"value": depth, "basis": "user"}, "depth_reference": {"value": "top", "basis": "user"},
                       "verified_by": {"value": by, "basis": "user"}}}


def test_put_clears_the_verification_of_an_edited_service_and_locks_verified_by(api):
    c, tmp, pid, f, app = api
    url = f"/projects/{pid}/site-design"
    r1 = c.put(url, json={"schema": "site_design.v1", "version": 0, "objects": [_verified()]})
    assert r1.status_code == 200 and r1.json()["objects"][0]["verified"] is True
    same = c.put(url, json={"schema": "site_design.v1", "version": 1, "objects": [_verified()]})
    assert same.status_code == 200 and same.json()["objects"][0]["verified"] is True
    edited = c.put(url, json={"schema": "site_design.v1", "version": 2, "objects": [_verified(depth=1.5)]})
    o = edited.json()["objects"][0]
    assert edited.status_code == 200 and o["verified"] is False and "verified_on" not in o and "verified_by" not in o["params"]
    assert any(i["message"].startswith("VERIFICATION CLEARED BY EDIT") for i in o["issues"])
    again = c.put(url, json={"schema": "site_design.v1", "version": 3, "objects": [_verified(by="Someone Else")]})            # stored version is not verified now: verifying anew is allowed
    assert again.status_code == 200 and again.json()["objects"][0]["verified"] is True
    locked = c.put(url, json={"schema": "site_design.v1", "version": 4, "objects": [_verified(by="Third Person")]})
    assert locked.status_code == 422 and locked.json()["code"] == "VERIFIED_BY_LOCKED"
    moved = c.put(url, json={"schema": "site_design.v1", "version": 4, "objects": [_verified(by="Someone Else", pts=((330000.0, 6260001.0), (330010.0, 6260000.0)))]})
    assert moved.json()["objects"][0]["verified"] is False

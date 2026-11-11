#!/usr/bin/env python3
"""Browser end-to-end test of the Pocket Architect AI assistant through the real Worker (Miniflare) with a scripted mock Anthropic.
Run from the repo root:  python3 server/test/e2e-ai/run_e2e.py        (needs: node 22, python playwright + chromium)
Starts the harness (ports 8805 mock, 8806 web+API), drives Chromium, writes screenshots to qa/ai/, exits non-zero on any failure."""
import json, subprocess, sys, time, urllib.request, os, pathlib, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[3]; QA = ROOT / "qa" / "ai"; QA.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:8806"

def ctl(path, body=None):
    r = urllib.request.Request(f"{BASE}/__ctl/{path}", data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    return json.load(urllib.request.urlopen(r, timeout=20))
sql = lambda q, a=(): ctl("sql", {"sql": q, "args": list(a)})

proc = subprocess.Popen(["node", str(ROOT / "server/test/e2e-ai/harness.mjs")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
t0 = time.time()
while True:
    line = proc.stdout.readline()
    if "READY" in line: break
    if not line or time.time() - t0 > 60: print("harness failed to start"); proc.kill(); sys.exit(2)
fails = []
def check(name, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f"  [{extra}]" if extra and not cond else "")); 
    if not cond: fails.append(name)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1440, "height": 900}); cap = {}
        def route(r):
            u = r.request.url
            if "fonts.g" in u: return r.abort()
            if u.endswith("/api/checkout"):  # we only need the project id the app would pay for; Stripe is not part of this test
                cap["body"] = r.request.post_data; return r.fulfill(status=503, content_type="application/json", body='{"error":{"code":"PAYMENTS_UNAVAILABLE","message":"x"}}')
            r.continue_()
        pg.route("**/*", route)
        shot = lambda n: pg.screenshot(path=str(QA / n))
        def rooms():
            pg.wait_for_timeout(1200)  # autosave debounce
            d = pg.evaluate("JSON.parse(localStorage.getItem('ps.autosave.v1'))")
            return [r for l in d["levels"] for r in l.get("rooms", [])]
        def used(): return sql("SELECT credits_used u, credits_total t FROM entitlements WHERE id='e_e2e1'")[0]
        def say(text, wait=2500):
            ta = pg.locator("textarea:visible").last; ta.fill(text); pg.keyboard.press("Enter"); pg.wait_for_timeout(wait)
            ok = pg.locator("button:visible", has_text="Continue")
            if "This may use a lot of credits" in pg.inner_text("body") and ok.count():  # the app's own confirmation for a large share of the remaining credits
                shot("confirm-dialog.png"); ok.last.click(); pg.wait_for_timeout(wait)
        def panel(): return pg.inner_text("body")

        pg.goto(BASE + "/plan-studio/app/", wait_until="load"); pg.wait_for_timeout(3000)
        pg.get_by_text("Keep exploring").click(); pg.wait_for_timeout(300)
        pg.get_by_role("button", name="Skip").click(); pg.wait_for_timeout(300)
        pg.get_by_role("button", name="Unlock plans, A$35").click(); pg.wait_for_timeout(800)
        pg.get_by_role("button", name="Continue to secure checkout").click(); pg.wait_for_timeout(1000)
        pid = json.loads(cap["body"])["projectId"]
        sql("INSERT INTO entitlements(id,project_id,email,stripe_session_id,payment_intent,amount_cents,currency,credits_total,pdf_used,pdf_allowed,status,created_at) VALUES('e_e2e1',?,'buyer@example.com','cs_e2e','pi_e2e1',3500,'aud',500,0,1,'active','2026-10-14')", [pid])
        pg.locator("button:visible", has_text="Restore purchase").first.click(); pg.wait_for_timeout(500)
        pg.fill("input[name=email]", "buyer@example.com"); pg.fill("input[name=reference]", "pi_e2e1")
        pg.locator("button:visible", has_text="Restore purchase").last.click(); pg.wait_for_timeout(2000)
        check("restore unlocks this design", "active for the design that is open now" in panel())
        shot("01-restored.png"); pg.get_by_role("button", name="Done").click(); pg.wait_for_timeout(500)
        pg.locator("button:visible", has_text="ASSISTANT").click(); pg.wait_for_timeout(800)
        check("assistant shows 500 of 500 credits", "500 of 500 credits left" in panel()); shot("02-assistant-ready.png")

        n0 = len(rooms())
        say("Add a 3 x 4 m study on the east side")
        r1 = rooms(); study = [r for r in r1 if (r.get("name") or "") == "Study"]
        check("one room added", len(r1) == n0 + 1, f"{n0}->{len(r1)}")
        xs = [q["x"] for q in study[0]["polygon"]] if study else [0]; ys = [q["y"] for q in study[0]["polygon"]] if study else [0]
        check("study is 3000 x 4000 mm and east of the existing plan (x >= 19400)", bool(study) and max(xs) - min(xs) == 3000 and max(ys) - min(ys) == 4000 and min(xs) >= 19400, json.dumps(study)[:300])
        fx = ROOT / "server/test/fixtures/ai-plan-4bed.json"  # plan text exactly as the running app sends it (refreshed on each run)
        sent = ctl("mocklast")["text"]; m = re.search(r"<plan>\n([\s\S]*)\n</plan>", sent); lvl = re.search(r"ACTIVE_LEVEL (\S+)", sent)
        if m: fx.write_text(json.dumps({"source": "Pocket Architect template: Single storey, 4 bedroom", "activeLevelId": lvl.group(1) if lvl else "", "context": m.group(1)}, indent=1) + "\n")
        txt = panel(); u = used()
        check("reply shown", "I have added a study on the east side" in txt)
        check("changes listed", "Added Study" in txt)
        check("credits charged server side", 0 < u["u"] < 40, u)
        check("meter drops to match the server", f"{500 - u['u']} of 500 credits left" in txt, txt[txt.find('of 500'):][:30])
        ml = ctl("mocklog"); check("upstream got key, version header, caching", ml and ml[-1]["key"] == "present" and ml[-1]["version"] == "2023-06-01" and ml[-1]["cached"] and ml[-1]["tools"] >= 25, ml[-1:] )
        shot("03-after-ai-edit.png")
        pg.locator(".psp-msg button", has_text="Undo").last.click(); pg.wait_for_timeout(600)
        check("Undo reverts the AI change", len(rooms()) == n0); shot("04-after-undo.png")

        say("Please make two changes"); r2 = rooms()
        check("two AI ops applied, unknown tool dropped", len(r2) == n0 + 2, f"{n0}->{len(r2)}")
        check("unknown tool not shown as a failure", "delete_everything" not in panel().lower() and "could not be applied" not in panel().lower())
        pg.locator(".psp-msg button", has_text="Undo").last.click(); pg.wait_for_timeout(600)
        check("ONE Undo reverts the whole two change reply", len(rooms()) == n0, f"now {len(rooms())}")
        shot("05-two-ops-undone-in-one-step.png")

        before = used()["u"]; ctl("mock", {"mode": "busy"}); say("Add a 3 x 4 m study on the east side")
        txt = panel(); check("busy upstream: friendly message, nothing charged", used()["u"] == before and ("busy" in txt.lower() or "Wait about" in txt or "could not answer" in txt.lower()), txt[-300:]); ctl("mock", {"mode": "normal"}); shot("06-busy.png")

        sql("UPDATE entitlements SET credits_used=399 WHERE id='e_e2e1'")
        say("Add a 3 x 4 m study on the east side"); txt = panel(); pu = used()["u"]
        check("80% warning shown", re.search(r"You have used 8\d% of the AI credits", txt) is not None and 400 <= pu < 475, f"{pu}"); shot("07-warning-80.png")
        sql("UPDATE entitlements SET credits_used=470 WHERE id='e_e2e1'")
        say("Add a 3 x 4 m study on the east side"); txt = panel(); pu = used()["u"]
        check("95% warning shown", "Only " in txt and "left. When they run out the assistant becomes read-only" in txt and 475 <= pu < 500, f"{pu}"); shot("08-warning-95.png")
        sql("UPDATE entitlements SET credits_used=500 WHERE id='e_e2e1'")
        n_before = len(rooms()); calls = len(ctl("mocklog")); say("Add a 3 x 4 m study on the east side"); txt = panel()
        check("zero credits: read-only message", "All AI credits in this Plan Pack have been used" in txt)
        check("zero credits: no change and no upstream call", len(rooms()) == n_before and len(ctl("mocklog")) == calls)
        check("meter shows 0 left", "0 of 500 credits left" in panel() or "used all 500" in panel())
        shot("09-read-only-at-zero.png")
        pg.reload(wait_until="load"); pg.wait_for_timeout(3500); pg.locator("button:visible", has_text="ASSISTANT").click(); pg.wait_for_timeout(800)
        ta_off = pg.evaluate("(()=>{const t=[...document.querySelectorAll('textarea')].filter(e=>e.offsetParent).pop();return t?t.disabled:null})()")
        check("after reload at zero the composer is read-only", ta_off is True or "read-only" in panel().lower(), str(ta_off)); shot("10-zero-after-reload.png")
        b.close()
finally:
    try: os.killpg(proc.pid, 15)
    except Exception: proc.kill()
print("\nE2E " + ("FAILED: " + "; ".join(fails) if fails else "PASSED")); sys.exit(1 if fails else 0)

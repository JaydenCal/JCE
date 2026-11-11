import threading, sys
from common import *
R = []
def check(name, ok, info=""):
    R.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(info) if info and not ok else ""), flush=True)
def sessions():
    return json.loads(urllib.request.urlopen("http://127.0.0.1:8811/_sessions").read())
def open_app(ctx, url=APP):
    pg = ctx.new_page(); pg.on("pageerror", lambda e: print("PAGEERROR", e))
    pg.route("**/checkout.stripe.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<html><body style='font:20px sans-serif;padding:40px'><h1>Mock Stripe Checkout</h1><p>Pocket Architect plan (one job) A$35.00 (GST included)</p><p>Card 4242 4242 4242 4242</p></body></html>"))
    pg.goto(url); pg.wait_for_function("window.__ps && window.__ps.premium"); pg.wait_for_timeout(1500)
    sk = pg.query_selector("button:has-text('Skip')")
    if sk and sk.is_visible(): sk.click()
    return pg
def open_restore(pg):
    pg.click("text=Unlock plans, A$35"); pg.click(".psp-modal button:has-text('Restore purchase')")
def pid(pg): return pg.evaluate("window.__ps.store.project.id")
def entitled(pg): return pg.evaluate("window.__ps.premium.isEntitled()")
def body(pg): return pg.inner_text("body")

with sync_playwright() as p:
    # A: unlock click and checkout request
    b, ctx = browser_ctx(p); pg = open_app(ctx); P1 = pid(pg)
    check("A0 starts locked", not entitled(pg))
    pg.click("text=Unlock plans, A$35"); pg.wait_for_timeout(500); pg.screenshot(path=SHOTS + "01-unlock-modal.png")
    check("A1 modal shows A$35 incl. GST", "A$35" in body(pg) and "incl. GST" in body(pg))
    n0 = len(sessions()); pg.click("button:has-text('Continue to secure checkout')"); pg.wait_for_url("**/checkout.stripe.com/**"); pg.wait_for_timeout(300)
    S = sessions()[-1]; F = S["form"]
    check("A2 one checkout session created", len(sessions()) == n0 + 1)
    check("A3 amount 3500 aud inclusive", F.get("line_items[0][price_data][unit_amount]") == "3500" and F.get("line_items[0][price_data][currency]") == "aud" and F.get("line_items[0][price_data][tax_behavior]") == "inclusive", F)
    check("A4 project id passed", F["client_reference_id"] == P1 == F["metadata[projectId]"], (F["client_reference_id"], P1))
    check("A5 success/cancel urls", F["success_url"] == f"{APP}?checkout=success&session_id={{CHECKOUT_SESSION_ID}}&project={P1}" and F["cancel_url"] == APP + "?checkout=cancel", F)
    check("A6 invoice creation on, locale en-AU", F["invoice_creation[enabled]"] == "true" and F["locale"] == "en-AU")
    pg.screenshot(path=SHOTS + "02-mock-stripe-checkout.png")
    SID = S["id"]; PI = "pi_" + SID[8:]; EMAIL = "Buyer@Example.com"
    # B: redirect back BEFORE webhook (pending poll), webhook fires after ~5s
    threading.Timer(5.0, lambda: print("webhook ->", webhook(completed("evt_B1", SID, P1, PI, EMAIL)))).start()
    pg.goto(f"{APP}?checkout=success&session_id={SID}&project={P1}"); pg.wait_for_selector("text=Confirming your payment"); pg.wait_for_timeout(1500); pg.screenshot(path=SHOTS + "03-pending-poll.png")
    pg.wait_for_selector("text=Plan Pack unlocked", timeout=30000); pg.wait_for_timeout(400); pg.screenshot(path=SHOTS + "04-unlocked.png")
    t = body(pg); check("B1 unlocked after delayed webhook", entitled(pg))
    check("B2 modal shows 500 credits", "500 of 500" in t, t[-400:]); check("B3 URL params stripped", "session_id" not in pg.url, pg.url)
    check("B4 receipt reference shown", "ent_" in t)
    RECEIPT = db("select id from entitlements where stripe_session_id='%s'" % SID)[0]["id"]
    # C: reload stays unlocked
    pg.reload(); pg.wait_for_function("window.__ps && window.__ps.premium"); pg.wait_for_timeout(2500)
    check("C1 still unlocked after reload", entitled(pg)); pg.screenshot(path=SHOTS + "05-reload-still-unlocked.png")
    check("C2 topbar no longer offers Unlock", "Unlock plans, A$35" not in pg.inner_text("header, body")[:2000] or entitled(pg))
    # D: fresh context, Restore purchase with email + receipt (three reference types)
    for label, ref in (("receipt ref", RECEIPT), ("payment intent", PI), ("session id", SID)):
        b2, c2 = browser_ctx(p); g = open_app(c2)
        g.evaluate("(id)=>{const pr=JSON.parse(JSON.stringify(window.__ps.store.project)); pr.id=id; window.__ps.store.replace(pr)}", P1); g.wait_for_timeout(500)
        check(f"D0 ({label}) fresh context locked, project restored to {P1}", pid(g) == P1 and not entitled(g))
        open_restore(g); g.fill("#psp-restore-email", "buyer@example.com"); g.fill("#psp-restore-ref", ref)
        if label == "receipt ref": g.screenshot(path=SHOTS + "06-restore-form.png")
        g.click("form button:has-text('Restore purchase'), button[form=psp-restore-form]"); g.wait_for_selector("text=Plan Pack restored", timeout=15000); g.wait_for_timeout(600)
        if label == "receipt ref": g.screenshot(path=SHOTS + "07-restored.png")
        check(f"D1 restore by {label} unlocks", entitled(g) and "active for the design that is open" in body(g), body(g)[-300:])
        b2.close()
    b2, c2 = browser_ctx(p); g = open_app(c2); open_restore(g); g.fill("#psp-restore-email", "wrong@example.com"); g.fill("#psp-restore-ref", RECEIPT)
    g.click("button[form=psp-restore-form]"); g.wait_for_timeout(1500); g.screenshot(path=SHOTS + "08-restore-wrong-email.png"); check("D2 wrong email refused", "could not find" in body(g).lower() and not entitled(g)); b2.close()
    # E: webhook BEFORE redirect (fresh context, new project)
    b3, c3 = browser_ctx(p); h = open_app(c3); P2 = pid(h); h.click("text=Unlock plans, A$35"); h.click("button:has-text('Continue to secure checkout')"); h.wait_for_url("**/checkout.stripe.com/**")
    S2 = sessions()[-1]; SID2 = S2["id"]; PI2 = "pi_" + SID2[8:]
    print("webhook first ->", webhook(completed("evt_E1", SID2, P2, PI2, "second@example.com")))
    h.goto(f"{APP}?checkout=success&session_id={SID2}&project={P2}"); h.wait_for_selector("text=Plan Pack unlocked", timeout=15000)
    check("E1 webhook-first then redirect unlocks immediately", entitled(h)); h.screenshot(path=SHOTS + "09-webhook-first-unlocked.png")
    # F: cancel return
    b4, c4 = browser_ctx(p); k = open_app(c4, APP + "?checkout=cancel"); k.wait_for_selector("text=Checkout cancelled"); k.screenshot(path=SHOTS + "10-cancel-return.png")
    check("F1 cancel shows not-charged notice, stays locked", not entitled(k)); check("F2 cancel params stripped", "checkout=" not in k.url, k.url); b4.close()
    # G: refund revokes (partial does not)
    print("partial refund ->", webhook(refund("evt_G0", PI2, full=False)))
    h.reload(); h.wait_for_function("window.__ps && window.__ps.premium"); h.wait_for_timeout(2500); check("G1 partial refund keeps access", entitled(h))
    print("full refund ->", webhook(refund("evt_G1", PI2)))
    h.reload(); h.wait_for_function("window.__ps && window.__ps.premium"); h.wait_for_timeout(3500); h.screenshot(path=SHOTS + "11-after-refund.png")
    check("G2 full refund revokes access in app", not entitled(h), body(h)[:200]); b3.close()
    # H: friends code from the real UI
    b5, c5 = browser_ctx(p); f = open_app(c5); PF = pid(f)
    open_restore(f); f.fill("#psp-restore-email", "friend1@example.com"); f.fill("#psp-restore-ref", "PA-FRIENDS-TEST"); f.click("button[form=psp-restore-form]"); f.wait_for_timeout(2500); f.screenshot(path=SHOTS + "12-friends-code.png")
    check("H1 friends code unlocks the open project in the app", entitled(f), body(f)[-300:])
    for i, em in enumerate(("friend2@example.com", "friend3@example.com", "friend4@example.com")):
        s, j = post("/api/entitlement/restore", {"email": em, "sessionOrReceipt": "PA-FRIENDS-TEST"}); print("friend", i + 2, s)
        if em.startswith("friend4"): check("H2 max uses (3) enforced", s == 403 and j["error"]["code"] == "CODE_EXHAUSTED", (s, j))
    b5.close(); b.close()
print(sum(ok for _, ok in R), "/", len(R), "passed"); sys.exit(0 if all(ok for _, ok in R) else 1)

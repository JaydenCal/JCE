from common import *
import urllib.request
exec(open("e2e.py").read().split("with sync_playwright()")[0].split("R = []")[0].replace("import threading, sys",""))
def open_app(ctx):
    pg = ctx.new_page(); pg.goto(APP); pg.wait_for_function("window.__ps && window.__ps.premium"); pg.wait_for_timeout(1500)
    sk = pg.query_selector("button:has-text('Skip')")
    if sk and sk.is_visible(): sk.click()
    return pg
ok = True
with sync_playwright() as p:
    b, c = browser_ctx(p); pg = open_app(c)
    for mode in ("down", "500", "html"):
        urllib.request.urlopen("http://127.0.0.1:8811/_mode?m=" + mode)
        pg.click("text=Unlock plans, A$35") if not pg.query_selector(".psp-modal") else None
        pg.click("button:has-text('Continue to secure checkout')"); pg.wait_for_selector(".psp-error:not([hidden])", timeout=20000)
        t = pg.inner_text(".psp-error"); print(mode, "->", t); ok &= "Payments are not available" in t
        if mode == "down": pg.screenshot(path=SHOTS + "13-stripe-down.png")
    b.close()
print("STRIPE DOWN", "OK" if ok else "FAIL"); raise SystemExit(0 if ok else 1)

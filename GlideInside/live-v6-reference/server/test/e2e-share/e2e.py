"""Browser end-to-end test of Save and share, the job zip and One-click render, through the real Worker (Miniflare, local D1 and R2).
Run: sh server/test/e2e-share/run.sh   (needs node 22, python playwright + chromium + Pillow). Screenshots go to qa/share/."""
import json, sys, time, io, zipfile, hashlib, urllib.request, urllib.parse, pathlib
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageStat
BASE = "http://127.0.0.1:8820"; APP = BASE + "/plan-studio/app/"; SHOTS = pathlib.Path(__file__).resolve().parents[3] / "qa" / "share"; TMP = pathlib.Path("/tmp/pa-share-e2e"); TMP.mkdir(exist_ok=True)
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
R = []
def check(name, ok, info=""):
    R.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(info)[:300] if info and not ok else ""), flush=True)
def db(q): return json.loads(urllib.request.urlopen(BASE + "/_db?q=" + urllib.parse.quote(q)).read())
def ctx_new(p, **kw):
    b = p.chromium.launch(args=ARGS); c = b.new_context(**{"viewport": {"width": 1366, "height": 800}, "accept_downloads": True, **kw})
    if not kw.get("is_mobile"): c.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8})")
    c.route("**/fonts.googleapis.com/**", lambda r: r.abort()); c.route("**/fonts.gstatic.com/**", lambda r: r.abort()); return b, c
def open_app(c, url=APP, wait_premium=True):
    pg = c.new_page(); pg.on("pageerror", lambda e: print("PAGEERROR", e))
    pg.goto(url); pg.wait_for_function("window.__ps && window.__ps.store"); pg.wait_for_timeout(1800)
    if wait_premium: pg.wait_for_function("window.__ps.premium")
    for _ in range(2):
        sk = pg.query_selector("button:has-text('Skip')")
        if sk and sk.is_visible(): sk.click(); pg.wait_for_timeout(300)
    return pg
body = lambda pg: pg.inner_text("body")
pid = lambda pg: pg.evaluate("window.__ps.store.project.id")
def events(pg):
    pg.evaluate("window.__ev=[];window.addEventListener('ps:analytics',e=>window.__ev.push(e.detail))")
def render_events(pg, name="ps_render"): return pg.evaluate("(n)=>window.__ev.filter(e=>e.event===n).map(e=>e.props)", name)
def go3d(pg):
    pg.evaluate("window.__ps.store.setUI({view:'3d'})"); pg.wait_for_selector(".ps3d-canvas", timeout=30000); pg.wait_for_timeout(2500)
def do_render(pg, cover=False, width=None, timeout=300000):
    pg.click("[data-action=render]"); pg.wait_for_selector("[data-action=render-start]")
    if width: pg.select_option("#ps-render-size", str(width))
    if cover: pg.check("#ps-render-cover")
    pg.click("[data-action=render-start]"); pg.wait_for_selector("[data-action=render-download]:not([hidden])", timeout=timeout)
    with pg.expect_download() as d: pg.click("[data-action=render-download]")
    path = TMP / (d.value.suggested_filename); d.value.save_as(path); return path

with sync_playwright() as p:
    # ---- A. Save and share ---------------------------------------------------------------------------------------------
    b1, c1 = ctx_new(p); a = open_app(c1); events(a); P1 = pid(a)
    a.fill(".ps-name", "Share test house"); a.press(".ps-name", "Enter"); a.wait_for_timeout(300)
    a.click("[data-action=share]"); a.wait_for_selector("[data-action=share-save]")
    t = body(a); check("A1 dialog says the link is saved, not emailed", "do not email" in t.lower() or "do not send you an email" in t.lower(), t[-500:])
    check("A2 optional email field", a.query_selector("#ps-share-email") is not None)
    a.screenshot(path=str(SHOTS / "01-share-dialog.png"))
    a.fill("#ps-share-email", "Lead@Example.com"); a.click("[data-action=share-save]"); a.wait_for_function("document.querySelector('.ps-modal input[readonly]').value.includes('?share=')", timeout=20000)
    LINK = a.input_value(".ps-modal input[readonly]"); SID = LINK.split("share=")[1]
    check("A3 share link shown", LINK.startswith(APP + "?share=") and len(SID) >= 16, LINK)
    a.screenshot(path=str(SHOTS / "02-share-link.png"))
    row = db(f"select * from projects where id='{SID}'")[0]
    check("A4 row stored with hashed key, email lead, expiry about a year", len(row["edit_key_hash"]) == 64 and row["email"] == "lead@example.com" and row["name"] == "Share test house" and row["expires_at"] > time.strftime("%Y-%m-%d", time.gmtime(time.time() + 360 * 86400)), row)
    rec = json.loads(a.evaluate(f"localStorage.getItem('ps.share.{P1}')"))
    check("A5 id and edit key remembered per project", rec["id"] == SID and rec["editKey"] and row["edit_key_hash"] != rec["editKey"])
    a.click("[data-action=copy-link]"); a.wait_for_timeout(300); check("A6 copy button reports", "copied" in body(a).lower() or "ctrl+c" in body(a).lower())
    a.keyboard.press("Escape"); a.wait_for_timeout(300)
    a.fill(".ps-name", "Share test house v2"); a.press(".ps-name", "Enter"); a.click("[data-action=share]"); a.wait_for_selector("[data-action=share-save]")
    check("A7 reopened dialog shows the same link and Update", a.input_value(".ps-modal input[readonly]") == LINK and "Update shared copy" in body(a))
    a.click("[data-action=share-save]"); a.wait_for_function("document.body.innerText.includes('Updated')", timeout=20000)
    row2 = db(f"select * from projects where id='{SID}'")[0]; n = db("select count(*) n from projects")[0]["n"]
    check("A8 second save updates the same row", row2["name"] == "Share test house v2" and n == 1 and row2["updated_at"] >= row["updated_at"], (row2, n))
    a.keyboard.press("Escape")
    # edit key is required: a stranger cannot overwrite
    s = urllib.request.Request(BASE + f"/api/projects/{SID}", data=json.dumps({"project": json.loads(a.evaluate("JSON.stringify(window.__ps.store.project)"))}).encode(), method="PUT", headers={"content-type": "application/json", "x-edit-key": "guess"})
    try: urllib.request.urlopen(s); code = 200
    except urllib.error.HTTPError as e: code = e.code
    check("A9 wrong edit key refused over HTTP", code == 403, code)

    # ---- B. open in a fresh context, read only, then fork -----------------------------------------------------------------
    b2, c2 = ctx_new(p); g = open_app(c2, LINK); events(g)
    g.wait_for_selector(".ps-shared-banner", timeout=20000); g.screenshot(path=str(SHOTS / "03-shared-readonly.png"))
    check("B1 shared design loaded with banner", g.evaluate("window.__ps.store.project.name") == "Share test house v2" and "Make my own copy" in body(g), body(g)[:300])
    check("B2 read only flag set", g.evaluate("window.__ps.store.readOnly === true"))
    g.fill(".ps-name", "Vandal"); g.press(".ps-name", "Enter"); g.wait_for_timeout(500)
    check("B3 edit attempt refused with a clear message", g.evaluate("window.__ps.store.project.name") == "Share test house v2" and "read only" in body(g).lower(), body(g)[-300:])
    g.wait_for_timeout(1500); check("B4 the visitor's own autosave slot is untouched", g.evaluate("localStorage.getItem('ps.autosave.v1')") is None)
    check("B5 not entitled by opening a link", not g.evaluate("window.__ps.premium.isEntitled()"))
    server_name = json.loads(urllib.request.urlopen(BASE + f"/api/projects/{SID}").read())["project"]["name"]; check("B6 server copy unchanged by the visitor", server_name == "Share test house v2")
    g.click("[data-action=fork]"); g.wait_for_function("!document.querySelector('.ps-shared-banner')", timeout=10000); g.wait_for_timeout(500)
    P2 = pid(g)
    check("B7 fork is a new local project", P2 != P1 and g.evaluate("window.__ps.store.project.name") == "Share test house v2 (copy)" and g.evaluate("window.__ps.store.readOnly === false") and "share=" not in g.url, (P2, g.url))
    g.fill(".ps-name", "My edit"); g.press(".ps-name", "Enter"); g.wait_for_timeout(1600)
    check("B8 fork is editable and autosaves", g.evaluate("window.__ps.store.project.name") == "My edit" and g.evaluate("JSON.parse(localStorage.getItem('ps.autosave.v1')).name") == "My edit")
    check("B9 fork has no link of its own yet", g.evaluate(f"localStorage.getItem('ps.share.{P2}')") is None)
    g.reload(); g.wait_for_function("window.__ps && window.__ps.store"); g.wait_for_timeout(1500); check("B10 reload keeps the fork", g.evaluate("window.__ps.store.project.name") == "My edit")
    g.click("[data-action=share]"); g.wait_for_selector("[data-action=share-save]"); g.click("[data-action=share-save]"); g.wait_for_function("document.querySelector('.ps-modal input[readonly]').value.includes('?share=')", timeout=20000)
    check("B11 fork can get its own link", g.input_value(".ps-modal input[readonly]") != LINK and db("select count(*) n from projects")[0]["n"] == 2)
    # a bad link
    b3, c3 = ctx_new(p); bad = open_app(c3, APP + "?share=" + "z" * 20); bad.wait_for_selector(".ps-modal", timeout=15000)
    check("B12 unknown link gives a plain message and the app still works", "not found" in body(bad).lower() and bad.evaluate("window.__ps.store.readOnly === false")); bad.screenshot(path=str(SHOTS / "04-bad-link.png")); b3.close()
    # expired link
    db("update projects set expires_at='2020-01-01T00:00:00.000Z' where id='%s'" % SID)
    b4, c4 = ctx_new(p); ex = open_app(c4, LINK); ex.wait_for_selector(".ps-modal", timeout=15000); check("B13 expired link says so", "expired" in body(ex).lower(), body(ex)[-200:]); b4.close()
    db("update projects set expires_at='2099-01-01T00:00:00.000Z' where id='%s'" % SID)
    b2.close()

    # ---- C. job zip --------------------------------------------------------------------------------------------------------------
    a.fill(".ps-name", "Zip job"); a.press(".ps-name", "Enter"); a.click("[data-action=file-menu]")
    check("C1 file menu lists both zip actions", a.is_visible("[data-action=job-download]") and a.is_visible("[data-action=job-open]") and "Download job (.zip)" in body(a) and "Open job (.zip)" in body(a))
    a.screenshot(path=str(SHOTS / "05-file-menu.png"))
    with a.expect_download() as d: a.click("[data-action=job-download]")
    zp = TMP / d.value.suggested_filename; d.value.save_as(zp)
    z = zipfile.ZipFile(zp); names = sorted(z.namelist()); man = json.loads(z.read("manifest.json"))
    check("C2 zip holds project.json and manifest.json", names == ["manifest.json", "project.json"], names)
    check("C3 manifest has job id, schema, date and SHA-256 per file", man["jobId"] == P1 and man["schemaVersion"] == 1 and man["createdAt"][:4] == "2026" and all(f["sha256"] == hashlib.sha256(z.read(f["path"])).hexdigest() for f in man["files"]) and len(man["files"]) == 1, man)
    b5, c5 = ctx_new(p); o = open_app(c5); events(o)
    o.click("[data-action=file-menu]")
    with o.expect_file_chooser() as fc: o.click("[data-action=job-open]")
    fc.value.set_files(str(zp)); o.wait_for_function("window.__ps.store.project.name === 'Zip job'", timeout=15000)
    check("C4 open job loads the design", pid(o) == P1)
    check("C5 opening a job does not grant the Plan Pack", not o.evaluate("window.__ps.premium.isEntitled()") and o.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('ps.ent.')).length") == 0)
    # tampered
    raw = bytearray(zp.read_bytes()); i = raw.find(b"Zip job"); raw[i:i + 3] = b"Hax"; bad_zp = TMP / "tampered.job.zip"; bad_zp.write_bytes(bytes(raw))
    o.click("[data-action=file-menu]")
    with o.expect_file_chooser() as fc: o.click("[data-action=job-open]")
    fc.value.set_files(str(bad_zp)); o.wait_for_selector(".ps-modal", timeout=10000); check("C6 tampered job refused with a message", "damaged" in body(o).lower() and o.evaluate("window.__ps.store.project.name") == "Zip job", body(o)[-300:])
    o.screenshot(path=str(SHOTS / "06-zip-refused.png")); o.keyboard.press("Escape")
    b5.close()

    # ---- D. render: free ---------------------------------------------------------------------------------------------------------
    go3d(a); a.click("[data-action=render]"); a.wait_for_selector("[data-action=render-start]"); a.screenshot(path=str(SHOTS / "07-render-dialog-free.png"))
    t = body(a); check("D1 free dialog explains 1600 px and the preview mark", "1600" in t and "Pocket Architect preview" in t)
    check("D2 free has no size choice and no cover option", a.query_selector("#ps-render-size") is None and a.query_selector("#ps-render-cover") is None)
    a.keyboard.press("Escape")
    t0 = time.time(); free_png = do_render(a); free_s = time.time() - t0
    im_free = Image.open(free_png).convert("RGB"); a.screenshot(path=str(SHOTS / "08-render-free-done.png"))
    check("D3 free render is 1600 px wide", im_free.width == 1600, im_free.size); print("  free render took %.1fs, size %s" % (free_s, im_free.size))
    ev = render_events(a); check("D4 ps_render analytics event, watermark true", ev and ev[-1]["status"] == "done" and ev[-1]["watermark"] is True and ev[-1]["entitled"] is False and ev[-1]["width"] == 1600, ev)
    im_free.save(SHOTS / "render-free.png"); a.keyboard.press("Escape")
    # cancel (deterministic: abort from the first progress callback)
    res = a.evaluate("""async()=>{const v=window.__ps.getViewer();const ctl=new AbortController();try{await v.renderImage({width:1600,ss:2,tile:512,signal:ctl.signal,onProgress:()=>ctl.abort()});return 'finished'}catch(e){return e.name}}""")
    check("D5 cancel stops the render", res == "AbortError", res)
    cs = a.evaluate("(()=>{const c=document.querySelector('.ps3d-canvas');return [c.width,c.height,c.clientWidth,c.clientHeight]})()"); check("D6 canvas back at on-screen size after a cancelled render", cs[0] >= cs[2] * 0.9 and cs[0] <= cs[2] * 3, cs)
    a.wait_for_timeout(500)

    # ---- E. render: entitled via friends code --------------------------------------------------------------------------------------
    a.evaluate("window.__ps.store.setUI({view:'2d'})")
    a.click("text=Unlock plans, A$35"); a.click(".psp-modal button:has-text('Restore purchase')"); a.fill("#psp-restore-email", "friend@example.com"); a.fill("#psp-restore-ref", "PA-FRIENDS-TEST"); a.click("button[form=psp-restore-form]")
    a.wait_for_function("window.__ps.premium.isEntitled()", timeout=20000); a.wait_for_timeout(600)
    for _ in range(3):
        if a.query_selector(".psp-modal"): a.keyboard.press("Escape"); a.wait_for_timeout(200)
    go3d(a); a.click("[data-action=render]"); a.wait_for_selector("#ps-render-size"); a.screenshot(path=str(SHOTS / "09-render-dialog-entitled.png"))
    opts = a.eval_on_selector_all("#ps-render-size option", "o=>o.map(x=>x.value)"); check("E1 entitled sees sizes up to 3840 and the cover option", "3840" in opts and a.query_selector("#ps-render-cover") is not None, opts)
    a.keyboard.press("Escape")
    exp_bodies = []
    c1.route("**/api/export/pdf", lambda r: (exp_bodies.append(r.request.post_data), r.fulfill(status=501, content_type="application/json", body='{"error":{"code":"EXPORT_NOT_CONFIGURED","message":"stub"}}')))
    t0 = time.time(); ent_png = do_render(a, cover=True, width=1920); ent_s = time.time() - t0
    im_ent = Image.open(ent_png).convert("RGB"); a.screenshot(path=str(SHOTS / "10-render-entitled-done.png")); im_ent.save(SHOTS / "render-entitled-1920.png")
    check("E2 entitled render is the chosen width", im_ent.width == 1920, im_ent.size); print("  entitled 1920 render took %.1fs" % ent_s)
    ev = render_events(a); check("E3 analytics: no watermark, entitled, cover", ev[-1]["watermark"] is False and ev[-1]["entitled"] is True and ev[-1]["cover"] is True, ev[-1])
    small = im_ent.resize(im_free.size, Image.LANCZOS)
    def diff(box): return ImageStat.Stat(ImageChops.difference(im_free.crop(box), small.crop(box))).mean
    br = diff((1300, 975, 1580, 1015)); ctrl = diff((100, 30, 380, 70))
    print("  watermark region diff", br, "control", ctrl)
    check("E4 free render carries a mark that the entitled render lacks", max(br) > 12 and max(br) > max(ctrl) + 6, (br, ctrl))
    a.keyboard.press("Escape")
    a.evaluate("window.__ps.premium.exportAs('pdf')"); a.wait_for_timeout(2500)
    check("E5 PDF export request carries the render as its cover image", exp_bodies and '"image":"data:image/jpeg;base64,' in exp_bodies[0], (exp_bodies[0][:200] if exp_bodies else None))
    a.evaluate("""()=>{const v=window.__ps.getViewer();const orig=v.renderImage.bind(v);window.__origRender=orig;v.renderImage=(o)=>orig({...o,onProgress:(f)=>{o.onProgress(f);const t=performance.now();while(performance.now()-t<400);}})}""")  # slow the tiles so a click can land mid render
    a.click("[data-action=render]"); a.wait_for_selector("[data-action=render-start]"); a.select_option("#ps-render-size", "3840"); a.click("[data-action=render-start]")
    a.evaluate("""()=>new Promise((res)=>{const iv=setInterval(()=>{if(/wide, \\d+%/.test(document.body.innerText)){clearInterval(iv);document.querySelector('[data-action=render-cancel]').click();res(true)}},15)})""")  # click Cancel as soon as progress shows
    a.wait_for_function("document.body.innerText.includes('Render cancelled')", timeout=60000)
    check("E5b cancel from the dialog stops a 3840 render", "Render cancelled" in body(a) and not a.is_visible("[data-action=render-cancel]")); a.screenshot(path=str(SHOTS / "11a-render-cancelled.png")); a.keyboard.press("Escape"); a.evaluate("()=>{window.__ps.getViewer().renderImage=window.__origRender}")
    t0 = time.time(); big = do_render(a, width=3840, timeout=420000); big_s = time.time() - t0
    im_big = Image.open(big); check("E6 entitled 3840 px render", im_big.width == 3840, im_big.size); print("  3840 render took %.1fs" % (time.time() - t0)); a.screenshot(path=str(SHOTS / "11-render-3840-done.png"))
    b1.close()

    # ---- F. phone: capped, responsive -------------------------------------------------------------------------------------------------
    bp, cp = ctx_new(p, viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ph = open_app(cp); events(ph); ph.evaluate("window.__ps.store.setUI({view:'3d'})"); ph.wait_for_selector(".ps3d-canvas", timeout=30000); ph.wait_for_timeout(2500)
    gi = ph.query_selector("button:has-text('Got it')")
    if gi and gi.is_visible(): gi.click(); ph.wait_for_timeout(400)
    ph.screenshot(path=str(SHOTS / "12-phone-3d.png"))
    visible = ph.is_visible("[data-action=render]"); check("F1 Render image reachable on a phone", visible)
    if visible:
        t0 = time.time(); pp = do_render(ph); im_p = Image.open(pp); print("  phone render took %.1fs %s" % (time.time() - t0, im_p.size))
        check("F2 phone render completes within the 1600 px cap", im_p.width <= 1600, im_p.size); ph.screenshot(path=str(SHOTS / "13-phone-render-done.png"))
    bp.close()
print(sum(ok for _, ok in R), "/", len(R), "passed"); sys.exit(0 if all(ok for _, ok in R) else 1)

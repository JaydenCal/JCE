// Screenshots of the commercial mode (M1) at 1440x900 into the folder given (default docs/commercial-review/). Serves website-live as
// the site root and the real Worker app (in-memory store, no Stripe key, no email) at /api, and answers the two outside hosts the
// pages ask for (Google Fonts and the analytics tag) with empty files so the run needs no network. Any console error, page error
// or failed request is printed at the end; a clean run prints "no console errors".
//   node tools/commercial-shots.cjs [outDir]        (Playwright must be installed: PLAYWRIGHT_PATH, NODE_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || path.resolve(__dirname, '../docs/commercial-review'));
const PORT = Number(process.env.PORT || 8817); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  // The fixtures: a 90 x 100 m IN1 lot with two back to back rows of 8 units in the default layout, i.e. ground office/amenity plus a
  // mezzanine office over the front bay (tests/helpers/commercial-fixture.mjs, plain: false).
  const { commercialProject } = await import('../tests/helpers/commercial-fixture.mjs');
  const FIX = { 'commercial.json': JSON.stringify(commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false })) };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const log = [];
  const mk = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`console.${m.type()}: ${m.text()} @ ${m.location().url}`); });
    page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()}: ${r.url()}`); });
    return page;
  };
  const page = await mk({ width: 1440, height: 900 });
  const shot = async (name, pg = page, opts = {}) => { await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }); console.log('shot', name); };
  const load = async (file) => { const j = FIX[file]; await page.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); window.__ps.store.setUI({ view: '2d' }); }, j); await page.waitForTimeout(700); await page.evaluate(() => window.__ps.editor.zoomToFit()); };
  const zoomTo = async (bb, pad = 60) => page.evaluate(([b, pad]) => {
    const ed = window.__ps.editor; const r = ed.element.getBoundingClientRect();
    const dock = document.querySelector('.cm-dock'); const strip = document.querySelector('.cm-strip');
    const left = dock && !dock.hidden ? dock.getBoundingClientRect().right - r.left + 8 : 0;
    const bottom = strip && !strip.hidden ? r.bottom - strip.getBoundingClientRect().top + 8 : 0;
    const w = r.width - left - 2 * pad; const h = r.height - bottom - 2 * pad;
    const scale = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
    ed.setView({ scale, ox: left + pad + (w - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale, oy: pad + (h - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale });
  }, [bb, pad]);
  const edit = (fn) => page.evaluate(`(() => { const s = window.__ps.store; s.apply('Shot edit', (p) => { (${fn})(p.commercial, p); }); const ev = new Event('x'); })()`);

  await page.goto(`${ORIGIN}/plan-studio/app/index.html`);
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // 01 the design type switch with Commercial
  await page.evaluate(() => window.__ps.openNew());
  await shot('01-commercial-toggle');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  // 02 two mirrored rows
  await load('commercial.json');
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await shot('02-two-mirrored-rows');
  // 03 stats strip close up
  const strip = page.locator('.cm-strip');
  await page.waitForTimeout(300);
  await strip.screenshot({ path: path.join(OUT, '03-stats-strip.png') }); console.log('shot 03-stats-strip');
  // 07 detail: mezzanine, doors, office, bays, zoomed to the first units and their bays
  await page.evaluate(() => { const s = window.__ps.store; s.apply('Detail', (p) => { const r = p.commercial.rows[0]; r.perUnit = { 0: { office: { accessibleWc: true } }, 3: { mezzanine: { use: 'storage', position: 'rear', depthMm: 4000 } } }; }); });
  await page.evaluate(() => { const s = window.__ps.store; s.apply('Regenerate', (p) => { p.commercial.parking.aisleMm = p.commercial.parking.aisleMm; }); });
  await page.waitForTimeout(400);
  await zoomTo({ x0: 19000, y0: 39000, x1: 40000, y1: 70000 }, 24);
  await shot('07-detail-mezz-doors-bays');
  // 13 the mezzanine level plan: the mezzanine offices over the front bays with the open edges (balustrade) and the stair below
  await page.evaluate(() => { const s = window.__ps.store; const lv = s.project.levels.find((l) => /Mezz/i.test(l.name)); s.setUI({ activeLevelId: lv.id }); });
  await page.waitForTimeout(400);
  await zoomTo({ x0: 19500, y0: 46000, x1: 35000, y1: 57000 }, 24);
  await shot('13-mezzanine-level');
  await page.locator('.ps-topbar').screenshot({ path: path.join(OUT, '14-level-tabs.png') }); console.log('shot 14-level-tabs');
  await page.evaluate(() => { const s = window.__ps.store; s.setUI({ activeLevelId: s.project.levels[0].id }); });
  // 08 dock fields (scrolled to office and mezzanine)
  await page.evaluate(() => window.__ps.editor.zoomToFit());
  await page.evaluate(() => { document.querySelectorAll('.cm-dock details').forEach((d) => { d.open = true; }); const d = document.querySelector('.cm-dock'); d.scrollTop = 330; });
  await shot('08-dock-fields');
  // 09 checks list
  await page.evaluate(() => { const d = document.querySelector('.cm-dock'); d.querySelectorAll('details').forEach((x) => { x.open = false; }); d.scrollTop = d.scrollHeight; });
  await shot('09-checks-list');
  // 15 one unit only: the "Clear this unit's changes" action (enabled once the unit has changes of its own)
  await page.evaluate(() => { const d = document.querySelector('.cm-dock'); d.scrollTop = 0; const sel = d.querySelector('[data-ps="unit-scope"]'); sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.locator('.cm-dock input[data-path="widthMm"]').evaluate((el) => { el.value = '7000'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.locator('.cm-dock').screenshot({ path: path.join(OUT, '15-dock-unit-clear.png') }); console.log('shot 15-dock-unit-clear');
  const had = await page.evaluate(() => !!window.__ps.store.project.commercial.rows[0].perUnit[1]);
  await page.locator('.cm-dock [data-action="clear-unit"]').click(); await page.waitForTimeout(300);
  const has = await page.evaluate(() => !!window.__ps.store.project.commercial.rows[0].perUnit[1]);
  console.log(`clear unit changes: had overrides ${had}, after clear ${has}`);
  // 04 setback breach: slide the row over the front setback
  await load('commercial.json');
  await page.evaluate(() => { const s = window.__ps.store; const id = s.project.commercial.rows[0].id; s.setUI({ commercialRow: id }); });
  await page.locator('.cm-dock input[data-path="count"]').evaluate((el) => { el.value = '8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.keyboard.press('Escape');
  // nudge with the keyboard: 18 m up the page (Shift is 1 m)
  await page.locator('canvas').first().click({ position: { x: 600, y: 400 } }).catch(() => {});
  await page.evaluate(() => { const s = window.__ps.store; s.setUI({ tool: 'commercial', commercialRow: s.project.commercial.rows[0].id }); });
  for (let i = 0; i < 22; i++) await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__ps.editor.zoomToFit(); const d = document.querySelector('.cm-dock'); d.querySelectorAll('details').forEach((x) => { x.open = false; }); d.scrollTop = d.scrollHeight; });
  await shot('04-setback-breach');
  // 10 3D view of the two rows
  await load('commercial.json');
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
  await page.waitForTimeout(3500);
  await shot('10-3d-view');
  // 16 3D with the roof off from above: the mezzanine floors and their 1000 mm balustrades inside the unit walls
  await page.evaluate(() => window.__ps.store.setUI({ showRoof: false }));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aerial')?.click());
  await page.waitForTimeout(2500);
  await shot('16-3d-roof-off');
  await page.evaluate(() => window.__ps.store.setUI({ showRoof: true }));
  // 20 the indicative yield and value panel (feasibility) in the dock, opened and scrolled to its heading
  await load('commercial.json');
  await page.evaluate(() => { const d = document.querySelector('.cm-dock'); d.querySelectorAll('details').forEach((x) => { x.open = x.querySelector('summary').textContent.trim() === 'Indicative yield and value'; }); const sec = [...d.querySelectorAll('details')].find((x) => x.open); d.scrollTop = sec.offsetTop - 70; });
  await shot('20-feasibility');
  // landing page
  const land = await mk({ width: 1440, height: 900 });
  await land.goto(`${ORIGIN}/commercial/`); await land.waitForTimeout(1200);
  await shot('05-landing-1440', land, { fullPage: true });
  const phone = await mk({ width: 390, height: 844 });
  await phone.goto(`${ORIGIN}/commercial/`); await phone.waitForTimeout(1200);
  await shot('06-landing-390', phone, { fullPage: true });
  // 12 phone width, plan view with the dock
  const small = await mk({ width: 390, height: 844 });
  await small.goto(`${ORIGIN}/plan-studio/app/index.html?mode=commercial&view=2d`); await small.waitForTimeout(2500);
  await small.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (['Skip', 'Got it'].includes(b.textContent.trim())) b.click(); }));
  await small.evaluate((j) => { window.__ps.replaceProject(JSON.parse(j)); window.__ps.store.setUI({ view: '2d' }); }, FIX['commercial.json']);
  await small.waitForTimeout(2500); // the tour card shows after a moment: put it away
  await small.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (['Skip', 'Got it'].includes(b.textContent.trim())) b.click(); }));
  await small.evaluate(() => window.__ps.editor.zoomToFit()); await small.waitForTimeout(500);
  await shot('12-phone-390', small); // the sheet starts collapsed to its title bar, the strip runs along the top, the tips chip sits clear above the sheet
  await small.evaluate(() => document.querySelector('.cm-dock [data-action="sheet-toggle"]')?.click());
  await shot('12b-phone-390-sheet-open', small);
  await small.evaluate(() => document.querySelector('.cm-dock [data-action="sheet-toggle"]')?.click());
  // 11 the handoff: ?mode=commercial
  const hand = await mk({ width: 1440, height: 900 });
  await hand.goto(`${ORIGIN}/plan-studio/app/index.html?mode=commercial`); await hand.waitForTimeout(2500);
  await shot('11-handoff-no-lot', hand);
  // Not errors: three.js and GPU driver notices, and the 401 the portal gives a visitor who is not signed in (/api/portal/me).
  const errs = [...new Set(log)].filter((l) => !/^console\.warning: (THREE\.|\[\.WebGL)/.test(l) && !/portal\/me/.test(l) && !/status of 401/.test(l));
  console.log(errs.length ? `--- ${errs.length} console errors\n${errs.join('\n')}` : 'no console errors');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

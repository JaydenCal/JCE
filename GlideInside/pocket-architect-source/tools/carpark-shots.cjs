// Before/after screenshots of the automatic car park layout and the Car park tool, 2D and 3D.
//   node tools/carpark-shots.cjs <outDir> <tag> [appDir]
// appDir is a folder holding a build of the app at plan-studio/app (node tools/build-single.mjs --out <appDir>/plan-studio/app/index.html);
// everything else is served from website-live. Playwright must be installed (PLAYWRIGHT_PATH or NODE_PATH). Cases (each in 2D and 3D):
//   warehouse  a warehouse on an 80 x 110 m lot, "Re-run car park layout" pressed
//   warehouse25  the same warehouse turned 25 degrees
//   strata     the default strata unit rows
//   hardstand  a rotated hardstand drawn with the Car park tool
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/growth/carpark-shots'); const TAG = process.argv[3] || 'after';
const APP = process.argv[4] ? path.resolve(process.argv[4]) : null;
const ONLY = (process.env.CASES || 'warehouse,warehouse25,strata,hardstand').split(',');
const PORT = Number(process.env.PORT || 8821); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  const { commercialProject } = await import('../tests/helpers/commercial-fixture.mjs');
  const { createStore } = await import('../src/model/store.js');
  const { chooseBuilding } = await import('../src/commercial/catalogue/fit.js');
  const { applyBuildingChoice, moveBuilding } = await import('../src/commercial/catalogue/ops.js');
  const { buildingsOf } = await import('../src/commercial/catalogue/buildings.js');
  const warehouse = (rot, w = 80000, d = 110000, type = 'warehouse') => {
    const store = createStore(commercialProject({ width: w, depth: d, rows: 'none', plain: false }));
    applyBuildingChoice(store, chooseBuilding(store.project, type));
    if (rot) { const b = buildingsOf(store.project.commercial)[0]; moveBuilding(store, b.id, { x: b.place.x, y: b.place.y, rotationDeg: (b.place.rotationDeg || 0) + rot }); }
    return store.project;
  };
  const CASES = {
    warehouse: { project: () => warehouse(0), rerun: true },
    small: { project: () => warehouse(0, 40000, 60000, 'office'), rerun: true },
    deepnarrow: { project: () => warehouse(0, 30000, 120000), rerun: true },
    large: { project: () => warehouse(0, 100000, 140000), rerun: true },
    warehouse25: { project: () => warehouse(25), rerun: true },
    strata: { project: () => commercialProject({ plain: false }), rerun: false },
    hardstand: { project: () => commercialProject({ plain: false }), rerun: false, hardstand: true },
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    let f = path.join(SITE, p);
    if (APP && p.startsWith('/plan-studio/app/')) f = path.join(APP, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch(); const log = [];
  for (const name of ONLY) {
    const spec = CASES[name]; if (!spec) continue;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`));
    const shot = async (n) => { await page.waitForTimeout(700); for (let k = 0; k < 3; k++) { try { await page.screenshot({ path: path.join(OUT, `${name}-${n}-${TAG}.png`), timeout: 90000 }); console.log('shot', name, n); break; } catch (e) { log.push(`${name} ${n} screenshot retry`); } } };
    await page.goto(`${ORIGIN}/plan-studio/app/index.html?mode=commercial`);
    await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const proj = spec.project();
    await page.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); window.__ps.store.setUI({ view: '2d' }); }, JSON.stringify(proj));
    await page.waitForTimeout(600);
    await page.waitForTimeout(800);
    await page.getByText('Skip to editor').click({ timeout: 4000 }).catch(() => {});
    await page.getByText('Skip tutorial').click({ timeout: 1500 }).catch(() => {});
    await page.locator('[data-action="prompt-notnow"]').click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
    if (spec.rerun) {
      const m = await page.evaluate(() => { window.__ps.buildingOps.rerunSiteLayout(window.__ps.store); const sw = window.__ps.store.project.commercial.siteWorks; return sw ? `${sw.bayRows.length} rows, ${sw.summary.provided} bays` : 'no site works'; });
      console.log(name, 'rerun:', m);
      await page.waitForTimeout(800);
    }
    const lot = proj.site.lot.boundary; const xs = lot.map((q) => q.x); const ys = lot.map((q) => q.y);
    const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const frame = (bb, left = 430) => page.evaluate(({ b, left }) => { const ed = window.__ps.editor; const r = ed.element.getBoundingClientRect(); const pad = 40; const w = r.width - left - 2 * pad; const h = r.height - 2 * pad - 20; const sc = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)); ed.setView({ scale: sc, ox: left + pad - b.x0 * sc, oy: pad - b.y0 * sc }); }, { b: bb, left });
    if (spec.hardstand) {
      await frame({ x0: 40000, y0: 0, x1: 100000, y1: 85000 }, 260);
      await page.locator('canvas.ps-plan-canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.evaluate(() => { window.__ps.store.setUI({ tool: 'carpark' }); });
      await page.waitForTimeout(400);
      const px = (p) => page.evaluate((q) => { const ed = window.__ps.editor; const v = ed.getView(); const r = document.querySelector('canvas.ps-plan-canvas').getBoundingClientRect(); return { x: r.left + q.x * v.scale + v.ox, y: r.top + q.y * v.scale + v.oy }; }, p);
      const mouse = async (p, kind) => { const s = await px(p); await page.mouse.move(s.x, s.y); if (kind === 'down') await page.mouse.down(); if (kind === 'up') await page.mouse.up(); };
      // a 40 x 30 m rectangle east of the units
      await mouse({ x: 52000, y: 20000 }, 'move'); await mouse({ x: 52000, y: 20000 }, 'down');
      await mouse({ x: 70000, y: 35000 }, 'move'); await mouse({ x: 92000, y: 50000 }, 'move'); await mouse({ x: 92000, y: 50000 }, 'up');
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__ps.editor.carpark.rotateSelected(24));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__ps.store.setUI({ tool: 'select' }));
      await frame({ x0: 40000, y0: 10000, x1: 100000, y1: 70000 }, 40);
    } else await frame(b, 430);
    await page.locator('button[title*="Close"], button[aria-label="Close"]').first().click({ timeout: 800 }).catch(() => {});
    await shot('2d');
    await page.evaluate(() => window.__ps.store.setUI({ tool: 'select', view: '3d' }));
    await page.waitForTimeout(4500);
    const cx = spec.hardstand ? 72 : (b.x0 + b.x1) / 2000; const cz = spec.hardstand ? 35 : (b.y0 + b.y1) / 2000;
    const span = spec.hardstand ? 45 : Math.max(b.x1 - b.x0, b.y1 - b.y0) / 1000;
    await page.evaluate(async (a) => { const v = window.__ps.getViewer(); await v.flyTo({ position: { x: a.cx - a.span * 0.35, y: a.span * 0.95, z: a.cz + a.span * 0.85 }, target: { x: a.cx, y: 0, z: a.cz }, fov: 45 }, { duration: 0.01 }); }, { cx, cz, span });
    await page.waitForTimeout(2500);
    await shot('3d');
    // A closer view of the bays: the centre of the generated bay rows (or of the drawn hardstand).
    const focus = await page.evaluate(() => {
      const c = window.__ps.store.project.commercial; const pts = [];
      for (const r of c.siteWorks?.bayRows || []) for (const sl of r.slots) pts.push(sl.centre);
      for (const p of c.pavements || []) if (String(p.id).startsWith('hs_')) for (const q of p.polygon) pts.push(q);
      if (!pts.length) return null;
      return { x: pts.reduce((s, q) => s + q.x, 0) / pts.length / 1000, z: pts.reduce((s, q) => s + q.y, 0) / pts.length / 1000 };
    });
    if (focus) {
      await page.evaluate(async (a) => { const v = window.__ps.getViewer(); await v.flyTo({ position: { x: a.x - 14, y: 26, z: a.z + 30 }, target: { x: a.x, y: 0, z: a.z }, fov: 45 }, { duration: 0.01 }); }, focus);
      await page.waitForTimeout(2000);
      await shot('3d-close');
    }
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

// Screenshots of the catalogue framework (type picker, warehouse and showroom in 3D, plan set page C101) into the folder given. Reuses the lot card stub server.
// Serves website-live as the site root, the real Worker app at /api, and stubs /api/site/* with a real looking E4 lot.
//   node tools/commercial-lotcard-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/catalogue-shots');
const PORT = Number(process.env.PORT || 8821); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADDRESS = '12 Industrial Drive, Westdale NSW';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const { demoLotResponse } = await import('../src/site/demo-lot.js');
  const tam = (await import('../src/site/fixtures/tamworth.js')).default;
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  const lotResp = () => {
    const r = demoLotResponse({ commercial: true });
    const W = 72; const D = 112;
    const outer = [[-W / 2 - 2, -D / 2], [W / 2, -D / 2 + 1.5], [W / 2 + 1, D / 2], [-W / 2, D / 2 - 1]];
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432', polygons: [{ outer, holes: [] }], areaM2: 8050, registeredAreaM2: 8050,
        bboxMga: { minE: r.origin.e - 37, minN: r.origin.n - 57, maxE: r.origin.e + 37, maxN: r.origin.n + 57 } } };
  };
  const jpg = fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/aerial-test.jpg'));
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/api/site/search') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ results: [{ label: ADDRESS, state: 'NSW', lon: 150.930273, lat: -31.090267 }] })); }
    if (u.pathname === '/api/site/lot') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(lotResp())); }
    if (u.pathname === '/api/site/aerial') { res.writeHead(200, { 'content-type': 'image/jpeg', 'x-site-meta': encodeURIComponent(JSON.stringify(tam.aerial)) }); return res.end(jpg); }
    if (u.pathname === '/api/site/contours') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(tam.contours)); }
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
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  const mk = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()} @ ${m.location().url}`); });
    return page;
  };
  const appFrame = (pg) => pg.frames().find((f) => /plan-studio\/app/.test(f.url()));
  const shot = async (pg, name) => { await pg.waitForTimeout(900); await pg.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  const cardReady = async (fr, ms = 45000) => fr.waitForFunction(() => { const r = document.querySelector('[data-ps="lot-card-root"]'); return r && !r.hidden && document.querySelector('[data-ps="cc-stats"] [data-stat]'); }, null, { timeout: ms });
  const act = async (fr, fn, arg) => fr.evaluate(fn, arg);
  const tab = (fr, id) => fr.evaluate((i) => document.querySelector(`[data-ps="cc-views"] [data-tab="${i}"]`)?.click(), id);
  const layout = async (fr, id) => { await fr.evaluate((i) => window.__ps.lotCard.setLayout(i), id); await fr.waitForTimeout(2500); };

  const page = await mk({ width: 1440, height: 900 });
  await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Lot 12/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('lookup wait: ' + e.message));
  await page.waitForTimeout(6000);
  const fr = page.mainFrame();
  await shot(page, 'catalogue-00-strata');
  await fr.evaluate(() => document.querySelector('[data-ps="cc-type-btn"]')?.click());
  await shot(page, 'catalogue-01-type-picker');
  await fr.evaluate(() => document.querySelector('[data-ps="cc-type-btn"]')?.click());
  // Warehouse with 4 docks, 3D.
  await fr.evaluate(() => window.__ps.lotCard.setType('warehouse')); await fr.waitForTimeout(3000);
  await fr.evaluate(() => { const o = window.__ps.buildingOps; const id = window.__ps.store.project.commercial.buildings[0].id; o.setBuildingParam(window.__ps.store, id, 'docks', 4); });
  await fr.waitForTimeout(1500);
  await shot(page, 'catalogue-02-warehouse-aerial');
  await tab(fr, '3d'); await page.waitForTimeout(3500); await shot(page, 'catalogue-03-warehouse-3d-4-docks');
  await tab(fr, 'street'); await page.waitForTimeout(3000); await shot(page, 'catalogue-04-warehouse-street');
  // Showroom street view.
  await fr.evaluate(() => window.__ps.lotCard.setType('showroom')); await fr.waitForTimeout(3000);
  await tab(fr, 'street'); await page.waitForTimeout(3500); await shot(page, 'catalogue-05-showroom-street');
  await tab(fr, '3d'); await page.waitForTimeout(3000); await shot(page, 'catalogue-06-showroom-3d');
  await tab(fr, 'aerial'); await page.waitForTimeout(1500);
  await fr.evaluate(() => window.__ps.lotCard.setType('warehouse')); await fr.waitForTimeout(2500);
  await fr.evaluate(() => { const o = window.__ps.buildingOps; const id = window.__ps.store.project.commercial.buildings[0].id; o.setBuildingParam(window.__ps.store, id, 'docks', 4); });
  await fr.waitForTimeout(800);
  await page.context().close();
  // The full editor (not embedded): the commercial dock with Buildings, the 2D plan, a selected building.
  const pe = await mk({ width: 1440, height: 900 });
  await pe.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
  await pe.waitForFunction(() => window.__ps?.store?.project?.commercial?.rows?.length > 0, null, { timeout: 60000 }).catch((e) => log.push('editor wait: ' + e.message));
  await pe.waitForTimeout(4000);
  await pe.evaluate(async () => {
    const ps = window.__ps; const s = ps.store; const o = ps.buildingOps;
    const mod = null; void mod;
    if (!s.project.commercial) return;
    const id = o.addBuilding(s, 'warehouse');
    o.setBuildingParam(s, id, 'docks', 4);
    s.setUI({ view: '2d', commercialBuilding: id, commercialRow: null });
  });
  await pe.waitForTimeout(3000); await shot(pe, 'catalogue-07-editor-dock-2d');
  await pe.evaluate(() => { const s = window.__ps.store; s.setUI({ view: '3d' }); });
  await pe.waitForTimeout(3000); await shot(pe, 'catalogue-08-editor-3d');
  await pe.context().close();
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

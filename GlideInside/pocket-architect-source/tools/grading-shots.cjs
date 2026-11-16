// Screenshots of the commercial 3D view for the pavement catalogue (concrete apron, asphalt car park, kerbs, markings) into the folder given.
// Same stub as tools/commercial-lotcard-shots.cjs (served site, real Worker app at /api, stubbed /api/site/*). SITE_DIR points at the website
// root holding a build of the app (node tools/build-single.mjs --out <root>/plan-studio/app/index.html).
//   SITE_DIR=/path/to/site node tools/commercial-pavement-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const SITE = path.resolve(process.env.SITE_DIR || '/home/claude/wt-gradefix/GlideInside/website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/pavement-shots');
const PORT = Number(process.env.PORT || 8818); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADDRESS = '12 Industrial Drive, Westdale NSW';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('/home/claude/wt-gradefix/GlideInside/pocket-architect-source/server/lib/app.js');
  const { createMemoryStore } = await import('/home/claude/wt-gradefix/GlideInside/pocket-architect-source/server/lib/store.js');
  const { demoLotResponse } = await import('/home/claude/wt-gradefix/GlideInside/pocket-architect-source/src/site/demo-lot.js');
  const tam = (await import('/home/claude/wt-gradefix/GlideInside/pocket-architect-source/src/site/fixtures/tamworth.js')).default;
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  const lotResp = () => {
    const r = demoLotResponse({ commercial: true });
    const W = 72; const D = 112;
    const outer = [[-W / 2 - 2, -D / 2], [W / 2, -D / 2 + 1.5], [W / 2 + 1, D / 2], [-W / 2, D / 2 - 1]];
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432', polygons: [{ outer, holes: [] }], areaM2: 8050, registeredAreaM2: 8050,
        bboxMga: { minE: r.origin.e - 37, minN: r.origin.n - 57, maxE: r.origin.e + 37, maxN: r.origin.n + 57 } } };
  };
  const jpg = fs.readFileSync(path.resolve('/home/claude/wt-gradefix/GlideInside/pocket-architect-source/tests/fixtures/aerial-test.jpg'));
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
  await page.goto(`${ORIGIN}/commercial/`, { waitUntil: 'domcontentloaded' });
  let fr; for (let i = 0; i < 100 && !(fr = appFrame(page)); i++) await page.waitForTimeout(200);
  await cardReady(fr).catch((e) => log.push('card not ready (demo): ' + e.message));
  await page.fill('#as-input', '12 Industrial');
  await page.waitForSelector('#as-list li', { timeout: 15000 });
  await page.click('#as-list li');
  await fr.waitForFunction(() => /Lot 12|Industrial/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('lookup wait: ' + e.message));
  await fr.waitForTimeout(6000);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.as-wrap').getBoundingClientRect().top + scrollY - 70));
  await layout(fr, process.env.LAYOUT || 'best');
  await tab(fr, '3d'); await page.waitForTimeout(3500);
  // Frame the paved area: poses come from the same pavement model the app drew (plan mm to metres, plan y is world z).
  const proj = await fr.evaluate(() => JSON.parse(JSON.stringify(window.__ps.store.project)));
  const lotb = proj.site.lot.boundary; const cx = lotb.reduce((a, q) => a + q.x, 0) / lotb.length / 1000; const miny = Math.min(...lotb.map((q) => q.y)) / 1000; const maxy = Math.max(...lotb.map((q) => q.y)) / 1000;
  console.log('terrain', !!proj.site.lot.terrain, 'lot', cx, miny, maxy);
  await fr.evaluate(() => { const st = document.createElement('style'); st.textContent = '[data-ps="lot-card-root"]{visibility:hidden!important}'; document.head.appendChild(st); });
  const frameBox = await page.evaluate(() => { const r = document.querySelector('iframe[src*="plan-studio"]')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
  const fly = (pose) => fr.evaluate(async (po) => { const v = window.__ps.getViewer(); await v.flyTo(po, { duration: 0.01 }); }, pose);
  const poses = { 'low-frontage': { position: { x: cx - 25, y: 3.2, z: miny - 14 }, target: { x: cx, y: 0, z: miny + 12 }, fov: 60 }, 'low-carpark': { position: { x: cx + 18, y: 2.6, z: miny + 40 }, target: { x: cx - 4, y: 0, z: miny + 62 }, fov: 60 }, 'mid-court': { position: { x: cx + 30, y: 14, z: miny + 8 }, target: { x: cx, y: 0, z: miny + 35 }, fov: 55 } };
  for (const [name, pose] of Object.entries(poses)) { await fly(pose); await page.waitForTimeout(1800); await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: frameBox ? { x: frameBox.x, y: frameBox.y + 38, width: frameBox.width, height: frameBox.height - 38 } : undefined }); console.log('shot', name); }
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

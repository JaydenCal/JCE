// Screenshots of the commercial 3D view for the pavement catalogue (concrete apron, asphalt car park, kerbs, markings) into the folder given.
// Same stub as tools/commercial-lotcard-shots.cjs (served site, real Worker app at /api, stubbed /api/site/*). SITE_DIR points at the website
// root holding a build of the app (node tools/build-single.mjs --out <root>/plan-studio/app/index.html).
//   SITE_DIR=/path/to/site node tools/commercial-pavement-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const SITE = path.resolve(process.env.SITE_DIR || path.resolve(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/pavement-shots');
const PORT = Number(process.env.PORT || 8818); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  const { pavementModel } = await import('../src/commercial/catalogue/pavements/logic.js');
  const m = pavementModel(proj.commercial, proj.site.lot);
  console.log(JSON.stringify({ areas: m.areas.map((a) => [a.id, a.type, Math.round(a.areaM2)]), kerbs: m.kerbs.map((k) => [k.type, Math.round(k.lengthMm)]), counts: m.quantities.markings.map((q) => [q.type, q.count]) }));
  const mm = (p) => ({ x: p.x / 1000, z: p.y / 1000 });
  const area = (id) => m.areas.find((a) => a.id.endsWith(id));
  const mid = (a) => { const q = a.polygon.map(mm); return { x: q.reduce((s, p) => s + p.x, 0) / q.length, z: q.reduce((s, p) => s + p.z, 0) / q.length }; };
  const apron = mid(area(':apron')); const bays = mid(area(':bays'));
  const acc = m.items.find((i) => i.type === 'accessible-symbol'); const cross = m.items.find((i) => i.type === 'ped-crossing');
  const layback = m.kerbs.find((k) => k.type === 'layback-kg') || m.kerbs[0]; const kb = mm(layback.polyline[0]);
  const kd = { x: layback.polyline[1].x - layback.polyline[0].x, y: layback.polyline[1].y - layback.polyline[0].y }; const kl = Math.hypot(kd.x, kd.y) || 1; const kn = { x: -kd.y / kl, z: kd.x / kl }; // the kerb's outward normal
  const poses = JSON.parse(process.env.POSES || 'null') || {
    'aerial-overview': { position: { x: apron.x + 40, y: 62, z: apron.z + 62 }, target: { x: apron.x, y: 0, z: apron.z + 6 }, fov: 40 },
    'apron-concrete': { position: { x: apron.x - 8, y: 4.5, z: apron.z + 6.5 }, target: { x: apron.x + 6, y: 0, z: apron.z - 0.8 }, fov: 58 },
    'carpark-asphalt': { position: { x: bays.x + 26, y: 11, z: bays.z + 20 }, target: { x: bays.x - 2, y: 0, z: bays.z - 2 }, fov: 48 },
    'kerb-and-layback': { position: { x: kb.x + kn.x * 4.5, y: 1.7, z: kb.z + kn.z * 4.5 }, target: { x: kb.x - kn.x * 1, y: 0, z: kb.z }, fov: 58 },
    'accessible-crossing': { position: { x: (acc ? acc.x / 1000 : bays.x) + 5, y: 5.5, z: (acc ? acc.y / 1000 : bays.z) + 8 }, target: { x: acc ? acc.x / 1000 : bays.x, y: 0, z: (acc ? acc.y / 1000 : bays.z) - 3 }, fov: 55 },
  };
  // Manual markings (arrows, give way, stop bar, speed hump, keep clear, loading zone) added to the aisle, to check the 3D of each.
  const ar = m.areas.find((a) => a.id.endsWith(':aisle')); const aq = ar.polygon.map(mm);
  const ax = (aq[0].x + aq[1].x) / 2; const az = (aq[0].z + aq[2].z) / 2; const ang = (proj.commercial.rows[0].rotationDeg || 0);
  const man = [
    { type: 'arrow-straight', x: ax * 1000 - 6000, y: az * 1000, rotationDeg: ang },
    { type: 'arrow-left', x: ax * 1000 - 3000, y: az * 1000, rotationDeg: ang },
    { type: 'arrow-right', x: ax * 1000, y: az * 1000, rotationDeg: ang },
    { type: 'stop-bar', x: ax * 1000 + 3000, y: az * 1000, rotationDeg: ang, widthMm: 3000 },
    { type: 'give-way', x: ax * 1000 + 5000, y: az * 1000, rotationDeg: ang, widthMm: 3000 },
    { type: 'speed-hump', x: ax * 1000 + 8500, y: az * 1000, rotationDeg: ang },
    { type: 'keep-clear', x: ax * 1000 + 13000, y: az * 1000, rotationDeg: ang },
  ];
  await fr.evaluate(() => { const st = document.createElement('style'); st.textContent = '[data-ps="lot-card-root"]{visibility:hidden!important}'; document.head.appendChild(st); });
  const frameBox = await page.evaluate(() => { const r = document.querySelector('iframe[src*="plan-studio"]')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
  const fly = (pose) => fr.evaluate(async (po) => { const v = window.__ps.getViewer(); await v.flyTo(po, { duration: 0.01 }); }, pose);
  for (const [name, pose] of Object.entries(poses)) { await fly(pose); await page.waitForTimeout(1800); await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: frameBox ? { x: frameBox.x, y: frameBox.y + 38, width: frameBox.width, height: frameBox.height - 38 } : undefined }); console.log('shot', name); }
  await fr.evaluate((items) => { window.__ps.store.apply('markings', (p) => { p.commercial.markings = items; }); }, man);
  await page.waitForTimeout(2500);
  const mp = { position: { x: ax + 3, y: 9, z: az + 10 }, target: { x: ax + 3, y: 0, z: az }, fov: 55 };
  await fly(mp); await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'manual-markings.png'), clip: frameBox ? { x: frameBox.x, y: frameBox.y + 38, width: frameBox.width, height: frameBox.height - 38 } : undefined }); console.log('shot manual-markings');
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

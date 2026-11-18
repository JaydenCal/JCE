// 3D review screenshots: strata complex, warehouse with metal upper, showroom, service station, mixed site and a residential house, each in Aerial, 3D, Street and Walk inside.
//   node tools/review3d-shots.cjs [outDir] [prefix] [scene,scene]   (prefix: before | after)
// Serves website-live as the site root, the real Worker app at /api, and stubs /api/site/* with a real looking E4 lot.
//   node tools/commercial-lotcard-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/fable-3d-review');
const PORT = Number(process.env.PORT || 8841); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADDRESS = '12 Industrial Drive, Westdale NSW';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const { demoLotResponse } = await import('../src/site/demo-lot.js');
  const tam = (await import('../src/site/fixtures/tamworth.js')).default;
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  let RES = false;
  const lotResp = () => {
    if (RES) { const d = demoLotResponse({}); return { ...d, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL' }; }
    const r = demoLotResponse({ commercial: true });
    const W = 72; const D = 112;
    const outer = [[-W / 2 - 2, -D / 2], [W / 2, -D / 2 + 1.5], [W / 2 + 1, D / 2], [-W / 2, D / 2 - 1]];
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432', polygons: [{ outer, holes: [] }], areaM2: 8050, registeredAreaM2: 8050,
        bboxMga: { minE: r.origin.e - 37, minN: r.origin.n - 57, maxE: r.origin.e + 37, maxN: r.origin.n + 57 } } };
  };
  const CACHE = path.join(OUT, 'aerial-cache'); fs.mkdirSync(CACHE, { recursive: true });
  const server = http.createServer(async (req, res_) => {
    const res = res_;
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/api/site/search') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ results: [{ label: ADDRESS, state: 'NSW', lon: 150.930273, lat: -31.090267 }] })); }
    if (u.pathname === '/api/site/lot') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(lotResp())); }
    if (u.pathname === '/api/site/aerial') {
      // A synthetic street drawn for the box asked for (tools/review3d-aerial.py), at the resolution the real service would give, cached on disk.
      const [minE, minN, maxE, maxN] = String(u.searchParams.get('bbox')).split(',').map(Number);
      const [oe, on] = String(u.searchParams.get('origin') || `${lotResp().origin.e},${lotResp().origin.n}`).split(',').map(Number);
      const res = Math.min(2, Math.max(0.05, Number(u.searchParams.get('res')) || 0.1));
      const maxPx = Number(u.searchParams.get('maxpx')) || 4096;
      const k = Math.max(1, (maxE - minE) / res / Math.min(maxPx, (maxE - minE) > 200 ? 800 : maxPx), (maxN - minN) / res / Math.min(maxPx, (maxE - minE) > 200 ? 800 : maxPx));
      const w = Math.ceil((maxE - minE) / res / k); const h = Math.ceil((maxN - minN) / res / k);
      const box = [minE - oe, minN - on, maxE - oe, maxN - on].map((v) => v.toFixed(1));
      const file = path.join(CACHE, `${RES ? 'r' : 'c'}_${box.join('_')}_${w}x${h}.jpg`);
      if (!fs.existsSync(file)) require('child_process').execFileSync('python3', [path.resolve(__dirname, 'review3d-aerial.py'), ...box, String(w), String(h), file, ...(RES ? ['res'] : [])]);
      const meta = { ...tam.aerial, bbox: { minE, minN, maxE, maxN }, widthPx: w, heightPx: h, mmPerPx: ((maxE - minE) / w) * 1000, source: 'Synthetic test picture', sample: false, synthetic: true };
      res_.writeHead(200, { 'content-type': 'image/jpeg', 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) }); return res_.end(fs.readFileSync(file));
    }
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
  const shot = async (pg, name) => { await pg.waitForTimeout(900); try { await pg.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 240000 }); console.log('shot', name); } catch (e) { console.log('shot failed', name, String(e.message).split('\n')[0]); } };
  const cardReady = async (fr, ms = 45000) => fr.waitForFunction(() => { const r = document.querySelector('[data-ps="lot-card-root"]'); return r && !r.hidden && document.querySelector('[data-ps="cc-stats"] [data-stat]'); }, null, { timeout: ms });
  const act = async (fr, fn, arg) => fr.evaluate(fn, arg);
  const tab = (fr, id) => fr.evaluate((i) => document.querySelector(`[data-ps="cc-views"] [data-tab="${i}"]`)?.click(), id);
  const layout = async (fr, id) => { await fr.evaluate((i) => window.__ps.lotCard.setLayout(i), id); await fr.waitForTimeout(2500); };

  const PRE = 'after';
  RES = true;
  const ph = await mk({ width: 1440, height: 900 });
  await ph.goto(`${ORIGIN}/plan-studio/app/?address=${encodeURIComponent('14 Wattle Street, Westdale NSW')}`, { waitUntil: 'domcontentloaded' });
  const f2 = ph.mainFrame();
  await ph.waitForFunction(() => window.__ps?.store?.project?.site?.lot?.boundary?.length > 2 && window.__ps.store.project.levels?.some((l) => l.walls?.length) && !/Loading your block|Placing design/.test(document.body.innerText), null, { timeout: 300000 }).catch((e) => log.push('house wait: ' + e.message));
  await ph.waitForTimeout(12000);
  await ph.getByText('Skip to editor').click().catch(() => {}); await ph.waitForTimeout(4000);
  console.log('lot roads', await f2.evaluate(() => (window.__ps.store.project.site.lot.roads || []).length));
  await f2.evaluate(() => window.__ps.store.setUI({ view: '2d' })); await ph.waitForTimeout(3500); await shot(ph, 'house-plan');
  await f2.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await ph.waitForTimeout(3500);
  await f2.evaluate(() => document.querySelector('[data-ps="view3d-aerial"]')?.click()); await ph.waitForTimeout(3500); await shot(ph, 'house-3d');
  console.log('tool L', await f2.evaluate(() => [...document.querySelectorAll('[data-ps^="tool-"]')].map((e) => e.dataset.ps).join(',')));
  // One user drawn road across the lot (not at the frontage), then 2D and 3D again.
  await f2.evaluate(() => {
    const st = window.__ps.store; const b = st.project.site.lot.boundary;
    const xs = b.map((q) => q.x); const ys = b.map((q) => q.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    st.apply('Draw road', (p) => { (p.site.paved ||= []).push({ id: 'way1', kind: 'road', material: 'asphalt', widthMm: 5500, radiusMm: 0, heads: [], kerbEdge: null, pts: [{ x: Math.min(...xs) + 3000, y: Math.max(...ys) - 6000 }, { x: cx, y: Math.max(...ys) - 6000 }, { x: Math.max(...xs) - 3000, y: Math.min(...ys) + 8000 }] }); });
  });
  await f2.evaluate(() => window.__ps.store.setUI({ view: '2d' })); await ph.waitForTimeout(3500); await shot(ph, 'house-plan-drawn-road');
  await f2.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await ph.waitForTimeout(3500);
  await f2.evaluate(() => document.querySelector('[data-ps="view3d-aerial"]')?.click()); await ph.waitForTimeout(3500); await shot(ph, 'house-3d-aerial-drawn-road');
  console.log('log', JSON.stringify(log.slice(0, 5)));
  await browser.close(); server.close(); process.exit(0);
})();

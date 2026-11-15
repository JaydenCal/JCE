// Screenshots of the tilt-up and panel construction systems (strata complex, warehouse with metal upper, showroom with accent entry) into the folder given. Reuses the lot card stub server.
// Serves website-live as the site root, the real Worker app at /api, and stubs /api/site/* with a real looking E4 lot.
//   node tools/commercial-lotcard-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/tiltup-shots');
const PORT = Number(process.env.PORT || 8827); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  const setParams = (type, params) => fr.evaluate(([t, ps]) => { const o = window.__ps.buildingOps; const st = window.__ps.store; const id = st.project.commercial.buildings.find((b) => b.type === t || true).id; for (const [k, v] of Object.entries(ps)) o.setBuildingParam(st, id, k, v); }, [type, params]);
  // 1. Strata complex in tilt-up.
  await fr.evaluate(() => window.__ps.lotCard.setLayout('b2b-12')); await fr.waitForFunction(() => !document.querySelector('.is-busy'), null, { timeout: 60000 }); await fr.waitForTimeout(14000);
  // The rows are edited after the layout is placed; a colour change then regenerates the walls from the rows.
  await fr.evaluate(() => window.__ps.buildingOps.setRowsUnit(window.__ps.store, { construction: 'tilt_up', panelFinish: 'painted', panelColour: 'project', panelReveals: 'one', accentPanels: 'both', accentColour: 'charcoal', signageBand: true })); await fr.waitForTimeout(2500);
  console.log('strata construction', await fr.evaluate(() => window.__ps.store.project.commercial.rows[0].unit.construction + ' walls with panel ' + window.__ps.store.project.levels.flatMap((l) => l.walls).filter((w) => w.panel).length));
  await tab(fr, 'aerial'); await page.waitForTimeout(2500); await shot(page, 'tiltup-01-strata-aerial');
  await tab(fr, '3d'); await page.waitForTimeout(3500); await shot(page, 'tiltup-02-strata-3d');
  console.log('viewer panels', await fr.evaluate(() => { const pw = window.__ps.store.project.levels.flatMap((l) => l.walls).filter((w) => w.panel).length; console.log('x'); window.__pw = pw; const m = window.__ps.getViewer?.()?.getModel?.(); const n = []; m?.traverse((o) => { if (o.isMesh && /panels/.test(o.name)) n.push(o.name); }); const all = {}; m?.traverse((o) => { if (o.isMesh) { const k = String(o.name).split(':')[0]; all[k] = (all[k] || 0) + 1; } }); return 'pw ' + pw + ' ' + n.length + ' ' + JSON.stringify(all).slice(0, 60); }));
  await tab(fr, 'street'); await page.waitForTimeout(3500); await shot(page, 'tiltup-03-strata-street');
  // 2. Warehouse, tilt-up with a metal upper.
  await fr.evaluate(() => window.__ps.lotCard.setType('warehouse')); await fr.waitForTimeout(3000);
  await setParams('warehouse', { construction: 'tilt_up_metal_upper', panelFinish: 'painted', panelColour: 'sand', dadoHeightMm: 3600 });
  await fr.waitForTimeout(1500);
  console.log('warehouse', await fr.evaluate(() => JSON.stringify(window.__ps.store.project.commercial.buildings.map((b) => [b.type, b.params.construction])) + ' panel walls ' + window.__ps.store.project.levels.flatMap((l) => l.walls).filter((w) => w.panel).length));
  await tab(fr, '3d'); await page.waitForTimeout(3500); await shot(page, 'tiltup-04-warehouse-metal-upper-3d');
  await tab(fr, 'street'); await page.waitForTimeout(3500); await shot(page, 'tiltup-05-warehouse-metal-upper-street');
  // 3. Showroom with painted panels and an accent entry.
  await fr.evaluate(() => window.__ps.lotCard.setType('showroom')); await fr.waitForTimeout(3000);
  await setParams('showroom', { construction: 'tilt_up', panelFinish: 'painted', panelColour: 'sand', accentPanels: 'entry', accentColour: 'charcoal', panelReveals: 'two', signageBand: true });
  await fr.waitForTimeout(1500);
  await tab(fr, 'street'); await page.waitForTimeout(3500); await shot(page, 'tiltup-06-showroom-street');
  await tab(fr, '3d'); await page.waitForTimeout(3500); await shot(page, 'tiltup-07-showroom-3d');
  await tab(fr, 'aerial'); await page.waitForTimeout(2000); await shot(page, 'tiltup-08-showroom-aerial');
  await page.context().close();
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

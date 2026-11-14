// Screenshots of the commercial lot card (landing page card and the embedded viewer) into the folder given.
// Serves website-live as the site root, the real Worker app at /api, and stubs /api/site/* with a real looking E4 lot.
//   node tools/commercial-lotcard-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/commercial-lotcard-shots');
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

  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const page = await mk({ width: w, height: h });
    if (w > 760) {
      await page.goto(`${ORIGIN}/commercial/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.querySelector('#as-input')?.scrollIntoView({ block: 'start' }));
      let fr; for (let i = 0; i < 100 && !(fr = appFrame(page)); i++) await page.waitForTimeout(200);
      await cardReady(fr).catch((e) => log.push('card not ready (demo): ' + e.message));
      await page.evaluate(() => window.scrollTo(0, document.querySelector('.as-wrap').getBoundingClientRect().top + scrollY - 70));
      await shot(page, `landing-before-${tag}`);
      await page.fill('#as-input', '12 Industrial');
      await page.waitForSelector('#as-list li', { timeout: 15000 });
      await page.click('#as-list li');
      await fr.waitForFunction((a) => /Lot 12|Industrial/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), ADDRESS, { timeout: 60000 }).catch((e) => log.push('lookup wait: ' + e.message));
      await fr.waitForTimeout(6000);
      await shot(page, `landing-after-${tag}`);
      const fr2 = appFrame(page);
      for (const [id, name] of [['row-6', 'single-row-6'], ['b2b-16', 'back-to-back-16'], ['court-20', 'central-apron-20']]) { await layout(fr2, id); await shot(page, `layout-${name}-${tag}`); }
      await layout(fr2, 'best'); await tab(fr2, '3d'); await page.waitForTimeout(2500); await shot(page, `view-3d-${tag}`);
      await tab(fr2, 'street'); await page.waitForTimeout(2500); await shot(page, `view-street-${tag}`);
      await tab(fr2, 'units'); await shot(page, `view-units-${tag}`);
      await fr2.evaluate(() => document.querySelector('[data-ps="cc-feas-open"]')?.click()); await shot(page, `view-feasibility-${tag}`);
      await fr2.evaluate(() => window.__ps.lotCard.closePanel());
      await tab(fr2, 'street'); await fr2.evaluate(() => { window.__ps.lotCard.setFinish('cladding', 'charcoal'); window.__ps.lotCard.setFinish('door', 'brick-red'); }); await page.waitForTimeout(1500); await shot(page, `finish-charcoal-red-doors-${tag}`);
      await fr2.evaluate(() => { window.__ps.lotCard.setFinish('cladding', 'tilt-panel-grey'); window.__ps.lotCard.setFinish('door', 'dark-grey'); }); await page.waitForTimeout(1500); await shot(page, `finish-tilt-panel-grey-${tag}`);
      await tab(fr2, 'walk'); await page.waitForTimeout(3500); await shot(page, `view-walk-${tag}`);
    } else {
      await page.goto(`${ORIGIN}/commercial/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.scrollTo(0, document.querySelector('.as-wrap').getBoundingClientRect().top + scrollY - 70));
      await shot(page, `landing-before-${tag}`);
      await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial`, { waitUntil: 'domcontentloaded' });
      await cardReady(page.mainFrame()).catch((e) => log.push('card not ready (demo, phone): ' + e.message));
      await page.waitForTimeout(3000);
      await shot(page, `app-demo-${tag}`);
      await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /Lot 12/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('phone lookup wait: ' + e.message));
      await page.waitForTimeout(6000);
      const fr = page.mainFrame();
      await shot(page, `landing-after-${tag}`);
      for (const [id, name] of [['row-6', 'single-row-6'], ['b2b-16', 'back-to-back-16'], ['court-20', 'central-apron-20']]) { await layout(fr, id); await shot(page, `layout-${name}-${tag}`); }
      await layout(fr, 'best'); await tab(fr, '3d'); await page.waitForTimeout(2500); await shot(page, `view-3d-${tag}`);
      await tab(fr, 'street'); await page.waitForTimeout(2500); await shot(page, `view-street-${tag}`);
      await tab(fr, 'units'); await shot(page, `view-units-${tag}`);
      await fr.evaluate(() => window.__ps.lotCard.closePanel()); await fr.evaluate(() => document.querySelector('.lc-more')?.click()); await shot(page, `card-details-${tag}`);
      await fr.evaluate(() => document.querySelector('[data-ps="cc-feas-open"]')?.click()); await shot(page, `view-feasibility-${tag}`);
    }
    await page.context().close();
  }
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

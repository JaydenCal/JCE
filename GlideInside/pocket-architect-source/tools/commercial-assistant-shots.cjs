// Screenshots of the AI assistant panel in commercial mode, with the in-browser mock answering. Stubs the site lookup like commercial-lotcard-shots.cjs.
//   node tools/commercial-assistant-shots.cjs [outDir]
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/assistant-shots');
const PORT = Number(process.env.PORT || 8819); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()}`); });
  // The mock must be on before the premium module starts, so set it as soon as the app object exists.
  await page.addInitScript(() => { const t = setInterval(() => { if (window.__ps?.CONFIG) { window.__ps.CONFIG.aiMock = true; clearInterval(t); } }, 5); });
  await page.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Lot 12/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('lookup wait: ' + e.message));
  await page.waitForTimeout(7000);
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  await page.click('.ps-tab[data-tab="ai"]').catch((e) => log.push('tab: ' + e.message));
  await page.waitForTimeout(1500);
  await shot('assistant-chips');
  await page.click('.psp-prompt:has-text("Compare three options")').catch((e) => log.push('chip: ' + e.message));
  await page.click('.psp-ai button:has-text("Send")').catch((e) => log.push('send: ' + e.message));
  await page.waitForSelector('[data-ps="ai-options"]', { timeout: 30000 }).catch((e) => log.push('options: ' + e.message));
  await shot('assistant-compare');
  await page.click('[data-option="B"] button:has-text("Apply")').catch((e) => log.push('apply: ' + e.message));
  await shot('assistant-compare-applied');
  await page.fill('.psp-input', 'Write a development brief');
  await page.click('.psp-ai button:has-text("Send")').catch(() => {});
  await page.waitForSelector('[data-ps="ai-brief"]', { timeout: 30000 }).catch((e) => log.push('brief: ' + e.message));
  await page.evaluate(() => document.querySelector('.psp-history')?.scrollTo(0, 1e6));
  await shot('assistant-brief');
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

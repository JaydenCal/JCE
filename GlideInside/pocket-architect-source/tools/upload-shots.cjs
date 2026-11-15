// Screenshots of the boundary upload: the dialog, an uploaded overseas lot (KML near Auckland, no Mapbox token so grey ground) and the custom rules panel.
//   node tools/upload-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/upload-shots');
const PORT = Number(process.env.PORT || 8819); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const KML = path.resolve(__dirname, '../tests/fixtures/upload/auckland.kml');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } }); // no MAPBOX_PUBLIC_TOKEN on purpose
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/site/')) { res.writeHead(502, { 'content-type': 'application/json' }); return res.end('{"error":"stub"}'); }
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers); return res.end(Buffer.from(await r.arrayBuffer()));
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
  await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|api\.mapbox\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/502|stub/.test(m.text())) log.push(`console.error: ${m.text()}`); });
  const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ps="lc-upload"]', { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('[data-ps="lc-upload"]');
  await page.waitForSelector('[data-ps="upload-dialog"]');
  await shot('01-upload-dialog');
  await page.setInputFiles('[data-ps="upload-file"]', KML);
  await page.waitForSelector('[data-ps="upload-use"]:not([disabled])', { timeout: 20000 });
  await shot('02-upload-review');
  await page.click('[data-ps="upload-use"]');
  await page.waitForSelector('[data-ps="upload-dialog"]', { state: 'detached', timeout: 30000 }).catch((e) => log.push('dialog still open: ' + e.message));
  await page.waitForTimeout(6000);
  await shot('03-uploaded-overseas-lot');
  const tab = (id) => page.evaluate((i) => document.querySelector(`[data-ps="cc-views"] [data-tab="${i}"]`)?.click(), id);
  await tab('3d'); await page.waitForTimeout(3500); await shot('04-overseas-3d-grey-ground');
  await tab('plan').catch(() => {});
  await page.click('[data-ps="lc-menu"]');
  await page.click('.lc-menu-item:has-text("Site rules")');
  await page.waitForSelector('[data-ps="rules-panel"]');
  await shot('05-custom-rules-panel');
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

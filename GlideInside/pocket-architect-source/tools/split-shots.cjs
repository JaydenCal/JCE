// Plan, Split and 3D of the commercial full editor at 1280, 1440 and 1920, with a report of any overlap between the stats strip and the other chips.
//   node tools/split-shots.cjs <outDir> <prefix>
const fs = require('fs'); const path = require('path'); const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/topview-shots'); const PRE = process.argv[3] || 'split';
const PORT = Number(process.env.PORT || 8861); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { commercialProject } = await import('../tests/helpers/commercial-fixture.mjs');
  const FIX = JSON.stringify(commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false }));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const w of [1280, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 1920 ? 1080 : 800 } });
    await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/plan-studio/app/index.html`);
    await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); }, FIX);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
    for (const view of ['2d', 'split', '3d']) {
      await page.evaluate((v) => window.__ps.store.setUI({ view: v }), view); await page.waitForTimeout(2500);
      const rep = await page.evaluate(() => {
        const q = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
        const strip = document.querySelector('.cm-strip'); if (!strip || strip.hidden) return 'no strip';
        const sr = strip.getBoundingClientRect(); const out = [];
        const others = [...document.querySelectorAll('.ps-stage button, .ps-stage .ps-credit, .ps-stage [class*="pill"], .ps-stage .lc-views, .ps-stage .ps-viewbar')].filter((e) => !strip.contains(e) && e.offsetParent !== null);
        for (const o of others) { const r = o.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue; if (r.left < sr.right && r.right > sr.left && r.top < sr.bottom && r.bottom > sr.top) out.push((o.className || o.tagName) + ':' + (o.textContent || '').trim().slice(0, 20)); }
        return out.length ? 'OVERLAP ' + out.join(' | ') : 'clear';
      });
      console.log(w, view, rep);
      await page.screenshot({ path: path.join(OUT, `${PRE}-${w}-${view}.png`) });
    }
    await ctx.close();
  }
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

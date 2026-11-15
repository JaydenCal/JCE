// Screenshots of the TOP VIEW mini map and its enlarged view (residential and commercial lot card, desktop and 390 px) into the folder given,
// plus a zoom and pan check of the enlarged view when it exists. Serves website-live as the site root with minimal /api stubs.
//   node tools/topview-shots.cjs <outDir> <prefix>      (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/topview-shots');
const PRE = process.argv[3] || 'shot';
const PORT = Number(process.env.PORT || 8831); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  const results = {};
  for (const [mode, url] of [['res', '/plan-studio/app/?embed=1'], ['com', '/plan-studio/app/?embed=1&mode=commercial']]) {
    for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
      await page.goto(ORIGIN + url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-ps="lc-mini"]', { timeout: 60000 }).catch((e) => log.push('no mini: ' + e.message));
      await page.waitForTimeout(5000);
      await page.screenshot({ path: path.join(OUT, `${PRE}-${mode}-normal-${tag}.png`) });
      const expand = await page.$('[data-ps="lc-mini-expand"]');
      await (expand || await page.$('[data-ps="lc-mini"]')).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `${PRE}-${mode}-enlarged-${tag}.png`) });
      if (await page.$('[data-ps="topview-dialog"]')) {
        const svg = await page.$('[data-ps="topview-svg"]');
        const vb = () => svg.getAttribute('viewBox');
        const v0 = await vb();
        const box = await svg.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(300);
        const v1 = await vb();
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 6 }); await page.mouse.up();
        await page.waitForTimeout(300);
        const v2 = await vb();
        await page.screenshot({ path: path.join(OUT, `${PRE}-${mode}-zoomed-${tag}.png`) });
        const dlg = await page.$eval('[data-ps="topview-dialog"]', (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, role: el.getAttribute('role'), modal: el.getAttribute('aria-modal') }; });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = !(await page.$('[data-ps="topview-dialog"]'));
        const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-ps'));
        results[`${mode}-${tag}`] = { zoomChanged: v0 !== v1, panChanged: v1 !== v2, dlg, closedByEscape: closed, focusBack };
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(OUT, `${PRE}-interaction.json`), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results));
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no page errors');
})().catch((e) => { console.error(e); process.exit(1); });

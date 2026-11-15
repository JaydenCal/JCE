// Browser check of the top view: rotate, pan, zoom, North up, moving a unit row and a building (one undo step), the corner view, Escape.
//   node tools/topview-move-shots.cjs <outDir> <prefix>   (Playwright; serves website-live with the real worker app at /api)
const fs = require('fs'); const path = require('path'); const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/topview-shots'); const PRE = process.argv[3] || 'tv';
const PORT = Number(process.env.PORT || 8851); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); const log = [];
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
  await page.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); }, FIX);
  await page.waitForSelector('[data-ps="lc-mini"]', { timeout: 60000 }); await page.waitForTimeout(3000);
  const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${PRE}-${n}.png`) }); console.log('shot', n); };
  // corner view: drag pans without opening, wheel zooms, right-drag rotates
  const mini = await page.$('[data-ps="lc-mini"]'); const bb = await mini.boundingBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  await shot('1-corner-start');
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  console.log('corner drag did not open', !(await page.isVisible('[data-ps="topview-dialog"]')));
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 40, cy - 30, { steps: 8 }); await page.mouse.up({ button: 'right' });
  console.log('corner transform', await page.evaluate(() => document.querySelector('[data-ps="lc-mini"] canvas').style.transform), 'reset visible', await page.isVisible('[data-ps="lc-mini-reset"]'));
  await shot('2-corner-moved-zoomed-rotated');
  await page.click('[data-ps="lc-mini-reset"]'); console.log('corner reset', await page.evaluate(() => document.querySelector('[data-ps="lc-mini"] canvas').style.transform === ''));
  // enlarged
  await page.click('[data-ps="lc-mini-expand"]'); await page.waitForSelector('[data-ps="topview-svg"]'); await page.waitForTimeout(1200);
  await shot('3-enlarged');
  const svg = await page.$('[data-ps="topview-svg"]'); const sb = await svg.boundingBox();
  await page.click('[data-ps="topview-rotate-right"]'); await page.click('[data-ps="topview-rotate-right"]'); await page.waitForTimeout(400);
  await shot('4-rotated-30');
  console.log('north arrow', await page.evaluate(() => document.querySelector('.tv-north').style.transform));
  await page.click('[data-ps="topview-north-up"]'); await shot('5-north-up');
  // move a unit row: find a row centre on screen via the first unit label region (click the middle of the stage)
  const undoBefore = await page.evaluate(() => window.__ps.store.project.commercial.rows.map((r) => [r.id, r.x, r.y]));
  const target = await page.evaluate(() => { const g = document.querySelector('[data-ps="topview-svg"] path[data-part="unit"]'); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  console.log('unit target', JSON.stringify(target));
  if (target) {
    await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.move(target.x + 60, target.y + 40, { steps: 10 }); await page.waitForTimeout(300);
    await shot('6-dragging-row');
    await page.mouse.up(); await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__ps.store.project.commercial.rows.map((r) => [r.id, r.x, r.y]));
    console.log('row moved', JSON.stringify(undoBefore) !== JSON.stringify(after), 'warning text:', await page.evaluate(() => document.querySelector('[data-ps="topview-warning"]').textContent));
    await shot('7-row-moved');
    await page.evaluate(() => window.__ps.store.undo()); await page.waitForTimeout(400);
    const undone = await page.evaluate(() => window.__ps.store.project.commercial.rows.map((r) => [r.id, r.x, r.y]));
    console.log('one undo restores', JSON.stringify(undone) === JSON.stringify(undoBefore));
    await page.click('[data-ps="topview-turn-right"]').catch(() => {}); await shot('8-turned-90');
  }
  await page.click('[data-ps="topview-move-mode"]'); await shot('9-pan-mode');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  console.log('escape closes', !(await page.isVisible('[data-ps="topview-dialog"]')));
  // phone
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await pc.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const ph = await pc.newPage(); await ph.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial`, { waitUntil: 'domcontentloaded' });
  await ph.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
  await ph.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); }, FIX); await ph.waitForSelector('[data-ps="lc-mini-expand"]'); await ph.waitForTimeout(2500);
  await ph.click('[data-ps="lc-mini-expand"]'); await ph.waitForTimeout(1200); await ph.screenshot({ path: path.join(OUT, `${PRE}-10-phone-enlarged.png`) }); console.log('shot 10');
  console.log(log.length ? log.join('\n') : 'no page errors');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

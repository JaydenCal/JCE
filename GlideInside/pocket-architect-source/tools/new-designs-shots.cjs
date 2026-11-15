// Screenshots of the generic design set in the built app: 2D plan and 3D for every design.
//   node tools/new-designs-shots.cjs [outDir]     (build the bundle first: node tools/build-single.mjs --out ../website-live/plan-studio/app/index.html)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/growth/new-designs');
const IDS = ['narrow_10_3bed', 'narrow_125_4bed', 'narrow_14_3bed_media', 'single_3bed_starter', 'narrow_double_4bed', 'townhouse_3bed', 'dual_occupancy_narrow', 'acreage_homestead_4bed', 'granny_1bed', 'granny_studio', 'granny_2bed_carport', 'shed_house_barn'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ps && window.__ps.store', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const skip = page.getByText('Skip to editor');
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(1500); }
  try { await page.locator('text="Skip"').first().click({ timeout: 6000 }); await page.waitForTimeout(600); } catch { /* no tour */ }
  for (const id of IDS) {
    await page.evaluate((i) => { const ps = window.__ps; ps.store.replace(ps.catalogue.createFromTemplate(i)); ps.store.setUI({ view: '2d' }); }, id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${id}-plan.png`) });
    await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${id}-3d.png`) });
    console.log('shot', id);
  }
  await browser.close(); server.close();
  if (errs.length) { console.error('page errors:\n' + errs.join('\n')); process.exit(1); }
})();

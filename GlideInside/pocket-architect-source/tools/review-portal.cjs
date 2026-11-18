// Site review driver for the builder and client portal (mock API): audits every tab at one width.
//   node tools/review-portal.cjs <width> <outDir>
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { audit, show } = require('./review-audit.cjs');
const W = Number(process.argv[2] || 1440); const OUT = path.resolve(process.argv[3]); const H = W < 600 ? 844 : 900; const tag = `portal-${W}`;
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  if (/site\.config\.js$/.test(f)) return res.end(fs.readFileSync(f, 'utf8') + '\nwindow.GI_CONFIG.portalMock = true;\n'); // review build: in-browser mock API
  fs.createReadStream(f).pipe(res);
});
(async () => {
  fs.mkdirSync(OUT, { recursive: true }); const report = []; const log = [];
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`; const portal = `${base}/website-live/portal/`; const app = `${base}/website-live/plan-studio/app/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const mk = async () => { const ctx = await browser.newContext({ viewport: { width: W, height: H } }); await ctx.route(/^https:\/\/(fonts\.|www\.googletagmanager)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' })); const pg = await ctx.newPage(); pg.setDefaultTimeout(90000); pg.on('pageerror', (e) => log.push('pageerror: ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') log.push('console.error: ' + m.text() + ' @ ' + m.location().url); }); return pg; };
  const step = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }).catch(() => {}); report.push(show(await audit(page, `${tag} ${name}`))); console.log('done', name); };
  const signIn = async (page, id, pw) => { await page.fill('input[name=username]', id); await page.fill('input[name=password]', pw); await page.click('button[type=submit]'); await page.waitForTimeout(800); };
  try {
    const page = await mk();
    await page.goto(portal); await page.waitForSelector('input[name=username]'); await step(page, '01-sign-in');
    await page.click('a[href="#forgot"]'); await page.waitForTimeout(300); await step(page, '02-forgot');
    await page.goto(portal); await page.waitForSelector('input[name=username]');
    await page.click('button[role=tab]:has-text("Client login")'); await step(page, '03-client-tab');
    await page.click('button[role=tab]:has-text("Builder login")');
    await page.click('button[type=submit]'); await page.waitForTimeout(400); await step(page, '03b-empty-submit');
    await signIn(page, 'priya@samplehomes.example', 'river-maple-47');
    await step(page, '04-after-login');
    for (const t of ['houses', 'glide', 'clients', 'billing', 'team', 'branding']) { await page.evaluate((x) => { location.hash = `/${x}`; }, t); await page.waitForTimeout(600); await step(page, `10-${t}`); }
    await page.evaluate(() => { location.hash = '/clients'; }); await page.waitForTimeout(500);
    const gen = page.locator('#generate-account'); if (await gen.count()) { await gen.click(); await page.waitForTimeout(400); await step(page, '11-generate'); await page.keyboard.press('Escape'); }
    await page.evaluate(() => { location.hash = '/billing'; }); await page.waitForTimeout(500);
    const view = page.locator('button:has-text("View tax invoice")').first(); if (await view.count()) { await view.click(); await page.waitForTimeout(500); await step(page, '12-invoice'); await page.keyboard.press('Escape'); }
    // client
    const p2 = await mk(); await p2.goto(`${portal}?client=1`); await p2.waitForSelector('input[name=username]');
    await signIn(p2, 'mei-6294', 'tulip-bear-29'); await step(p2, '20-first-sign-in');
    const p3 = await mk(); await p3.goto(`${portal}?client=1`); await p3.waitForSelector('input[name=username]');
    await signIn(p3, 'sarah-4821', 'lemon-peach-52'); await step(p3, '21-client-home');
    await p3.goto(app); await p3.waitForSelector('.pas-strip', { timeout: 20000 }).catch(() => {}); await step(p3, '22-client-app');
    await p3.click('.pas-strip button:has-text("House designs")').catch(() => {}); await p3.waitForTimeout(1500); await step(p3, '23-house-picker');
    await p3.locator('.pas-item').first().click().catch(() => {}); await p3.waitForTimeout(900); await step(p3, '24-placement');
    await p3.click('.pas-menu > button').catch(() => {}); await p3.waitForTimeout(300); await step(p3, '25-user-menu');
  } catch (e) { report.push('DRIVER ERROR ' + e.message.split('\n')[0]); console.log('driver error', e.message.split('\n')[0]); }
  fs.writeFileSync(path.join(OUT, `${tag}-audit.txt`), report.join('\n') + '\nCONSOLE:\n' + [...new Set(log)].join('\n') + '\n');
  await browser.close(); server.close();
})();

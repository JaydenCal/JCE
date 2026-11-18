// Screenshot of the portal Branding tab with the title block preview (mock API). node tools/titleblock-shots.cjs [outDir]
const http = require('http'); const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2] || '/home/claude/shots/builder-titleblocks';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1500 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); }); page.on('requestfailed', (r) => errs.push('FAIL ' + r.url()));
  await page.addInitScript(() => { let c = { portalMock: true, portalEnabled: true }; Object.defineProperty(window, 'GI_CONFIG', { get: () => c, set: (v) => { c = Object.assign(v || {}, { portalMock: true, portalEnabled: true }); } }); }); await page.goto(`${base}/website-live/portal/`);  await page.waitForSelector('input[name=username]', {timeout: 5000});
  await page.fill('input[name=username]', 'priya@samplehomes.example'); await page.fill('input[name=password]', 'river-maple-47'); await page.click('button[type=submit]'); await page.waitForTimeout(900);
  await page.evaluate(() => { location.hash = '/branding'; }); await page.waitForTimeout(700);
  const logo = 'data:image/png;base64,' + fs.readFileSync('/tmp/sample-logo.png').toString('base64');
  await page.setInputFiles('input[type=file]', '/tmp/sample-logo.png'); await page.waitForTimeout(500);
  const vals = { Name: 'Sample Homes Pty Ltd', 'Builder licence number': '123456C', ABN: '51824753556', 'Business address': '4 Industrial Drive, Thornton NSW 2322', Phone: '02 5550 0100', Email: 'hello@samplehomes.com.au', Website: 'www.samplehomes.com.au' };
  for (const [l, v] of Object.entries(vals)) { const el = page.locator(`.pp-field:has(label:has-text("${l}")) input`).first(); if (await el.count()) await el.fill(v); }
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'branding-tab.png'), fullPage: true });
  await page.locator('.pp-field:has(label:has-text("Email")) input').first().fill('not an email'); await page.waitForTimeout(200);
  await page.click('button:has-text("Save branding")'); await page.waitForTimeout(500);
  console.log('invalid email alert:', await page.locator('.pp-tb-errors').innerText());
  await page.locator('.pp-field:has(label:has-text("Email")) input').first().fill('hello@samplehomes.com.au');
  await page.click('button:has-text("Save branding")'); await page.waitForTimeout(700);
  console.log('toast:', await page.locator('.pp-toast, [role=status]').first().innerText().catch(() => 'n/a'));
  console.log('errors', errs); await browser.close(); server.close();
})();

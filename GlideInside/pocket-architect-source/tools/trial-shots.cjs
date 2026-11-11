// Screenshots of the free trial flow at 1440x900 into docs/trial-review/. Serves website-live as the site root and the real Worker app
// (createApp, in-memory store, no Stripe key, no email) at /api, so the screens run against the real routes.
//   node tools/trial-shots.cjs        (Playwright must be installed: NODE_PATH or a local install)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(__dirname, '../docs/trial-review');
const PORT = Number(process.env.PORT || 8791);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'screenshot-admin-token-0123456789';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1', ADMIN_TOKEN: TOKEN } });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const cookies = r.headers.getSetCookie?.() || [];
      if (cookies.length) headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/i, '')); // plain http on localhost
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const shot = async (name, opts = {}) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }); console.log('shot', name); };
  const post = (body) => fetch(`${ORIGIN}/api/portal/trial-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });
  const form = { tradingName: '', firstName: 'Jo', lastName: 'Marsh', mobile: '0412 345 678', region: 'Mid North Coast', homesPerYear: 24, howHeard: 'Google', consent: true, website: '' };

  // 1. The trial form on For builders.
  await page.goto(`${ORIGIN}/for-builders/`);
  await page.locator('#trial').scrollIntoViewIfNeeded();
  await page.fill('[name=companyLegalName]', 'Coastal Homes Pty Ltd');
  await page.fill('[name=abn]', '51 824 753 556');
  await page.fill('[name=tradingName]', 'Coastal Homes');
  await page.fill('[name=firstName]', 'Jo'); await page.fill('[name=lastName]', 'Marsh');
  await page.fill('[name=email]', 'jo@coastalhomes.example'); await page.fill('[name=mobile]', '0412 345 678');
  await page.selectOption('[name=region]', 'Mid North Coast'); await page.fill('[name=homesPerYear]', '24');
  await page.check('[name=consent]');
  await page.locator('#trial').scrollIntoViewIfNeeded();
  await shot('01-trial-form');
  await page.click('#trial-submit'); await page.waitForSelector('#trial-done:not([hidden])');
  await shot('02-trial-form-thanks');
  // Two more requests so the admin list has content.
  await post({ ...form, companyLegalName: 'Hinterland Builders Pty Ltd', abn: '33 051 775 556', email: 'sam@hinterland.example', firstName: 'Sam', region: 'Northern Rivers', homesPerYear: 60 });
  await post({ ...form, companyLegalName: 'Outback Cabins Pty Ltd', abn: '12 004 044 937', email: 'lee@outback.example', firstName: 'Lee', region: 'Other', homesPerYear: '' });

  // 2. The admin page: token gate, pending list, approve and the shown once login.
  await page.goto(`${ORIGIN}/portal/admin/`);
  await page.waitForSelector('input[name=token]');
  await shot('03-admin-token');
  await page.fill('input[name=token]', TOKEN); await page.click('button[type=submit]');
  await page.waitForSelector('.pp-adm-req');
  await shot('04-admin-requests', { fullPage: true });
  const decline = page.locator('.pp-adm-req', { hasText: 'Outback Cabins' }).locator('button:has-text("Decline")');
  await decline.click(); await page.fill('textarea', 'Not building in our regions'); await page.click('.pp-dialog-foot .pp-btn--danger'); await page.waitForTimeout(500);
  await page.locator('.pp-adm-req', { hasText: 'Coastal Homes' }).locator('button:has-text("Approve")').click();
  await page.waitForTimeout(300);
  await shot('05-admin-approve-confirm');
  await page.click('.pp-dialog-foot .pp-btn--primary'); await page.waitForSelector('.pp-cred');
  await shot('06-admin-credentials-shown-once');
  const text = await page.locator('.pp-cred').innerText();
  const user = (text.match(/[a-z]+-[2-9]{4}/) || [])[0];
  const pass = (text.match(/[a-z]+-[a-z]+-[2-9]{2}/) || [])[0];
  await page.click('.pp-dialog-foot .pp-btn--primary'); await page.waitForTimeout(300);
  await page.locator('.pp-tab[data-tab=approved]').click();
  await page.locator('h2:has-text("Builder accounts")').scrollIntoViewIfNeeded();
  await shot('07-admin-orgs');

  // 3. The builder signs in: trial banner, locked clients tab, billing tab.
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await b.goto(`${ORIGIN}/portal/`); await b.waitForSelector('input[name=username]');
  await b.fill('input[name=username]', user); await b.fill('input[name=password]', pass); await b.click('button[type=submit]');
  await b.waitForTimeout(800);
  const pw = b.locator('input[type=password]');
  await pw.nth(0).fill(pass); await pw.nth(1).fill('Correct-Horse-Battery-9'); await pw.nth(2).fill('Correct-Horse-Battery-9');
  await b.click('button[type=submit]'); await b.waitForTimeout(1000);
  await b.goto(`${ORIGIN}/portal/#/houses`); await b.waitForSelector('#trial-banner', { timeout: 8000 }).catch(async () => { await b.screenshot({ path: path.join(OUT, 'debug.png') }); console.log(errors.join('\n')); throw new Error('no banner'); });
  await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, '08-trial-banner-houses.png') }); console.log('shot 08');
  await b.evaluate(() => { location.hash = '/clients'; }); await b.waitForSelector('#clients-locked'); await b.waitForTimeout(400);
  await b.screenshot({ path: path.join(OUT, '09-trial-clients-locked.png') }); console.log('shot 09');
  await b.evaluate(() => { location.hash = '/billing'; }); await b.waitForSelector('#account-status'); await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, '10-trial-billing.png') }); console.log('shot 10');

  await browser.close();
  server.close();
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exit(1); });

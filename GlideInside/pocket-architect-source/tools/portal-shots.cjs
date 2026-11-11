// Screenshots of the portal screens and the client app at 1440x900 into docs/portal-screens/.
// Serves the GlideInside folder locally (the portal is website-live/portal, the app is pocket-architect-source). Mock API only.
//   node tools/portal-shots.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(__dirname, '../docs/portal-screens');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const portal = `${base}/website-live/portal/`;
  const app = `${base}/pocket-architect-source/index.html`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    return page;
  };
  const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  const signIn = async (page, id, pw) => { await page.fill('input[name=username]', id); await page.fill('input[name=password]', pw); await page.click('button[type=submit]'); await page.waitForTimeout(600); };

  // Builder
  const page = await newPage();
  await page.goto(portal); await page.waitForSelector('input[name=username]');
  await shot(page, '01-builder-sign-in');
  await page.click('a[href="#forgot"]'); await page.waitForTimeout(300); await shot(page, '02-forgot-password');
  await page.goto(portal); await page.waitForSelector('input[name=username]');
  await page.click('button[role=tab]:has-text("Client login")'); await shot(page, '03-client-sign-in');
  await page.click('button[role=tab]:has-text("Builder login")');
  await signIn(page, 'priya@samplehomes.example', 'river-maple-47');
  for (const [tab, name] of [['houses', '04-house-library'], ['glide', '05-glide-library'], ['clients', '06-clients'], ['billing', '08-billing'], ['team', '10-team'], ['branding', '11-branding']]) {
    await page.evaluate((t) => { location.hash = `/${t}`; }, tab); await page.waitForTimeout(500); await shot(page, name);
  }
  // Generate account
  await page.evaluate(() => { location.hash = '/clients'; }); await page.waitForTimeout(400);
  await page.click('#generate-account'); await page.waitForTimeout(300);
  await page.fill('.pp-form input[type=text]', 'Priscilla');
  await shot(page, '07a-generate-account');
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await shot(page, '07b-credentials-shown-once');
  const creds = await page.evaluate(() => document.body.innerText);
  const user = (creds.match(/[a-z]+-[2-9]{4}/) || [])[0];
  const pass = (creds.match(/[a-z]+-[a-z]+-[2-9]{2}/) || [])[0];
  console.log('generated', user, pass ? '(password captured)' : 'no password');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.locator('.pp-client-settings').scrollIntoViewIfNeeded(); await shot(page, '06b-client-settings');
  // Tax invoice
  await page.evaluate(() => { location.hash = '/billing'; }); await page.waitForTimeout(500);
  const view = page.locator('button:has-text("View tax invoice")').first();
  if (await view.count()) { await view.click(); await page.waitForTimeout(500); await shot(page, '09-tax-invoice'); await page.keyboard.press('Escape'); }

  // Forced password change (seeded client who has not signed in yet)
  const p2 = await newPage();
  await p2.goto(`${portal}?client=1`); await p2.waitForSelector('input[name=username]');
  await signIn(p2, 'mei-6294', 'tulip-bear-29');
  await shot(p2, '12-first-sign-in-change-password');

  // Client in the app
  const p3 = await newPage();
  await p3.goto(`${portal}?client=1`); await p3.waitForSelector('input[name=username]');
  await signIn(p3, 'sarah-4821', 'lemon-peach-52');
  await shot(p3, '13-client-home');
  await p3.goto(`${app}`); await p3.waitForSelector('.pas-strip', { timeout: 15000 }).catch(() => {});
  await p3.waitForTimeout(800);
  await shot(p3, '14-client-app');
  await p3.click('.pas-strip button:has-text("House designs")'); await p3.waitForTimeout(1500);
  await shot(p3, '15-house-picker-fit-ranking');
  await p3.locator('.pas-item').first().click(); await p3.waitForTimeout(900);
  await shot(p3, '16-placement-on-lot');
  await p3.click('.pas-btn--primary:has-text("Place house")'); await p3.waitForTimeout(700);
  await shot(p3, '17-house-placed-editable');
  await p3.click('.psp-chip, .psp-btn:has-text("Exports"), .psp-btn:has-text("Download")').catch(() => {});
  await p3.waitForTimeout(300); await shot(p3, '18-client-export-menu');
  await p3.keyboard.press('Escape');
  await p3.click('.pas-menu > button'); await p3.click('.pas-menu-list button:has-text("Send to JCE")'); await p3.waitForTimeout(500);
  await shot(p3, '19-send-to-jce');

  await browser.close(); server.close();
  console.log(errors.length ? `console errors:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

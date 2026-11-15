// Screenshots of free profiles: the save prompt, create profile, My designs and the owner's Contacts, at 1440 and 390 wide.
// Serves website-live as the site root and the real Worker app (createApp, in-memory store, no Stripe, no email) at /api.
//   PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright node tools/profile-shots.cjs [outdir]
// The password used here is made up at run time for this throwaway in-memory server. It is never printed or written anywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/profile-shots');
const PORT = Number(process.env.PORT || 8793);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(18).toString('hex');
const PW = `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}-Qz9-${crypto.randomBytes(3).toString('hex')}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: crypto.randomBytes(20).toString('hex'), ADMIN_TOKEN: ADMIN } });
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
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`) }); console.log('shot', `${name}-${label}`); };
    const email = `shots-${label}@example.com`;

    await page.goto(`${ORIGIN}/plan-studio/app/?template=house_single`);
    await page.waitForFunction(() => window.__ps?.profilesReady, null, { timeout: 30000 });
    await page.evaluate(() => window.__ps.profilesReady);
    await page.waitForSelector('[data-action="profile-save"]:not([hidden])');
    await page.waitForSelector('.pso-card', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('.pso-card .pso-link')?.click()); // skip the first run tour
    await shot('00-topbar');
    // a first meaningful edit shows the prompt (non blocking)
    await page.evaluate(() => window.__ps.store.run('add_room', { type: 'study', name: 'Study', x: 12000, y: 0, width: 3000, depth: 3000 }));
    await page.waitForSelector('[data-role="profile-prompt"]', { timeout: 8000 });
    await shot('01-prompt');
    // Not now hides it for the session
    await page.click('[data-action="prompt-notnow"]');
    await page.evaluate(() => window.__ps.store.run('add_room', { type: 'store', name: 'Store', x: 16000, y: 0, width: 3000, depth: 3000 }));
    await page.waitForTimeout(1500);
    if (await page.locator('[data-role="profile-prompt"]').count()) errors.push(`${label}: prompt came back after Not now`);
    // the button still opens it
    await page.click('[data-action="profile-save"]');
    await page.waitForSelector('[data-role="profile-prompt"]');
    await page.click('[data-action="prompt-create"]');
    await page.waitForSelector('#ps-prof-name');
    await page.fill('#ps-prof-name', 'Sam Citizen');
    await page.fill('#ps-prof-email', email);
    await page.fill('#ps-prof-pw', PW);
    await page.fill('#ps-prof-phone', '0412 345 678');
    await page.fill('#ps-prof-post', 'Tamworth 2340');
    await page.selectOption('#ps-prof-role', 'homeowner');
    await page.check('#ps-prof-terms');
    await page.check('#ps-prof-privacy');
    await shot('02-signup');
    if (await page.isChecked('#ps-prof-mk')) errors.push(`${label}: marketing box was ticked by default`);
    await page.click('[data-action="create-submit"]');
    await page.waitForSelector('[data-role="profile-status"]:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(() => /Saved to profile/.test(document.querySelector('[data-role="profile-status"]')?.textContent || ''), null, { timeout: 15000 });
    // two more designs, one commercial, so the list has something to show
    await page.evaluate(async () => {
      const api = window.__ps.profiles.api;
      const base = structuredClone(window.__ps.store.project);
      const mk = (id, name, mode, address) => ({ ...structuredClone(base), id, name, mode, site: { ...(base.site || {}), lot: address ? { address, lotLabel: 'Lot 3 DP 123456' } : base.site?.lot } });
      await api.saveDesign(mk('p_shot_two', 'Granny flat, Moore Creek Rd', undefined, '14 Moore Creek Rd, Tamworth NSW 2340'));
      await api.saveDesign(mk('p_shot_three', 'Warehouse units', 'commercial', '8 Industrial Dr, Dubbo NSW 2830'));
    });
    await page.click('[data-action="my-designs"]');
    await page.waitForSelector('[data-role="my-designs"] .ps-prof-row');
    await shot('03-my-designs');
    await page.click('.ps-modal-root .ps-modal-foot .ps-btn, .ps-modal-root footer .ps-btn');
    await page.waitForSelector('.ps-modal-root .ps-scrim', { state: 'detached', timeout: 5000 });
    await page.click('[data-action="profile-account"]');
    await page.waitForSelector('#ps-prof-prefs-mk');
    await shot('04-profile');
    await page.keyboard.press('Escape');
    await shot('05-signed-in');
    // the owner's Contacts
    const admin = await ctx.newPage();
    await admin.setViewportSize(viewport);
    await admin.addInitScript((t) => { try { sessionStorage.setItem('gi.admin.token', t); } catch (e) { /* ignore */ } }, ADMIN);
    await admin.goto(`${ORIGIN}/portal/admin/`);
    await admin.waitForSelector('#contacts-section .pp-table', { timeout: 15000 });
    await admin.locator('#contacts-section').scrollIntoViewIfNeeded();
    await admin.waitForTimeout(400);
    await admin.screenshot({ path: path.join(OUT, `06-admin-contacts-${label}.png`) });
    console.log('shot', `06-admin-contacts-${label}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  if (errors.length) { console.log('PROBLEMS:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('no page errors');
})().catch((e) => { console.error(e); process.exit(1); });

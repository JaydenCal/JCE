// Release screenshots for the merged commercial branches (lot card with warehouse and units, 3D, assistant options, subscription gate, AI meter, grace banner,
// admin trial section, boundary upload dialog, uploaded overseas lot). Real Worker app at /api (no live services: fake Stripe key, no Anthropic key), stubbed /api/site/*.
//   node tools/release-shots.cjs [outDir]
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/release-shots');
const PORT = Number(process.env.PORT || 8830); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADMIN = 'release-admin-token-0123456789';
const ADDRESS = '12 Industrial Drive, Westdale NSW';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const { demoLotResponse } = await import('../src/site/demo-lot.js');
  const tam = (await import('../src/site/fixtures/tamworth.js')).default;
  const mstore = createMemoryStore();
  const app = createApp({ store: mstore, env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1', ADMIN_TOKEN: ADMIN, STRIPE_SECRET_KEY: 'sk_test_not_used', COMMERCIAL_SUB_PRICE_ID: 'price_not_used', COMMERCIAL_AI_TOPUP_PRICE_ID: 'price_topup_not_used' } });
  const lotResp = () => {
    const r = demoLotResponse({ commercial: true });
    const W = 72; const D = 112;
    const outer = [[-W / 2 - 2, -D / 2], [W / 2, -D / 2 + 1.5], [W / 2 + 1, D / 2], [-W / 2, D / 2 - 1]];
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432', polygons: [{ outer, holes: [] }], areaM2: 8050, registeredAreaM2: 8050,
        bboxMga: { minE: r.origin.e - 37, minN: r.origin.n - 57, maxE: r.origin.e + 37, maxN: r.origin.n + 57 } } };
  };
  const jpg = fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/aerial-test.jpg'));
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/api/site/search') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ results: [{ label: ADDRESS, state: 'NSW', lon: 150.930273, lat: -31.090267 }] })); }
    if (u.pathname === '/api/site/lot') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(lotResp())); }
    if (u.pathname === '/api/site/aerial') { res.writeHead(200, { 'content-type': 'image/jpeg', 'x-site-meta': encodeURIComponent(JSON.stringify(tam.aerial)) }); return res.end(jpg); }
    if (u.pathname === '/api/site/contours') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(tam.contours)); }
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|api\.mapbox\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/502|stub/.test(m.text())) log.push(`console.error: ${m.text()}`); });
    if (opts.mock) await page.addInitScript(() => { const t = setInterval(() => { if (window.__ps?.CONFIG) { window.__ps.CONFIG.aiMock = true; clearInterval(t); } }, 5); });
    return { ctx, page };
  };
  const shotOf = (page) => async (name, o = {}) => { await page.waitForTimeout(o.wait ?? 800); await page.screenshot({ path: path.join(OUT, `${name}.png`), ...o.opts }); console.log('shot', name); };
  const lotLoaded = (page) => page.waitForFunction(() => /Lot 12/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('lookup wait: ' + e.message));
  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  const want = (k) => !ONLY.length || ONLY.includes(k);

  // 1. Assistant (mock model): compare options, then a mix with a warehouse. The result is the lot card and the 3D view.
  if (want('assistant')) {
    const { page } = await mk({ mock: true });
    const shot = shotOf(page);
    await page.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
    await lotLoaded(page);
    await page.waitForTimeout(7000);
    await page.click('.ps-tab[data-tab="ai"]').catch((e) => log.push('tab: ' + e.message));
    await page.waitForTimeout(1500);
    await page.click('.psp-prompt:has-text("Compare three options")').catch((e) => log.push('chip: ' + e.message));
    await page.click('.psp-ai button:has-text("Send")').catch((e) => log.push('send: ' + e.message));
    await page.waitForSelector('[data-ps="ai-options"]', { timeout: 60000 }).catch((e) => log.push('options: ' + e.message));
    await shot('03-assistant-compare-options');
    await page.fill('.psp-input', 'Mix workshops and a warehouse');
    await page.click('.psp-ai button:has-text("Send")').catch(() => {});
    await page.waitForTimeout(9000);
    await shot('03b-assistant-mix-applied');
    const info = await page.evaluate(() => { const p = window.__ps?.store?.project; return p ? { buildings: (p.commercial?.buildings || []).map((b) => b.type), rows: (p.commercial?.rows || []).length } : null; });
    console.log('project after mix', JSON.stringify(info));
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(await page.evaluate(() => window.__ps.store.project)));
    await page.close();
  }
  const embedUrl = `${ORIGIN}/plan-studio/app/?embed=1&mode=commercial&address=${encodeURIComponent(ADDRESS)}`;
  const tabOf = (page, id) => page.evaluate((i) => document.querySelector(`[data-ps="cc-views"] [data-tab="${i}"]`)?.click(), id);

  // 2. Lot card with a warehouse and units, then the 3D view with pavements and buildings.
  if (want('card')) {
    const { page } = await mk();
    const shot = shotOf(page);
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded' });
    await lotLoaded(page);
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.__ps.lotCard.setLayout('best'));
    await page.waitForTimeout(3000);
    const added = await page.evaluate(() => { const { addBuilding } = window.__ps.buildingOps; return addBuilding(window.__ps.store, 'warehouse', { params: { spanMm: 20000, depthMm: 28000 } }); });
    console.log('warehouse added', added);
    await page.waitForTimeout(3000);
    await shot('01-lot-card-warehouse-and-units');
    await tabOf(page, '3d'); await page.waitForTimeout(4500);
    await shot('02-3d-pavements-and-buildings');
    const proj = await page.evaluate(() => JSON.parse(JSON.stringify(window.__ps.store.project)));
    if (process.env.DUMP2) fs.writeFileSync(process.env.DUMP2, JSON.stringify(proj));
    const { pavementModel } = await import('../src/commercial/catalogue/pavements/logic.js');
    const m = pavementModel(proj.commercial, proj.site.lot);
    const mm = (q) => ({ x: q.x / 1000, z: q.y / 1000 });
    const apron = m.areas.find((a) => a.id.endsWith(':apron'));
    const c = apron ? (() => { const q = apron.polygon.map(mm); return { x: q.reduce((t, v) => t + v.x, 0) / q.length, z: q.reduce((t, v) => t + v.z, 0) / q.length }; })() : { x: 0, z: 0 };
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '[data-ps="lot-card-root"]{visibility:hidden!important}'; document.head.appendChild(st); });
    await page.evaluate(async (po) => { await window.__ps.getViewer().flyTo(po, { duration: 0.01 }); }, { position: { x: c.x + 45, y: 60, z: c.z + 60 }, target: { x: c.x, y: 0, z: c.z }, fov: 42 });
    await page.waitForTimeout(2500);
    await shot('02b-3d-overview-clear');
    await page.close();
  }

  // 4. Subscription gate (Subscribe is enabled because a price id is set; no Stripe call is made) and the AI meter on the trial login.
  if (want('billing')) {
    const { page } = await mk();
    const shot = shotOf(page);
    await page.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
    await lotLoaded(page);
    await page.waitForTimeout(5000);
    await page.click('.ps-tab[data-tab="ai"]').catch(() => {});
    await page.waitForTimeout(1200);
    await shot('04-subscription-gate-assistant-locked');
    await page.click('.psp-ai button:has-text("Subscribe")').catch((e) => log.push('gate click: ' + e.message));
    await page.waitForSelector('.psp-modal', { timeout: 8000 }).catch((e) => log.push('gate: ' + e.message));
    await shot('04b-subscription-gate-dialog');
    await page.close();

    // The owner creates the trial login in the admin API, a friend signs in, and the AI tab shows the message meter.
    const put = await fetch(`${ORIGIN}/api/commercial/admin/trial`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ username: 'friend', password: 'Gum-tree-Wattle-7731' }) });
    console.log('trial created', put.status);
    const login = await (await fetch(`${ORIGIN}/api/commercial/trial/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'friend', password: 'Gum-tree-Wattle-7731' }) })).json();
    const t = await mk();
    const shot2 = shotOf(t.page);
    await t.page.addInitScript((tok) => localStorage.setItem('ps.cs.token', JSON.stringify({ token: tok, kind: 'trial' })), login.token);
    await t.page.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
    await lotLoaded(t.page);
    await t.page.waitForTimeout(5000);
    await t.page.click('.ps-tab[data-tab="ai"]').catch(() => {});
    await t.page.waitForTimeout(2000);
    await shot2('05-ai-meter-trial-login');
    await t.page.close();

    // A subscriber whose last card payment failed: inside the three day grace period the banner shows, linking to Manage billing.
    const { signToken } = await import('../server/lib/entitlement.js');
    const nowIso = new Date().toISOString();
    await mstore.createEntitlement({ id: 'csub_grace0001', projectId: '*', email: 'dev@example.com', stripeSessionId: 'cs_grace_1', stripePaymentIntent: 'sub_grace', amountCents: 5000, currency: 'aud', creditsTotal: 0, status: 'past_due', createdAt: nowIso, expiresAt: new Date(Date.now() + 20 * 86400000).toISOString() });
    await mstore.createEntitlement({ id: 'cgrace:csub_grace0001', projectId: 'csubgrace', email: null, stripeSessionId: 'cgrace-s:csub_grace0001', amountCents: 0, currency: 'aud', creditsTotal: 0, status: 'active', createdAt: nowIso, expiresAt: new Date(Date.now() - 86400000).toISOString() });
    const subTok = await signToken({ eid: 'csub_grace0001', pid: '*', exp: Math.floor(Date.now() / 1000) + 86400 }, 'x');
    const g = await mk();
    const shot3 = shotOf(g.page);
    await g.page.addInitScript((tok) => localStorage.setItem('ps.cs.token', JSON.stringify({ token: tok, kind: 'subscription' })), subTok);
    await g.page.goto(`${ORIGIN}/plan-studio/app/?mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
    await lotLoaded(g.page);
    await g.page.waitForTimeout(5000);
    await shot3('06-grace-banner-failed-payment');
    await g.page.click('.ps-tab[data-tab="ai"]').catch(() => {});
    await g.page.waitForTimeout(1500);
    await shot3('06b-grace-banner-with-assistant');
    await g.page.close();
  }

  // 7. Admin trial section.
  if (want('admin')) {
    const { page } = await mk();
    const shot = shotOf(page);
    await page.goto(`${ORIGIN}/portal/admin/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name=token]');
    await page.fill('input[name=token]', ADMIN);
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Commercial trial login', { timeout: 15000 }).catch((e) => log.push('admin: ' + e.message));
    // The owner creates the internal test account (he types the password; this script only uses a throwaway one against the local test server).
    await fetch(`${ORIGIN}/api/portal/admin/internal-orgs`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ username: 'internal.test', password: 'Shot-only-Pass-2026-q' }) }).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=INTERNAL', { timeout: 15000 }).catch((e) => log.push('admin internal: ' + e.message));
    await page.locator('text=Builder accounts').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot('07c-admin-internal-account-badge');
    await page.click('#create-internal').catch(() => {});
    await page.waitForSelector('input[name=orgName]', { timeout: 5000 }).catch(() => {});
    await shot('07d-admin-create-internal-form');
    await page.keyboard.press('Escape');
    await page.locator('text=Commercial trial login').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot('07-admin-commercial-trial-login');
    const sec = page.locator('text=Commercial AI cost').first();
    if (await sec.count()) { await sec.scrollIntoViewIfNeeded(); await shot('07b-admin-commercial-ai-cost'); }
    await page.close();
  }

  // 8. Boundary upload: the dialog, then an uploaded overseas lot with a warehouse on it and the custom rules panel.
  if (want('upload')) {
    const { page } = await mk();
    const shot = shotOf(page);
    await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ps="lc-upload"]', { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.click('[data-ps="lc-upload"]');
    await page.waitForSelector('[data-ps="upload-dialog"]');
    await shot('08-upload-boundary-dialog');
    await page.setInputFiles('[data-ps="upload-file"]', path.resolve(__dirname, '../tests/fixtures/upload/auckland.kml'));
    await page.waitForSelector('[data-ps="upload-use"]:not([disabled])', { timeout: 20000 });
    await shot('08b-upload-review');
    await page.click('[data-ps="upload-use"]');
    await page.waitForSelector('[data-ps="upload-dialog"]', { state: 'detached', timeout: 30000 }).catch((e) => log.push('dialog still open: ' + e.message));
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.__ps.lotCard.setLayout('best')).catch(() => {});
    await page.waitForTimeout(3000);
    const added = await page.evaluate(() => { try { return window.__ps.buildingOps.addBuilding(window.__ps.store, 'vehicle-workshop'); } catch (e) { return 'ERR ' + e.message; } });
    console.log('building on the uploaded lot', added);
    await page.waitForTimeout(3000);
    await shot('09-uploaded-overseas-lot-with-building');
    await tabOf(page, '3d'); await page.waitForTimeout(4000);
    await shot('09b-uploaded-lot-3d');
    await tabOf(page, 'plan').catch(() => {});
    await page.click('[data-ps="lc-menu"]');
    await page.click('.lc-menu-item:has-text("Site rules")');
    await page.waitForSelector('[data-ps="rules-panel"]');
    await shot('10-custom-rules-panel');
    await page.close();
  }

  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

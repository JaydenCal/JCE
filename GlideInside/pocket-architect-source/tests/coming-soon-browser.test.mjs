// Browser checks (Playwright and Chrome, skipped when either is missing) for the review fixes on the coming soon branch:
//  - the website widget has no route to the full editor, the Glide library or the page around it, and says so plainly when it cannot start
//  - the signing secret is not on the page until asked for, and a designer cannot edit leads
//  - Reset in the Site costs panel never clears the builder default
// The app is the built bundle in ../website-live/plan-studio/app (rebuild it first); the panels are the source modules served as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const SITE = path.resolve(SRC, '../website-live');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'))); } catch { /* no playwright */ }
const SKIP = !chromium || !fs.existsSync(CHROME) || !fs.existsSync(path.join(SITE, 'plan-studio/app/index.html')) ? 'Playwright, Chrome or the built app is not available' : false;
const TOKEN = 'browser-test-admin-token-0123456789';
const HOSTED = 'https://www.samplehomes.example'; // the builder's website (the test page stands in for it: ?host= is read when the real ancestor is not https)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

async function serve() {
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  let origin = '';
  const holder = {};
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, origin || 'http://127.0.0.1');
    try {
      if (u.pathname.startsWith('/api/')) {
        const ch = []; for await (const c of req) ch.push(c);
        const r = await holder.app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(ch) }));
        const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
        const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (sc.length) h['set-cookie'] = sc;
        res.writeHead(r.status, h); return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (u.pathname === '/__host.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<!doctype html><body><iframe id="f" width="1100" height="820" src="${u.searchParams.get('src')}"></iframe><script>window.__msgs=[];addEventListener('message',e=>window.__msgs.push({o:e.origin,d:e.data}))</script></body>`); }
      if (u.pathname === '/__blank.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/__src/node_modules/three/build/three.module.js","three/addons/":"/__src/node_modules/three/examples/jsm/","jspdf":"/__src/node_modules/jspdf/dist/jspdf.es.min.js"}}</script><body></body>'); }
      let root = SITE; let p = decodeURIComponent(u.pathname);
      if (p.startsWith('/__src/')) { root = SRC; p = p.slice(6); }
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500); res.end(String(e?.message)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  holder.app = createApp({ store: createMemoryStore(), env: { SITE_URL: origin, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1', ADMIN_TOKEN: TOKEN } });
  return { server, origin };
}

async function seedBuilder(origin) {
  const H = await import('./helpers/grading-harness.mjs');
  const jar = { c: null };
  const call = async (m, p, b, admin) => {
    const h = { origin, 'x-gi-request': '1', 'content-type': 'application/json' };
    if (admin) h.authorization = `Bearer ${TOKEN}`; if (jar.c && !admin) h.cookie = `gi_session=${jar.c}`;
    const r = await fetch(`${origin}/api${p}`, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    for (const c of r.headers.getSetCookie?.() || []) { const x = /^gi_session=([^;]*)/.exec(c); if (x) jar.c = x[1] || null; }
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const o = await call('POST', '/portal/admin/orgs', { name: 'Sample Homes', adminFirstName: 'Priya', adminEmail: 'priya@samplehomes.example' }, true);
  assert.equal(o.status, 201);
  const cred = o.data.credentials;
  assert.equal((await call('POST', '/portal/session', { identifier: cred.username, password: cred.password })).status, 200);
  assert.equal((await call('POST', '/portal/password', { currentPassword: cred.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
  await call('PUT', '/portal/billing/contact', { name: 'Priya', email: 'accounts@samplehomes.example', phone: '', legalName: 'Sample Homes', abn: '51824753556' });
  await call('PUT', '/portal/org/branding', { displayName: 'Sample Homes', colours: { primary: '#1f4d3a', accent: '#d9822b' } });
  const ids = [];
  for (const n of ['Banksia 25', 'Wattle 30']) { const p = H.residential({ fall: 0 }); p.site = { northDeg: 0, underlay: null, tanks: [], lot: null }; ids.push((await call('POST', '/portal/houses', { name: n, project: { ...p, name: n } })).data.id); }
  const me = await call('GET', '/portal/me');
  const slug = me.data.org.slug || me.data.org.id;
  assert.equal((await call('PUT', '/portal/widget', { enabled: true, origins: [HOSTED], houseIds: ids })).status, 200);
  return { slug };
}

const VISIBLE = `(sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return !e.closest('[hidden]') && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; }).map((e) => e.outerHTML.slice(0, 80))`;
const ROUTES_TO_EDITOR = ['[data-ps="lc-edit"]', '[data-ps="lc-full-editor"]', '.ps-embed-full', '[data-ps="embed-full"]', '[data-ps="lc-upload"]', '[data-ps="lc-pdf"]', '[data-ps="lc-pdf-house"]', '[data-ps="lc-send-engineer"]'];

test('widget lockdown: no route to the full editor, the Glide library or the host page; the first design is the builder\'s own', { skip: SKIP, timeout: 150000 }, async () => {
  const { server, origin } = await serve();
  const br = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    const { slug } = await seedBuilder(origin);
    const ctx = await br.newContext({ viewport: { width: 1100, height: 820 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    // every frame: while the view is uncovered, the design on it is the builder's (never the app's own sample house)
    await ctx.addInitScript(() => { window.__seen = []; setInterval(() => { const ps = window.__ps; if (ps?.widgetMode) window.__seen.push({ cover: document.body.classList.contains('gw-widget-wait'), name: ps.store?.ui?.placedDesign?.name || null }); }, 50); });
    const host = await ctx.newPage();
    const popups = []; ctx.on('page', (p) => { if (p !== host) popups.push(p.url()); });
    await host.goto(`${origin}/__host.html?src=${encodeURIComponent(`/plan-studio/app/?embed=1&widget=${slug}&host=${encodeURIComponent(HOSTED)}`)}`);
    const frame = host.frameLocator('#f');
    await frame.locator('[data-ps="lot-card"]').first().waitFor({ state: 'attached', timeout: 90000 });
    const fr = host.frames().find((f) => f !== host.mainFrame());
    await fr.waitForFunction(() => window.__ps?.store?.ui?.placedDesign?.name, null, { timeout: 90000 });
    await host.waitForTimeout(2500);
    // 1. nothing that leads to the editor, uploads, PDFs or the engineer menu is visible
    for (const sel of ROUTES_TO_EDITOR) assert.deepEqual(await fr.evaluate(`(${VISIBLE})(${JSON.stringify(sel)})`), [], `${sel} must not be visible in widget mode`);
    const seen = await fr.evaluate(() => window.__seen);
    assert.ok(seen.length > 0);
    for (const x of seen) if (!x.cover) assert.ok(['Banksia 25', 'Wattle 30'].includes(x.name), `uncovered frame showed ${x.name}`);
    assert.ok(seen.some((x) => x.cover), 'the view is covered until the builder design is placed');
    // 2. the first design shown is one of the builder's own
    const placed = await fr.evaluate(() => window.__ps.store.ui.placedDesign.name);
    assert.ok(['Banksia 25', 'Wattle 30'].includes(placed), `first design was ${placed}`);
    // 3. pressing the buttons anyway (they are hidden, so a script or a keyboard can reach them) never navigates, opens a window or hands the design to the editor
    const before = host.url();
    await fr.evaluate(() => { for (const s of ['[data-ps="lc-edit"]', '.ps-embed-full', '[data-ps="lc-full-editor"]']) document.querySelectorAll(s).forEach((e) => e.click()); });
    await fr.evaluate(() => window.__ps.openFull?.());
    await host.waitForTimeout(800);
    assert.equal(host.url(), before);
    assert.deepEqual(popups, []);
    assert.equal(await fr.evaluate(() => Object.keys(localStorage).filter((k) => /handoff/i.test(k)).length), 0, 'no hand over to the editor');
    // 4. the design swap list holds the builder's designs only, never the Glide library or building types
    await fr.evaluate(() => document.querySelector('[data-ps="lc-swap"]')?.click());
    await host.waitForTimeout(600);
    const swap = await fr.evaluate(() => [...document.querySelectorAll('[data-ps="lc-swaplist"] .lc-swap-i')].map((e) => e.textContent.replace(/[^\w ]/g, '').trim()));
    assert.ok(swap.length >= 1 && swap.every((n) => ['Banksia 25', 'Wattle 30'].includes(n)), `swap list: ${swap.join(', ')}`);
    // 5. nothing is posted to the page around the frame (no ps:ready, no ps:analytics), and Google Analytics is not in the app page
    assert.deepEqual(await host.evaluate(() => window.__msgs), []);
    assert.equal(await fr.evaluate(() => !!(window.gtag || window.dataLayer || document.querySelector('script[src*="googletagmanager"], script[src*="analytics.js"]'))), false);
    // 6. messages from the page around the frame are ignored
    await host.evaluate(() => document.getElementById('f').contentWindow.postMessage({ type: 'ps:set-mode', mode: 'demo' }, '*'));
    await host.waitForTimeout(400);
    assert.notEqual(await fr.evaluate(() => document.querySelector('.ps-shell')?.dataset.mode), 'demo');
    // 7. the lead form is the one thing offered
    assert.equal((await fr.evaluate(`(${VISIBLE})('[data-gw="open"]')`)).length, 1);
  } finally { await br.close(); server.close(); }
});

test('widget that cannot start (unknown builder, switched off, or the config call fails) shows a plain panel and nothing else', { skip: SKIP, timeout: 120000 }, async () => {
  const { server, origin } = await serve();
  const br = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await br.newContext({ viewport: { width: 1100, height: 820 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const pg = await ctx.newPage();
    await pg.goto(`${origin}/plan-studio/app/?embed=1&widget=nobody-here&host=${encodeURIComponent(origin)}`);
    await pg.waitForSelector('[data-gw="unavailable"]', { timeout: 90000 });
    assert.match(await pg.textContent('[data-gw="unavailable"]'), /This widget is not available right now/);
    for (const sel of [...ROUTES_TO_EDITOR, '[data-ps="lot-card"]', '[data-gw="open"]', '.ps-shell', '.ps-stage']) assert.deepEqual(await pg.evaluate(`(${VISIBLE})(${JSON.stringify(sel)})`), [], `${sel} must be hidden when the widget is not available`);
    assert.deepEqual(await pg.evaluate(() => [...document.body.children].filter((c) => !c.classList.contains('gw-unavail') && getComputedStyle(c).display !== 'none' && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE').map((c) => c.tagName + '.' + c.className)), []);
  } finally { await br.close(); server.close(); }
});

const MODULE_PAGE = (origin) => `${origin}/__blank.html`;

test('Site costs panel: Reset leaves the builder default alone; removing it asks first; a designer has no builder buttons', { skip: SKIP, timeout: 90000 }, async () => {
  const { server, origin } = await serve();
  const br = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const pg = await (await br.newContext()).newPage();
    await pg.goto(MODULE_PAGE(origin));
    const out = await pg.evaluate(async () => {
      const { openSiteCosts } = await import('/__src/src/premium/site-costs/panel.js');
      const { createProject } = await import('/__src/src/model/schema.js');
      const log = [];
      let defaults = { rates: { cut_excavate: { nsw: 77, qld: 77 } } };
      const mk = (canEdit) => { window.__ps = { siteCostDefaults: { get: () => defaults, ...(canEdit ? { set: async (s) => { log.push('set'); defaults = s; }, clear: async () => { log.push('clear'); defaults = null; } } : {}) } }; };
      const layer = { openModal: ({ body }) => { const b = body(); b.dataset.panel = '1'; document.body.append(b); return Promise.resolve(); } };
      const wait = () => new Promise((r) => setTimeout(r, 60));
      const actions = () => [...document.querySelectorAll('[data-panel] [data-action]')].map((b) => b.dataset.action);
      const project = createProject({ name: 'T' });
      const res = {};
      // admin
      mk(true);
      let designCalls = [];
      openSiteCosts({ layer, getProject: () => project, setDesign: (d) => designCalls.push(d) }); await wait();
      res.adminActions = actions();
      document.querySelector('[data-action="reset"]').click(); await wait();
      res.afterReset = { log: [...log], defaults: !!defaults, designCalls: designCalls.length, resetLabel: document.querySelector('[data-action="reset"]')?.textContent };
      document.querySelector('[data-action="remove-builder"]').click(); await wait();
      res.confirmShown = !!document.querySelector('[data-testid="remove-builder-confirm"], [data-panel] [role="alertdialog"]');
      res.afterAsk = [...log];
      document.querySelector('[data-action="remove-builder-no"]').click(); await wait();
      res.afterKeep = { log: [...log], defaults: !!defaults };
      document.querySelector('[data-action="remove-builder"]').click(); await wait();
      document.querySelector('[data-action="remove-builder-yes"]').click(); await wait();
      res.afterRemove = { log: [...log], defaults: !!defaults };
      // designer
      document.querySelectorAll('[data-panel]').forEach((n) => n.remove());
      defaults = { rates: { cut_excavate: { nsw: 77, qld: 77 } } }; log.length = 0;
      mk(false);
      openSiteCosts({ layer, getProject: () => project, setDesign: () => {} }); await wait();
      res.designerActions = actions();
      document.querySelector('[data-action="reset"]')?.click(); await wait();
      res.designerLog = [...log];
      return res;
    });
    assert.ok(out.adminActions.includes('save-builder') && out.adminActions.includes('remove-builder'));
    assert.deepEqual(out.afterReset.log, [], 'Reset never calls the builder default');
    assert.equal(out.afterReset.defaults, true);
    assert.equal(out.afterReset.designCalls, 1, 'Reset drops only this design\'s own rates');
    assert.match(out.afterReset.resetLabel, /builder rates/);
    assert.equal(out.confirmShown, true);
    assert.deepEqual(out.afterAsk, [], 'asking is not removing');
    assert.deepEqual(out.afterKeep.log, []);
    assert.deepEqual(out.afterRemove.log, ['clear']);
    assert.equal(out.afterRemove.defaults, false);
    assert.ok(!out.designerActions.includes('save-builder') && !out.designerActions.includes('remove-builder'), 'a designer has no builder buttons');
    assert.deepEqual(out.designerLog, []);
  } finally { await br.close(); server.close(); }
});

test('Leads tab: the signing secret is not on the page until asked for; a designer can read leads but not change them', { skip: SKIP, timeout: 90000 }, async () => {
  const { server, origin } = await serve();
  const br = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const pg = await (await br.newContext()).newPage();
    await pg.goto(MODULE_PAGE(origin));
    const SECRET = 'whsec_0123456789abcdef0123456789abcdef0123456789abcdef';
    const out = await pg.evaluate(async (SECRET) => {
      const { renderLeads } = await import('/__src/src/portal/ui/leads-tab.js');
      const calls = [];
      const lead = { id: 'lead_1', createdAt: '2026-11-19T01:00:00.000Z', name: 'Sarah Jones', email: 's@example.com', phone: '', address: '22 Banksia Rise', lotLabel: 'Lot 14', houseName: 'Banksia 25', status: 'new', note: '' };
      const api = {
        listLeads: async () => ({ leads: [lead], total: 1, newCount: 1 }),
        getWebhook: async () => ({ configured: true, url: 'https://hooks.zapier.com/x', enabled: true, secretHint: SECRET.slice(0, 10) + '...', deliveries: [], maxAttempts: 5 }),
        revealWebhookSecret: async () => { calls.push('reveal'); return { secret: SECRET }; },
        updateLead: async () => { calls.push('update'); return lead; },
      };
      const wait = () => new Promise((r) => setTimeout(r, 80));
      const res = {};
      const admin = document.createElement('div'); document.body.append(admin);
      await renderLeads(admin, { api, me: { permissions: ['clients.read', 'clients.write', 'branding.write'] } });
      res.adminCsv = !!admin.querySelector('[data-ps="leads-csv"]');
      res.adminSelectDisabled = admin.querySelector('select')?.disabled;
      res.hiddenText = admin.textContent.includes(SECRET) || admin.textContent.includes(SECRET.slice(12));
      res.callsBefore = [...calls];
      [...admin.querySelectorAll('button')].find((b) => /Show or hide/.test(b.textContent)).click(); await wait();
      res.shownText = admin.textContent.includes(SECRET);
      res.callsAfter = [...calls];
      const designer = document.createElement('div'); document.body.append(designer);
      await renderLeads(designer, { api, me: { permissions: ['clients.read'] } });
      res.designerCsv = !!designer.querySelector('[data-ps="leads-csv"]');
      res.designerSelectDisabled = designer.querySelector('select')?.disabled;
      res.designerNoteDisabled = designer.querySelector('input[type=text]')?.disabled;
      res.designerHooks = !!designer.querySelector('[data-ps="webhook-url"]');
      return res;
    }, SECRET);
    assert.equal(out.hiddenText, false, 'the secret is not in the page text before Show');
    assert.deepEqual(out.callsBefore, []);
    assert.equal(out.shownText, true);
    assert.deepEqual(out.callsAfter, ['reveal']);
    assert.equal(out.adminCsv, true);
    assert.equal(out.adminSelectDisabled, false);
    assert.equal(out.designerCsv, false);
    assert.equal(out.designerSelectDisabled, true);
    assert.equal(out.designerNoteDisabled, true);
    assert.equal(out.designerHooks, false);
  } finally { await br.close(); server.close(); }
});

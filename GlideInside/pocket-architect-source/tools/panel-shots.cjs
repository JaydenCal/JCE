// Screenshots of the commercial panel (close, collapse, reopen), the side panel hide (AI design assistant) and the aerial on/off toggle.
// Based on tools/commercial-shots.cjs. node tools/panel-shots.cjs <outDir> <prefix>
// Original header: screenshots of the commercial mode (M1) at 1440x900 into the folder given (default docs/commercial-review/). Serves website-live as
// the site root and the real Worker app (in-memory store, no Stripe key, no email) at /api, and answers the two outside hosts the
// pages ask for (Google Fonts and the analytics tag) with empty files so the run needs no network. Any console error, page error
// or failed request is printed at the end; a clean run prints "no console errors".
//   node tools/commercial-shots.cjs [outDir]        (Playwright must be installed: PLAYWRIGHT_PATH, NODE_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/topview-shots'); const PRE = process.argv[3] || 'panel';
const PORT = Number(process.env.PORT || 8841); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  // The fixtures: a 90 x 100 m IN1 lot with two back to back rows of 8 units in the default layout, i.e. ground office/amenity plus a
  // mezzanine office over the front bay (tests/helpers/commercial-fixture.mjs, plain: false).
  const { commercialProject } = await import('../tests/helpers/commercial-fixture.mjs');
  const FIX = { 'commercial.json': JSON.stringify(commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false })) };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
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
  const browser = await chromium.launch();
  const log = [];
  const mk = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`console.${m.type()}: ${m.text()} @ ${m.location().url}`); });
    page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()}: ${r.url()}`); });
    return page;
  };

  const page = await mk({ width: 1440, height: 900 });
  const shot = async (name, pg = page) => { await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(OUT, `${PRE}-${name}.png`) }); console.log('shot', name); };
  const boot = async (pg, fixture) => {
    await pg.goto(`${ORIGIN}/plan-studio/app/index.html`);
    await pg.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
    await pg.waitForTimeout(1200);
    if (fixture) await pg.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); window.__ps.store.setUI({ view: '2d' }); }, FIX['commercial.json']);
    await pg.waitForTimeout(800);
    await pg.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  };
  await boot(page, true);
  await shot('cm-1-open-1440');
  await page.click('[data-action="sheet-toggle"]'); await shot('cm-2-collapsed-1440');
  await page.click('[data-action="sheet-toggle"]');
  await page.click('[data-action="panel-close"]'); await shot('cm-3-closed-reopen-button-1440');
  console.log('reopen visible', await page.isVisible('[data-ps="commercial-reopen"]'));
  await page.click('[data-ps="commercial-reopen"]'); await page.waitForTimeout(500); console.log('dock back', await page.isVisible('.cm-dock'));
  await page.locator('.cm-dock').focus(); await page.keyboard.press('Escape'); console.log('escape closed', !(await page.isVisible('.cm-dock')));
  await page.reload(); await page.waitForTimeout(2500);
  console.log('after reload closed stays', !(await page.isVisible('.cm-dock')), await page.evaluate(() => localStorage.getItem('gi.cm.panel.v1')));
  await page.evaluate(() => localStorage.removeItem('gi.cm.panel.v1'));
  // narrow desktop 1100 and phone 390
  const narrow = await mk({ width: 1100, height: 800 }); await boot(narrow, true); await shot('cm-4-open-1100', narrow);
  const phone = await mk({ width: 390, height: 844 }); await boot(phone, true); await shot('cm-5-phone-390', phone);
  // side panel: Properties, AI tab, hidden with the edge tab, shown again
  await page.evaluate(() => localStorage.clear()); await boot(page, true);
  await shot('ai-1-panel-1440');
  await page.click('.ps-tab[data-tab="ai"]').catch(() => {}); await shot('ai-2-assistant-tab-1440');
  await page.click('[data-ps="panel-hide"]'); await shot('ai-3-hidden-edge-tab-1440');
  console.log('panel hidden', !(await page.isVisible('.ps-panel')), 'tab', await page.isVisible('[data-ps="panel-show"]'), 'stored', await page.evaluate(() => localStorage.getItem('gi.panelHidden.v1')));
  await page.reload(); await page.waitForTimeout(2500); console.log('hidden after reload', !(await page.isVisible('.ps-panel')));
  await page.click('[data-ps="panel-show"]'); console.log('shown again', await page.isVisible('.ps-panel'));
  await page.keyboard.press('Alt+p'); console.log('alt+p hides', !(await page.isVisible('.ps-panel'))); await page.keyboard.press('Alt+p');
  await page.evaluate(() => localStorage.setItem('gi.panelHidden.v1', '1')); await phone.evaluate(() => localStorage.setItem('gi.panelHidden.v1', '1')); await phone.reload(); await phone.waitForTimeout(3000); await shot('ai-4-phone-hidden-390', phone);
  await phone.evaluate(() => localStorage.removeItem('gi.panelHidden.v1')); await phone.reload(); await phone.waitForTimeout(3000); await shot('ai-5-phone-sheet-390', phone);
  // builder setting: assistant off for clients
  await page.evaluate(() => { localStorage.clear(); document.querySelector('.ps-shell').dataset.ai = 'off'; }); await page.waitForTimeout(300);
  console.log('ai tab hidden when off', !(await page.isVisible('.ps-tab[data-tab="ai"]'))); await shot('ai-6-setting-off-1440');
  // aerial toggle on and off
  await page.evaluate(() => { localStorage.clear(); delete document.querySelector('.ps-shell').dataset.ai; });
  // The fixture lot has no aerial of its own (and the run is offline), so give it the aerial metadata the toggle looks for.
  await page.evaluate(() => window.__ps.store.apply('Shot aerial', (p) => { const e = p.site.lot.envelope || {}; p.site.lot.aerial = { key: 'shot', source: 'shot', attribution: '', extent: { x0: -80, y0: -80, x1: 200, y1: 200 }, mmPerPx: 100 }; p.site.lot.layers = { ...(p.site.lot.layers || {}), aerial: true }; void e; })); await page.waitForTimeout(800);
  const fab = '[data-ps="aerial-toggle-stage"]';
  console.log('aerial fab present', await page.isVisible(fab).catch(() => false));
  await shot('aerial-1-on-1440');
  await page.click(fab).catch((e) => console.log('fab click', e.message)); await shot('aerial-2-off-1440');
  console.log('aerial stored', await page.evaluate(() => localStorage.getItem('gi.aerial.v1')), 'lot layer', await page.evaluate(() => window.__ps.store.project.site?.lot?.layers?.aerial));
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await page.waitForTimeout(2500); await shot('aerial-3-off-3d-1440');
  console.log(log.length ? log.join('\n') : 'no console errors');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

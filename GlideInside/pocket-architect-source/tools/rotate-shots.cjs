// Screenshots of the Rotate tool in use (residential house with an edited driveway, split view with live 3D, commercial building).
//   node tools/rotate-shots.cjs [outDir] [residential.json] [commercial.json]   (Playwright required; website-live holds the app build)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/shots/claude-rotate-tool-v2');
const RES = fs.readFileSync(process.argv[3] || '/tmp/res.json', 'utf8'); const COM = fs.readFileSync(process.argv[4] || '/tmp/com.json', 'utf8');
const PORT = Number(process.env.PORT || 8827); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js'); const { createMemoryStore } = await import('../server/lib/store.js');
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch(); const log = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()}`); });
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  await page.goto(`${ORIGIN}/plan-studio/app/index.html`);
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const load = async (json, view = '2d') => {
    await page.evaluate(([s, v]) => { window.__ps.replaceProject(JSON.parse(s)); window.__ps.store.setUI({ view: v }); }, [json, view]);
    await page.waitForTimeout(900);
    await page.getByText('Skip to editor').click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-action="prompt-notnow"]').click({ timeout: 1500 }).catch(() => {});
    await page.getByText('Skip tutorial').click({ timeout: 1500 }).catch(() => {});
    await page.evaluate(() => { const c = document.querySelector('.lc-min'); const card = document.querySelector('.lc-card, .lot-card, [data-ps="lot-card"]'); if (c && !(c.closest('.is-min'))) c.click(); });
    await page.waitForTimeout(500);
  };
  const px = (p) => page.evaluate((q) => { const v = window.__ps.editor.getView(); const r = document.querySelector('canvas.ps-plan-canvas').getBoundingClientRect(); return { x: r.left + q.x * v.scale + v.ox, y: r.top + q.y * v.scale + v.oy }; }, p);
  const frame = (b) => page.evaluate((b) => { const ed = window.__ps.editor; const r = ed.element.getBoundingClientRect(); const pad = 60; const left = 300; const w = r.width - left - 2 * pad; const h = r.height - 2 * pad; const scale = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)); ed.setView({ scale, ox: left + pad - b.x0 * scale + (w - (b.x1 - b.x0) * scale) / 2, oy: pad - b.y0 * scale + (h - (b.y1 - b.y0) * scale) / 2 }); }, b);
  const ctl = (fn, ...a) => page.evaluate(([f, a]) => { const c = window.__ps.editor.rotate; const r = c[f](...a); return r === undefined ? null : JSON.parse(JSON.stringify(r)); }, [fn, a]);
  const arcPt = (draft, deg) => { const a = ((-90 + deg) * Math.PI) / 180; return { x: draft.pivot.x + Math.cos(a) * draft.R, y: draft.pivot.y + Math.sin(a) * draft.R }; };

  // Residential
  await load(RES);
  const lotB = await page.evaluate(() => { const b = window.__ps.store.project.site.lot.boundary; return { x0: Math.min(...b.map((p) => p.x)), y0: Math.min(...b.map((p) => p.y)), x1: Math.max(...b.map((p) => p.x)), y1: Math.max(...b.map((p) => p.y)) }; });
  await frame(lotB);
  await page.locator('canvas.ps-plan-canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('o'); await page.waitForTimeout(500);
  await shot('01-rotate-armed-residential');
  let d = await ctl('draft');
  let s = await px(arcPt(d, 0)); await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (const q of [10, 22, 35]) { s = await px(arcPt(d, q)); await page.mouse.move(s.x, s.y, { steps: 3 }); }
  await shot('02-dragging-free-angle-arc');
  await page.mouse.up(); await shot('03-after-drag-driveway-attached');
  // Shift snap
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  d = await ctl('draft');
  await page.evaluate(() => window.__ps.editor.rotate.resetPivot());
  s = await px(arcPt(d, 0)); await page.mouse.move(s.x, s.y); await page.mouse.down();
  await page.keyboard.down('Shift');
  for (const q of [20, 38, 52]) { s = await px(arcPt(d, q)); await page.mouse.move(s.x, s.y, { steps: 3 }); }
  await shot('04-shift-snap-45');
  await page.mouse.up(); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  // Pivot drag to a corner, turn
  d = await ctl('draft');
  const corner = d.target.ring[0];
  s = await px(d.pivot); await page.mouse.move(s.x, s.y); await page.mouse.down(); const sc = await px(corner); await page.mouse.move(sc.x, sc.y, { steps: 6 }); await page.mouse.up();
  d = await ctl('draft');
  s = await px(arcPt(d, 0)); await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (const q of [-15, -30, -50]) { s = await px(arcPt(d, q)); await page.mouse.move(s.x, s.y, { steps: 3 }); }
  await shot('05-pivot-moved-to-corner');
  await page.mouse.up();
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  await page.evaluate(() => window.__ps.editor.rotate.resetPivot());
  // Typed angle and align
  const inp = page.locator('[data-ps="rotate-angle"]'); await inp.fill('28'); await inp.press('Enter'); await page.waitForTimeout(400);
  await shot('06-typed-28-panel');
  await page.getByRole('button', { name: 'Street frontage' }).click(); await page.waitForTimeout(500);
  await shot('07-aligned-to-frontage');
  await inp.fill('-17'); await inp.press('Enter'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Nearest boundary' }).click(); await page.waitForTimeout(500);
  await shot('08-aligned-to-nearest-boundary');
  // Split: live 3D during a drag
  await page.evaluate(() => window.__ps.store.setUI({ view: 'split' })); await page.waitForTimeout(3500);
  d = await ctl('draft'); await frame(lotB);
  s = await px(arcPt(d, 0)); await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (const q of [10, 30, 55]) { s = await px(arcPt(d, q)); await page.mouse.move(s.x, s.y, { steps: 3 }); await page.waitForTimeout(250); }
  await page.waitForTimeout(1500);
  await shot('09-split-live-3d-during-drag');
  await page.mouse.up();
  await shot('10-split-after');
  // Commercial
  await load(COM, '2d');
  await page.evaluate(() => { window.__ps.store.setUI({ view: '2d' }); });
  await page.evaluate(async () => { const m = await import('/plan-studio/app/ps-commercial-ops.js').catch(() => null); });
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

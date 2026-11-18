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
  const hc = () => page.evaluate(() => { const rs = window.__ps.store.project.levels.flatMap((l) => l.rooms).flatMap((r) => r.polygon); const xs = rs.map((p) => p.x); const ys = rs.map((p) => p.y); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; });
  // A point on the longest outside wall of the ground floor (it picks the house, not a piece of furniture), and the angle and radius of it about the centre.
  const wallPt = () => page.evaluate(() => { const l = window.__ps.store.project.levels[0]; const w = l.walls.filter((x) => x.kind === 'exterior').sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))[0]; return { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }; });
  let START = null;
  const at = (c, deg, R) => { const base = Math.atan2(START.y - c.y, START.x - c.x); const r = R || Math.hypot(START.x - c.x, START.y - c.y); const a = base + (deg * Math.PI) / 180; return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }; };
  const dragArc = async (c, degs, shift) => {
    let s = await px(at(c, 0)); await page.mouse.move(s.x, s.y); await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    for (const q of degs) { s = await px(at(c, q)); await page.mouse.move(s.x, s.y, { steps: 4 }); await page.waitForTimeout(150); }
  };
  const release = async (shift) => { await page.mouse.up(); if (shift) await page.keyboard.up('Shift'); };

  await load(RES);
  const lotB = await page.evaluate(() => { const b = window.__ps.store.project.site.lot.boundary; return { x0: Math.min(...b.map((p) => p.x)), y0: Math.min(...b.map((p) => p.y)), x1: Math.max(...b.map((p) => p.x)), y1: Math.max(...b.map((p) => p.y)) }; });
  await frame(lotB);
  await page.locator('canvas.ps-plan-canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('o'); await page.waitForTimeout(500);
  const c = await hc();
  START = await wallPt(); let s0 = await px(START); await page.mouse.click(s0.x, s0.y); await page.waitForTimeout(400);
  await shot('01-rotate-armed-house-selected');
  await dragArc(c, [8, 17, 29]); await shot('02-dragging-free-angle-arc');
  await release(); await shot('03-after-drag-driveway-attached');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  await dragArc(c, [20, 38, 52], true); await shot('04-shift-snap');
  await release(true); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  // pivot dragged to a house corner, then turn
  const corner = { x: c.x - 4000, y: c.y + 5000 };
  s0 = await px(c); await page.mouse.move(s0.x, s0.y); await page.mouse.down(); const sc = await px(corner); await page.mouse.move(sc.x, sc.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  let s = await px(START); await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (const q of [-12, -28, -45]) { s = await px(at(corner, q)); await page.mouse.move(s.x, s.y, { steps: 4 }); }
  await shot('05-pivot-dragged-to-corner'); await page.mouse.up();
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); // clears the custom pivot
  const inp = page.locator('[data-ps="rotate-angle"]'); await inp.fill('28'); await inp.press('Enter'); await page.waitForTimeout(400);
  await shot('06-typed-28');
  await page.locator('[data-ps="rotate-align-frontage"]').click(); await page.waitForTimeout(500); await shot('07-aligned-to-frontage');
  await inp.fill('-17'); await inp.press('Enter'); await page.waitForTimeout(300);
  await page.locator('[data-ps="rotate-align-boundary"]').click(); await page.waitForTimeout(500); await shot('08-aligned-to-nearest-boundary');
  await page.evaluate(() => window.__ps.store.setUI({ view: 'split' })); await page.waitForTimeout(3500);
  await frame(lotB);
  await dragArc(c, [10, 30, 55]); await page.waitForTimeout(1500); await shot('09-split-live-3d-during-drag');
  await release(); await shot('10-split-after');
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

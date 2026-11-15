// Screenshots of the Hardstand tool (draw a rectangle, draw a polygon, the result in 2D and 3D) into the folder given.
//   node tools/hardstand-shots.cjs [outDir]        (Playwright must be installed: PLAYWRIGHT_PATH, NODE_PATH or a local install; website-live holds a build of the app)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(__dirname, '../../website-live');
const OUT = path.resolve(process.argv[2] || '/home/claude/hardstand-shots');
const PORT = Number(process.env.PORT || 8819); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };
  await page.goto(`${ORIGIN}/plan-studio/app/index.html`);
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate((s) => { window.__ps.replaceProject(JSON.parse(s)); window.__ps.store.setUI({ view: '2d' }); }, FIX['commercial.json']);
  await page.waitForTimeout(700);
  await page.getByText('Skip to editor').click({ timeout: 5000 }).catch(() => {}); // the guided flow covers the plan
  await page.waitForTimeout(700);
  // Frame the free ground east of the units (plan mm), then arm the Hardstand tool with the P key.
  await page.evaluate(() => {
    const ed = window.__ps.editor; const r = ed.element.getBoundingClientRect();
    const b = { x0: 40000, y0: 0, x1: 100000, y1: 85000 }; const pad = 40; const left = 260;
    const w = r.width - left - 2 * pad; const h = r.height - 2 * pad - 60;
    const scale = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
    ed.setView({ scale, ox: left + pad - b.x0 * scale, oy: pad - b.y0 * scale });
  });
  await page.locator('[data-action="prompt-notnow"]').click({ timeout: 3000 }).catch(() => {});
  await page.locator('canvas.ps-plan-canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('p'); await page.waitForTimeout(400);
  const px = (p) => page.evaluate((q) => { const ed = window.__ps.editor; const v = ed.getView(); const r = document.querySelector('canvas.ps-plan-canvas').getBoundingClientRect(); return { x: r.left + q.x * v.scale + v.ox, y: r.top + q.y * v.scale + v.oy }; }, p);
  const mouse = async (p, kind) => { const s = await px(p); await page.mouse.move(s.x, s.y); if (kind === 'down') await page.mouse.down(); if (kind === 'up') await page.mouse.up(); };
  const info = () => page.evaluate(() => JSON.stringify((window.__ps.store.project.commercial.pavements || []).map((x) => [x.id, x.type, x.polygon.length])));
  await shot('01-picker-armed');
  // Rectangle: drag across free ground east of the buildings (mode R), then a second type beside it.
  await page.keyboard.press('r');
  await mouse({ x: 72000, y: 12000 }, 'move'); await mouse({ x: 72000, y: 12000 }, 'down');
  for (const q of [{ x: 78000, y: 18000 }, { x: 84000, y: 26000 }, { x: 88000, y: 30000 }]) await mouse(q, 'move');
  await shot('02-rectangle-drawing');
  await mouse({ x: 88000, y: 30000 }, 'up');
  console.log('after rectangle', await info());
  // Polygon (mode P): click the corners, double click to finish.
  await page.evaluate(() => { document.querySelector('[data-ps="hardstand-type"]').value = 'concrete-heavy'; document.querySelector('[data-ps="hardstand-type"]').dispatchEvent(new Event('change', { bubbles: true })); });
  await page.keyboard.press('p');
  const pts = [{ x: 72000, y: 40000 }, { x: 88000, y: 40000 }, { x: 88000, y: 52000 }, { x: 80000, y: 58000 }, { x: 72000, y: 52000 }];
  for (const q of pts) { const s = await px(q); await page.mouse.click(s.x, s.y); }
  await mouse({ x: 72000, y: 46000 }, 'move');
  await shot('03-polygon-drawing');
  const last = await px(pts[0]); await page.mouse.dblclick(last.x, last.y);
  console.log('after polygon', await info());
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__ps.store.setUI({ tool: 'select' }));
  await shot('04-result-2d');
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
  await page.waitForTimeout(4500);
  await page.evaluate(async () => { const v = window.__ps.getViewer(); await v.flyTo({ position: { x: 62, y: 55, z: 78 }, target: { x: 80, y: 0, z: 40 }, fov: 45 }, { duration: 0.01 }); });
  await page.waitForTimeout(2500);
  await shot('05-result-3d');
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

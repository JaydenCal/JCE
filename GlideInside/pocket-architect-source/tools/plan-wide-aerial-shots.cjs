// Screenshots for the 19/11/2026 hotfix: restored project gets its aerial, no neighbour massing, labels agree, drivepi visible, driveway click.
//   node tools/plan-wide-aerial-shots.cjs <outDir> [siteDir]
const http = require('http'); const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(process.argv[3] || path.resolve(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/shots/plan-wide-aerial'); const TAG = process.env.TAG || 'after';
const PORT = Number(process.env.PORT || 8851); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function png(w, h, px) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A plain aerial look-alike: grass, a grey road across the bottom, a few roofs.
const AERIAL = png(512, 512, (x, y) => { const n = ((x * 7 + y * 13) % 11) - 5; if (y > 440) return [92 + n, 94 + n, 98 + n]; if ((x > 60 && x < 150 && y > 80 && y < 160) || (x > 340 && x < 450 && y > 90 && y < 170) || (x > 80 && x < 180 && y > 280 && y < 360)) return [170 + n, 110 + n, 90 + n]; return [96 + n, 138 + n, 80 + n]; });

// A second picture for the wide tile (a coarser aerial with a road grid), so it reads differently from the sharp tile.
const WIDE = png(256, 256, (x, y) => { const n = ((x * 5 + y * 9) % 9) - 4; if (x % 64 < 5 || y % 64 < 5) return [110 + n, 110 + n, 114 + n]; if (((x >> 4) + (y >> 4)) % 5 === 0) return [160 + n, 112 + n, 92 + n]; return [84 + n, 126 + n, 72 + n]; });
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { FIXTURES } = await import('../src/site/fixtures/index.js');
  const { createProject } = await import('../src/model/schema.js');
  const { buildSiteLot } = await import('../src/site/model.js');
  const { catalogue } = await import('../src/catalogue/index.js');
  const { placeHouse } = await import('../src/portal/place-house.js');
  const { autoPose } = await import('../src/portal/auto-place.js');
  const L = await import('../src/site/lotplan.js');
  const f = FIXTURES[0];
  const lotResp = { ...structuredClone(f.lot), sample: false };
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/site/aerial') {
        const [minE, minN, maxE, maxN] = u.searchParams.get('bbox').split(',').map(Number);
        const wide = (maxE - minE) > (f.aerial.bbox.maxE - f.aerial.bbox.minE) * 1.5;
        const px = wide ? 256 : 512;
        const meta = { ...f.aerial, sample: false, synthetic: false, bbox: { minE, minN, maxE, maxN }, widthPx: px, heightPx: px, mmPerPx: ((maxE - minE) / px) * 1000 };
        hits.push(wide ? 'wide' : 'inner');
        res.writeHead(200, { 'content-type': 'image/png', 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) }); return res.end(wide ? WIDE : AERIAL);
      }
      if (u.pathname === '/api/site/contours') return j(f.contours);
      if (u.pathname === '/api/site/lot') return j(lotResp);
      if (u.pathname === '/api/site/search') return j({ results: f.search });
      res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}');
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  // A confirmed frontage (edge 0), no road centrelines, no setback classification, a granny flat placed.
  const p = createProject({ name: 'Lot 314' });
  const lot = buildSiteLot({ lot: lotResp, aerialMeta: null, aerialKey: null, contours: null, address: 'Lot 314 DP 1278464 Tamworth', source: 'nsw' });
  lot.roads = []; lot.frontEdges = [0]; lot.frontageConfirmed = true; lot.frontageMethod = 'builder'; lot.layers = { ...lot.layers, aerial: true, houses: false };
  p.site.lot = lot;
  const h = catalogue.createFromTemplate('granny_studio');
  placeHouse(p, h, autoPose(p, h).pose);
  const browser = await chromium.launch(); const log = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.route(/^https:\/\/(fonts\.|www\.googletagmanager)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript((s) => { if (!localStorage.getItem('ps.autosave.v1')) localStorage.setItem('ps.autosave.v1', s); try { localStorage.setItem('ps.tour.done', '1'); } catch (e) {} }, JSON.stringify(p));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  const dismiss = async () => { for (const t of ['Skip to editor', 'Skip tutorial', 'Skip']) await page.getByText(t, { exact: true }).first().click({ timeout: 800 }).catch(() => {}); await page.locator('[data-action="prompt-notnow"]').click({ timeout: 800 }).catch(() => {}); };
  const shot = async (n) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${n}.png`), timeout: 90000 }); console.log('shot', n); };
  await page.goto(`${ORIGIN}/plan-studio/app/index.html?mode=residential`);
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
  await page.waitForTimeout(3500); await dismiss(); await page.waitForTimeout(1500);
  console.log('aerial requests', JSON.stringify(hits), 'wide key', await page.evaluate(() => window.__ps.store.project.site.lot.aerialWide?.key || null));
  await page.evaluate(() => window.__ps.store.setUI({ view: '2d', tool: 'select' })); await dismiss();
  await page.evaluate(() => document.querySelector('[data-ps="lc-minimise"]')?.click());
  await page.waitForTimeout(800);
  await shot('01-plan-default-zoom');
  const box = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(80); }
  await shot('02-plan-zoomed-out-wide-aerial');
  await page.evaluate(() => { const s = window.__ps.store; s.apply('aerial off', (pr) => { pr.site.lot.layers.aerial = false; }); });
  await shot('03-plan-zoomed-out-aerial-layer-off');
  await page.evaluate(() => { const s = window.__ps.store; s.apply('aerial on', (pr) => { pr.site.lot.layers.aerial = true; }); });
  await page.getByText('Got it', { exact: true }).click({ timeout: 1500 }).catch(() => {});
  await page.locator('button[aria-label="Zoom to fit"]').click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  // Driveway: Driveway PIs tool, first click ON the boundary edge (frontage), at high zoom.
  await page.evaluate(() => window.__ps.store.setUI({ tool: 'drivepi' })); await page.waitForTimeout(500);
  const pr = await page.evaluate(() => window.__ps.store.project);
  const lt = pr.site.lot;
  const a = lt.boundary[0]; const b = lt.boundary[1];
  const onEdge = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
  const client = (pt) => page.evaluate((m) => window.__ps.editor.toClient(m), pt);
  console.log('zoom', await page.evaluate(() => document.body.innerText.match(/Zoom\s*\d+%/)?.[0]));
  const click = async (pt) => { const c = await client(pt); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(450); };
  await click(onEdge);
  console.log('drawing started', await page.evaluate(() => document.querySelector('.ps-hint, [data-ps="hint"]')?.textContent || ''));
  const bld = L.nearestOnBuilding(pr, onEdge);
  const via = { x: (onEdge.x + bld.x) / 2 + 1200, y: (onEdge.y + bld.y) / 2 };
  await click(via);
  const c3 = await client(bld); await page.mouse.move(c3.x, c3.y); await page.waitForTimeout(300);
  await shot('04-driveway-drawing-from-boundary-click');
  await page.mouse.down(); await page.mouse.up(); await page.mouse.down(); await page.mouse.up();
  await page.mouse.dblclick(c3.x, c3.y); await page.waitForTimeout(800);
  const drawn = await page.evaluate(() => window.__ps.store.project.site.driveway || null);
  console.log('drawn driveway', JSON.stringify(drawn && { drawn: drawn.drawn, pis: drawn.pis.length }));
  await shot('05-driveway-drawn');
  fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
  await browser.close(); server.close(); console.log(log.join('\n') || 'no page errors');
})();

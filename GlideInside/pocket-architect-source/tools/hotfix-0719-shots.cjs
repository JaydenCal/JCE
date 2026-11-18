// Screenshots for the 19/11/2026 hotfix: restored project gets its aerial, no neighbour massing, labels agree, drivepi visible, driveway click.
//   node tools/hotfix-0719-shots.cjs <outDir> [siteDir]
const http = require('http'); const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(process.argv[3] || path.resolve(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/shots/hotfix-0719'); const TAG = process.env.TAG || 'after';
const PORT = Number(process.env.PORT || 8837); const ORIGIN = `http://127.0.0.1:${PORT}`;
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
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { FIXTURES } = await import('../src/site/fixtures/index.js');
  const { createProject } = await import('../src/model/schema.js');
  const { buildSiteLot } = await import('../src/site/model.js');
  const { catalogue } = await import('../src/catalogue/index.js');
  const { placeHouse } = await import('../src/portal/place-house.js');
  const { autoPose } = await import('../src/portal/auto-place.js');
  const f = FIXTURES[0];
  const lotResp = { ...structuredClone(f.lot), sample: false };
  const meta = { ...f.aerial, sample: false, synthetic: false };
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, ORIGIN);
    if (u.pathname.startsWith('/api/')) {
      hits.push(u.pathname);
      const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/site/aerial') { res.writeHead(200, { 'content-type': 'image/png', 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) }); return res.end(AERIAL); }
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
  // A restored project: real looking lot (not a sample), house placed, no aerial and no contours stored, neighbour houses layer ON.
  const p = createProject({ name: 'Restored' });
  const lot = buildSiteLot({ lot: lotResp, aerialMeta: null, aerialKey: null, contours: null, address: '22 Fullerton St, Stockton', source: 'nsw' });
  lot.layers = { ...lot.layers, aerial: true, houses: true };
  p.site.lot = lot;
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  const browser = await chromium.launch(); const log = [];
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 } });
  await ctx.route(/^https:\/\/(fonts\.|www\.googletagmanager)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.addInitScript((s) => { if (!localStorage.getItem('ps.autosave.v1')) localStorage.setItem('ps.autosave.v1', s); try { localStorage.setItem('ps.tour.done', '1'); } catch (e) {} }, JSON.stringify(p));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  const dismiss = async () => { for (const t of ['Skip to editor', 'Skip tutorial', 'Skip']) await page.getByText(t, { exact: true }).first().click({ timeout: 800 }).catch(() => {}); await page.locator('[data-action="prompt-notnow"]').click({ timeout: 800 }).catch(() => {}); };
  const shot = async (n) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${n}-${TAG}.png`), timeout: 90000 }); console.log('shot', n); };
  await page.goto(`${ORIGIN}/plan-studio/app/index.html?mode=residential`);
  await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 30000 });
  await page.waitForTimeout(3000); await dismiss(); await page.waitForTimeout(1500);
  const aerialReq = hits.filter((x) => x === '/api/site/aerial').length;
  const contReq = hits.filter((x) => x === '/api/site/contours').length;
  console.log('aerial requests', aerialReq, 'contours requests', contReq, 'has aerial key', await page.evaluate(() => !!window.__ps.store.project.site.lot.aerial?.key));
  await page.evaluate(() => window.__ps.store.setUI({ view: '2d' })); await dismiss();
  await shot('01-restored-2d-toolbar-1536x730');
  const tb = await page.evaluate(() => { const t = document.querySelector('.ps-toolbox'); const b = document.querySelector('[data-tool="drivepi"]'); const r = b.getBoundingClientRect(); return { toolboxScroll: t.scrollHeight > t.clientHeight + 1, driveTop: r.top, driveBottom: r.bottom, vh: innerHeight, hidden: b.hidden }; });
  console.log('toolbox', JSON.stringify(tb));
  await page.evaluate(() => window.__ps.store.setUI({ view: 'split' })); await dismiss();
  await shot('02-restored-split-1536x730');
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await dismiss(); await page.waitForTimeout(2500);
  await shot('03-restored-3d-no-neighbours');
  const labels = await page.evaluate(() => ({ head: document.querySelector('.lc-head-t')?.textContent || null, pill: document.querySelector('.lc-find-in')?.value ?? document.querySelector('.lc-find span')?.textContent ?? null, address: window.__ps.store.project.site.lot.address, label: window.__ps.store.project.site.lot.lotLabel }));
  console.log('labels', JSON.stringify(labels));
  // Driveway click: Select tool, click the driveway centreline in the plan. Expect the Driveway PIs tool and a new PI; Escape goes back.
  const L = await import('../src/site/lotplan.js');
  const D = await import('../src/site/drivepi.js');
  const centre = L.deriveDriveway(p).centre; const mid = centre[Math.floor(centre.length / 2)];
  await page.evaluate(() => window.__ps.store.setUI({ view: '2d', tool: 'select' })); await dismiss(); await page.waitForTimeout(800);
  const client = (pt) => page.evaluate((m) => window.__ps.editor.toClient(m), pt);
  const click = async (pt) => { const c = await client(pt); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(450); };
  const tool = () => page.evaluate(() => window.__ps.store.ui.tool);
  const tools = [await tool()];
  await click(mid); tools.push(await tool());
  const pis = await page.evaluate(() => (window.__ps.store.project.site.driveway?.pis || []).length);
  await shot('04-driveway-click-enters-drivepi');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); tools.push(await tool());
  await click(mid); tools.push(await tool());
  const off = { x: mid.x + 14000, y: mid.y - 9000 };
  await click(off); tools.push(await tool());
  console.log('driveway click tools [start, after click, after Escape, re-enter, after off click]', JSON.stringify(tools), 'PIs after first click', pis);
  await shot('05-after-click-off-driveway');
  // A: a granny flat (no garage door) -> draw a driveway with the tool. B: change the building type from the bottom left card in the drivepi tool.
  await page.evaluate(() => { const ps = window.__ps; ps.store.setUI({ view: '2d' }); });
  await page.evaluate(() => { const ps = window.__ps; const t = ps.catalogue.createFromTemplate('granny_studio'); window.__granny = t; });
  await page.evaluate(() => { document.querySelector('[data-ps="lc-swap"]')?.click(); });
  await page.waitForTimeout(500);
  await shot('06-card-type-list-open');
  const listN = await page.evaluate(() => document.querySelectorAll('[data-ps="lc-swaplist"] .lc-swap-i').length);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-ps="lc-swaplist"] .lc-swap-i')].find((x) => /Granny flat, 1 bedroom|Studio|granny/i.test(x.textContent)); b?.click(); });
  await page.waitForTimeout(2500);
  const placed = await page.evaluate(() => ({ name: window.__ps.store.project.placedHouse?.name, door: window.__ps.store.project.levels[0].openings.some((o) => o.kind === 'garage_door' || o.kind === 'roller_door') }));
  console.log('swap list items', listN, JSON.stringify(placed));
  await page.evaluate(() => window.__ps.store.setUI({ tool: 'drivepi' })); await page.waitForTimeout(800);
  await shot('07-drivepi-no-driveway-instructions');
  const p2 = await page.evaluate(() => window.__ps.store.project);
  const k = D.kerbSnap(p2, L.nearestOnBuilding(p2, { x: 0, y: 0 }));
  const bld = L.nearestOnBuilding(p2, k.point);
  const via = { x: (k.point.x + bld.x) / 2 + 1500, y: (k.point.y + bld.y) / 2 };
  await click(k.point); await click(via);
  const c3 = await client(bld); await page.mouse.move(c3.x, c3.y); await page.waitForTimeout(300);
  await shot('08-drawing-driveway-in-progress');
  await page.mouse.down(); await page.mouse.up(); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300);
  await page.mouse.dblclick(c3.x, c3.y); await page.waitForTimeout(800);
  const drawn = await page.evaluate(() => window.__ps.store.project.site.driveway || null);
  console.log('drawn driveway', JSON.stringify(drawn && { drawn: drawn.drawn, pis: drawn.pis.length }));
  await shot('09-driveway-drawn-and-panel');
  await page.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await page.waitForTimeout(2500); await dismiss();
  await shot('10-drawn-driveway-3d');
  console.log('contours chip', await page.evaluate(() => { const c = document.querySelector('[data-ps="contours-toggle"]'); return c ? `${c.textContent} hidden=${c.hidden}` : 'none'; }));
  await page.evaluate(() => { const lc = document.querySelector('[data-ps="lc-minimise"]'); if (lc && !document.querySelector('.lc-card.is-min')) lc.click(); }); await page.waitForTimeout(800);
  await shot('10b-3d-contours-card-minimised');
  await page.evaluate(() => window.__ps.store.setUI({ view: '2d' })); await page.waitForTimeout(600);
  console.log('delete button present', await page.evaluate(() => !!document.querySelector('[data-ps="drivepi-delete-driveway"]')), 'tool', await tool());
  await page.getByText('Delete driveway', { exact: true }).click({ timeout: 4000 }).catch((e) => console.log('click failed', e.message.split('\n')[0])); await page.waitForTimeout(500);
  console.log('after delete driveway', await page.evaluate(() => JSON.stringify(window.__ps.store.project.site.driveway || null)));
  await shot('11-driveway-deleted');
  fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n') + `\naerial=${aerialReq} contours=${contReq}\n${JSON.stringify(tb)}\n${JSON.stringify(labels)}\n${JSON.stringify(tools)} pis=${pis} placed=${JSON.stringify(placed)}\n`);
  await browser.close(); server.close(); console.log(log.join('\n') || 'no page errors');
})();

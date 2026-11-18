// Grading visual checks: real WebGL renders of the commercial embed (and a residential house) on a 4 m fall, including pavements.
//   node tools/grading-views.cjs <outDir> <prefix> [scene,scene] [view,view]
// Scenes: strata-u (17 unit U shape), warehouse, service-station, house. Views: aerial, 3d, street, crossover, apron, kerb, court, carpark.
// Serves ../website-live (build first), stubs /api. Playwright from node_modules or PLAYWRIGHT_PATH. PORT env picks the port.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/growth/g2-shots');
const PREFIX = process.argv[3] || 'x';
const SCENES = (process.argv[4] || 'strata-u,warehouse,service-station,house').split(',');
const VIEWS = (process.argv[5] || 'aerial,3d,street,crossover,apron,kerb,court').split(',');
const FALL = Number(process.env.FALL || 4);
const PORT = Number(process.env.PORT || 8862);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    if (p.startsWith('/api/')) { res.writeHead(404); return res.end('{}'); }
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  for (const scene of SCENES) {
    const commercial = scene !== 'house';
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.setDefaultTimeout(180000);
    await page.route(/^https:\/\//, (r) => r.abort());
    page.on('pageerror', (e) => log.push(`${scene} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.push(`${scene} console.error: ${m.text().slice(0, 300)}`); });
    await page.goto(`http://127.0.0.1:${PORT}/plan-studio/app/?embed=1${commercial ? '&mode=commercial' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ps && window.__ps.store && window.__ps.lotCard !== undefined, null, { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: '[data-ps="lot-card-root"],[data-ps="cc-root"],.lc-root,.lc-dock,.lc-pager,.lc-types{visibility:hidden!important}' });
    if (commercial) {
      const layout = { 'strata-u': 'u-court' }[scene];
      if (layout) await page.evaluate((l) => window.__ps.lotCard.setLayout(l), layout);
      else await page.evaluate((t) => window.__ps.lotCard.setType(t), scene);
      await page.waitForTimeout(3500);
    }
    // the 4 m fall (down the lot depth) plus a 2 percent cross slope and small bumps, as the test fixture does
    await page.evaluate((fall) => {
      const st = window.__ps.store;
      st.apply('terrain', (p) => {
        const b = p.site.lot.boundary; const xs = b.map((q) => q.x); const ys = b.map((q) => q.y);
        const x0 = Math.min(...xs) - 120000; const y0 = Math.min(...ys) - 120000; const w = Math.max(...xs) - Math.min(...xs); const d = Math.max(...ys) - Math.min(...ys);
        const cellMm = 1000; const cols = Math.ceil((w + 240000) / cellMm) + 1; const rows = Math.ceil((d + 240000) / cellMm) + 1; const values = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = (x0 + i * cellMm) / 1000; const y = (y0 + j * cellMm - Math.min(...ys)) / 1000; values.push(100 + (fall / (d / 1000)) * y + 0.02 * x + 0.12 * Math.sin(x * 0.9) * Math.cos(y * 0.7)); }
        p.site.lot.terrain = { cols, rows, cellMm, x0, y0, values };
        delete p.site.lot.floorRL;
      });
    }, FALL);
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => { const p = JSON.parse(JSON.stringify(window.__ps.store.project)); const b = p.site.lot.boundary; return { mode: p.mode, boundary: b, aerial: !!p.site.lot.aerial, buildings: (p.commercial?.buildings || []).length, rows: (p.commercial?.rows || []).length }; });
    const { pavementModel } = await import('../src/commercial/catalogue/pavements/logic.js');
    const { roadReserve } = await import('../src/site/lotplan.js');
    const proj = await page.evaluate(() => JSON.parse(JSON.stringify(window.__ps.store.project)));
    const lot = proj.site.lot;
    if (process.env.DUMP) fs.writeFileSync(path.join(process.env.DUMP, `${scene}.json`), JSON.stringify(proj));
    const rv = roadReserve(lot, { extendM: 60 })[0];
    const xs = info.boundary.map((q) => q.x / 1000); const ys = info.boundary.map((q) => q.y / 1000);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
    const pm = commercial ? pavementModel(proj.commercial, lot) : null;
    const P = rv ? { fx: (rv.lines.property[0].x + rv.lines.property[1].x) / 2000, fz: (rv.lines.property[0].y + rv.lines.property[1].y) / 2000, ox: rv.outward.x, oz: rv.outward.y, ux: rv.u.x, uz: rv.u.y } : { fx: cx, fz: Math.min(...ys), ox: 0, oz: -1, ux: 1, uz: 0 };
    const { terrainModel } = await import('../src/viewer3d/terrain.js');
    const tmod = terrainModel(proj, { cellM: 0.75 });
    const gy = (x, z) => (tmod ? tmod.heightAt(x * 1000, z * 1000) : 0);
    const at = (f, o, u, y) => ({ x: P.fx + P.ox * o + P.ux * u + (f?.x || 0), y, z: P.fz + P.oz * o + P.uz * u + (f?.z || 0) });
    const area = (k) => pm?.areas.find((a) => a.id.includes(k)); const mid = (a) => { const q = a.polygon; return { x: q.reduce((s2, t) => s2 + t.x, 0) / q.length / 1000, z: q.reduce((s2, t) => s2 + t.y, 0) / q.length / 1000 }; };
    const pt = (c, o, u, y) => { const x = c.x + P.ox * o + P.ux * u; const z = c.z + P.oz * o + P.uz * u; return { x, y: gy(x, z) + y, z }; };
    const crA = pm?.areas.find((a) => a.id.endsWith(':pad')); const cross = crA ? mid(crA) : { x: P.fx, z: P.fz };
    const apA = pm?.areas.find((a) => a.role === 'apron') || pm?.areas.find((a) => a.role === 'aisle' && !a.id.endsWith(':pad')); const apr = apA ? mid(apA) : { x: cx, z: cz };
    const kb = pm?.kerbs.find((k) => k.type.includes('layback')) || pm?.kerbs[0]; const kc = kb ? { x: kb.polyline[0].x / 1000, z: kb.polyline[0].y / 1000 } : cross;
    console.log(scene, JSON.stringify({ front: P, areas: pm?.areas.map((a) => a.role), houseWays: (proj.site.ways || []).length }));
    const tgt = (c, y) => ({ x: c.x, y: gy(c.x, c.z) + y, z: c.z });
    const poses = {
      aerial: { position: pt({ x: cx, z: cz }, 70, 60, 95), target: tgt({ x: cx, z: cz }, 0), fov: 45 },
      '3d': { position: pt({ x: cx, z: cz }, 70, 45, 26), target: tgt({ x: cx, z: cz }, 0), fov: 50 },
      street: { position: at(null, 16, -8, 1.7), target: at(null, -18, 2, 0.6), fov: 62 },
      crossover: { position: pt(cross, 7.5, -4, 0.9), target: tgt(cross, 0.1), fov: 70 },
      apron: { position: pt(apr, 0, -9, 1.6), target: tgt(apr, 0.3), fov: 62 },
      kerb: { position: pt(kc, 5, 6, 2.0), target: tgt(kc, 0), fov: 62 },
      court: { position: pt({ x: cx, z: cz }, 20, 34, 15), target: tgt({ x: cx, z: cz }, 0), fov: 55 },
      carpark: { position: at(null, -8, 16, 2.6), target: at(null, -26, -6, 0.2), fov: 64 },
      oblique: { position: at(null, 14, 20, 1.1), target: at(null, -8, -4, 0.3), fov: 66 },
    };
    if (!commercial) { // a house lot is narrow: higher, closer poses on the driveway and the crossover
      poses.street = { position: at(null, 11, -7, 3.4), target: at(null, -14, 2, 0), fov: 62 };
      poses.crossover = { position: at(null, 8, -5, 2.4), target: at(null, -1, 0, 0), fov: 66 };
      poses.oblique = { position: at(null, 4, 9, 6), target: at(null, -12, -2, 0), fov: 62 };
      poses.kerb = { position: at(null, 5, 3, 2.2), target: at(null, 0, 0, 0), fov: 66 };
    }
    const poseJson = process.env.POSES ? JSON.parse(process.env.POSES) : {};
    for (const name of VIEWS) {
      const pose = poseJson[name] || poses[name]; if (!pose) continue;
      await page.evaluate(async (po) => { await window.__ps.getViewer().flyTo(po, { duration: 0.01 }); }, pose);
      await page.waitForTimeout(1800);
      const f = path.join(OUT, `${PREFIX}-${scene}-${name}.png`);
      await page.screenshot({ path: f });
      console.log('shot', f);
    }
    await page.close();
  }
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

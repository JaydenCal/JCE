// Terrain smoothness shots: a large gently falling rural lot and a normal sloping residential lot whose elevation source is stepped
// (whole metre levels), at a low oblique and from above.   node tools/terrain-shots.cjs <outDir> <tag> [appDir]
// appDir holds a build at plan-studio/app/index.html (node tools/build-single.mjs --out <appDir>/plan-studio/app/index.html); the rest is website-live.
const path = require('path'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { startServer, newPage } = require('./resiflow-harness.cjs');
const OUT = path.resolve(process.argv[2] || '/home/claude/shots/terrain'); const TAG = process.argv[3] || 'after';
const log = [];
// Elevation grid (site metres relative to the origin) falling about 2 percent to the south east with a shallow swale, stepped to q.
function grid(w, h, cell, q, fall = 0.02) {
  const cols = Math.round(w / cell) + 1; const rows = Math.round(h / cell) + 1; const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = i * cell; const y = j * cell; const t = 300 - fall * x - fall * 0.6 * y + 1.2 * Math.sin(x / 160) * Math.cos(y / 130); values.push(Math.round(t / q) * q); }
  return { cols, rows, cell, x0: -w / 2, y0: h / 2, values };
}
const CASES = {
  rural: { w: 400, h: 1250, cell: 5, q: 1, fall: 0.02, address: '756 Quia' },
  resi: { w: 60, h: 120, cell: 2, q: 0.5, fall: 0.07, address: '14 Sample' },
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = (process.env.CASES || 'rural,resi').split(',');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const name of only) {
    const c = CASES[name]; const pad = 60;
    const { ORIGIN, close } = await startServer(Number(process.env.PORT || 8830) + only.indexOf(name), {
      lot: (r) => ({ ...r, sample: false, demo: false, neighbours: [], lot: { ...r.lot, lotNumber: '3', planLabel: 'DP 263990', lotLabel: 'Lot 3 DP 263990', lotPlan: '3/DP263990', polygons: [{ outer: [[-c.w / 2, c.h / 2], [c.w / 2, c.h / 2], [c.w / 2, -c.h / 2], [-c.w / 2, -c.h / 2]], holes: [] }], areaM2: c.w * c.h, registeredAreaM2: c.w * c.h, bboxMga: { minE: r.origin.e - c.w / 2, minN: r.origin.n - c.h / 2, maxE: r.origin.e + c.w / 2, maxN: r.origin.n + c.h / 2 } } }),
      aerial: (a) => ({ ...a, bbox: { minE: 302577.528 - c.w / 2 - pad, minN: 6558552.325 - c.h / 2 - pad, maxE: 302577.528 + c.w / 2 + pad, maxN: 6558552.325 + c.h / 2 + pad } }),
      contours: (t) => ({ ...t, contours: [], grid: grid(c.w + 2 * pad + 40, c.h + 2 * pad + 40, c.cell, c.q, c.fall) }),
    });
    const page = await newPage(browser, { width: 1440, height: 900 }, log); page.setDefaultTimeout(120000);
    if (process.env.AERIAL === 'off') await page.addInitScript(() => { try { localStorage.setItem('gi.aerial.v1', 'off'); } catch { /* none */ } });
    await page.goto(`${ORIGIN}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ps="flow-root"]:not([hidden])');
    await page.fill('[data-ps="flow-address"]', c.address);
    await page.waitForSelector('[data-ps="flow-suggest"] li'); await page.click('[data-ps="flow-suggest"] li');
    await page.waitForSelector('[data-ps="flow-lot-label"]'); await page.waitForTimeout(3000);
    await page.evaluate(() => { document.querySelector('[data-ps="flow-root"]').hidden = true; window.__ps.store.setUI({ view: '3d' }); });
    await page.waitForTimeout(6000);
    const t = await page.evaluate(() => { const l = window.__ps.store.project.site.lot; const tr = l.terrain; return { cols: tr.cols, rows: tr.rows, cellMm: tr.cellMm, x0: tr.x0, y0: tr.y0, vals: Array.from(tr.values) }; });
    // flat run along the fall line: the longest run of equal neighbouring nodes in the stored terrain
    let run = 0; let worst = 0; for (let j = 0; j < t.rows; j += 4) { run = 0; for (let i = 1; i < t.cols; i++) { if (Math.abs(t.vals[j * t.cols + i] - t.vals[j * t.cols + i - 1]) < 0.011) { run++; worst = Math.max(worst, run); } else run = 0; } }
    console.log(name, TAG, 'terrain', t.cols, 'x', t.rows, 'cell', t.cellMm, 'mm; longest flat run', worst, 'nodes');
    // keep only the viewer canvas on screen: no panels, tips or tutorial
    const box = await page.evaluate(() => { let best = null; for (const c of document.querySelectorAll('canvas')) { const r = c.getBoundingClientRect(); if (r.width > 300 && (!best || r.width * r.height > best.a)) best = { c, a: r.width * r.height, r }; } best.c.setAttribute('data-shot', '1'); const st = document.createElement('style'); st.textContent = 'body *{visibility:hidden!important}[data-shot]{visibility:visible!important}'; document.head.appendChild(st); return { x: best.r.x, y: best.r.y, width: best.r.width, height: best.r.height }; });
    const lot = { cx: 0, cz: 0 };
    const polys = await page.evaluate(() => { const b = window.__ps.store.project.site.lot.boundary; const xs = b.map((p) => p.x / 1000); const ys = b.map((p) => p.y / 1000); return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) }; });
    const R = Math.max(polys.w, polys.d);
    const poses = {
      oblique: { position: { x: polys.cx - R * 0.35, y: R * 0.07 + 8, z: polys.cz + polys.d * 0.12 + R * 0.3 }, target: { x: polys.cx, y: 0, z: polys.cz - polys.d * 0.05 }, fov: 55 },
      above: { position: { x: polys.cx, y: R * 1.05, z: polys.cz + 1 }, target: { x: polys.cx, y: 0, z: polys.cz }, fov: 55 },
      low: { position: { x: polys.cx - polys.w * 0.3, y: 4, z: polys.cz + polys.d * 0.3 }, target: { x: polys.cx + polys.w * 0.1, y: 0, z: polys.cz - polys.d * 0.15 }, fov: 70 },
    };
    for (const [pn, pose] of Object.entries(poses)) {
      await page.evaluate(async (po) => { await window.__ps.getViewer().flyTo(po, { duration: 0.01 }); }, pose);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT, `${name}-${pn}-${TAG}${process.env.AERIAL === 'off' ? '-lawn' : ''}.png`), clip: box }); console.log('shot', name, pn);
    }
    await close();
  }
  await browser.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

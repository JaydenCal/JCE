// Shots of house placement on three lots (a narrow, irregular, sloping lot; a normal lot; a large lot) in the guided flow, the homepage
// embed and the editor, at 1440 and 390 wide.
//   node tools/fit-shots.cjs <before|after> [outDir] [lots=narrow,normal,large]
const path = require('path'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { startServer, newPage } = require('./resiflow-harness.cjs');
const TAG = process.argv[2] || 'after';
const OUT = path.resolve(process.argv[3] || '/home/claude/growth/fit-shots');
const LOTS = (process.argv[4] || 'narrow,normal,large').split(',');
const ONLY = process.env.WIDTHS ? process.env.WIDTHS.split(',') : ['1440', '390'];

// Plan metres (x east, y south, street along the top), turned into the site response (x east, y north of the origin).
const SHAPES = {
  narrow: [[0, 0], [16, 0], [27, 20], [30, 46], [18, 52], [10.5, 27]],
  normal: [[0, 0], [20, 0], [20, 40], [0, 40]],
  large: [[0, 0], [40, 0], [40, 80], [0, 80]],
};
const centre = (pts) => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
function lotFor(name) {
  const pts = SHAPES[name];
  const [cx, cy] = centre(pts);
  const site = (p) => [Math.round((p[0] - cx) * 1000) / 1000, Math.round((cy - p[1]) * 1000) / 1000];
  const area = Math.round(Math.abs(pts.reduce((t, a, i) => { const b = pts[(i + 1) % pts.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  const nb = (ring, n) => ({ lotNumber: String(n), planLabel: 'DP 1198432', lotLabel: `Lot ${n} DP 1198432`, areaM2: 700, polygons: [{ outer: ring.map(site), holes: [] }] });
  const left = [[minX - 22, 0], pts[0], ...pts.slice().reverse().filter((p) => p[0] <= cx && p[1] > 0), [minX - 22, maxY]];
  const right = [pts[1], [maxX + 22, 0], [maxX + 22, maxY], ...pts.filter((p, i) => i > 1 && p[0] > cx).reverse()];
  return (base) => ({
    ...base,
    lot: { ...base.lot, areaM2: area, registeredAreaM2: area, polygons: [{ outer: pts.map(site), holes: [] }], lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432' },
    neighbours: [nb(left, 11), nb(right, 13), nb([[minX - 22, maxY], [maxX + 22, maxY], [maxX + 22, maxY + 35], [minX - 22, maxY + 35]], 20), nb([[minX - 22, -18 - 40], [maxX + 22, -18 - 40], [maxX + 22, -18], [minX - 22, -18]], 30)],
    roads: [{ name: 'Sample Street', points: [site([minX - 120, -9]), site([maxX + 120, -9])] }],
  });
}
// Levels: the narrow lot falls about 0.14 m per metre to the south east; the others are near flat.
function contoursFor(name) {
  const pts = SHAPES[name];
  const [cx, cy] = centre(pts);
  const fall = name === 'narrow' ? 0.14 : 0.01;
  const cell = 2; const half = 70; const cols = half + 1; const rows = half + 1;
  const values = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values.push(Math.round((400 - fall * 0.6 * c * cell - fall * 0.8 * r * cell) * 100) / 100);
  void cx; void cy;
  return (base) => ({ ...base, minRL: Math.min(...values), maxRL: Math.max(...values), grid: { cols, rows, cell, x0: -half, y0: half, values } });
}

const log = [];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let port = Number(process.env.PORT || 8841);
  for (const lotName of LOTS) {
    const { ORIGIN, close } = await startServer(port++, { lot: lotFor(lotName), contours: contoursFor(lotName) });
    for (const [w, hgt, tag] of [[1440, 900, '1440'], [390, 844, '390']].filter((x) => ONLY.includes(x[2]))) {
      const T = 120000;
      const shot = async (page, n) => { await page.waitForTimeout(1200); const f = path.join(OUT, `${TAG}-${lotName}-${n}-${tag}.png`); try { await page.screenshot({ path: f, timeout: T }); console.log('shot', f); } catch (e) { console.log('NO SHOT', f, e.message.split('\n')[0]); } };
      const info = (page) => page.evaluate(() => { const s = window.__ps?.store; const q = (x) => document.querySelector(x); return { status: q('[data-ps="flow-place-status"]')?.textContent || '', card: q('[data-ps="fit-card"]')?.innerText || '', tooBig: !!s?.project.placedHouse?.tooBig, tanks: (s?.project.site.tanks || []).map((t) => [t.x, t.y]) }; });
      // 1. The guided flow ------------------------------------------------------------------------------------------------
      let page = await newPage(browser, { width: w, height: hgt }, log);
      page.setDefaultTimeout(T);
      const next = async () => { await page.click('[data-ps="flow-next"]'); await page.waitForTimeout(500); };
      try {
        await page.goto(`${ORIGIN}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ps="flow-root"]:not([hidden])');
        await page.fill('[data-ps="flow-address"]', '14 Sample');
        await page.waitForSelector('[data-ps="flow-suggest"] li');
        await page.click('[data-ps="flow-suggest"] li');
        await page.waitForSelector('[data-ps="flow-lot-label"]');
        await page.waitForTimeout(2500);
        await next();
        await page.waitForSelector('[data-ps="flow-home"]');
        await shot(page, 'flow2-choose');
        await page.click('[data-ps="flow-home"][data-id="house_double"]');
        await next();
        await page.waitForSelector('[data-ps="flow-house"]');
        await page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"]'));
        await page.waitForTimeout(1500);
        console.log(lotName, tag, 'step 3', JSON.stringify(await info(page)));
        await shot(page, 'flow3-placed');
        if (lotName !== 'narrow') {
          // push the house over the side boundary to see what the tool says
          for (let i = 0; i < (lotName === 'large' ? 16 : 6); i++) await page.evaluate(() => { const s = document.querySelector('[data-ps="flow-nudge-step"]'); s.value = '1000'; s.dispatchEvent(new Event('change')); document.querySelector('[data-ps="flow-nudge-left"]').click(); });
          await page.waitForTimeout(600);
          console.log(lotName, tag, 'pushed', JSON.stringify(await info(page)));
          await shot(page, 'flow3-pushed');
        }
        if (TAG === 'after' && await page.$('[data-ps="fit-act-auto"]')) {
          await page.click('[data-ps="fit-act-auto"]');
          await page.waitForTimeout(900);
          console.log(lotName, tag, 'auto fit', JSON.stringify(await info(page)));
          await shot(page, 'flow3-autofit');
          if (lotName === 'narrow' && await page.$('[data-ps="fit-undo"]')) {
            await page.click('[data-ps="fit-undo"]'); await page.waitForTimeout(500);
            await shot(page, 'flow3-undo');
            await page.click('[data-ps="fit-act-auto"]'); await page.waitForTimeout(700);
          }
        }
        if (lotName === 'narrow') {
          // the garage turned away from the street: is there a driveway?
          await page.click('[data-ps="flow-rot-right"]'); await page.click('[data-ps="flow-rot-right"]'); await page.waitForTimeout(700);
          await shot(page, 'flow3-garage-away');
          await page.click('[data-ps="flow-rot-left"]'); await page.click('[data-ps="flow-rot-left"]'); await page.waitForTimeout(400);
        }
        await next();
        await page.waitForTimeout(800);
        const keep = page.getByRole('button', { name: 'Keep this position' });
        if (await keep.count()) { await shot(page, 'flow3-breach-dialog'); await keep.first().click(); }
        await page.waitForSelector('[data-ps="flow-summary"]');
        await page.waitForTimeout(5000);
        await shot(page, 'flow4-check');
        await next();
        await page.waitForTimeout(4000);
        await shot(page, 'editor-open');
        await page.evaluate(() => window.__ps.store.setUI({ view: '3d' }));
        await page.waitForTimeout(5000);
        await shot(page, 'editor-3d');
        await page.evaluate(() => window.__ps.store.setUI({ view: '2d' }));
        await page.waitForTimeout(2500);
        await shot(page, 'editor-2d');
      } catch (e) { console.log('FAIL flow', lotName, tag, e.message.split('\n')[0]); await shot(page, 'flow-fail').catch(() => {}); }
      await page.context().close();
      // 2. The homepage embed ---------------------------------------------------------------------------------------------
      page = await newPage(browser, { width: w, height: hgt }, log);
      page.setDefaultTimeout(T);
      try {
        await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&address=${encodeURIComponent('14 Sample Street, Westdale NSW')}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ps="lot-card"]');
        await page.waitForFunction(() => !!window.__ps?.store?.project?.placedHouse, null, { timeout: T });
        await page.waitForTimeout(9000);
        await shot(page, 'embed-first');
        // step the design carousel to the double storey home
        for (let i = 0; i < 5 && (await page.evaluate(() => window.__ps.store.project.placedHouse?.id)) !== 'house_double'; i++) { await page.click('[aria-label="Next design"]'); await page.waitForTimeout(2500); }
        await page.waitForTimeout(3000);
        console.log(lotName, tag, 'embed', JSON.stringify(await info(page)));
        await shot(page, 'embed');
        if (TAG === 'after' && await page.$('[data-ps="fit-act-auto"]')) {
          await page.click('[data-ps="fit-act-auto"]');
          await page.waitForTimeout(3500);
          await shot(page, 'embed-autofit');
        }
        await page.click('.lc-mini-x').catch(() => {});
        await page.waitForTimeout(1500);
        await shot(page, 'embed-topview');
      } catch (e) { console.log('FAIL embed', lotName, tag, e.message.split('\n')[0]); await shot(page, 'embed-fail').catch(() => {}); }
      await page.context().close();
    }
    close();
  }
  await browser.close();
  const errs = [...new Set(log)].filter((l) => !/favicon|ERR_|Failed to load resource/.test(l));
  console.log(errs.length ? `page errors:\n${errs.slice(0, 20).join('\n')}` : 'no page errors');
})();

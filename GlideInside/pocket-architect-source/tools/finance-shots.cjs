// Finance panel shots and checks in both guided flows (step 4 cards, See details, assumptions, scenarios, sensitivity).
//   node tools/finance-shots.cjs [outDir]
const path = require('path'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { startServer, newPage } = require('./resiflow-harness.cjs');
const OUT = path.resolve(process.argv[2] || '/home/claude/growth/fin-shots');
const fails = []; const log = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { ORIGIN, close } = await startServer(Number(process.env.PORT || 8833), { commercial: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const T = 120000;
  for (const kind of ['commercial', 'residential']) {
    const page = await newPage(browser, { width: 1440, height: 1000 }, log);
    page.setDefaultTimeout(T);
    const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `fin-${kind}-${n}.png`), timeout: T }); console.log('shot', kind, n); };
    const next = async () => { await page.click('[data-ps="flow-next"]'); await page.waitForTimeout(500); };
    const idle = async () => { await page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"]')); await page.waitForTimeout(500); };
    await page.goto(`${ORIGIN}/plan-studio/app/${kind === 'commercial' ? '?mode=commercial' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ps="flow-root"]:not([hidden])');
    await page.fill('[data-ps="flow-address"]', '14 Sample');
    await page.waitForSelector('[data-ps="flow-suggest"] li');
    await page.click('[data-ps="flow-suggest"] li');
    await page.waitForSelector('[data-ps="flow-lot-label"]');
    await page.waitForTimeout(2500);
    await next();
    if (kind === 'commercial') {
      await page.waitForSelector('[data-ps="flow-type"]');
      await page.click('[data-ps="flow-type"][data-type="strata-units"]').catch(() => {});
      await idle(); await next();
      await page.waitForSelector('[data-ps="flow-building"]').catch(() => {});
      await idle(); await next();
    } else {
      await page.waitForSelector('[data-ps="flow-home"]');
      await page.locator('[data-ps="flow-home"]').first().click();
      await next();
      await page.waitForSelector('[data-ps="flow-house"]');
      await page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"]'));
      await page.waitForTimeout(800);
      await next();
    }
    await page.waitForSelector('[data-ps="flow-summary"] [data-ps="fin-cards"]');
    await page.waitForTimeout(3500);
    check(await page.locator('[data-ps="flow-summary"] [data-ps="fin-cards"] .fx-card').count() === 4, `${kind}: four headline cards (profit, margin, residual land value, peak debt)`);
    for (const k of ['profit', 'margin', 'rlv', 'debt']) check(await page.locator(`[data-ps="flow-summary"] [data-ps="fin-${k}"]`).count() === 1, `${kind}: card ${k}`);
    await shot('1-step4-cards');
    await page.click('[data-ps="flow-summary"] [data-ps="fin-details-toggle"]');
    await page.waitForSelector('[data-ps="flow-summary"] [data-ps="fin-breakdown"]');
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-details"]').scrollIntoView({ block: 'start' }));
    await shot('2-see-details-breakdown');
    // edit one assumption
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-assumptions"] summary').click());
    await page.waitForSelector('[data-ps="flow-summary"] [data-ps="fin-in-ratePct"]');
    const before = await page.textContent('[data-ps="flow-summary"] [data-ps="fin-profit"]');
    await page.fill('[data-ps="flow-summary"] [data-ps="fin-in-ratePct"]', '12.5'); await page.press('[data-ps="flow-summary"] [data-ps="fin-in-ratePct"]', 'Enter');
    await page.waitForTimeout(700);
    const after = await page.textContent('[data-ps="flow-summary"] [data-ps="fin-profit"]');
    check(before !== after, `${kind}: editing the interest rate changes the profit (${before} -> ${after})`);
    check(await page.locator('[data-ps="flow-summary"] [data-ps="fin-reset-ratePct"]').count() === 1, `${kind}: the edited row shows Reset`);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-in-ratePct"]').scrollIntoView({ block: 'center' }));
    await shot('3-assumptions-edited');
    await page.click('[data-ps="flow-summary"] [data-ps="fin-reset-ratePct"]'); await page.waitForTimeout(500);
    check(await page.locator('[data-ps="flow-summary"] [data-ps="fin-reset-ratePct"]').count() === 0, `${kind}: Reset returns the row to its default`);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-assumptions"] summary').click());
    // scenarios
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-scenarios"] summary').click());
    await page.fill('[data-ps="flow-summary"] [data-ps="fin-scn-name"]', 'Sell'); await page.click('[data-ps="flow-summary"] [data-ps="fin-scn-save"]'); await page.waitForTimeout(500);
    await page.click('[data-ps="flow-summary"] [data-ps="fin-mode-hold"]'); await page.waitForTimeout(500);
    await page.fill('[data-ps="flow-summary"] [data-ps="fin-scn-name"]', 'Hold'); await page.click('[data-ps="flow-summary"] [data-ps="fin-scn-save"]'); await page.waitForTimeout(500);
    await page.click('[data-ps="flow-summary"] [data-ps="fin-mode-sell"]'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-assumptions"] summary').click());
    await page.fill('[data-ps="flow-summary"] [data-ps="fin-in-buildMonths"]', '15'); await page.press('[data-ps="flow-summary"] [data-ps="fin-in-buildMonths"]', 'Enter'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-assumptions"] summary').click());
    await page.fill('[data-ps="flow-summary"] [data-ps="fin-scn-name"]', 'Staged'); await page.click('[data-ps="flow-summary"] [data-ps="fin-scn-save"]'); await page.waitForTimeout(600);
    check(await page.locator('[data-ps="flow-summary"] [data-ps="fin-scn"]').count() === 3, `${kind}: three scenarios saved`);
    check((await page.locator('[data-ps="flow-summary"] [data-ps="fin-compare"] thead th').count()) === 5, `${kind}: compare table has Current plus three`);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-compare"]').scrollIntoView({ block: 'center' }));
    await shot('4-scenarios-compare');
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-sensitivity"] summary').click());
    await page.waitForSelector('[data-ps="flow-summary"] [data-ps="fin-sens"]');
    check((await page.locator('[data-ps="flow-summary"] [data-ps="fin-sens"] tbody tr').count()) === 3, `${kind}: sensitivity grid has three price rows`);
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sens"]').scrollIntoView({ block: 'center' }));
    await shot('5-sensitivity');
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sec-sources"] summary').click());
    await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-sources"]').scrollIntoView({ block: 'center' }));
    await shot('6-sources');
    const txt = await page.evaluate(() => document.querySelector('[data-ps="flow-summary"] [data-ps="fin-root"]').innerText);
    check(!/[–—]/.test(txt), `${kind}: no em or en dashes in the panel`);
    check(!/compliant/i.test(txt), `${kind}: the word compliant is not used`);
    check(/quantity surveyor, valuer and your accountant/i.test(txt), `${kind}: the check-with line is shown`);
    // 3D view stays visible and uncovered
    const rects = await page.evaluate(() => { const v = document.querySelector('[data-ps="flow-3d"]')?.getBoundingClientRect(); const f = document.querySelector('[data-ps="flow-summary"] [data-ps="fin-root"]')?.getBoundingClientRect(); return v && f ? { v: [v.left, v.right], f: [f.left, f.right] } : null; });
    check(!!rects && (rects.f[1] <= rects.v[0] + 2 || rects.f[0] >= rects.v[1] - 2), `${kind}: the panel sits beside the 3D view, not over it`);
    await page.close();
  }
  await browser.close(); close();
  const bad = log.filter((l) => !/favicon|Failed to load resource|WebGL|GPU|swiftshader/i.test(l));
  check(bad.length === 0, `no page errors (${bad.slice(0, 3).join(' | ')})`);
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})();

// Site review driver: runs the residential or commercial guided flow, then the editor, export menu, assistant panel and account/gate, and audits every screen
// (contrast, unlabeled controls, clipped text, dashes, prices) at one width. Output: screenshots plus an audit text file.
//   node tools/review-drive.cjs res|com <width> <outDir>
const path = require('path'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { startServer, newPage } = require('./resiflow-harness.cjs');
const { audit, show } = require('./review-audit.cjs');
const [mode, wArg, outArg] = process.argv.slice(2); const W = Number(wArg || 1440); const OUT = path.resolve(outArg);
const H = W < 600 ? 844 : 900; const tag = `${mode}-${W}`; const log = []; const report = [];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const com = mode === 'com';
  const { ORIGIN, close } = await startServer(Number(process.env.PORT || 8840), { commercial: com });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await newPage(browser, { width: W, height: H }, log); page.setDefaultTimeout(150000);
  const step = async (name, { full = false } = {}) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), fullPage: full }).catch(() => {}); const r = await audit(page, `${tag} ${name}`); report.push(show(r)); console.log('done', name); };
  const idle = async () => { await page.waitForFunction(() => !document.querySelector('[data-ps="flow-placing"]'), null, { timeout: 150000 }).catch(() => {}); await page.waitForTimeout(500); };
  const next = async () => { await page.click('[data-ps="flow-next"]'); await page.waitForTimeout(600); };
  try {
    await page.goto(`${ORIGIN}/plan-studio/app/${com ? '?mode=commercial' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ps="flow-root"]:not([hidden])');
    await step('1a-find');
    await page.fill('[data-ps="flow-address"]', '14 Sample'); await page.waitForSelector('[data-ps="flow-suggest"] li'); await step('1b-suggest');
    await page.click('[data-ps="flow-suggest"] li'); await page.waitForSelector('[data-ps="flow-lot-label"]'); await page.waitForTimeout(2500); await step('1c-lot');
    await next();
    if (com) { await page.waitForSelector('[data-ps="flow-type"]'); await step('2a-type'); await page.click('[data-ps="flow-type"][data-type="warehouse"]'); await idle(); await step('2b-type-chosen'); }
    else { await page.waitForSelector('[data-ps="flow-home"]'); await step('2a-choose'); await page.locator('[data-ps="flow-home"]').first().click(); await step('2b-chosen'); }
    await next(); await page.waitForSelector(com ? '[data-ps="flow-building"]' : '[data-ps="flow-house"]'); await idle(); await step('3-place');
    await next(); await page.waitForTimeout(3500); await step('4-check', { full: false });
    await next(); await page.waitForTimeout(2500); await step('5-editor');
    await page.evaluate(() => window.__ps.store.setUI({ view: '2d' })); await step('5b-editor-2d');
    // Export menu
    const ex = page.locator('button:has-text("Exports")').first();
    if (await ex.count()) { await ex.click().catch(() => {}); await page.waitForTimeout(500); await step('6-exports-menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 5).catch(() => {}); }
    // Assistant tab
    const ai = page.locator('text=AI DESIGN ASSISTANT, text=AI design assistant').first();
    if (await ai.count()) { await ai.click().catch(() => {}); await page.waitForTimeout(600); await step('7-assistant'); }
    // Help
    const q = page.locator('button[aria-label*="elp" i], button:has-text("?")').first();
    if (await q.count()) { await q.click().catch(() => {}); await page.waitForTimeout(500); await step('8-help'); await page.keyboard.press('Escape'); }
  } catch (e) { report.push('DRIVER ERROR ' + e.message.split('\n')[0]); console.log('driver error', e.message.split('\n')[0]); await page.screenshot({ path: path.join(OUT, `${tag}-error.png`) }).catch(() => {}); }
  fs.writeFileSync(path.join(OUT, `${tag}-audit.txt`), report.join('\n') + '\nCONSOLE:\n' + [...new Set(log)].join('\n') + '\n');
  await browser.close(); close();
})();

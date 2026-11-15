const path = require('path'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { startServer, newPage, ADDRESS } = require('./resiflow-harness.cjs');
const OUT = '/home/claude/resiflow-shots/before';
(async () => {
  const { ORIGIN, close } = await startServer();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  const shot = async (pg, n) => { await pg.waitForTimeout(1200); await pg.screenshot({ path: path.join(OUT, `${n}.png`), timeout: 120000 }); console.log('shot', n); };
  // A: home page address search
  let page = await newPage(browser, { width: 1440, height: 900 }, log);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelector('#as-input')?.scrollIntoView({ block: 'start' }));
  await shot(page, 'A1-home');
  await page.fill('#as-input', '14 Sample');
  await page.waitForSelector('#as-list li', { timeout: 15000 });
  await shot(page, 'A2-home-suggest');
  await page.click('#as-list li');
  let fr; for (let i = 0; i < 100 && !(fr = page.frames().find((f) => /plan-studio\/app/.test(f.url()))); i++) await page.waitForTimeout(200);
  await fr.waitForFunction(() => /Lot 7/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 60000 }).catch((e) => log.push('wait ' + e.message));
  await page.waitForTimeout(6000);
  await shot(page, 'A3-home-lot-card');
  await fr.evaluate(() => document.querySelector('[data-ps="lc-edit"]')?.click()).catch(() => {});
  await page.waitForTimeout(8000);
  page = page.context().pages().at(-1);
  await shot(page, 'A4-after-edit-click');
  await page.context().close();
  // B: /plan-studio/app/ cold
  page = await newPage(browser, { width: 1440, height: 900 }, log);
  await page.goto(`${ORIGIN}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await shot(page, 'B1-app-cold');
  await page.goto(`${ORIGIN}/plan-studio/app/?address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await shot(page, 'B2-app-address');
  await page.context().close();
  await browser.close(); close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });

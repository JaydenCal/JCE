// iPhone 14 in Safari's engine (WebKit): home page search, address, lot with its aerial, place a house, and every way out of the placement screens.
// Skips cleanly where Playwright's WebKit is not installed (`npx playwright install webkit`). IPHONE_ENGINE=chromium runs the same flow in Chromium with
// iPhone 14 emulation (what CI without WebKit can do). IPHONE_SHOTS=/dir saves iPhone size screenshots.
// The Worker app is real; the NSW upstream is stubbed (the export hangs, so the aerial comes from tiles through the canvas warp, the iOS risk).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE, ARGS, toStep, dismiss } from './helpers/phone-harness.mjs';
import { serve } from './helpers/nsw-stub.mjs';

const SHOTS = process.env.IPHONE_SHOTS || '';
const ENGINE = process.env.IPHONE_ENGINE || 'webkit';
let pw = null;
try { pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs')); } catch { /* no playwright */ }
let browser = null;
let why = !pw ? 'Playwright is not available' : !fs.existsSync(path.join(SITE, 'plan-studio/app/index.html')) ? 'the built app is not available' : '';
if (!why) {
  try { browser = ENGINE === 'chromium' ? await pw.chromium.launch({ args: ARGS }) : await pw.webkit.launch(); } catch (e) { why = `${ENGINE} is not installed (${String(e.message).split('\n')[0].slice(0, 80)})`; }
}
const SKIP = why || false;
if (SKIP) console.log(`# iphone-webkit skipped: ${SKIP}`);

const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };

test('iPhone 14: search an address, the aerial shows, place a house, and the placement screens can be closed', { skip: SKIP, timeout: 240000 }, async () => {
  const state = { log: [], tiles: 0 };
  const { server, origin } = await serve(state);
  try {
    const { defaultBrowserType, ...device } = pw.devices['iPhone 14'];
    const ctx = await browser.newContext(device);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.addInitScript(() => { window.GI_CONFIG = { ...(window.GI_CONFIG || {}), siteExportSlowMs: 1500 }; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // Home page: the hero no longer carries the sentence that lists what loads, and the search box is still there.
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.cine-side .lead').count(), 0, 'the hero sentence is gone');
    assert.doesNotMatch(await page.locator('body').innerText(), /Your real lot loads/);
    const input = page.locator('[data-addr-input]').first();
    await input.waitFor({ timeout: 15000 });
    await shot(page, '1-home-hero.png');
    await input.fill('12 Smith Street Tamworth');
    await page.locator('.as-opt').first().waitFor({ timeout: 30000 });
    await page.locator('.as-opt').first().tap();
    await page.waitForURL(/plan-studio\/app/, { timeout: 30000 });
    await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
    await dismiss(page);

    // The lot loads with an aerial that is a real picture (not blank) and no larger than a phone canvas can take.
    await page.waitForFunction(() => { const l = window.__ps.store.project?.site?.lot; return !!(l && l.aerial); }, null, { timeout: 120000 });
    const pic = await page.evaluate(async () => {
      const key = window.__ps.store.project.site.lot.aerial.key;
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ps.underlay', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const blob = await new Promise((res, rej) => { const q = db.transaction('images').objectStore('images').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (!blob) return { stored: false };
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let min = 255; let max = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; min = Math.min(min, v); max = Math.max(max, v); }
      return { stored: true, w: bmp.width, h: bmp.height, spread: max - min, alpha: d[3] };
    });
    assert.ok(pic.stored, 'the aerial is in the image store');
    assert.ok(Math.max(pic.w, pic.h) <= 2048, `phone aerial at most 2048 px a side, got ${pic.w} x ${pic.h}`);
    assert.ok(pic.spread > 60 && pic.alpha === 255, 'the aerial has picture content (not blank)');
    assert.ok(state.tiles >= 1, 'the aerial came through the tile path');
    await page.waitForTimeout(6000);
    await shot(page, '2-lot-with-aerial.png');

    // The viewer a phone lands on from the home page: the enlarged top view is the building placement screen. Its Close is on screen and 44 px,
    // and closing it keeps the design.
    await page.locator('.lc-mini-x').first().tap({ force: true });
    await page.locator('[data-ps=topview-dialog]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await shot(page, '4-topview-close.png');
    const close = await page.evaluate(() => { const b = document.querySelector('[data-ps=topview-close-top]').getBoundingClientRect(); return { x: b.x, r: b.right, top: b.top, bottom: b.bottom, h: b.height, w: b.width, vw: innerWidth, vh: innerHeight }; });
    assert.ok(close.h >= 44 && close.w >= 44 && close.x >= 0 && close.r <= close.vw && close.top >= 0 && close.bottom <= close.vh, `Close is on screen and 44 px: ${JSON.stringify(close)}`);
    const before = await page.evaluate(() => JSON.stringify(window.__ps.store.project.site.lot.boundary));
    await page.locator('[data-ps=topview-close-top]').tap();
    await page.waitForFunction(() => !document.querySelector('[data-ps=topview-dialog]'), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => JSON.stringify(window.__ps.store.project.site.lot.boundary)), before, 'the design is kept');

    // The guided phone flow: place a house; the placement step's Back (44 px) returns to the home choice without losing the lot.
    await page.goto(`${origin}/plan-studio/app/?mode=residential&address=${encodeURIComponent('12 Smith Street Tamworth')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ps && window.__ps.store, null, { timeout: 60000 });
    await dismiss(page);
    await page.waitForSelector('[data-ps=flow-next]:not([disabled])', { timeout: 90000 }).catch(async (e) => { await shot(page, 'debug-flow-next.png'); throw e; });
    await page.waitForTimeout(2500);
    await shot(page, '2b-flow-lot-aerial.png');
    await toStep(page, 3);
    const back = await page.evaluate(() => { const b = document.querySelector('[data-ps=flow-back]').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, w: b.width, vh: innerHeight }; });
    assert.ok(back.h >= 44 && back.w >= 44 && back.top >= 0 && back.bottom <= back.vh, 'Back is on screen and 44 px');
    await shot(page, '3-place-step.png');
    await page.click('[data-ps=flow-back]');
    await page.waitForFunction(() => document.querySelector('.gf-root')?.dataset.stepId === 'home', null, { timeout: 20000 });
    assert.ok(await page.evaluate(() => !!window.__ps.store.project.site.lot), 'the lot is kept');
    assert.deepEqual(errs.filter((e) => !/WebGL|swiftshader/i.test(e)), []);
    await ctx.close();
  } finally {
    await browser?.close();
    server.close();
  }
});

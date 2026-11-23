// Loading a lot (23/11/2026), page level checks: the home page bar under the hero search and the guided flow's Find your lot bar.
// Needs Playwright (skipped when it is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStub, GL_ARGS } from './helpers/site-stub.mjs';

let chromium = null;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'))); } catch { /* skipped below */ }
const SKIP = chromium ? false : 'Playwright is not available';

test('home page: the slim bar under the hero search follows gi:status steps and the button text comes back', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.mode = 'slowaerial';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    await page.goto(url + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__P = []; new MutationObserver(() => { const p = document.querySelector('.as-prog'); if (p) window.__P.push({ hidden: p.hidden, now: Number(p.getAttribute('aria-valuenow')), label: p.querySelector('.as-prog-label').textContent, wait: p.classList.contains('is-wait') }); }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
    const input = page.locator('[data-addr-input]').first();
    await input.fill('14 Sample Street Calala');
    await input.press('Enter');
    await page.waitForSelector('.as-prog:not([hidden])', { timeout: 15000 });
    const go = await page.evaluate(() => document.querySelector('.as-go').textContent);
    assert.match(go, /Finding your block/);
    await page.waitForFunction(() => window.__P.some((p) => /of 6/.test(p.label)), null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('.as-go').textContent !== 'Finding your block...', null, { timeout: 90000 });
    const log = await page.evaluate(() => window.__P);
    const stepLogs = log.filter((p) => !p.hidden && /of 6/.test(p.label));
    assert.ok(stepLogs.length >= 3, 'the bar shows several steps');
    assert.ok(stepLogs.every((p) => p.now < 100 || /Done/.test(p.label)), 'not 100 before done');
    assert.deepEqual(stepLogs.map((p) => p.now), [...stepLogs.map((p) => p.now)].sort((a, b) => a - b));
    await page.waitForFunction(() => document.querySelector('.as-prog').hidden, null, { timeout: 5000 });
    assert.ok(log.some((p) => p.now === 100 && p.label === 'Done'), 'done fills the bar before it hides');
    assert.equal(await page.evaluate(() => document.querySelector('.as-go').disabled), false);
  } finally { await browser.close(); srv.close(); }
});

test('home page: an error from the viewer hides the bar and keeps the warning', { skip: SKIP, timeout: 120000 }, async () => {
  const { srv, url, S } = await startStub(); S.mode = '500';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    await page.goto(url + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const input = page.locator('[data-addr-input]').first();
    await input.fill('14 Sample Street Calala');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-addr-status]')?.dataset.kind === 'warn', null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => document.querySelector('.as-prog')?.hidden !== false), true, 'bar hidden');
    assert.equal(await page.evaluate(() => document.querySelector('.as-go').disabled), false);
  } finally { await browser.close(); srv.close(); }
});

test('guided flow, Find your lot: the bar names each step and ends done; a failed lookup shows the error state', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.mode = 'slowaerial';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    await page.goto(url + '/plan-studio/app/?mode=residential', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ps=flow-address]', { timeout: 60000 });
    await page.evaluate(() => { window.__L = []; new MutationObserver(() => { const b = document.querySelector('[data-ps=flow-root] .ps-lp'); if (b) window.__L.push({ hidden: b.hidden, state: b.dataset.state, now: Number(b.getAttribute('aria-valuenow')), label: b.querySelector('.ps-lp-label').textContent }); }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
    await page.fill('[data-ps=flow-address]', '14 Sample Street Calala');
    await page.press('[data-ps=flow-address]', 'Enter');
    await page.waitForFunction(() => document.querySelector('[data-ps=flow-lot-label]'), null, { timeout: 90000 });
    await page.waitForFunction(() => window.__L.some((b) => b.state === 'done'), null, { timeout: 20000 });
    const log = await page.evaluate(() => window.__L);
    const labels = [...new Set(log.map((b) => b.label))];
    assert.ok(labels.includes('Loading the lot boundary') && labels.includes('Aerial photo'), `labels ${labels}`);
    const running = log.filter((b) => b.state === 'running');
    assert.ok(running.every((b) => b.now < 100));
    assert.deepEqual(running.map((b) => b.now), [...running.map((b) => b.now)].sort((a, b) => a - b));
    // A failed lookup: the error state with the message, never left running.
    S.mode = '500';
    await page.fill('[data-ps=flow-address]', '16 Sample Street Calala');
    await page.press('[data-ps=flow-address]', 'Enter');
    await page.waitForFunction(() => document.querySelector('[data-ps=flow-root] .ps-lp')?.dataset.state === 'error', null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => document.querySelector('[data-ps=flow-address]').closest('.gf-card').querySelector('.ps-lp').hidden), false);
  } finally { await browser.close(); srv.close(); }
});

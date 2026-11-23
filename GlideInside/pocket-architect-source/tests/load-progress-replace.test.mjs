// Loading a lot (23/11/2026): a second search replaces a lookup in progress. Needs Playwright (skipped when it is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStub, GL_ARGS } from './helpers/site-stub.mjs';
import { chromium, SKIP, viewerPage, send, watchBar } from './helpers/viewer-host.mjs';

test('viewer: a second search mid load replaces the first at once instead of waiting for it', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.scenario = 'tam'; S.mode = 'hanglot';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const { page, frame } = await viewerPage(browser, url);
    await send(page, '14 Sample Street Calala');
    await frame.waitForFunction(() => document.querySelector('.ps-lp[data-state=running]') && /boundary/.test(document.querySelector('.ps-lp-label').textContent), null, { timeout: 60000 });
    S.mode = 'ok';
    const t0 = Date.now();
    await send(page, '14 Sample Street Calala');
    await page.waitForFunction(() => window.__M.some((m) => m.type === 'gi:status' && m.state === 'done'), null, { timeout: 60000 });
    assert.ok(Date.now() - t0 < 40000, 'did not wait out the first lookup');
    const errs = await page.evaluate(() => window.__M.filter((m) => m.type === 'gi:status' && m.state === 'error'));
    assert.equal(errs.length, 0, 'the replaced lookup reports no error');
  } finally { await browser.close(); srv.close(); }
});

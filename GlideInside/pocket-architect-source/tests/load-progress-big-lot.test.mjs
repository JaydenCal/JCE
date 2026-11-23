// Loading a lot (23/11/2026): the 50.9 ha rural lot loads and a lookup over the time limit fails fast. Needs Playwright (skipped when it is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStub, GL_ARGS } from './helpers/site-stub.mjs';
import { chromium, SKIP, viewerPage, send, watchBar } from './helpers/viewer-host.mjs';

test('viewer: the 50.9 ha rural lot loads (frontage framed, bar done) within the time limit, never spinning', { skip: SKIP, timeout: 200000 }, async () => {
  const { srv, url, S } = await startStub(); S.scenario = 'rural';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const { page, frame } = await viewerPage(browser, url);
    const t0 = Date.now();
    await send(page, '756 Quia Road Gunnedah');
    await page.waitForFunction(() => window.__M.some((m) => m.type === 'gi:status' && (m.state === 'done' || m.state === 'error')), null, { timeout: 80000 });
    assert.ok(Date.now() - t0 < 60000, 'settled inside the time limit');
    const last = await page.evaluate(() => window.__M.filter((m) => m.type === 'gi:status').pop());
    assert.equal(last.state, 'done', JSON.stringify(last));
    const r = await frame.evaluate(() => ({ lot: window.__ps.store.project.site.lot.lotLabel, busy: !!document.querySelector('[data-embed-busy]') }));
    assert.equal(r.lot, 'Lot 3 DP 263990');
    assert.equal(r.busy, false);
    const aerialUrl = S.urls.find((x) => x.startsWith('aerial'));
    assert.ok(Number(new URLSearchParams(aerialUrl.split(' ')[1]).get('res')) > 0.6, 'a coarse aerial request for the big lot');
    assert.equal(S.calls.aerial, 1, 'no wide tile for a lot this long');
    // The first view frames the house where it now stands (on the frontage), not where the sample house was before the placement.
    const ndc = await frame.evaluate(() => {
      const v = window.__ps.getViewer(); const w = window.__ps.store.project.levels[0].walls[0];
      const q = new v.camera.position.constructor(w.a.x / 1000, 1, w.a.y / 1000).project(v.camera);
      return [q.x, q.y];
    });
    assert.ok(Math.abs(ndc[0]) < 1 && Math.abs(ndc[1]) < 1, `the house is in view (ndc ${ndc.map((x) => x.toFixed(2))})`);
  } finally { await browser.close(); srv.close(); }
});

test('viewer: when the lookup runs over the limit the page gets an error with a retry and the bar shows the error state', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.scenario = 'rural'; S.mode = 'hanglot';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const { page, frame } = await viewerPage(browser, url);
    await frame.evaluate(() => { window.__ps.runTimeoutMs = 4000; });
    const t0 = Date.now();
    await send(page, '756 Quia Road Gunnedah');
    await page.waitForFunction(() => window.__M.some((m) => m.type === 'gi:status' && m.state === 'error'), null, { timeout: 30000 });
    assert.ok(Date.now() - t0 < 40000, 'failed fast (the 4 s limit starts when the lookup does, after any demo lot in progress)');
    const err = await page.evaluate(() => window.__M.filter((m) => m.type === 'gi:status' && m.state === 'error').pop());
    assert.equal(err.retry, true);
    assert.match(err.message, /taking too long/);
    const st = await frame.evaluate(() => ({ busy: !!document.querySelector('[data-embed-busy]'), bar: document.querySelector('.ps-lp')?.dataset.state, text: document.querySelector('.ps-lp-label')?.textContent }));
    assert.equal(st.busy, false);
    assert.equal(st.bar, 'error');
    assert.match(st.text, /taking too long/);
    // A retry from the page starts again cleanly.
    S.mode = 'ok';
    await send(page, '756 Quia Road Gunnedah');
    await page.waitForFunction(() => window.__M.filter((m) => m.type === 'gi:status' && m.state === 'loading').length >= 2, null, { timeout: 15000 });
  } finally { await browser.close(); srv.close(); }
});

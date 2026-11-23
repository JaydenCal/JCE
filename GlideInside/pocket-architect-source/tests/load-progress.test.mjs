// Loading a lot (23/11/2026): a large rural lot no longer spins forever, every lookup settles, and a loading bar names the step in progress.
// Unit checks always run; the browser checks need Playwright (skipped when it is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoadTracker, withDeadline, statusMessage, LOAD_STEPS, RUN_TIMEOUT_MS, TOO_LONG_TEXT } from '../src/site/load-steps.js';
import { applySiteLookup } from '../src/site/apply.js';
import { fetchAerial, fetchSite, innerAerialRes, BIG_LOT_SPAN_M, WIDE_SKIP_SPAN_M } from '../src/site/client.js';
import { ruralLot, startStub, GL_ARGS } from './helpers/site-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('tracker: steps advance in order, never run backwards, and stay short of 100 until done', () => {
  const seen = [];
  const t = createLoadTracker({ onChange: (s) => seen.push({ ...s }) });
  t.start('address');
  for (const id of ['lot', 'aerial', 'contours', 'setbacks', 'place']) t.step(id);
  t.step('lot'); // a late repeated event
  assert.equal(t.state.label, LOAD_STEPS[5].label);
  const fr = seen.map((s) => s.fraction);
  assert.deepEqual([...fr].sort((a, b) => a - b), fr, 'fraction never decreases');
  assert.ok(Math.max(...fr) < 1 && t.state.status === 'running', 'not 100 before done');
  t.done();
  assert.equal(t.state.fraction, 1);
  assert.equal(t.state.label, 'Done');
});

test('tracker: a quiet retry keeps the step, an error is final and shows the message, start begins again', () => {
  const t = createLoadTracker();
  t.start('lot');
  t.step('busy');
  assert.equal(t.state.index, 1);
  assert.match(t.state.label, /Busy/);
  t.step('aerial');
  assert.equal(t.state.label, 'Aerial photo');
  t.fail('Could not load');
  assert.equal(t.state.status, 'error');
  assert.equal(t.state.message, 'Could not load');
  t.done(); // too late: the error stands
  assert.equal(t.state.status, 'error');
  t.start('address');
  assert.equal(t.state.status, 'running');
  assert.equal(t.state.index, 0);
});

test('status message: gi:status step with a 1 based step, the total and the label', () => {
  const t = createLoadTracker();
  t.start('lot');
  t.step('aerial');
  assert.deepEqual(statusMessage(t.state, '1 Main St'), { type: 'gi:status', state: 'step', step: 3, total: 6, label: 'Aerial photo', address: '1 Main St' });
});

test('withDeadline settles with the work, or rejects as SLOW after the limit and aborts what is in flight', async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 50), 7);
  let aborted = false;
  await assert.rejects(withDeadline(new Promise(() => {}), 30, { onTimeout: () => { aborted = true; } }), (e) => e.code === 'SLOW' && e.message === TOO_LONG_TEXT);
  assert.ok(aborted);
  assert.equal(RUN_TIMEOUT_MS, 45000);
});

test('a lot box over 600 m is asked for at a coarser resolution that keeps the picture near 2048 px; a normal lot keeps the finest', () => {
  const small = { minE: 0, minN: 0, maxE: 40, maxN: 60 };
  assert.equal(innerAerialRes(small), '0.05');
  const big = ruralLot().lot.bboxMga;
  const res = Number(innerAerialRes(big));
  assert.ok(res > 0.6 && res < 0.8, `res ${res}`);
  assert.ok(Math.max(big.maxE - big.minE, big.maxN - big.minN) > BIG_LOT_SPAN_M);
});

test('an aerial request that never answers is given up on (TIMEOUT), and the caller own abort still aborts', async () => {
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchAerial({ bbox: '0,0,1,1' }, { fetchImpl: hang, timeoutMs: 40 }), (e) => e.code === 'TIMEOUT');
  const ctl = new AbortController();
  const p = fetchAerial({ bbox: '0,0,1,1' }, { fetchImpl: hang, timeoutMs: 5000, signal: ctl.signal });
  ctl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('the 50.9 ha lot: the lot is returned with a warning when the aerial never answers, and no wide tile is asked for', async () => {
  const calls = [];
  const fetchImpl = (url, { signal } = {}) => {
    const u = new URL(url, 'http://x');
    calls.push(u.pathname + u.search);
    if (u.pathname.endsWith('/site/lot')) return Promise.resolve(new Response(JSON.stringify(ruralLot()), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (u.pathname.endsWith('/site/aerial')) return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return Promise.resolve(new Response(JSON.stringify({ grid: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  const steps = [];
  const t0 = Date.now();
  const r = await fetchSite({ label: '756 Quia Road Gunnedah NSW', state: 'NSW', lon: 150.151393, lat: -30.953601 }, { fetchImpl, onStep: (s) => steps.push(s), deferContours: true, aerialTimeoutMs: 60 });
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(r.lot.lot.lotLabel, 'Lot 3 DP 263990');
  assert.equal(r.aerial, null);
  assert.ok(r.warnings.some((w) => /No aerial image/.test(w)));
  assert.deepEqual(steps.slice(0, 3), ['lot', 'aerial', 'contours']);
  const aerialCalls = calls.filter((c) => c.includes('/site/aerial'));
  assert.equal(aerialCalls.length, 1, 'the optional wide tile is not asked for when the inner aerial failed');
  const res = Number(new URLSearchParams(aerialCalls[0].split('?')[1]).get('res'));
  assert.ok(res > 0.6, 'a coarse resolution for a big lot');
  assert.ok(Math.max(r.lot.lot.bboxMga.maxE - r.lot.lot.bboxMga.minE, r.lot.lot.bboxMga.maxN - r.lot.lot.bboxMga.minN) < WIDE_SKIP_SPAN_M * 2);
});

test('with a deadline the aerial gets only the time left: out of time it is skipped and the lot still comes back', async () => {
  const calls = [];
  const fetchImpl = (url) => {
    const u = new URL(url, 'http://x');
    calls.push(u.pathname);
    if (u.pathname.endsWith('/site/lot')) return Promise.resolve(new Response(JSON.stringify(ruralLot()), { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve(new Response(JSON.stringify({ grid: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  const r = await fetchSite({ label: 'x', state: 'NSW', lon: 150.1, lat: -30.9 }, { fetchImpl, deferContours: true, deadlineAt: Date.now() + 5000 });
  assert.equal(r.aerialSkipped, true);
  assert.equal(r.aerial, null);
  assert.ok(!calls.some((c) => c.endsWith('/site/aerial')), 'no aerial request when there is no time for one');
  assert.equal(r.lot.lot.lotLabel, 'Lot 3 DP 263990');
});

test('a run that was given up on never lands its lot: an aborted signal stops applySiteLookup before it touches the project', async () => {
  const store = { project: { id: 'p', site: {} } };
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(applySiteLookup(store, { label: '' }, { prefetched: { lot: ruralLot(), aerial: null, contours: null, warnings: [] }, signal: ctl.signal }), (e) => e.name === 'AbortError');
  assert.equal(store.project.site.lot, undefined);
});

test('the resolution cap follows the requested box: a 614 m box and over is coarser, a smaller one keeps the finest', () => {
  assert.equal(innerAerialRes({ minE: 0, minN: 0, maxE: 540, maxN: 100 }, 30), '0.05'); // 600 m box
  assert.ok(Number(innerAerialRes({ minE: 0, minN: 0, maxE: 560, maxN: 100 }, 30)) > 0.25); // 620 m box
});

test('the new strings follow the text rules: no en or em dashes, never "compliant", no old product name', () => {
  for (const f of ['../src/site/load-steps.js', '../src/ui/load-progress.js']) {
    const s = fs.readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!/[–—]/.test(s), f);
    assert.ok(!/compliant|Pocket Architect/i.test(s), f);
  }
  const fw = fs.readFileSync(path.join(HERE, '../../website-live/framework.js'), 'utf8');
  const i = fw.indexOf('Progress bar under each address field');
  const block = fw.slice(i, fw.indexOf('function setBusy', i));
  assert.ok(block.length > 200 && !/[–—]/.test(block) && !/compliant|Pocket Architect/i.test(block));
});

import { chromium, SKIP, viewerPage, send, watchBar } from './helpers/viewer-host.mjs';

test('viewer: the bar follows the real steps, gi:status carries them, and it ends done (normal lot, desktop)', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.mode = 'slowaerial';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const { page, frame } = await viewerPage(browser, url);
    await watchBar(frame);
    await send(page, '14 Sample Street Calala');
    await page.waitForFunction(() => window.__M.some((m) => m.type === 'gi:status' && (m.state === 'done' || m.state === 'error')), null, { timeout: 90000 });
    const msgs = await page.evaluate(() => window.__M.filter((m) => m.type === 'gi:status'));
    assert.equal(msgs[0].state, 'loading', 'loading still comes first (older pages)');
    const steps = msgs.filter((m) => m.state === 'step');
    assert.ok(steps.length >= 3, 'step messages are sent');
    assert.ok(steps.every((m) => m.total === 6 && m.step >= 1 && m.step <= 6 && typeof m.label === 'string'));
    assert.deepEqual(steps.map((m) => m.step), [...steps.map((m) => m.step)].sort((a, b) => a - b), 'the step number never decreases');
    assert.equal(msgs[msgs.length - 1].state, 'done');
    const labels = [...new Set((await frame.evaluate(() => window.__B)).map((b) => b.label))];
    const at = (t) => labels.findIndex((l) => l === t);
    assert.ok(at('Loading the lot boundary') >= 0 && at('Aerial photo') > at('Loading the lot boundary'), `labels ${labels}`);
    assert.ok(at('Setbacks') > at('Aerial photo') || at('Placing the home') > at('Aerial photo'), `labels ${labels}`);
    const bar = await frame.evaluate(() => window.__B);
    const running = bar.filter((b) => b.state === 'running');
    assert.ok(running.length && running.every((b) => b.now < 100), 'never 100 before done');
    assert.deepEqual(running.map((b) => b.now), [...running.map((b) => b.now)].sort((a, b) => a - b), 'the bar never runs backwards');
    assert.ok(bar.some((b) => b.state === 'done' && b.now === 100));
  } finally { await browser.close(); srv.close(); }
});

test('viewer, phone 390x844: the bar sits along the bottom edge inside the screen', { skip: SKIP, timeout: 150000 }, async () => {
  const { srv, url, S } = await startStub(); S.mode = 'slowaerial';
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const { page, frame } = await viewerPage(browser, url, { w: 390, h: 844, touch: true });
    await send(page, '14 Sample Street Calala');
    await frame.waitForSelector('.ps-lp:not([hidden])', { timeout: 30000 });
    const g = await frame.evaluate(() => { const b = document.querySelector('.ps-lp').getBoundingClientRect(); return { l: b.left, r: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight, h: b.height }; });
    assert.ok(g.l >= 0 && g.r <= g.vw + 1, 'inside the width');
    assert.ok(Math.abs(g.bottom - g.vh) <= 2, `at the bottom edge (${g.bottom} of ${g.vh})`);
    assert.ok(g.h < 70, 'slim');
    assert.equal(await frame.evaluate(() => { const e = document.querySelector('.ps3d-hints'); return !e || getComputedStyle(e).display; }), 'none', 'the gesture hint gives way to the bar');
  } finally { await browser.close(); srv.close(); }
});


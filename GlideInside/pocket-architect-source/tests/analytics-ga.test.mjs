// Google Analytics on the standalone app page (src/ui/ga.js): page addresses are cleaned so a looked up address never reaches Google,
// internal traffic is tagged by ?gi_internal=1, events carry only checked values, purchase is once per Stripe session, and the small
// Save your design card follows a placed house by placedDelayMs (src/profile/policy.js). No network, no real analytics id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPageLocation, cleanReferrer, isInternalTraffic, mapEvent, initGoogleAnalytics } from '../src/ui/ga.js';
import { isStandalonePage, track } from '../src/ui/analytics.js';
import { createPromptPolicy } from '../src/profile/policy.js';
import { placedLotKey, isSampleLot } from '../src/profile/placed.js';

// track() raises a window event first: give Node a window that takes it.
globalThis.window ??= { dispatchEvent() {} };
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const memoryArea = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const fakeWin = (url, { top = true, ga4Id = 'G-TEST000000' } = {}) => {
  const u = new URL(url);
  const win = { location: { href: u.href, search: u.search }, document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}) }, localStorage: memoryArea(), sessionStorage: memoryArea(), navigator: {}, GI_CONFIG: { ga4Id, planPackPrice: 'A$30' }, setTimeout: () => 0 };
  win.self = win;
  win.top = top ? win : {};
  return win;
};

test('the page address sent to Google never carries the looked up address or other free text', () => {
  const out = cleanPageLocation({ href: 'https://glideinside.com.au/plan-studio/app/?address=12%20Example%20Street%20Tamworth&utm_source=google&view=3d&name=Jo&template=house-2&lot=77' });
  assert.equal(out, 'https://glideinside.com.au/plan-studio/app/?utm_source=google&view=3d&template=house-2');
  assert.ok(!/address|Example|Tamworth|name|lot/i.test(out));
  assert.equal(cleanPageLocation({ href: 'https://x.test/app/?utm_source=a%20b' }), 'https://x.test/app/', 'a value with spaces is dropped');
  assert.equal(cleanPageLocation({ href: 'not a url' }), '');
  assert.equal(cleanReferrer('https://glideinside.com.au/index.html?address=1%20Main%20St#x'), 'https://glideinside.com.au/index.html');
  assert.equal(cleanReferrer(''), '');
});

test('the gtag page_view carries the cleaned address and nothing else', () => {
  const win = fakeWin('https://glideinside.com.au/plan-studio/app/?address=12%20Example%20Street&view=3d');
  const calls = [];
  win.gtag = (...a) => calls.push(a);
  const r = initGoogleAnalytics({ win, idle: () => {} });
  assert.equal(r.active, true);
  assert.ok(!JSON.stringify(calls).includes('Example'));
  assert.deepEqual(calls.find((c) => c[1] === 'page_view')[2].page_location, 'https://glideinside.com.au/plan-studio/app/?view=3d');
});

test('frames, the widget, a missing id and an opt out send nothing', () => {
  assert.equal(initGoogleAnalytics({ win: fakeWin('https://x.test/app/', { top: false }) }).reason, 'framed');
  assert.equal(initGoogleAnalytics({ win: fakeWin('https://x.test/app/'), widget: true }).reason, 'widget');
  assert.equal(initGoogleAnalytics({ win: fakeWin('https://x.test/app/', { ga4Id: '' }) }).reason, 'no-id');
  const w = fakeWin('https://x.test/app/');
  w['ga-disable-G-TEST000000'] = true;
  assert.equal(initGoogleAnalytics({ win: w }).reason, 'opt-out');
  assert.equal(isStandalonePage(fakeWin('https://x.test/app/?embed=viewer')), false);
});

test('?gi_internal=1 tags the browser as internal until ?gi_internal=0', () => {
  const win = fakeWin('https://x.test/app/?gi_internal=1');
  assert.equal(isInternalTraffic(win), true);
  win.location = { href: 'https://x.test/app/', search: '' };
  assert.equal(isInternalTraffic(win), true, 'remembered');
  win.location = { href: 'https://x.test/app/?gi_internal=0', search: '?gi_internal=0' };
  assert.equal(isInternalTraffic(win), false);
  const sent = [];
  const live = fakeWin('https://x.test/app/?gi_internal=1');
  live.gtag = (...a) => sent.push(a);
  initGoogleAnalytics({ win: live, idle: () => {} });
  track('house_placed', { sample: false });
  const ev = sent.find((c) => c[0] === 'event' && c[1] === 'house_placed');
  assert.equal(ev[2].traffic_type, 'internal');
});

test('event mapping: checked values only, purchase once per Stripe session in AUD', () => {
  assert.deepEqual(mapEvent('app_opened', { entry: 'phone', from: 'home_search' }), [{ name: 'app_opened', params: { entry: 'phone', from: 'home_search' } }]);
  assert.deepEqual(mapEvent('app_opened', { entry: '12 Example St', from: 'x' })[0].params, {}, 'free text is dropped');
  assert.deepEqual(mapEvent('lot_loaded', { success: false, ms: 1234.4, sample: false })[0].params, { result: 'fail', ms: 1234, sample: 'no' });
  assert.equal(mapEvent('unknown_event').length, 0);
  const seen = new Set();
  const once = (k) => (seen.has(k) ? false : (seen.add(k), true));
  const first = mapEvent('ps_checkout_completed', { sessionId: 'cs_test_abc123456' }, { once, price: 30 });
  assert.deepEqual(first.map((e) => e.name), ['ps_checkout_completed', 'purchase']);
  assert.equal(first[1].params.transaction_id, 'cs_test_abc123456');
  assert.equal(first[1].params.currency, 'AUD');
  assert.equal(first[1].params.value, 30);
  assert.deepEqual(mapEvent('ps_checkout_completed', { sessionId: 'cs_test_abc123456' }, { once }).map((e) => e.name), ['ps_checkout_completed'], 'a reload does not count twice');
  assert.deepEqual(mapEvent('ps_checkout_completed', { sessionId: 'bad id!' }, { once }).map((e) => e.name), ['ps_checkout_completed'], 'no purchase without a valid session id');
  const signup = mapEvent('ps_profile_signup', { marketing: true }, { once, utm: { utm_source: 'google' } });
  assert.deepEqual(signup.map((e) => e.name), ['ps_profile_signup', 'generate_lead']);
  assert.equal(signup[1].params.lead_type, 'free_profile');
  assert.ok(!('email' in signup[0].params));
});

test('the Save your design card follows a placed house by about 4 seconds, once, and waits while busy', () => {
  const timers = [];
  const shown = [];
  let busy = false;
  const policy = createPromptPolicy({
    show: (r) => shown.push(r), isBusy: () => busy, session: null,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
  });
  assert.equal(policy.noteHousePlaced(), true);
  assert.equal(timers.at(-1).ms, 4000, 'placedDelayMs defaults to 4 seconds');
  assert.deepEqual(shown, [], 'nothing shown before the delay');
  busy = true;
  timers.at(-1).fn();
  assert.deepEqual(shown, [], 'a drag or dialog holds it back');
  assert.equal(timers.at(-1).ms, 1000, 'checked again a second later');
  busy = false;
  timers.at(-1).fn();
  assert.deepEqual(shown, ['placed']);
  assert.equal(policy.noteHousePlaced(), false, 'once per session');
});

test('the card is not offered after Not now or to someone with an account', () => {
  const timers = [];
  const shown = [];
  const mk = (extra) => createPromptPolicy({ show: (r) => shown.push(r), setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, ...extra });
  const a = mk({ status: () => 'in' });
  assert.equal(a.noteHousePlaced(), false);
  const b = mk({ otherAccount: () => true });
  assert.equal(b.noteHousePlaced(), false);
  const c = mk({});
  c.dismiss();
  assert.equal(c.noteHousePlaced(), false);
  assert.deepEqual(shown, []);
});

test('a house on a real lot is told apart from the sample lot', () => {
  const real = { placedHouse: { id: 'h' }, site: { lot: { origin: { e: 1, n: 2 }, lotLabel: 'Lot 4', boundary: [1, 2, 3] } } };
  assert.equal(placedLotKey(real), '1|2|Lot 4|3');
  assert.equal(placedLotKey({ ...real, placedHouse: null }), null);
  assert.equal(isSampleLot({ site: { lot: { lotLabel: 'Sample lot' } } }), true);
  assert.equal(isSampleLot(real), false);
});

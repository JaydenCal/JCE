// Review fixes for release 6m: the address leaves the page URL, website analytics.js sends cleaned locations and checked events,
// internal flag, Stripe referrer, no double counting, top view close mid drag, reopening a saved project is not a new placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { addressFromSearch, resetHeldAddress } from '../src/ui/embed-viewer.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const area = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };

test('the app removes ?address= from its own URL after reading it, and keeps it in memory', () => {
  resetHeldAddress();
  const calls = [];
  const win = { location: { href: 'https://glideinside.com.au/plan-studio/app/?mode=residential&address=12%20Example%20St%20Tamworth&utm_source=g' }, sessionStorage: area(), history: { state: null, replaceState: (...a) => calls.push(a) }, performance: { getEntriesByType: () => [{ type: 'navigate' }] } };
  assert.equal(addressFromSearch(undefined, win), '12 Example St Tamworth');
  assert.equal(calls.length, 1);
  assert.ok(!/address|Example/.test(calls[0][2]) && /mode=residential/.test(calls[0][2]) && /utm_source=g/.test(calls[0][2]));
  win.location.href = 'https://glideinside.com.au' + calls[0][2];
  assert.equal(addressFromSearch(undefined, win), '12 Example St Tamworth', 'later reads still get it');
  // a reload of the same tab (clean URL) gets it back from sessionStorage; a fresh visit does not
  resetHeldAddress();
  win.performance = { getEntriesByType: () => [{ type: 'reload' }] };
  assert.equal(addressFromSearch(undefined, win), '12 Example St Tamworth');
  resetHeldAddress();
  win.performance = { getEntriesByType: () => [{ type: 'navigate' }] };
  assert.equal(addressFromSearch(undefined, win), '');
  assert.equal(addressFromSearch('?address=a%20b'), 'a b', 'an explicit search string is only parsed');
});

function loadAnalytics({ url, referrer = '', local = {}, framed = false }) {
  const calls = [];
  const u = new URL(url);
  const ls = area(); Object.entries(local).forEach(([k, v]) => ls.setItem(k, v));
  const ss = area();
  const listeners = {};
  const win = { GI_CONFIG: { ga4Id: 'G-TEST000000', planPackPrice: 'A$30' }, localStorage: ls, sessionStorage: ss, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, dataLayer: [] };
  win.window = win; win.parent = framed ? {} : win;
  win.gtag = (...a) => calls.push(a);
  const document = { referrer, readyState: 'complete', head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} };
  const ctx = vm.createContext({ ...win, window: win, document, location: { href: u.href, search: u.search, pathname: u.pathname, origin: u.origin }, navigator: {}, URL, URLSearchParams, setTimeout: () => 0, Date, JSON, Object, String, Math, isFinite, parseFloat, Number, console, gtag: win.gtag, dataLayer: win.dataLayer });
  win.parent = framed ? {} : win;
  ctx.window = Object.assign(win, { location: ctx.location, document, navigator: ctx.navigator, URL, URLSearchParams });
  ctx.parent = win.parent;
  vm.runInContext(read('../../website-live/analytics.js'), ctx);
  const emit = (event, props) => (listeners['ps:analytics'] || []).forEach((f) => f({ detail: { event, props } }));
  return { calls, emit, win };
}

test('analytics.js sends origin, path and allow listed values only, never ?address=', () => {
  const { calls } = loadAnalytics({ url: 'https://glideinside.com.au/?address=12%20Example%20St&utm_source=google&name=Jo', referrer: 'https://glideinside.com.au/plan-studio/app/?address=12%20Example%20St' });
  const cfg = calls.find((c) => c[0] === 'config');
  assert.equal(cfg[2].page_location, 'https://glideinside.com.au/?utm_source=google');
  assert.equal(cfg[2].page_referrer, 'https://glideinside.com.au/plan-studio/app/');
  const set = calls.find((c) => c[0] === 'set');
  assert.equal(set[1].page_location, cfg[2].page_location);
  assert.ok(!JSON.stringify(calls).match(/Example|address=/));
});

test('analytics.js: internal flag, Stripe referrer dropped', () => {
  let r = loadAnalytics({ url: 'https://glideinside.com.au/?gi_internal=1' });
  assert.equal(r.win.localStorage.getItem('gi_internal'), '1');
  assert.equal(r.calls.find((c) => c[0] === 'config')[2].traffic_type, 'internal');
  r = loadAnalytics({ url: 'https://glideinside.com.au/', local: { gi_internal: '1' } });
  r.emit('house_placed', { sample: false });
  assert.equal(r.calls.find((c) => c[1] === 'house_placed')[2].traffic_type, 'internal');
  r = loadAnalytics({ url: 'https://glideinside.com.au/?checkout=success', referrer: 'https://checkout.stripe.com/c/pay/cs_live_abc' });
  assert.equal(r.calls.find((c) => c[0] === 'config')[2].page_referrer, '');
  r = loadAnalytics({ url: 'https://glideinside.com.au/' });
  assert.equal(r.calls.find((c) => c[0] === 'config')[2].traffic_type, undefined);
});

test('analytics.js forwards the app events once, with checked values, and scrubs address like text', () => {
  const { calls, emit } = loadAnalytics({ url: 'https://glideinside.com.au/' });
  const names = () => calls.filter((c) => c[0] === 'event').map((c) => c[1]);
  for (const n of ['app_opened', 'lot_loaded', 'house_placed', 'ps_profile_prompt', 'ps_share_copy', 'ps_share_open', 'ps_export', 'ps_upgrade_click', 'ps_checkout_started', 'ps_project_saved']) emit(n, { entry: 'desktop', from: 'home_search', success: true, ms: 1200, type: 'pdf', source: 'export', address: '12 Example St' });
  emit('ps_profile_signup', { marketing: true });
  emit('ps_profile_signup', { marketing: true });
  emit('ps_checkout_completed', { sessionId: 'cs_test_12345678' });
  emit('ps_checkout_completed', { sessionId: 'cs_test_12345678' });
  emit('design_started', { method: 'edit' });
  emit('design_started', { method: 'edit' });
  const n = names();
  for (const e of ['app_opened', 'lot_loaded', 'house_placed', 'ps_profile_prompt', 'ps_profile_signup', 'ps_share_copy', 'ps_share_open', 'ps_export', 'ps_upgrade_click', 'ps_checkout_started', 'ps_checkout_completed', 'purchase', 'generate_lead']) assert.ok(n.includes(e), e);
  assert.equal(n.filter((x) => x === 'purchase').length, 1, 'one purchase per Stripe session');
  assert.equal(n.filter((x) => x === 'generate_lead').length, 1);
  assert.equal(n.filter((x) => x === 'design_started').length, 1);
  assert.equal(n.filter((x) => x === 'app_opened').length, 1);
  assert.ok(!JSON.stringify(calls).includes('Example'));
  assert.equal(calls.find((c) => c[1] === 'app_opened')[2].from, 'home_search');
});

test('analytics.js does not report from inside a frame or on the app page itself', () => {
  assert.equal(loadAnalytics({ url: 'https://glideinside.com.au/', framed: true }).calls.length, 0);
  const app = loadAnalytics({ url: 'https://glideinside.com.au/plan-studio/app/' });
  app.emit('house_placed', {});
  assert.equal(app.calls.length, 0, 'src/ui/ga.js reports there');
});

test('top view close() ends a drag in progress and resets drag state first', () => {
  const src = read('../src/lotcard/topview.js');
  const body = src.slice(src.indexOf('  function close() {'));
  const iEnd = body.indexOf('endDrag();');
  assert.ok(iEnd > 0 && body.indexOf('hsDrag = false;') < iEnd && body.indexOf('turning = false;') < iEnd);
  assert.ok(iEnd < body.indexOf('ov.remove();'), 'drag ended before the overlay is removed');
});

test('a reopened saved project is not a new house placement (no house_placed, no save card)', async () => {
  const src = read('../src/app.js');
  assert.match(src, /let lastPlaced = placedLotKey\(store\.project\);/);
  const { watchHousePlaced } = await import('../src/profile/placed.js');
  const mk = (project) => { const subs = []; return { project, on: (_e, f) => { subs.push(f); }, fire() { subs.forEach((f) => f()); } }; };
  const lot = (n) => ({ origin: { e: 1, n }, lotLabel: 'Lot 1', boundary: [1, 2, 3, 4] });
  let hits = 0;
  const reopened = mk({ site: { lot: lot(1) }, placedHouse: { id: 'h' } });
  watchHousePlaced(reopened, () => hits++);
  reopened.fire();
  assert.equal(hits, 0, 'reopening a saved project does not count');
  reopened.project = { site: { lot: lot(2) }, placedHouse: { id: 'h' } };
  reopened.fire();
  assert.equal(hits, 1, 'a different lot placed afterwards does');
  const fresh = mk({ site: { lot: lot(1) } });
  watchHousePlaced(fresh, () => hits++);
  fresh.project = { site: { lot: lot(1) }, placedHouse: { id: 'h' } };
  fresh.fire();
  assert.equal(hits, 2);
});

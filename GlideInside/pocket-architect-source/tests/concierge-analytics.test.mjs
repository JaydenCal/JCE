// Concierge GA4 events: fixed names, fixed parameter schema, once-only confirmation, no personal data. Runs analytics.js in a stubbed browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../../website-live/analytics.js', import.meta.url), 'utf8');
function browser({ framed = false, search = '' } = {}) {
  const events = []; const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const win = { GI_CONFIG: { ga4Id: 'G-TEST' }, localStorage: store, sessionStorage: store, addEventListener() {}, dataLayer: [] };
  win.parent = framed ? {} : win;
  win.gtag = function () { const a = [...arguments]; if (a[0] === 'event') events.push({ name: a[1], params: JSON.parse(JSON.stringify(a[2] || {})) }); };
  const doc = { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], createElement: () => ({}), head: { appendChild() {} } };
  const ctx = vm.createContext({ window: win, document: doc, location: { search, pathname: '/for-builders/', href: 'https://site.test/for-builders/', origin: 'https://site.test' }, URLSearchParams, URL, Date, JSON, Object, String, Number, parseFloat, isFinite, setTimeout, console });
  vm.runInContext(SRC, ctx);
  return { win, events };
}
const NAMES = ['booking_agent_opened', 'booking_agent_intent_selected', 'booking_agent_qualification_completed', 'booking_slots_viewed', 'booking_agent_booking_attempt', 'booking_agent_booking_confirmed', 'booking_agent_booking_failed', 'booking_agent_handoff_requested'];

test('analytics: all eight booking events are sent through the existing helper with safe parameters', () => {
  const b = browser();
  b.win.giTrackBooking('booking_agent_opened', { page_path: '/for-builders/' });
  b.win.giTrackBooking('booking_agent_intent_selected', { intent: 'builder', page_path: '/for-builders/' });
  b.win.giTrackBooking('booking_agent_qualification_completed', { intent: 'builder', qualifier: 'custom', page_path: '/for-builders/' });
  b.win.giTrackBooking('booking_slots_viewed', { booking_type: 'builder', slot_count: '11_30' });
  b.win.giTrackBooking('booking_agent_booking_attempt', { booking_type: 'builder' });
  b.win.giTrackBooking('booking_agent_booking_confirmed', { booking_type: 'builder', dedupe: 'x1' });
  b.win.giTrackBooking('booking_agent_booking_failed', { booking_type: 'builder', reason: 'slot_taken' });
  b.win.giTrackBooking('booking_agent_handoff_requested', { target: 'demo', page_path: '/for-builders/' });
  assert.deepEqual(b.events.map((e) => e.name), NAMES);
  assert.deepEqual(b.events[3].params, { booking_type: 'builder', slot_count: '11_30' });
});
test('analytics: unknown events are refused and personal data can never be sent, even if a caller tries', () => {
  const b = browser();
  assert.equal(b.win.giTrackBooking('purchase', { value: 1 }), false);
  assert.equal(b.win.giTrackBooking('page_view', {}), false);
  b.win.giTrackBooking('booking_agent_booking_attempt', { booking_type: 'sam@example.com', name: 'Sam Test', email: 'sam@example.com', phone: '0412345678', ref: 'GI-ABC234', message: 'my address is 1 Test St', page_path: 'https://evil.test/?e=sam@example.com' });
  b.win.giTrackBooking('booking_agent_opened', { page_path: '/book-a-demo/?email=sam@example.com', name: 'Sam' });
  b.win.giTrackBooking('booking_agent_booking_failed', { booking_type: 'builder', reason: 'Error for sam@example.com' });
  const all = JSON.stringify(b.events);
  assert.doesNotMatch(all, /sam|example|0412|GI-ABC|evil|address|Test St/i);
  assert.deepEqual(b.events[0].params, {});
});
test('analytics: the confirmed event fires once per booking however many times it is requested', () => {
  const b = browser();
  for (let i = 0; i < 5; i++) b.win.giTrackBooking('booking_agent_booking_confirmed', { booking_type: 'agent', dedupe: 'gi_bk_conf_GI-AAAAAA' });
  assert.equal(b.events.filter((e) => e.name === 'booking_agent_booking_confirmed').length, 1);
  b.win.giTrackBooking('booking_agent_booking_confirmed', { booking_type: 'agent', dedupe: 'gi_bk_conf_GI-BBBBBB' });
  assert.equal(b.events.length, 2);
  assert.equal('dedupe' in b.events[0].params, false, 'the dedupe key is never sent');
});
test('analytics: attribution (UTM) is passed, nothing else is added, and a framed page sends nothing', () => {
  const b = browser({ search: '?utm_source=google&utm_medium=cpc' });
  b.win.giTrackBooking('booking_agent_opened', { page_path: '/' });
  assert.deepEqual(b.events[0].params, { page_path: '/', utm_source: 'google', utm_medium: 'cpc' });
  const f = browser({ framed: true });
  f.win.giTrackBooking('booking_agent_opened', { page_path: '/' });
  assert.equal(f.events.length, 0, 'the app inside an iframe never double counts');
});
test('analytics: the UI code only ever calls giTrackBooking with enum values and no free text', () => {
  const ui = fs.readFileSync(new URL('../../website-live/assets/concierge/concierge.js', import.meta.url), 'utf8');
  const calls = [...ui.matchAll(/track\("([a-z_]+)"/g)].map((m) => m[1]);
  for (const c of calls) assert.ok(NAMES.includes(c), c);
  assert.ok(!/track\([^)]*(state\.name|state\.email|\.email|\.name|msg|text)\b/.test(ui.replace(/summary\.name/g, '')), 'no personal fields are passed to track()');
});

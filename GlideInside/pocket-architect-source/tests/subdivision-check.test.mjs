// Subdivision check: minimum lot size, lot count logic, the lead payload and the enquiry route with source "subdivision-check".
import test from 'node:test';
import assert from 'node:assert/strict';
import { minLotFor, rangeText, frontageFor } from '../src/subdiv/rules.js';
import { layoutSubdivision, indicativeYield, frameOf } from '../src/subdiv/layout.js';
import { buildLeadPayload, validateLead, submitLead, SOURCE, CAVEAT, EVENTS } from '../src/subdiv/lead.js';
import { isSubdivisionCheck } from '../src/toolmode.js';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';

const rect = (w, d, front = [0]) => ({ boundary: [{ x: 0, y: 0 }, { x: w * 1000, y: 0 }, { x: w * 1000, y: d * 1000 }, { x: 0, y: d * 1000 }], frontEdges: front, areaM2: w * d, zoning: { code: 'R2', name: 'Low Density Residential' }, address: '1 Test St', lotNumber: '5', planLabel: 'DP 123', lga: 'Test' });

test('minimum lot size: zone default, user figure wins, unknown zone is labelled', () => {
  const a = minLotFor(rect(20, 40));
  assert.equal(a.minM2, 600); assert.equal(a.basis, 'default');
  assert.equal(minLotFor(rect(20, 40), { userMinM2: 450 }).basis, 'user');
  assert.equal(minLotFor(rect(20, 40), { councilMinM2: 500 }).minM2, 500);
  const n = minLotFor({ zoning: null });
  assert.equal(n.minM2, 600); assert.match(n.note, /No zone/);
  assert.equal(minLotFor({ zoning: { code: 'RU1', name: 'Primary Production' } }).minM2, 400000);
  assert.ok(frontageFor(450) < frontageFor(1000));
});

test('range text', () => {
  assert.equal(rangeText(5, 7), 'About 5 to 7 lots');
  assert.equal(rangeText(3, 3), 'About 3 lots');
  assert.match(rangeText(1, 1), /No further subdivision/);
});

test('lot count: small block is not divided; frontage, battle-axe and road layouts', () => {
  const small = indicativeYield(rect(20, 40), { minM2: 450, minFrontM: 12 });
  assert.equal(small.high, 1); assert.equal(small.layout.kind, 'none');
  const two = indicativeYield(rect(20, 60), { minM2: 450, minFrontM: 12 });
  assert.equal(two.high, 2); assert.equal(two.layout.kind, 'battleaxe');
  const wide = indicativeYield(rect(40, 30), { minM2: 450, minFrontM: 12 });
  assert.equal(wide.layout.kind, 'frontage'); assert.equal(wide.high, 2);
  const big = indicativeYield(rect(60, 100), { minM2: 600, minFrontM: 15 });
  assert.equal(big.layout.kind, 'road'); assert.ok(big.high >= 6);
  assert.ok(big.low <= big.high && big.low >= 1);
  // every proposed lot meets the minimum area, numbering runs 1..n, the road has lots on both sides and a turning head
  big.layout.lots.forEach((l, i) => { assert.equal(l.n, i + 1); assert.ok(l.areaM2 >= 600 * 0.97); });
  assert.ok(big.layout.road.head.length >= 12);
  assert.equal(big.layout.road.centre.length, 2);
  // a bigger minimum can only lower the count
  assert.ok(indicativeYield(rect(60, 100), { minM2: 1500, minFrontM: 20 }).high <= big.high);
});

test('lot count: the front edge sets the frame, so a rotated block gives the same count', () => {
  const a = rect(40, 30);
  const th = 0.6; const c = Math.cos(th); const s = Math.sin(th);
  const b = { ...a, boundary: a.boundary.map((p) => ({ x: Math.round(p.x * c - p.y * s), y: Math.round(p.x * s + p.y * c) })) };
  assert.equal(indicativeYield(b, { minM2: 450, minFrontM: 12 }).high, indicativeYield(a, { minM2: 450, minFrontM: 12 }).high);
  assert.ok(frameOf(b).n);
});

test('layout output carries no design numbers and no forbidden words', () => {
  const l = layoutSubdivision(rect(60, 100), { minM2: 600, minFrontM: 15 });
  const text = JSON.stringify(Object.keys(l)) + CAVEAT;
  assert.ok(!/compliant|[–—]/i.test(text));
  assert.equal(CAVEAT, 'Indicative only. Yield depends on council controls, access, services, flooding and the final survey.');
});

test('lead payload: source tag, address, lot and DP, area, count range, role', () => {
  const lot = rect(60, 100);
  const result = { low: 5, high: 7, rules: { minM2: 600, basis: 'default' }, layout: { kind: 'road' } };
  const p = buildLeadPayload({ name: ' Sam ', email: 'Sam@Example.com', phone: '', role: 'Agent', consent: true }, lot, result);
  assert.equal(p.source, SOURCE); assert.equal(SOURCE, 'subdivision-check');
  assert.equal(p.email, 'sam@example.com'); assert.equal(p.name, 'Sam'); assert.equal(p.phone, '');
  assert.deepEqual(p.lot, { address: '1 Test St', lot: '5', dp: 'DP 123', lga: 'Test', zone: 'R2 Low Density Residential' });
  assert.deepEqual(p.subdivision, { role: 'Agent', lotAreaM2: 6000, lotsLow: 5, lotsHigh: 7, minLotM2: 600, minBasis: 'default', layout: 'road' });
  assert.equal(p.consent, true);
  assert.equal(validateLead({ name: 'a', email: 'bad', role: 'Agent', consent: true }), 'Enter a valid email address.');
  assert.match(validateLead({ name: 'a', email: 'a@b.co', role: 'Agent', consent: false }), /Tick the box/);
  assert.equal(validateLead({ name: 'a', email: 'a@b.co', phone: '', role: 'Buyer', consent: true }), '');
  assert.deepEqual(Object.values(EVENTS), ['subdiv_check_start', 'subdiv_lot_loaded', 'subdiv_result_shown', 'subdiv_lead_submit', 'subdiv_pdf_download']);
  assert.equal(isSubdivisionCheck('?mode=subdivision-check'), true);
  assert.equal(isSubdivisionCheck('?mode=commercial'), false);
});

test('submitLead posts once to the existing enquiry route', async () => {
  const calls = [];
  const out = await submitLead({ a: 1 }, { fetchImpl: async (u, i) => { calls.push([u, i]); return new Response(JSON.stringify({ ok: true, reference: 'GI-ABCDE' }), { status: 200 }); } });
  assert.equal(out.reference, 'GI-ABCDE'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/enquiry/jce');
});

test('enquiry route: subdivision-check lead is saved, emailed to the owner only, phone optional', async () => {
  const sent = [];
  const store = createMemoryStore();
  const app = createApp({ store, env: { SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 's', RESEND_API_KEY: 're_test' }, fetchImpl: async (u, i) => { sent.push(JSON.parse(i.body)); return new Response(JSON.stringify({ id: 'em' }), { status: 200 }); }, now: () => Date.UTC(2026, 10, 25, 3) });
  const post = (b) => app.handle(new Request('https://x.test/api/enquiry/jce', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify(b) }));
  const body = buildLeadPayload({ name: 'Sam', email: 'sam@example.com', phone: '', role: 'Developer', consent: true }, rect(60, 100), { low: 5, high: 7, rules: { minM2: 600, basis: 'default' }, layout: { kind: 'road' } });
  const res = await post(body);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['enquiries@jceinfrastructure.com.au']);
  assert.match(sent[0].text, /subdivision-check/); assert.match(sent[0].text, /Role: Developer/); assert.match(sent[0].text, /Nothing was sent to the person/);
  const [row] = await store.listEnquiries();
  assert.equal(row.source, 'subdivision-check'); assert.equal(row.lot.subdivision.lotsHigh, 7);
  // a bad role is refused; another source still needs a phone
  assert.equal((await post({ ...body, subdivision: { ...body.subdivision, role: 'Pirate' } })).status, 400);
  assert.equal((await post({ ...body, source: 'public', email: 'x@example.com' })).status, 400);
});

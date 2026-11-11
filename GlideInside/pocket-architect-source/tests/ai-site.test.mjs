// AI design helper on real lots: context summary, setback check, site tools, suggestions, mock, org credit pools, top-ups
// and the per-organisation spend budgets. Pure modules and the server in memory; no network, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { applyOp, OPS, OpError } from '../src/model/ops.js';
import * as P from '../src/model/placement.js';
import { buildContext, compactContext, siteLines } from '../src/premium/ai/context.js';
import { checkToolCall, siteCallProblem, buildTools, SITE_OP_NAMES } from '../src/premium/ai/tools.js';
import { SYSTEM_PROMPT } from '../src/premium/ai/prompt.js';
import { describeOp } from '../src/premium/ai/summary.js';
import { promptsFor, BASE_PROMPTS } from '../src/premium/ai/suggestions.js';
import { mockReply, createMockApi, MOCK_TOPUP } from '../src/premium/ai/mock.js';
import { normaliseCredits, meterText, resetText, isExhausted, availableCredits, canTopUp, topUpLabel, warningText, exhaustedText, resetDate } from '../src/premium/credits.js';
import * as C from '../server/lib/credits.js';
import { scrubClaims } from '../server/lib/anthropic.js';
import { readConfig } from '../server/lib/config.js';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { issueOrgToken, issueToken } from '../server/lib/entitlement.js';

// A 15 m by 40 m lot, boundary clockwise on screen. Edge 2 (the bottom, y = 40000) is the front, edge 0 the rear.
const BOUNDARY = [{ x: 0, y: 0 }, { x: 15000, y: 0 }, { x: 15000, y: 40000 }, { x: 0, y: 40000 }];
const SETBACKS = { front: 4.5, side: 0.9, rear: 3, secondaryFront: null, garage: 5.5, sources: [{ clause: '3.2', page: 14, quote: 'q', dcp: 'Test DCP' }] };
// Terrain falling 0.225 m per 5 m row toward the south (+y): 1.8 m over the 40 m depth.
const terrain = () => ({ cols: 4, rows: 9, cellMm: 5000, x0: 0, y0: 0, values: Array.from({ length: 36 }, (_, i) => 102 - 0.225 * Math.floor(i / 4)) });

function lotProject({ setbacks = SETBACKS, envelope = null, withTerrain = true, house = { x: 2000, y: 5000, w: 6000, d: 9000 } } = {}) {
  const p = createProject({ id: 'p_site', name: 'Lot test' });
  p.site.lot = {
    source: 'api', address: '12 Smith St, Tamworth', state: 'NSW', srid: 7856, zone: 'R1', origin: { e: 1, n: 2 }, lotLabel: '4', planLabel: 'DP123456',
    areaM2: 600, lga: 'Tamworth Regional', boundary: BOUNDARY, frontEdges: [2], neighbours: [], contours: [], terrain: withTerrain ? terrain() : null,
    floorRL: withTerrain ? 101.2 : null, floorRLAuto: true, setbacks, envelope,
  };
  if (house) applyOp(p, 'add_room', { type: 'living', name: 'Living', x: house.x, y: house.y, width: house.w, depth: house.d, walls: false });
  return p;
}

// Context -------------------------------------------------------------------------------------------------
test('context: a lot adds a short site summary with setbacks and their source, fall, and the current check', () => {
  const p = lotProject();
  const lines = siteLines(p);
  const text = lines.join('\n');
  assert.match(lines[0], /^SITE NSW "12 Smith St, Tamworth" lot 4 DP123456 lga="Tamworth Regional" zone="R1" area=600m2 frontage=15m depth=40m/);
  assert.match(text, /SETBACKS m front=4.5 side=0.9 rear=3 secondary_front=n\/a garage=5.5 source: Test DCP cl 3.2 p14/);
  assert.match(text, /FALL 1.8m across lot, 4.5% falling to the S, RL 100.43..102 floor_rl=101.2\(auto\)/);
  assert.match(text, /LOT_BOUNDARY \(0,0\) \(15000,0\) \(15000,40000\) \(0,40000\) front_edges=2/);
  assert.match(text, /SETBACK_CHECK inside the indicative setback envelope/);
  const full = buildContext(p, { activeLevelId: p.levels[0].id });
  assert.ok(full.text.indexOf('SITE ') < full.text.indexOf('FINISH'), 'site lines come early so truncation keeps them');
  assert.ok(!/compliant/i.test(full.text));
});

test('context: no lot means no site lines; null setbacks are stated as not loaded and no value is printed', () => {
  const none = createProject({ id: 'p_none' });
  assert.deepEqual(siteLines(none), []);
  assert.ok(!/SITE|SETBACK/.test(compactContext(none)));
  const p = lotProject({ setbacks: null, withTerrain: false });
  const text = siteLines(p).join('\n');
  assert.match(text, /SETBACKS not loaded \(council setbacks are not available for this lot; do not state any\)/);
  assert.match(text, /SETBACK_CHECK not possible, setbacks not loaded/);
  assert.ok(!/FALL/.test(text), 'no level data and no floor level, so no FALL line');
  assert.ok(!/front=|rear=/.test(text.replace(/front_edges=\d/, '')));
});

test('context: a breach is reported per boundary in metres, and the site lines survive the token cap', () => {
  const p = lotProject({ house: { x: 2000, y: 30000, w: 6000, d: 9000 } });
  assert.match(siteLines(p).join('\n'), /SETBACK_CHECK breach front boundary 3.50m/);
  const capped = buildContext(p, { activeLevelId: p.levels[0].id, maxTokens: 400 });
  assert.match(capped.text, /SITE NSW/);
});

// Setback check -----------------------------------------------------------------------------------------------
test('setback check, rectangular envelope: inside, and breaches per boundary in metres', () => {
  assert.equal(P.checkSetbacks(lotProject()).status, 'ok');
  // Derived from the setbacks: x 900..14100, y 3000..35500.
  const env = P.envelopeOf(lotProject().site.lot);
  assert.equal(env.source, 'derived');
  const bb = { minX: Math.min(...env.polygon.map((q) => q.x)), maxX: Math.max(...env.polygon.map((q) => q.x)), minY: Math.min(...env.polygon.map((q) => q.y)), maxY: Math.max(...env.polygon.map((q) => q.y)) };
  assert.deepEqual([bb.minX, bb.maxX, bb.minY, bb.maxY].map(Math.round), [900, 14100, 3000, 35500]);
  const low = P.checkSetbacks(lotProject({ house: { x: 2000, y: 30000, w: 6000, d: 9000 } }));
  assert.equal(low.status, 'breach');
  assert.deepEqual(low.breaches.map((b) => [b.label, b.kind, b.breachM, b.requiredM]), [['front boundary', 'front', 3.5, 4.5]]);
  const corner = P.checkSetbacks(lotProject({ house: { x: 0, y: 1000, w: 6000, d: 9000 } }));
  assert.deepEqual(corner.breaches.map((b) => [b.label, b.breachM]).sort(), [['rear boundary', 2], ['side boundary 2', 0.9]].sort());
  assert.match(corner.message, /Outside the indicative setback envelope: /);
  assert.ok(!/compliant/i.test(corner.message));
});

test('setback check, irregular (L shaped) envelope given by the lot', () => {
  const L = [{ x: 1000, y: 1000 }, { x: 14000, y: 1000 }, { x: 14000, y: 20000 }, { x: 8000, y: 20000 }, { x: 8000, y: 34000 }, { x: 1000, y: 34000 }];
  const inside = lotProject({ envelope: L, house: { x: 1500, y: 5000, w: 6000, d: 25000 } });
  assert.equal(P.envelopeOf(inside.site.lot).source, 'lot');
  assert.equal(P.checkSetbacks(inside).status, 'ok');
  // Every house corner but one is inside the L, and the reflex corner (8000, 20000) pokes into the house.
  const notch = P.checkSetbacks(lotProject({ envelope: L, house: { x: 3000, y: 15000, w: 9000, d: 10000 } }));
  assert.equal(notch.status, 'breach');
  assert.equal(notch.breaches[0].breachM, 4);
  // A house entirely inside the wide arm is fine even though its bounding box reaches over the notch.
  assert.equal(P.checkSetbacks(lotProject({ envelope: L, house: { x: 3000, y: 3000, w: 9000, d: 10000 } })).status, 'ok');
});

test('setback check: setbacks not loaded, no lot, no building, never an invented value', () => {
  const p = lotProject({ setbacks: null });
  const r = P.checkSetbacks(p);
  assert.equal(r.status, 'setbacks_not_loaded');
  assert.equal(r.message, 'Council setbacks are not loaded for this lot.');
  assert.equal(P.checkSetbacks(createProject({ id: 'x' })).status, 'no_lot');
  assert.equal(P.checkSetbacks(lotProject({ house: null })).status, 'no_building');
  // An envelope with no setbacks still checks geometry but reports no required values.
  const env = lotProject({ setbacks: null, envelope: [{ x: 1000, y: 1000 }, { x: 14000, y: 1000 }, { x: 14000, y: 34000 }, { x: 1000, y: 34000 }], house: { x: 0, y: 5000, w: 6000, d: 9000 } });
  const e = P.checkSetbacks(env);
  assert.equal(e.status, 'breach');
  assert.equal(e.breaches[0].requiredM, null);
});

test('garage setback to the front boundary is checked only when the lot carries one', () => {
  const p = lotProject();
  applyOp(p, 'add_room', { type: 'garage', name: 'Garage', x: 8000, y: 28000, width: 3000, depth: 6000, walls: false }); // 6000 mm from the front
  assert.equal(P.checkSetbacks(p).status, 'ok', '6 m from the front is past the 5.5 m garage setback');
  p.levels[0].rooms.at(-1).polygon = [{ x: 8000, y: 29000 }, { x: 11000, y: 29000 }, { x: 11000, y: 35000 }, { x: 8000, y: 35000 }];
  const bad = P.checkSetbacks(p);
  assert.deepEqual(bad.breaches.map((b) => [b.kind, b.label, b.breachM, b.requiredM]), [['garage', 'garage to front boundary', 0.5, 5.5]]);
  p.site.lot.setbacks = { ...SETBACKS, garage: null };
  assert.equal(P.checkSetbacks(p).status, 'ok', 'no garage setback loaded, so none is checked');
});

test('suggest a site position, move and rotate the house, fall across the lot', () => {
  const p = lotProject({ house: { x: -4000, y: 30000, w: 6000, d: 9000 } });
  assert.equal(P.checkSetbacks(p).status, 'breach');
  const s = P.suggestPosition(p, 'centre');
  assert.equal(s.fits, true);
  P.translateHouse(p, s.dx, s.dy);
  assert.equal(P.checkSetbacks(p).status, 'ok');
  const front = P.suggestPosition(p, 'front');
  const rear = P.suggestPosition(p, 'rear');
  assert.ok(front.dy > rear.dy, 'front sits further south than rear');
  const big = lotProject({ house: { x: 0, y: 0, w: 14000, d: 9000 } });
  const bigS = P.suggestPosition(big, 'centre');
  assert.equal(bigS.fits, false);
  assert.ok(bigS.residualM > 0);
  const before = structuredClone(p.levels[0].rooms[0].polygon);
  P.rotateHouse(p, 90, P.houseCentre(p));
  const bb = (poly) => ({ w: Math.max(...poly.map((q) => q.x)) - Math.min(...poly.map((q) => q.x)), h: Math.max(...poly.map((q) => q.y)) - Math.min(...poly.map((q) => q.y)) });
  assert.deepEqual([bb(p.levels[0].rooms[0].polygon).w, bb(p.levels[0].rooms[0].polygon).h], [bb(before).h, bb(before).w]);
  const fall = P.fallAcross(lotProject());
  assert.equal(fall.fallM, 1.8);
  assert.equal(fall.slopePct, 4.5);
  assert.equal(fall.direction, 'S');
  assert.equal(P.fallAcross(lotProject({ withTerrain: false })), null);
  // Contours alone are enough: flat arrays of x, y pairs with a level.
  const c = lotProject({ withTerrain: false });
  c.site.lot.contours = [{ level: 102, pts: [0, 0, 15000, 0] }, { level: 100.2, pts: [0, 40000, 15000, 40000] }, { level: 101.1, pts: [0, 20000, 15000, 20000] }];
  assert.equal(P.fallAcross(c).fallM, 1.8);
  const north = lotProject();
  north.site.northDeg = 180;
  assert.equal(P.fallAcross(north).direction, 'N', 'with north pointing down the screen, down the screen is north');
});

// Tools -------------------------------------------------------------------------------------------------------
test('site tools are in the registry and checked strictly', () => {
  for (const n of SITE_OP_NAMES) assert.ok(OPS[n], n);
  const tools = buildTools(null);
  assert.deepEqual(tools.map((t) => t.name), Object.keys(OPS));
  assert.deepEqual(checkToolCall('move_house', { dx: '1500', dy: -2000, junk: 1 }, tools), { ok: true, args: { dx: 1500, dy: -2000 } });
  assert.match(checkToolCall('move_house', { dx: 1e9, dy: 0 }, tools).error, /between/);
  assert.match(checkToolCall('move_house', { dx: 100 }, tools).error, /dy is required/);
  assert.match(checkToolCall('rotate_house', { degrees: 400 }, tools).error, /between -360 and 360/);
  assert.match(checkToolCall('rotate_house', { degrees: 'ninety' }, tools).error, /wrong type|between/);
  assert.match(checkToolCall('set_floor_level', { rl: 5000 }, tools).error, /between/);
  assert.match(checkToolCall('suggest_site_position', { align: 'sideways' }, tools).error, /listed options/);
  assert.equal(checkToolCall('suggest_site_position', { align: 'front', apply: true }, tools).ok, true);
  assert.equal(checkToolCall('check_setbacks', {}, tools).ok, true);
  assert.equal(checkToolCall('shift_house', { dx: 1, dy: 1 }, tools).ok, false);
});

test('site tools refuse without a lot, never invent setbacks, and keep floor levels sane', () => {
  const none = createProject({ id: 'n' });
  applyOp(none, 'add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 4000 });
  for (const [op, args] of [['move_house', { dx: 100, dy: 0 }], ['rotate_house', { degrees: 10 }], ['set_floor_level', { rl: 10 }], ['suggest_site_position', {}]]) {
    assert.throws(() => applyOp(none, op, args), OpError, op);
    assert.match(siteCallProblem(op, none), /No lot is loaded/);
  }
  assert.equal(siteCallProblem('set_finish', none), null);
  const nosb = lotProject({ setbacks: null });
  assert.equal(siteCallProblem('check_setbacks', nosb), 'Council setbacks are not loaded for this lot.');
  assert.throws(() => applyOp(nosb, 'suggest_site_position', {}), /not loaded/);
  assert.equal(applyOp(nosb, 'check_setbacks', {}).report, 'Council setbacks are not loaded for this lot.');
  // Moving still works without setbacks (the lot is there), but a check does not pretend.
  applyOp(nosb, 'move_house', { dx: 1000, dy: 0 });
  const p = lotProject();
  assert.throws(() => applyOp(p, 'set_floor_level', { rl: 140 }), /more than 5 m/);
  applyOp(p, 'set_floor_level', { rl: 101.35 });
  assert.equal(p.site.lot.floorRL, 101.35);
  assert.equal(p.site.lot.floorRLAuto, false);
  const r = applyOp(p, 'check_setbacks', {});
  assert.equal(r.changed, false);
  assert.equal(r.status, 'ok');
  const moved = applyOp(lotProject({ house: { x: -4000, y: 30000, w: 6000, d: 9000 } }), 'suggest_site_position', {});
  assert.equal(moved.changed, false, 'without apply it only reports');
  assert.equal(moved.fits, true);
});

test('site tools run as one undo step through the store, and describe themselves', () => {
  const store = createStore(lotProject({ house: { x: -4000, y: 30000, w: 6000, d: 9000 } }), {});
  const results = store.runBatch('AI: Moved the house', [{ op: 'suggest_site_position', args: { apply: true } }, { op: 'check_setbacks', args: {} }]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal(results[1].result.status, 'ok');
  assert.equal(P.checkSetbacks(store.project).status, 'ok');
  store.undo();
  assert.equal(P.checkSetbacks(store.project).status, 'breach');
  for (const op of SITE_OP_NAMES) assert.ok(describeOp(op, { dx: 2500, dy: -1000, degrees: 90, rl: 101.2 }, store.project).length > 8, op);
  assert.equal(describeOp('move_house', { dx: 2500, dy: -1000 }, store.project), 'Moved the house 2.5 m east and 1.0 m north');
});

test('system prompt: site rules, no invented setbacks, never the word compliant', () => {
  assert.match(SYSTEM_PROMPT, /Never invent or recall a setback/);
  assert.match(SYSTEM_PROMPT, /council setbacks are not loaded for this lot/);
  assert.match(SYSTEM_PROMPT, /inside the indicative setback envelope/);
  assert.ok(!/compliant/i.test(SYSTEM_PROMPT));
  assert.ok(!/[–—]/.test(SYSTEM_PROMPT));
  assert.equal(scrubClaims('The house is fully compliant with the front setback. Great.'), 'The house is inside the indicative setback envelope. Great.');
  assert.ok(!/compliant|complies/i.test(scrubClaims('It is compliant, and complies with cl 3.')));
});

// Suggestions and mock ----------------------------------------------------------------------------------------
test('prompt chips follow the design: site chips with a lot, a note when setbacks are not loaded', () => {
  assert.deepEqual(promptsFor(createProject({ id: 'a' })), { prompts: BASE_PROMPTS, note: null });
  const full = promptsFor(lotProject());
  assert.ok(full.prompts.includes('Fit this house inside the setbacks'));
  assert.ok(full.prompts.includes('Move the garage to the front setback'));
  assert.ok(full.prompts.includes('How much fall is on this lot?'));
  assert.equal(full.note, null);
  const bare = promptsFor(lotProject({ setbacks: null, withTerrain: false }));
  assert.ok(!bare.prompts.some((t) => /setback/i.test(t)));
  assert.match(bare.note, /Council setbacks are not loaded for this lot/);
});

test('mock replies carry valid operations that the registry applies, and say so when the lot lacks data', () => {
  const p = lotProject({ house: { x: -4000, y: 30000, w: 6000, d: 9000 } });
  const fit = mockReply('Fit this house inside the setbacks', p);
  assert.deepEqual(fit.ops.map((o) => o.op), ['suggest_site_position', 'check_setbacks']);
  for (const o of fit.ops) assert.equal(checkToolCall(o.op, o.args).ok, true);
  const store = createStore(p, {});
  assert.deepEqual(store.runBatch('mock', fit.ops).map((r) => r.ok), [true, true]);
  assert.equal(P.checkSetbacks(store.project).status, 'ok');
  assert.match(mockReply('How much fall is on this lot?', lotProject()).reply, /1.8 m of fall across the lot \(4.5%\), falling to the S/);
  assert.equal(mockReply('Move the garage to the front setback', lotProject()).ops[0].args.align, 'front');
  assert.deepEqual(mockReply('Fit this house inside the setbacks', lotProject({ setbacks: null })).ops, []);
  assert.match(mockReply('Fit this house inside the setbacks', lotProject({ setbacks: null })).reply, /^Council setbacks are not loaded for this lot\./);
  assert.match(mockReply('fit it', createProject({ id: 'n' })).reply, /No lot is loaded/);
  assert.equal(mockReply('Set the floor level to suit the ground', lotProject()).ops[0].op, 'set_floor_level');
  assert.equal(mockReply('Change the roof colour to charcoal', createProject({ id: 'n' })).ops[0].op, 'set_finish');
  for (const text of ['fit', 'check', 'fall', 'rotate', 'roof colour', 'what']) assert.ok(!/compliant/i.test(mockReply(text, lotProject()).reply));
});

test('mock api: monthly credits, warnings, hard stop, then a top-up that carries over and is recorded for billing', async () => {
  const project = lotProject();
  const api = createMockApi({ getProject: () => project, session: { kind: 'client', credits: { total: 6, used: 0, monthResetsOn: '2026-12-01' } }, cost: 2, delayMs: 0 });
  const r1 = await api.edit('t', { message: 'fall' });
  assert.equal(r1.credits.remaining, 4);
  assert.equal(r1.credits.monthResetsOn, '2026-12-01');
  assert.equal(r1.warning, null);
  const r2 = await api.edit('t', { message: 'fall' });
  assert.equal(r2.warning.level, 0.5);
  const r3 = await api.edit('t', { message: 'fall' });
  assert.equal(r3.credits.remaining, 0);
  assert.equal(r3.warning.level, 0.95);
  await assert.rejects(api.edit('t', { message: 'fall' }), (e) => e.code === 'CREDITS_EXHAUSTED' && e.details.topUp.credits === 300 && e.details.monthResetsOn === '2026-12-01');
  const top = await api.topUp('t');
  assert.equal(top.credits.topUpRemaining, 300);
  assert.deepEqual(api.events.map((e) => [e.credits, e.amountCents]), [[300, 1000]]);
  const r4 = await api.edit('t', { message: 'fall' });
  assert.equal(r4.credits.topUpRemaining, 298);
  assert.equal(r4.credits.remaining, 0, 'monthly credits are spent first, then top-up');
  // Builder can switch client top-ups off; a client then cannot top up, and a public session cannot at all.
  const client = createMockApi({ getProject: () => project, session: { kind: 'client' }, delayMs: 0 });
  client.state.clientTopUps = false;
  await assert.rejects(client.topUp('t'), (e) => e.code === 'TOPUP_DISABLED');
  await assert.rejects(createMockApi({ getProject: () => project, delayMs: 0 }).topUp('t'), (e) => e.code === 'NOT_ENTITLED');
  const builder = createMockApi({ getProject: () => project, session: { kind: 'builder' }, delayMs: 0 });
  assert.deepEqual(await builder.setClientTopUps('t', false), { clientTopUps: false });
  await assert.rejects(client.setClientTopUps('t', true), (e) => e.code === 'NOT_ENTITLED');
});

// Client credit helpers ---------------------------------------------------------------------------------------
test('client credits: monthly meter, reset date, top-up offer and wording', () => {
  const c = normaliseCredits({ total: 300, used: 240, remaining: 60, warnLevel: 0.8, kind: 'org', monthResetsOn: '2026-12-01', topUpRemaining: 120, topUp: { allowed: true, credits: 300, amountCents: 1000 } });
  assert.equal(meterText(c), '60 of 300 monthly credits left plus 120 top-up');
  assert.equal(resetText(c), 'Monthly credits reset on 01/12/2026.');
  assert.equal(resetDate('2026-12-01'), '01/12/2026');
  assert.equal(availableCredits(c), 180);
  assert.equal(canTopUp(c), true);
  assert.equal(topUpLabel(c, 'client'), "Top up 300 credits, A$10 on your builder's monthly invoice");
  assert.equal(topUpLabel(c, 'builder'), 'Top up 300 credits, A$10 on your monthly invoice');
  assert.equal(isExhausted({ ...c, remaining: 0, topUpRemaining: 0 }), true);
  assert.equal(isExhausted({ ...c, remaining: 0 }), false, 'top-up credits keep the assistant working');
  assert.equal(canTopUp({ ...c, topUp: { ...c.topUp, allowed: false } }), false);
  assert.match(warningText({ level: 0.8, usedPercent: 80, remaining: 60 }, c), /80% of this month's AI credits. 60 credits left. They reset on 01\/12\/2026./);
  assert.match(warningText({ level: 0.95, usedPercent: 96, remaining: 12 }, c), /Only 12 credits left this month/);
  assert.match(exhaustedText({ ...c, remaining: 0 }), /read-only until the credits reset on 01\/12\/2026/);
  // Public Plan Pack wording and meter are unchanged.
  const pub = normaliseCredits({ total: 500, used: 188, remaining: 312 });
  assert.equal(meterText(pub), '312 of 500 credits left');
  assert.equal(resetText(pub), '');
  assert.equal(canTopUp(pub), false);
  assert.match(warningText({ level: 0.8, usedPercent: 80, remaining: 100 }, pub), /Plan Pack/);
  for (const t of [warningText({ level: 0.5, remaining: 5 }, c), exhaustedText(c), topUpLabel(c)]) assert.ok(!/compliant/i.test(t));
});

// Server arithmetic ------------------------------------------------------------------------------------------
test('monthly cap arithmetic: Sydney calendar months, spend order, charge split', () => {
  // 30/11/2026 23:59 in Sydney (AEDT, UTC+11) is still November; one minute later is December.
  const nov = C.sydneyMonth(Date.UTC(2026, 10, 30, 12, 59));
  assert.deepEqual([nov.key, nov.resetsOn, nov.resetsAtMs], ['2026-11', '2026-12-01', Date.UTC(2026, 10, 30, 13, 0)]);
  assert.equal(C.sydneyMonth(Date.UTC(2026, 10, 30, 13, 0)).key, '2026-12');
  // June in AEST (UTC+10): the month ends at 14:00 UTC on the 30th.
  const jun = C.sydneyMonth(Date.UTC(2026, 5, 15, 0, 0));
  assert.deepEqual([jun.key, jun.resetsOn, jun.resetsAtMs], ['2026-06', '2026-07-01', Date.UTC(2026, 5, 30, 14, 0)]);
  assert.equal(C.sydneyMonth(Date.UTC(2026, 11, 31, 12, 0)).resetsOn, '2027-01-01');
  assert.equal(C.sydneyMonth(Date.UTC(2026, 11, 31, 12, 0)).key, '2026-12');
  assert.deepEqual(C.orgPoolIds('o1', 'l9', '2026-11'), { monthlyId: 'org:o1:l9:2026-11', topUpId: 'orgtop:o1:l9' });
  assert.deepEqual(C.planSpend(5, 300, 3), { fromMonthly: 3, fromTopUp: 0 });
  assert.deepEqual(C.planSpend(2, 300, 5), { fromMonthly: 2, fromTopUp: 3 });
  assert.deepEqual(C.planSpend(0, 300, 5), { fromMonthly: 0, fromTopUp: 5 });
  assert.equal(C.planSpend(1, 2, 4), null);
  assert.deepEqual(C.splitCharge(1, 2, 3), { monthly: 1, topUp: 0 });
  assert.deepEqual(C.splitCharge(4, 2, 3), { monthly: 2, topUp: 2 });
  const b = C.orgBalance({ creditsTotal: 300, creditsUsed: 290, creditsReserved: 4 }, { creditsTotal: 300, creditsUsed: 10, creditsReserved: 0 });
  assert.deepEqual(b, { total: 300, used: 290, reserved: 4, remaining: 6, topUpRemaining: 290, available: 296 });
  const cfg = readConfig({});
  assert.deepEqual([cfg.topUpCredits, cfg.topUpCents, cfg.orgMonthlyCredits, cfg.orgDailyCapUsd, cfg.orgMonthlyCapUsd, cfg.publicReserveShare], [300, 1000, 300, 1, 10, 0.3]);
  assert.deepEqual(C.orgPoolCaps(cfg), { dailyUsd: 5 * 0.7, monthlyUsd: 50 * 0.7 });
  assert.equal(C.clientTopUpsEnabled([], 'o1'), true);
  assert.equal(C.clientTopUpsEnabled([{ createdAt: '2026-11-01T00:00:00Z', detail: { orgId: 'o1', enabled: false } }, { createdAt: '2026-11-02T00:00:00Z', detail: { orgId: 'o2', enabled: true } }], 'o1'), false);
  assert.equal(C.orgBudget(readConfig({ ORG_BUDGETS: '{"o1":{"dailyUsd":0.5}}' }), 'o1').dailyUsd, 0.5);
  assert.equal(C.orgBudget(readConfig({ ORG_BUDGETS: '{"o1":{"dailyUsd":0.5}}' }), 'o1').monthlyUsd, 10);
  assert.equal(C.orgBudget(readConfig({ ORG_BUDGETS: 'not json' }), 'o1').dailyUsd, 1);
});

// Server: org pools, top-ups, budgets -------------------------------------------------------------------------
const T0 = Date.UTC(2026, 10, 14, 3, 0, 0); // 14/11/2026 14:00 Sydney
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const USAGE = { input_tokens: 5200, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 5800 }; // 668 micro-USD, 1 credit

function world(env = {}) {
  const clock = { t: T0 };
  const store = createMemoryStore();
  const fetchImpl = async (url) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', usage: USAGE, content: [{ type: 'text', text: 'The house is fully compliant with the setbacks.' }] });
  };
  const app = createApp({ store, env: { SITE_URL: 'https://site.test', PORTAL_ENABLED: '1', ENTITLEMENT_SECRET: 'secret', ANTHROPIC_API_KEY: 'k', ...env }, fetchImpl, now: () => clock.t });
  const w = { clock, store, app, config: app.config };
  w.call = async (method, path, { token, body } = {}) => {
    const headers = token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {};
    const res = await app.fetch(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, json: await res.clone().json().catch(() => null) };
  };
  w.token = (orgId, loginId, role, cap) => issueOrgToken({ orgId, loginId, role, cap }, w.config, clock.t);
  w.edit = (token) => (w.clock.t += 11000, w.call('POST', '/api/ai/edit', { token, body: { message: 'fit it', context: 'PROJECT "T" type=house units=mm\nLEVEL l_1 "Ground" active', history: [], activeLevelId: 'l_1' } }));
  w.pack = async (id = 'p_pub') => {
    const { entitlement } = await store.createEntitlement({ id: `ent_${id}`, projectId: id, stripeSessionId: `cs_${id}`, creditsTotal: 500, status: 'active', createdAt: new Date(clock.t).toISOString(), expiresAt: new Date(clock.t + 86400000 * 300).toISOString() });
    return issueToken(entitlement, w.config, clock.t);
  };
  return w;
}

test('org login: monthly pool, hard stop with the top-up offer, top-up carries over, billable event recorded', async () => {
  const w = world({ ORG_MONTHLY_CREDITS: '6' });
  const tok = await w.token('org1', 'client1', 'client');
  const first = await w.edit(tok);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.credits.kind, 'org');
  assert.deepEqual([first.json.credits.total, first.json.credits.used, first.json.credits.remaining, first.json.credits.monthResetsOn], [6, 1, 5, '2026-12-01']);
  assert.ok(!/compliant/i.test(first.json.reply), 'a claim of compliance is rewritten');
  assert.match(first.json.reply, /inside the indicative setback envelope/);
  assert.equal(first.json.warning, null);
  // Keep going until the hard stop: the monthly credits stop a request that could not be covered.
  let last = first;
  let warned = [];
  for (let i = 0; i < 12; i++) {
    const r = await w.edit(tok);
    if (r.status !== 200) {
      last = r;
      break;
    }
    if (r.json.warning) warned.push(r.json.warning.level);
  }
  assert.deepEqual(warned, [0.5, 0.8, 0.95].filter((l) => warned.includes(l)), 'warnings come once each at the existing thresholds');
  assert.ok(warned.includes(0.5));
  assert.equal(last.status, 402);
  assert.equal(last.json.error.code, 'CREDITS_EXHAUSTED');
  assert.deepEqual([last.json.error.topUp.allowed, last.json.error.topUp.credits, last.json.error.topUp.amountCents, last.json.error.monthResetsOn], [true, 300, 1000, '2026-12-01']);
  const leftover = (await w.call('GET', '/api/credits', { token: tok })).json;
  assert.equal(leftover.available, leftover.remaining);

  const upAt = w.clock.t;
  const up = await w.call('POST', '/api/ai/topup', { token: tok, body: {} });
  assert.equal(up.status, 200);
  assert.equal(up.json.credits.topUpRemaining, 300);
  const events = await w.store.listEvents('ai_topup');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { orgId: 'org1', loginId: 'client1', credits: 300, amountCents: 1000, currency: 'aud', gstInclusive: true, createdAt: new Date(upAt).toISOString(), role: 'client' });
  const after = await w.edit(tok);
  assert.equal(after.status, 200);
  assert.equal(after.json.credits.topUpRemaining, 300, 'what is left of the monthly credits is spent first');
  assert.equal(after.json.credits.remaining, leftover.remaining - 1);

  // Next calendar month in Sydney: the monthly pool is fresh, the top-up balance carries over.
  w.clock.t = Date.UTC(2026, 10, 30, 13, 0, 1);
  const credits = (await w.call('GET', '/api/credits', { token: await w.token('org1', 'client1', 'client') })).json;
  assert.deepEqual([credits.remaining, credits.used, credits.topUpRemaining, credits.monthResetsOn], [6, 0, 300, '2027-01-01']);
  // Another login in the same org has its own pool.
  const other = await w.token('org1', 'client2', 'client');
  assert.equal((await w.call('GET', '/api/credits', { token: other })).json.topUpRemaining, 0);
});

test('org login: monthly credits are spent before top-up credits, and a request can straddle both', async () => {
  const w = world({ ORG_MONTHLY_CREDITS: '1' });
  const tok = await w.token('o', 'l', 'builder');
  await w.call('POST', '/api/ai/topup', { token: tok, body: {} });
  const a = await w.edit(tok);
  assert.deepEqual([a.json.credits.remaining, a.json.credits.topUpRemaining], [0, 300]);
  const b = await w.edit(tok);
  assert.deepEqual([b.json.credits.remaining, b.json.credits.topUpRemaining], [0, 299]);
  assert.equal((await w.store.listEvents('ai_topup')).length, 1);
});

test('builder can turn client top-ups off for the organisation; default is on', async () => {
  const w = world({ ORG_MONTHLY_CREDITS: '1' });
  const builder = await w.token('o', 'b', 'builder');
  const client = await w.token('o', 'c', 'client');
  const otherOrgClient = await w.token('o2', 'c', 'client');
  assert.equal((await w.call('POST', '/api/ai/topup', { token: client, body: {} })).status, 200, 'on by default');
  assert.equal((await w.call('POST', '/api/ai/topup-setting', { token: client, body: { enabled: false } })).status, 403, 'a client cannot change it');
  assert.equal((await w.call('POST', '/api/ai/topup-setting', { token: builder, body: { enabled: 'no' } })).status, 400);
  assert.equal((await w.call('POST', '/api/ai/topup-setting', { token: builder, body: { enabled: false } })).json.clientTopUps, false);
  const off = await w.call('POST', '/api/ai/topup', { token: client, body: {} });
  assert.equal(off.status, 403);
  assert.equal(off.json.error.code, 'TOPUP_DISABLED');
  assert.equal((await w.call('GET', '/api/credits', { token: client })).json.topUp.allowed, false);
  assert.equal((await w.call('POST', '/api/ai/topup', { token: builder, body: {} })).status, 200, 'the builder can still top up');
  assert.equal((await w.call('POST', '/api/ai/topup', { token: otherOrgClient, body: {} })).status, 200, 'other organisations are unaffected');
  w.clock.t += 1000;
  assert.equal((await w.call('POST', '/api/ai/topup-setting', { token: builder, body: { enabled: true } })).json.clientTopUps, true);
  assert.equal((await w.call('POST', '/api/ai/topup', { token: client, body: {} })).status, 200);
  assert.equal((await w.call('POST', '/api/ai/topup', { token: null, body: {} })).status, 403);
  const exhausted = await (async () => {
    const x = world({ ORG_MONTHLY_CREDITS: '1' });
    const b2 = await x.token('o', 'b', 'builder');
    const c2 = await x.token('o', 'c', 'client');
    await x.call('POST', '/api/ai/topup-setting', { token: b2, body: { enabled: false } });
    await x.edit(c2);
    return x.edit(c2);
  })();
  assert.equal(exhausted.json.error.code, 'CREDITS_EXHAUSTED');
  assert.equal(exhausted.json.error.topUp.allowed, false, 'the hard stop offers no top-up when the builder turned it off');
});

test('per-organisation spend budgets stop one org before the global cap, and public buyers keep a reserved share', async () => {
  // Global US$0.002 a day with half reserved for the public: all organisations together may spend US$0.001 (1000 micro).
  const w = world({ AI_DAILY_CAP_USD: '0.002', PUBLIC_RESERVE_SHARE: '0.5', ORG_DAILY_CAP_USD: '0.0007', ORG_BUDGETS: '{"big":{"dailyUsd":0.01}}' });
  const a = await w.token('a', 'l1', 'client');
  assert.equal((await w.edit(a)).status, 200); // 668 micro
  const aStop = await w.edit(a); // 668 < 700 so one more is allowed, then the org is over
  assert.equal(aStop.status, 200);
  const aOver = await w.edit(a);
  assert.equal(aOver.status, 503);
  assert.equal(aOver.json.error.code, 'AI_PAUSED');
  assert.match(aOver.json.error.message, /organisation has reached its AI daily budget/);
  assert.equal((await w.store.listEvents('org_budget')).length, 1);
  // Org A is paused, but org B and the public are not.
  assert.equal((await w.call('GET', '/api/health')).json.aiPaused, false);
  const pub = await w.pack();
  const b = await w.token('b', 'l1', 'client');
  // Orgs together have used 1336 micro, over their combined 1000 micro share, so org B is stopped too.
  const bStop = await w.edit(b);
  assert.equal(bStop.status, 503);
  assert.equal(bStop.json.error.code, 'AI_PAUSED');
  assert.doesNotMatch(bStop.json.error.message, /organisation has reached/);
  const ok = await w.edit(pub);
  assert.equal(ok.status, 200, 'the public Plan Pack still works inside the reserved share');
  assert.equal(ok.json.credits.remaining, 499);
  // The public can still use the rest of the global cap (2000 micro): 1336 + 668 = 2004 reaches it, then global pause.
  assert.equal((await w.edit(pub)).status, 503);
  // An org with its own larger budget is limited only by the combined org share and global caps.
  const big = world({ ORG_BUDGETS: '{"big":{"dailyUsd":0.01}}', ORG_DAILY_CAP_USD: '0.0007' });
  const bt = await big.token('big', 'l', 'builder');
  for (let i = 0; i < 3; i++) assert.equal((await big.edit(bt)).status, 200);
});

test('Plan Pack tokens and org tokens do not mix, and the Plan Pack flow is unchanged', async () => {
  const w = world();
  const pub = await w.pack();
  const org = await w.token('o', 'l', 'client');
  const r = await w.edit(pub);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.credits).sort(), ['charged', 'remaining', 'total', 'used', 'warnLevel'], 'the Plan Pack reply keeps its shape');
  assert.equal((await w.call('POST', '/api/ai/topup', { token: pub, body: {} })).status, 403, 'a Plan Pack cannot top up');
  assert.equal((await w.call('POST', '/api/export/dxf', { token: org, body: { project: {} } })).status, 403, 'an org token is not a Plan Pack for exports');
  const credits = (await w.call('GET', '/api/credits?project=p_pub', { token: pub })).json;
  assert.deepEqual([credits.total, credits.used, credits.remaining], [500, 1, 499]);
});

// Check with council flags and the portal switch ----------------------------------------------------------------------
test('setbacks flagged check with council are still used, named with their source in context, check results and the prompt', () => {
  const p = lotProject({ house: { x: 2000, y: 30000, w: 6000, d: 9000 } });
  p.site.lot.setbacks = {
    ...SETBACKS,
    checkWithCouncil: ['front'],
    sources: [{ rule: 'front', dcp: 'Tamworth DCP 2010', clause: '4.1', page: 22 }, { rule: 'side', kind: 'codes_sepp', dcp: 'Codes SEPP' }, { rule: 'rear', kind: 'qdc' }],
  };
  const notes = P.setbackNotes(p.site.lot);
  assert.deepEqual(notes.map((n) => [n.rule, n.flagged, n.source]), [['front', true, 'Tamworth DCP 2010 cl 4.1 p22'], ['side', false, 'Codes SEPP Housing Code'], ['rear', false, 'QDC default'], ['garage', false, null]]);
  const text = siteLines(p).join('\n');
  assert.match(text, /SETBACKS_CHECK_WITH_COUNCIL front\(Tamworth DCP 2010 cl 4.1 p22\) \(still used/);
  assert.match(text, /source: front=Tamworth DCP 2010 cl 4.1 p22; side=Codes SEPP Housing Code; rear=QDC default/);
  const r = P.checkSetbacks(p);
  assert.equal(r.status, 'breach', 'a flagged rule is still applied');
  assert.deepEqual([r.breaches[0].flagged, r.breaches[0].source], [true, 'Tamworth DCP 2010 cl 4.1 p22']);
  assert.match(r.message, /Flagged check with council: front \(Tamworth DCP 2010 cl 4.1 p22\)\. They are still used\./);
  // Other ways the review flag can arrive: a flag on the source, low confidence, needsReview.
  for (const flag of [{ needsReview: true }, { confidence: 'low' }, { checkWithCouncil: true }]) {
    p.site.lot.setbacks = { ...SETBACKS, checkWithCouncil: undefined, sources: [{ rule: 'rear', dcp: 'X DCP', clause: '2', ...flag }] };
    assert.deepEqual(P.setbackNotes(p.site.lot).filter((n) => n.flagged).map((n) => n.rule), ['rear']);
  }
  p.site.lot.setbacks = SETBACKS;
  assert.equal(P.flaggedSentence(p.site.lot), '');
  assert.match(SYSTEM_PROMPT, /SETBACKS_CHECK_WITH_COUNCIL as "check with council" and give its source \(council DCP clause, Codes SEPP Housing Code or QDC default\)/);
  assert.ok(SYSTEM_PROMPT.length / 3.5 < 800);
});

test('builder and client AI sit behind portalEnabled on the client and the server', async () => {
  const { CONFIG } = await import('../src/config.js');
  assert.equal(CONFIG.portalEnabled, false);
  assert.equal(readConfig({}).portalEnabled, false);
  assert.equal(readConfig({ PORTAL_ENABLED: '1' }).portalEnabled, true);
  const w = world({ PORTAL_ENABLED: '0' });
  const tok = await w.token('o', 'l', 'client');
  for (const [m, path] of [['POST', '/api/ai/edit'], ['GET', '/api/credits'], ['POST', '/api/ai/topup']]) {
    const r = await w.call(m, path, { token: tok, body: m === 'POST' ? { message: 'x', context: 'c' } : undefined });
    assert.equal(r.status, 403, path);
    assert.match(r.json.error.message, /not switched on yet/);
  }
  const pub = await w.pack();
  assert.equal((await w.edit(pub)).status, 200, 'public Plan Pack users are unaffected');
});

// Final review additions (11/11/2026) ------------------------------------------------------------------------------------
test('a request that costs more than its estimate is charged in full, as a Plan Pack is', () => {
  assert.deepEqual(C.splitCharge(5, 3, 0), { monthly: 5, topUp: 0 });
  assert.deepEqual(C.splitCharge(9, 2, 3), { monthly: 2, topUp: 7 });
  assert.deepEqual(C.splitCharge(0, 2, 3), { monthly: 0, topUp: 0 });
});

test('placement reads the setback stage output: { minM } slots, edgeKinds, per rule flags and the fallback basis', () => {
  const slot = (minM, extra = {}) => ({ minM, calc: 'fixed', clause: 'cl 3D.21(1)-(3) primary road', page: null, dcp: 'Codes SEPP 2008, Part 3D Inland Code', edition: 'as retrieved 11/11/2026', flag: null, ...extra });
  const picked = {
    basis: 'Codes SEPP Inland Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)',
    front: slot(4.5, { flag: 'check_with_council', flagReason: 'currency not verified' }), side: slot(0.9), rear: slot(3), secondaryFront: null, garage: null,
    flag: 'check_with_council', edgeKinds: ['rear', 'side', 'front', 'side'],
  };
  const p = lotProject({ setbacks: picked });
  const lot = p.site.lot;
  assert.equal(P.requiredFor('front', lot.setbacks), 4.5);
  assert.equal(P.requiredFor('side', lot.setbacks), 0.9);
  const notes = P.setbackNotes(lot);
  assert.deepEqual(notes.map((n) => [n.rule, n.valueM, n.flagged]), [['front', 4.5, true], ['side', 0.9, false], ['rear', 3, false]]);
  assert.match(notes[0].source, /^Codes SEPP Inland Code cl 3D\.21/);
  assert.doesNotMatch(notes[0].source, /cl cl/);
  assert.deepEqual(P.classifyEdges(lot).map((e) => e.kind), picked.edgeKinds);
  const env = P.envelopeOf(lot);
  assert.equal(env.source, 'derived');
  assert.deepEqual(env.missing, []);
});

test('corner lot without edgeKinds: the shortest street edge is the primary frontage', () => {
  const p = lotProject({});
  const lot = p.site.lot;
  const lens = lot.boundary.map((a, i) => Math.hypot(lot.boundary[(i + 1) % lot.boundary.length].x - a.x, lot.boundary[(i + 1) % lot.boundary.length].y - a.y));
  const long = lens.indexOf(Math.max(...lens));
  const short = lens.indexOf(Math.min(...lens));
  lot.frontEdges = [long, short];
  const kinds = P.classifyEdges(lot).map((e) => e.kind);
  assert.equal(kinds[short], 'front');
  assert.equal(kinds[long], 'secondaryFront');
});

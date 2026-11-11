// Lot checks (breach messages and walls), "fit this house" honesty, placement size check, plain setback words, mock credits.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { lotChecks, edgeCompass, plainSetbackReason, setbackUnavailableText } from '../src/site/lot-checks.js';
import { fitHouse } from '../src/site/fit-house.js';
import { fitsLot } from '../src/portal/place-house.js';
import { createMockApi, mockReply } from '../src/premium/ai/mock.js';
import { streetTreeSpots, houseSpec } from '../src/site/neighbours.js';

const BOUNDARY = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 40000 }, { x: 0, y: 40000 }];
const SETBACKS = { front: { minM: 4.5 }, side: { minM: 0.9 }, rear: { minM: 3 }, secondaryFront: null, garage: null };

function lotProject({ house, setbacks = SETBACKS } = {}) {
  const p = createProject({ id: 'p_polish', name: 'Polish' });
  p.site.lot = {
    source: 'api', address: '1 Test St', state: 'NSW', zone: 56, origin: { e: 1, n: 2 }, lotLabel: '4', planLabel: 'DP1', areaM2: 800, lga: 'Tamworth',
    boundary: BOUNDARY, frontEdges: [2], neighbours: [], contours: [], terrain: null, floorRL: null, floorRLAuto: true, setbacks, envelope: null,
  };
  if (house) applyOp(p, 'add_room', { type: 'living', name: 'Living', x: house.x, y: house.y, width: house.w, depth: house.d, walls: true });
  return p;
}

test('edgeCompass names the side the edge faces, plan up is north', () => {
  const p = lotProject();
  const lot = p.site.lot;
  assert.equal(edgeCompass(lot, 0), 'north');
  assert.equal(edgeCompass(lot, 1), 'east');
  assert.equal(edgeCompass(lot, 2), 'south');
  assert.equal(edgeCompass(lot, 3), 'west');
});

test('lotChecks: inside gives no messages; setback breach is worded "check with council" and never "compliant"', () => {
  const ok = lotChecks(lotProject({ house: { x: 4000, y: 10000, w: 10000, d: 12000 } }));
  assert.equal(ok.messages.length, 0);
  assert.equal(ok.breachWallIds.size, 0);
  const bad = lotChecks(lotProject({ house: { x: 4000, y: 10000, w: 10000, d: 28500 } })); // 1.5 m from the south boundary, needs 4.5
  assert.equal(bad.crossesBoundary, false);
  const m = bad.messages.find((x) => x.kind === 'envelope');
  assert.ok(m, 'an envelope message');
  assert.match(m.text, /^Outside the indicative setback envelope by \d+\.\d\d m at the south boundary, check with council\.$/);
  assert.ok(!/compliant/i.test(m.text));
  assert.ok(bad.breachWallIds.size >= 1, 'the walls nearest the south boundary are flagged');
});

test('lotChecks: a house over the lot boundary says so and flags its walls', () => {
  const c = lotChecks(lotProject({ house: { x: 12000, y: 10000, w: 10000, d: 10000 } }));
  assert.equal(c.crossesBoundary, true);
  assert.match(c.messages[0].text, /^House crosses the lot boundary/);
  assert.ok(c.breachWallIds.size >= 1);
});

test('fitsLot compares footprint with the lot either way round: 15 x 16 m fits on 20 x 40 m, 22 x 30 m does not', () => {
  const house = (w, d) => { const p = createProject({ id: 'h' }); applyOp(p, 'add_room', { type: 'living', name: 'L', x: 0, y: 0, width: w, depth: d, walls: true }); return p; };
  const lot = { widthMm: 20000, depthMm: 40000 };
  assert.equal(fitsLot(house(15000, 16000), { x: 0, y: 0, rotation: 0 }, lot), true);
  assert.equal(fitsLot(house(15000, 16000), { x: 0, y: 0, rotation: 90 }, lot), true);
  assert.equal(fitsLot(house(22000, 30000), { x: 0, y: 0, rotation: 0 }, lot), false);
});

test('fitHouse: a house that fits is moved; one that cannot fit gets one honest message with the shortfall per side', () => {
  const fits = fitHouse(lotProject({ house: { x: 4000, y: 29000, w: 10000, d: 8000 } }));
  assert.equal(fits.ok && fits.fits, true);
  const tooWide = fitHouse(lotProject({ house: { x: 1000, y: 5000, w: 18500, d: 30000 } })); // 20 m lot, 0.9 m side setbacks leave 18.2 m
  assert.equal(tooWide.ok, true);
  assert.equal(tooWide.fits, false);
  assert.match(tooWide.message, /does not fit inside the indicative setbacks/);
  assert.match(tooWide.message, /by \d+\.\d\d m/);
  assert.match(tooWide.message, /narrower/);
  assert.ok(!/✓|moved the house/i.test(tooWide.message));
});

test('mock assistant: a refused fit makes no changes and is free; a successful fit charges', async () => {
  let project = lotProject({ house: { x: 1000, y: 5000, w: 18500, d: 30000 } });
  const r = mockReply('Fit this house inside the setbacks', project);
  assert.equal(r.ops.length, 0);
  assert.match(r.reply, /does not fit/);
  const api = createMockApi({ getProject: () => project, delayMs: 0, cost: 2 });
  const refused = await api.edit('t', { message: 'Fit this house inside the setbacks' });
  assert.equal(refused.credits.charged, 0);
  const canned = await api.edit('t', { message: 'hello there' });
  assert.equal(canned.credits.charged, 0, 'an "I can only do..." reply is free');
  project = lotProject({ house: { x: 4000, y: 29000, w: 10000, d: 8000 } });
  const ok = await api.edit('t', { message: 'Fit this house inside the setbacks' });
  assert.equal(ok.credits.charged, 2);
  assert.ok(ok.ops.some((o) => o.op === 'suggest_site_position'));
});

test('suggest_site_position with apply: a house that cannot fit fails with the honest message and changes nothing', () => {
  const p = lotProject({ house: { x: 1000, y: 5000, w: 18500, d: 30000 } });
  const before = JSON.stringify(p.levels);
  assert.throws(() => applyOp(p, 'suggest_site_position', { align: 'centre', apply: true }), /does not fit inside the indicative setbacks/);
  assert.equal(JSON.stringify(p.levels), before);
});

test('setback wording: raw rule strings never reach the screen', () => {
  assert.match(plainSetbackReason('not determinable: front (no rule for this zone/use/lot)'), /^Setbacks not available for this lot, check with council/);
  assert.ok(!/not determinable|null|\?/.test(plainSetbackReason('not determinable: front (no rule for this zone/use/lot)')));
  assert.match(setbackUnavailableText({ lga: 'Townsville', setbacks: null }), /Setbacks not available for this lot, check with Townsville Council/);
});

test('neighbour houses and street trees are deterministic and keep off the subject lot frontage', () => {
  const ring = [[0, 0], [14, 0], [14, 36], [0, 36]];
  const a = houseSpec(14, 30, 1);
  const b = houseSpec(14, 30, 1);
  assert.deepEqual(a, b);
  const spots = streetTreeSpots([ring, ring.map((p) => [p[0] + 14, p[1]])], 1);
  assert.ok(Array.isArray(spots));
});

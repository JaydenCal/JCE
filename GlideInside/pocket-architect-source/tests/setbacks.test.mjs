import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickRules, pickRulesDetailed, buildEnvelope, classifyEdges, envelopeArea, BASIS_LABELS } from '../src/site/setbacks.js';

const slot = (minM, extra = {}) => ({ minM, basis: 'fixed', ...extra });
const rule = (id, zones, over = {}) => ({
  id, zones, appliesTo: ['any'], conditions: {}, front: null, secondaryFront: null, side: null, rear: null, garage: null,
  sources: [id + '-src'], quote: 'q', clause: 'c', page: 1, source_file: 'f.pdf', confidence: 'high', needsReview: null, ...over,
});
const council = {
  lga_slug: 'test', council: 'Test Council', dcp: 'Test DCP', status: 'ready',
  rules: [
    rule('r2-all', ['R2'], { front: slot(6), side: slot(0.9), rear: slot(3), secondaryFront: slot(3) }),
    rule('r2-two', ['R2'], { conditions: { storeys: 2 }, side: slot(1.5) }),
    rule('r2-wide', ['R2'], { conditions: { lotWidthMinM: 20 }, front: slot(8) }),
    rule('r5', ['R5'], { front: slot(10), side: slot(5), rear: slot(10) }),
    rule('r1-text', ['R1'], { front: slot(5), side: { minM: null, basis: 'ncc', note: 'BCA' }, rear: slot(3) }),
    rule('prec', ['R2'], { conditions: { precinct: 'Arcadia Estate' }, front: slot(4.5), side: slot(0.9), rear: slot(3) }),
    rule('batt', ['R2'], { conditions: { qualifiers: ['battle_axe'] }, front: slot(2) }),
    rule('conf-a', ['R3'], { front: slot(5), side: slot(1), rear: slot(3) }),
    rule('conf-b', ['R3'], { front: slot(6) }),
    rule('band', ['RU5'], { front: slot(6), side: { minM: null, bands: [
      { lotWidthMaxM: 10, minM: 0.9 }, { lotWidthMinM: 10.01, lotWidthMaxM: 15, minM: 1.2 }, { lotWidthMinM: 15.01, minM: 1.5 }] },
    rear: { minM: null, bands: [{ lotAreaMaxM2: 300, minM: 3 }, { lotAreaMinM2: 300.01, minM: 5 }] } }),
    rule('hband', ['R1'], { front: slot(5), rear: slot(3), side: { minM: null, bands: [
      { buildingHeightMaxM: 8.5, minM: 0.9 }, { buildingHeightMinM: 8.51, minM: 2.5 }] } }),
  ],
};
const base = { zone: 'R2', storeys: 1, lotWidthM: 15, lotAreaM2: 600, cornerLot: false, use: 'dwelling' };

test('picks council DCP values with basis and sources', () => {
  const p = pickRules(council, base);
  assert.equal(p.basis, 'Council DCP');
  assert.equal(p.front.minM, 6);
  assert.equal(p.side.minM, 0.9);
  assert.equal(p.rear.minM, 3);
  assert.deepEqual(p.front.sources, ['r2-all-src']);
  assert.equal(p.front.basis, 'Council DCP');
  assert.equal(p.secondaryFront, null);
});

test('storey condition: more specific rule overrides the general one', () => {
  const p = pickRules(council, { ...base, storeys: 2 });
  assert.equal(p.side.minM, 1.5);
  assert.equal(p.front.minM, 6);
});

test('lot width condition and unknown inputs', () => {
  assert.equal(pickRules(council, { ...base, lotWidthM: 22 }).front.minM, 8);
  const d = pickRulesDetailed(council, { ...base, lotWidthM: undefined });
  assert.equal(d.picked, null, 'front depends on lot width, which is unknown');
});

test('precinct and qualifier rules never apply unless asserted', () => {
  assert.equal(pickRules(council, base).front.minM, 6);
  assert.equal(pickRules(council, { ...base, precinct: 'Arcadia Estate' }).front.minM, 4.5);
  assert.equal(pickRules(council, { ...base, qualifiers: ['battle_axe'] }).front.minM, 2);
});

test('conflicting rules of equal specificity are not resolved', () => {
  const d = pickRulesDetailed(council, { ...base, zone: 'R3' });
  assert.equal(d.picked, null);
  assert.match(d.attempts[0].reason, /conflicting/);
});

test('non-numeric side (BCA) is not determinable', () => {
  assert.equal(pickRules(council, { ...base, zone: 'R1' }), null);
});

test('corner lot needs a secondary frontage value', () => {
  const p = pickRules(council, { ...base, cornerLot: true });
  assert.equal(p.secondaryFront.minM, 3);
  assert.equal(pickRules(council, { ...base, zone: 'R5', cornerLot: true }), null);
});

test('bands: lot width, lot area and building height', () => {
  const ru5 = (w, a) => pickRules(council, { ...base, zone: 'RU5', lotWidthM: w, lotAreaM2: a });
  assert.equal(ru5(9, 250).side.minM, 0.9);
  assert.equal(ru5(12, 250).side.minM, 1.2);
  assert.equal(ru5(18, 450).side.minM, 1.5);
  assert.equal(ru5(18, 450).rear.minM, 5);
  assert.equal(ru5(9, 250).rear.minM, 3);
  assert.equal(pickRules(council, { ...base, zone: 'RU5', lotWidthM: undefined }), null);
  const h = (bh) => pickRules(council, { ...base, zone: 'R1', buildingHeightM: bh });
  assert.equal(h(7).side.minM, 0.9);
  assert.equal(h(9).side.minM, 2.5);
  assert.equal(h(undefined), null);
});

test('averaging front setback uses neighbours when supplied', () => {
  const c = { status: 'ready', rules: [rule('avg', ['R2'], { front: { minM: null, basis: 'average_neighbours' }, side: slot(1), rear: slot(3) })] };
  assert.equal(pickRules(c, base), null);
  assert.equal(pickRules(c, { ...base, neighbourSetbacksM: [5, 7] }).front.minM, 6);
});

// ---------------------------------------------------------------- fallback chain
const nswFb = { name: 'NSW Codes SEPP Housing Code', rules: [
  rule('hc-1', ['R1', 'R2', 'R3', 'R4'], { conditions: { lotWidthMinM: 10 }, front: slot(4.5), side: slot(0.9), rear: slot(3), secondaryFront: slot(2) }),
  rule('hc-r5', ['R5'], { front: { minM: null, bands: [{ lotAreaMinM2: 4000, lotAreaMaxM2: 10000, minM: 10 }] }, side: slot(5), rear: slot(10) }),
] };
const qldFb = { name: 'QDC MP1.1', rules: [rule('q-1', ['*'], { front: slot(6), side: slot(1.5), rear: slot(6) })] };
const none = { lga_slug: 'cobar-shire-council', status: 'none', rules: [] };

test('council with status none falls back to the Housing Code (NSW)', () => {
  const d = pickRulesDetailed(none, { ...base, zone: 'R2' }, { fallbacks: { NSW: nswFb, QLD: qldFb } });
  assert.equal(d.picked.basis, BASIS_LABELS.NSW);
  assert.equal(d.picked.basis, 'Codes SEPP Housing Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)');
  assert.equal(d.picked.front.minM, 4.5);
  assert.equal(d.picked.front.basis, BASIS_LABELS.NSW);
  assert.equal(d.picked.front.dcp, 'NSW Codes SEPP Housing Code');
  assert.deepEqual(d.picked.front.sources, ['hc-1-src']);
  assert.equal(d.attempts[0].basis, 'Council DCP');
});

test('DCP that cannot determine a zone falls back; DCP that can does not', () => {
  const fromDcp = pickRules(council, base, { fallbacks: { NSW: nswFb } });
  assert.equal(fromDcp.basis, 'Council DCP');
  const fb = pickRules(council, { ...base, zone: 'R1' }, { fallbacks: { NSW: nswFb } });
  assert.equal(fb.basis, BASIS_LABELS.NSW);
  assert.equal(fb.attempts.length, 2);
});

test('fallback with bands and no match returns null', () => {
  assert.equal(pickRules(none, { ...base, zone: 'R5', lotAreaM2: 2000 }, { fallbacks: { NSW: nswFb } }), null);
  assert.equal(pickRules(none, { ...base, zone: 'R5', lotAreaM2: 5000 }, { fallbacks: { NSW: nswFb } }).front.minM, 10);
  assert.equal(pickRules(none, { ...base, lotWidthM: 8 }, { fallbacks: { NSW: nswFb } }), null);
  assert.equal(pickRules(none, base), null, 'no fallback loaded');
});

test('inland councils use the Inland Code, others the Housing Code; formula bands are evaluated', () => {
  const inl = { name: 'NSW Inland Code', rules: [rule('ic-1', ['R1', 'R2', 'RU1'], { front: slot(4.5), rear: slot(3), side: { minM: null, bands: [
    { lotWidthMinM: 10.01, lotWidthMaxM: 18, buildingHeightMaxM: 4.5, minM: 0.9, basis: 'fixed' },
    { lotWidthMinM: 10.01, lotWidthMaxM: 18, buildingHeightMinM: 4.51, buildingHeightMaxM: 8.5, minM: null, formulaParams: { offsetM: 4.5, divisor: 4, plusM: 0.9 }, formula: '(building height - 4.5) / 4 + 0.9' }] } })] };
  const west = { lga_slug: 'cobar', status: 'none', fallbackSet: 'NSW_INLAND', rules: [] };
  const fbs = { NSW: nswFb, NSW_INLAND: inl };
  const p = pickRules(west, { ...base, buildingHeightM: 6.5 }, { fallbacks: fbs });
  assert.equal(p.basis, BASIS_LABELS.NSW_INLAND);
  assert.match(p.basis, /^Codes SEPP Inland Code/);
  assert.equal(p.side.minM, 1.4);
  assert.equal(pickRules(west, { ...base, buildingHeightM: 3 }, { fallbacks: fbs }).side.minM, 0.9);
  assert.equal(pickRules(west, { ...base, buildingHeightM: undefined }, { fallbacks: fbs }), null);
  const east = pickRules(none, base, { fallbacks: fbs });
  assert.match(east.basis, /^Codes SEPP Housing Code/);
  assert.equal(pickRules(none, { ...base, zone: 'R5', lotAreaM2: 2000 }, { fallbacks: fbs }), null, 'R5 is Part 3A: no values, no envelope');
});

test('QLD lots over 450 m2 return null (MP1.2 not verified)', () => {
  const q = { name: 'QDC MP1.1', rules: [rule('q-s', ['*'], { conditions: { lotAreaMaxM2: 450 }, front: slot(3), side: slot(1.5), rear: slot(1.5) })] };
  assert.equal(pickRules(council, { ...base, state: 'QLD', lotAreaM2: 400 }, { fallbacks: { QLD: q } }).front.minM, 3);
  assert.equal(pickRules(council, { ...base, state: 'QLD', lotAreaM2: 600 }, { fallbacks: { QLD: q } }), null);
});

test('QLD always uses the QDC default, labelled as such', () => {
  const p = pickRules(council, { ...base, state: 'QLD' }, { fallbacks: { NSW: nswFb, QLD: qldFb } });
  assert.equal(p.basis, 'QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)');
  assert.equal(p.front.minM, 6);
  assert.equal(pickRules(council, { ...base, state: 'QLD' }, { fallbacks: { NSW: nswFb } }), null);
});

test('applied setbacks carry clause, page, DCP name, edition and the check_with_council flag', () => {
  const c = { lga_slug: 'x', council: 'X', dcp: 'X DCP 2020', status: 'ready', rules: [
    rule('a', ['R2'], { dcp: 'X DCP 2020', edition: 'commenced 01/07/2020', clause: 'cl 3.1', page: 12, front: slot(6), side: slot(1), rear: slot(3) }),
    rule('b', ['R3'], { dcp: 'X DCP 2020', edition: 'UNVERIFIED', confidence: 'low', needsReview: 'range printed', flag: 'check_with_council', flagReason: 'range printed',
      front: slot(6), side: slot(1), rear: slot(3) }),
  ] };
  const p = pickRules(c, base);
  assert.equal(p.front.clause, 'cl 3.1');
  assert.equal(p.front.page, 12);
  assert.equal(p.front.dcp, 'X DCP 2020');
  assert.equal(p.front.edition, 'commenced 01/07/2020');
  assert.equal(p.flag, null);
  const q = pickRules(c, { ...base, zone: 'R3' });
  assert.equal(q.flag, 'check_with_council');
  assert.match(q.flagReason, /range printed/);
});

test('no output text uses the word compliant', () => {
  assert.ok(!/compliant/i.test(JSON.stringify(BASIS_LABELS)));
});

// ---------------------------------------------------------------- envelope
const rect = [{ x: 0, y: 0 }, { x: 15000, y: 0 }, { x: 15000, y: 30000 }, { x: 0, y: 30000 }]; // front edge 0 (south)
const picked = (f, s, r, sec = null) => ({ front: { minM: f }, side: { minM: s }, rear: { minM: r }, secondaryFront: sec == null ? null : { minM: sec } });

test('rectangular lot: front, sides and rear inset individually', () => {
  assert.deepEqual(classifyEdges(rect, [0]), ['front', 'side', 'rear', 'side']);
  const env = buildEnvelope(rect, [0], picked(6, 0.9, 3));
  assert.deepEqual(env, [{ x: 900, y: 6000 }, { x: 14100, y: 6000 }, { x: 14100, y: 27000 }, { x: 900, y: 27000 }]);
  assert.equal(envelopeArea(env), 13200 * 21000);
});

test('array point format is preserved and orientation does not matter', () => {
  const cw = [[0, 0], [0, 30000], [15000, 30000], [15000, 0]];
  const env = buildEnvelope(cw, [3], picked(6, 1, 3));
  assert.ok(Array.isArray(env[0]));
  assert.equal(envelopeArea(env), 13000 * 21000);
});

test('corner lot: shortest road edge is primary, other gets the secondary setback', () => {
  // road on the south (edge 0, 15 m) and the east (edge 1, 30 m)
  assert.deepEqual(classifyEdges(rect, [0, 1]), ['front', 'secondaryFront', 'rear', 'side']);
  const env = buildEnvelope(rect, [0, 1], picked(6, 0.9, 3, 3));
  assert.deepEqual(env, [{ x: 900, y: 6000 }, { x: 12000, y: 6000 }, { x: 12000, y: 27000 }, { x: 900, y: 27000 }]);
  assert.equal(buildEnvelope(rect, [0, 1], picked(6, 0.9, 3)), null, 'secondary setback required');
});

test('splayed (trapezoid) lot: each edge offset by its own setback, vertices on the offset lines', () => {
  const trap = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 16000, y: 30000 }, { x: 4000, y: 30000 }];
  assert.deepEqual(classifyEdges(trap, [0]), ['front', 'side', 'rear', 'side']);
  const env = buildEnvelope(trap, [0], picked(5, 1.5, 4));
  assert.equal(env.length, 4);
  assert.ok(Math.abs(env[0].y - 5000) < 1e-6 && Math.abs(env[1].y - 5000) < 1e-6);
  assert.ok(Math.abs(env[2].y - 26000) < 1e-6 && Math.abs(env[3].y - 26000) < 1e-6);
  // distance from the first vertex to the left boundary line equals the side setback
  const [a, b] = [trap[3], trap[0]];
  const dist = (p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(Math.abs(dist(env[0]) - 1500) < 1e-6);
  assert.ok(envelopeArea(env) < envelopeArea(trap));
});

test('irregular five-sided lot with a kinked side boundary', () => {
  const lot = [{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 15000 }, { x: 16000, y: 32000 }, { x: 0, y: 32000 }];
  assert.deepEqual(classifyEdges(lot, [0]), ['front', 'side', 'side', 'rear', 'side']);
  const env = buildEnvelope(lot, [0], picked(6, 1, 3));
  assert.ok(env && env.length === 5);
  assert.ok(env.every((p) => p.y >= 6000 - 1e-6 && p.y <= 29000 + 1e-6));
});

test('setbacks that consume the lot give null', () => {
  assert.equal(buildEnvelope(rect, [0], picked(6, 8, 3)), null);
  assert.equal(buildEnvelope(rect, [0], null), null);
});

test('council with status none: no picked values, no envelope', () => {
  const p = pickRules(none, base);
  assert.equal(p, null);
  assert.equal(buildEnvelope(rect, [0], p), null);
});

// ---------------------------------------------------------------- real data
const dataDir = fileURLToPath(new URL('../../setbacks-data/rules/', import.meta.url));
test('generated Tamworth rules: R2 LSM-U', { skip: !existsSync(dataDir + 'tamworth-regional-council.json') }, () => {
  const t = JSON.parse(readFileSync(dataDir + 'tamworth-regional-council.json', 'utf8'));
  const p = pickRules(t, { zone: 'R2', storeys: 1, lotWidthM: 15, lotAreaM2: 600, cornerLot: false, use: 'dwelling', landSizeMap: 'LSM-U' });
  assert.ok(p, 'determinable');
  assert.equal(p.front.minM, 5.5);
  assert.equal(p.side.minM, 1);
  assert.equal(p.rear.minM, 1);
});

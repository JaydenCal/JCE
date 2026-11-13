// Commercial feasibility ("Indicative yield and value"): area mapping, the sale rate blend and its fallback for weak portal evidence,
// golden totals for the commercial fixture, the low to high band, and a wording lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaKeyFor, areaDefaults, feasibility, summaryRows, costRows, CAVEAT, GST_NOTE, RENT_NOTE, SOURCES_TEXT, MIN_N, AREAS } from '../src/commercial/feasibility.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { normaliseCommercial } from '../src/commercial/schema.js';
import { commercialEdit } from '../src/commercial/mode.js';
import { createStore } from '../src/model/store.js';
import market from '../src/commercial/data/market.json' with { type: 'json' };
import portal from '../src/commercial/data/market-portal.json' with { type: 'json' };

const p = commercialProject({ zoning: { code: 'E4', name: 'General Industrial' }, plain: false });
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('area mapping: council names, Westdale, the default and the override', () => {
  const k = (lga, extra = {}) => areaKeyFor({ lga, ...extra });
  assert.equal(k('TAMWORTH REGIONAL'), 'tamworth');
  assert.equal(areaKeyFor({ lga: '', address: '14 Example Road, Westdale NSW 2340' }), 'tamworth');
  assert.equal(areaKeyFor({ suburb: 'Westdale' }), 'tamworth');
  const want = { GUNNEDAH: 'gunnedah', NARRABRI: 'narrabri', 'MOREE PLAINS': 'moree', 'ARMIDALE REGIONAL': 'armidale', 'GLEN INNES SEVERN': 'glen-innes', INVERELL: 'inverell', 'DUBBO REGIONAL': 'dubbo', ORANGE: 'orange', 'BATHURST REGIONAL': 'bathurst', 'MID-WESTERN REGIONAL': 'mudgee', 'WAGGA WAGGA': 'wagga-wagga', ALBURY: 'albury', KEMPSEY: 'kempsey', 'PORT MACQUARIE-HASTINGS': 'port-macquarie', 'COFFS HARBOUR': 'coffs-harbour', 'CLARENCE VALLEY': 'grafton', LISMORE: 'lismore', BALLINA: 'ballina', MUSWELLBROOK: 'muswellbrook', SINGLETON: 'singleton', CESSNOCK: 'cessnock', MAITLAND: 'maitland', 'LAKE MACQUARIE': 'lake-macquarie', NEWCASTLE: 'newcastle', 'City of Newcastle': 'newcastle' };
  for (const [lga, key] of Object.entries(want)) assert.equal(k(lga), key, lga);
  assert.equal(k('WARRUMBUNGLE'), 'default');
  assert.equal(areaKeyFor(null), 'default');
  assert.equal(AREAS.length, 26);
  // every area resolves in both data files (portal may lack an area, market.json may not)
  for (const a of AREAS) assert.ok(market.areas[a.m], `market.json has ${a.m}`);
  // the override beats the detection
  const lot = { ...p.site.lot, lga: 'TAMWORTH REGIONAL' };
  assert.equal(feasibility(p.commercial, lot).areaKey, 'tamworth');
  assert.equal(feasibility({ ...p.commercial, feasibility: { area: 'dubbo', v: {} } }, lot).areaKey, 'dubbo');
});

test('sale rate: the blend of asking and sold medians for small strata units, with both shown', () => {
  const d = areaDefaults('tamworth', { avgUnitGfaM2: 100 });
  const s = d.inputs.saleRate;
  assert.equal(s.value, Math.round((3264 + 1580) / 2)); // 2422
  assert.equal(s.status, 'PORTAL');
  assert.equal(s.chip, 'Portal data 13/11/2026 (n 11 asking, n 16 sold)');
  assert.deepEqual([s.evidence.askMedPsm, s.evidence.soldMedPsm, s.evidence.askUsed, s.evidence.soldUsed], [3264, 1580, true, true]);
  assert.equal(areaDefaults('dubbo', { avgUnitGfaM2: 100 }).inputs.saleRate.value, Math.round((1180 + 1649) / 2));
  assert.equal(d.inputs.rentRate.value, 115);
  assert.equal(d.inputs.rentRate.chip, 'Portal data 13/11/2026 (n 7 listings)');
});

test('fallback: portal medians from fewer than 4 listings are not used', () => {
  assert.equal(MIN_N, 4);
  // Narrabri: asking n 2 only, so the published range middle (ESTIMATE)
  const n = areaDefaults('narrabri').inputs;
  assert.equal(n.saleRate.status, 'ESTIMATE');
  assert.equal(n.saleRate.value, 1700);
  assert.match(n.saleRate.note, /weak \(n 2 asking\)/);
  assert.equal(n.rentRate.status, 'ESTIMATE');
  // Moree: no portal listings at all
  const mo = areaDefaults('moree').inputs;
  assert.equal(mo.saleRate.value, 1800);
  assert.match(mo.saleRate.note, /No portal listings/);
  // Armidale: asking n 5 is strong, sold n 3 is weak, so asking only; rent n 3 is weak
  const ar = areaDefaults('armidale').inputs;
  assert.equal(ar.saleRate.value, 1343);
  assert.equal(ar.saleRate.chip, 'Portal data 13/11/2026 (n 5 asking)');
  assert.equal(ar.saleRate.evidence.soldUsed, false);
  assert.equal(ar.rentRate.status, 'ESTIMATE');
  assert.equal(ar.rentRate.value, 135);
  // Glen Innes (n 1) and the default area fall back to ranges
  assert.equal(areaDefaults('glen-innes').inputs.saleRate.status, 'ESTIMATE');
  const def = areaDefaults('default').inputs;
  assert.equal(def.saleRate.value, 2300);
  assert.equal(def.yieldPct.value, 8);
  // larger units (over 400 m2) use the sold median
  assert.equal(areaDefaults('tamworth', { avgUnitGfaM2: 600 }).inputs.saleRate.value, 1580);
  // yields, land and costs always come from market.json ranges
  const t = areaDefaults('tamworth').inputs;
  assert.deepEqual([t.yieldPct.value, t.landRate.value, t.buildRate.value, t.siteRate.value, t.feesPct.value, t.contPct.value], [7.25, 100, 1950, 185, 10, 8.75]);
  assert.ok(Object.values(t).every((x) => x.status === 'PORTAL' || x.status === 'ESTIMATE'));
  // sanity on the data files
  assert.equal(portal.asAt, '13/11/2026');
  assert.equal(market.buildCost.professionalFeesPct.low, 8);
});

test('totals: golden numbers for the commercial fixture in Tamworth', () => {
  const f = feasibility(p.commercial, p.site.lot);
  assert.equal(f.areaKey, 'tamworth');
  near(f.gfa, 1627.2, 0.01); // 16 units, 90.0 m2 ground plus 11.7 m2 mezzanine
  assert.equal(f.lotM2, 9000);
  const m = f.mid;
  near(m.realisation, 1627.2 * 2422, 0.5); // 3,941,078
  near(m.grossRent, 1627.2 * 115, 0.5); // 187,128
  near(m.endValue, (1627.2 * 115) / 0.0725, 0.5); // 2,581,076
  near(m.land, 900000, 0.01);
  near(m.build, 1627.2 * 1950, 0.5); // 3,173,040
  near(m.siteWorks, 9000 * 185, 0.01); // 1,665,000
  near(m.fees, (3173040 + 1665000) * 0.1, 0.5);
  near(m.contingency, (3173040 + 1665000) * 0.0875, 0.5);
  near(m.cost, 900000 + 3173040 + 1665000 + 483804 + 423328.5, 1);
  near(m.marginSale, m.realisation - m.cost, 0.01);
  near(m.marginSalePct, (m.marginSale / m.cost) * 100, 1e-6);
  near(m.grossYieldOnCostPct, (m.grossRent / m.cost) * 100, 1e-6);
  // per unit rows use each unit's own GFA and add up to the whole
  assert.equal(f.perUnit.length, 16);
  near(f.perUnit[0].gfa, 101.7, 0.01);
  near(f.perUnit[0].price, 101.7 * 2422, 0.5);
  near(f.perUnit.reduce((s, u) => s + u.price, 0), m.realisation, 0.5);
  near(f.perUnit.reduce((s, u) => s + u.rent, 0), m.grossRent, 0.5);
  assert.equal(summaryRows(f)[1][1], '$3,941,078');
  assert.equal(costRows(f).at(-1)[1], '$6,645,173');
});

test('overrides: listing price replaces land rate x area, edits flow through, the band always holds the value in use', () => {
  const base = feasibility(p.commercial, p.site.lot);
  const withPrice = feasibility({ ...p.commercial, feasibility: { area: null, v: { landPrice: 1250000, saleRate: 3000, buildRate: 2600 } } }, p.site.lot);
  assert.equal(withPrice.landFromPrice, true);
  assert.equal(withPrice.mid.land, 1250000);
  assert.equal(withPrice.low.land, 1250000);
  assert.equal(withPrice.high.land, 1250000);
  assert.equal(withPrice.mid.saleRate, 3000);
  assert.equal(withPrice.inputs.saleRate.edited, true);
  assert.equal(withPrice.inputs.saleRate.chip, 'Edited by you');
  assert.equal(withPrice.mid.build, base.gfa * 2600);
  // build rate 2600 is above the published high of 2400: the band still reaches it
  assert.equal(withPrice.low.build, base.gfa * 2600);
  for (const f of [base, withPrice]) {
    assert.ok(f.low.realisation <= f.mid.realisation && f.mid.realisation <= f.high.realisation);
    assert.ok(f.low.endValue <= f.mid.endValue && f.mid.endValue <= f.high.endValue);
    assert.ok(f.low.cost >= f.mid.cost && f.mid.cost >= f.high.cost, 'costs are highest in the low case');
    assert.ok(f.low.marginSale <= f.mid.marginSale && f.mid.marginSale <= f.high.marginSale);
  }
  // low case: low sale rate (published low 2200 is below the portal blend 2422), high cost ends
  near(base.low.saleRate, 2200, 0);
  near(base.high.saleRate, 3400, 0);
  assert.equal(base.low.yieldPct, 8);
  assert.equal(base.high.yieldPct, 6.5);
  near(base.low.build, base.gfa * 2400, 0.5);
  near(base.high.build, base.gfa * 1500, 0.5);
});

test('the spec is kept by the schema and the edit is one undo step', () => {
  const c = normaliseCommercial({ ...p.commercial, feasibility: { area: 'dubbo', v: { saleRate: 2500 } } });
  assert.deepEqual(c.feasibility, { area: 'dubbo', v: { saleRate: 2500 } });
  const s = createStore(structuredClone(p));
  commercialEdit(s, 'Set sale rate', (cc) => { cc.feasibility ??= { area: null, v: {} }; cc.feasibility.v.saleRate = 2600; });
  assert.equal(feasibility(s.project.commercial, s.project.site.lot).mid.saleRate, 2600);
  s.undo();
  assert.equal(feasibility(s.project.commercial, s.project.site.lot).mid.saleRate, 2422);
});

test('wording: caveat, GST note, no dashes, no compliant, no builder brands, DD/MM/YYYY dates', () => {
  assert.equal(CAVEAT, 'Indicative only, not a valuation. Figures from portal listings and published reports, check with a registered valuer and quantity surveyor.');
  const f = feasibility(p.commercial, p.site.lot);
  const all = [CAVEAT, GST_NOTE, RENT_NOTE, SOURCES_TEXT, ...summaryRows(f).flat(), ...costRows(f).flat(), ...Object.values(f.inputs).flatMap((i) => [i.chip, i.note || ''])].join('\n');
  assert.doesNotMatch(all, /[–—]/);
  assert.doesNotMatch(all, /compliant/i);
  assert.doesNotMatch(all, /g\.?\s?j\.?\s?gardner|hotondo|metricon|simonds|clarendon|mcdonald jones|porter davis|burbank|henley|fairmont|coral homes|rawson|eden brae|masterton/i);
  assert.doesNotMatch(all, /\b\d{4}-\d{2}-\d{2}\b/);
  assert.match(all, /13\/11\/2026/);
  assert.match(GST_NOTE, /ex GST/);
  // the panel builds on the same strings
  const ui = readFileSync(new URL('../src/commercial/ui/panel-commercial.js', import.meta.url), 'utf8');
  assert.match(ui, /Indicative yield and value/);
  assert.match(ui, /CAVEAT/);
  assert.doesNotMatch(ui, /[–—]/);
});

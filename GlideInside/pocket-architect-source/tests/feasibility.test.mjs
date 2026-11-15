// Commercial feasibility ("Indicative yield and value"): area mapping, the sale rate blend and its fallback for weak portal evidence,
// golden totals for the commercial fixture, the low to high band, and a wording lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaKeyFor, areaDefaults, areaChain, resolveArea, stateOf, areaStatusLine, feasibility, summaryRows, costRows, chargesLabel, CAVEAT, GST_NOTE, RENT_NOTE, SOURCES_TEXT, MIN_N, AREAS, MARKET_DATE } from '../src/commercial/feasibility.js';
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
  assert.equal(AREAS.length, 52); // 35 NSW areas and the Regional NSW default, 15 Queensland areas and the Regional QLD default (15/11/2026)
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
  assert.equal(n.saleRate.value, 1550); // the 15/11/2026 range 1,140 to 1,990 (two comps) has a middle of 1,565, rounded to 50
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
  assert.deepEqual([t.yieldPct.value, t.landRate.value, t.buildRate.value, t.siteRate.value, t.feesPct.value, t.contPct.value], [7.25, 100, 1500, 120, 8, 7.5]);
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
  // the mezzanine (16 x 11.7 m2 = 187.2 m2) is valued at half the ground floor rate (an input), and the capitalised value uses NET rent
  const revenueGfa = 1627.2 - 187.2 * 0.5;
  near(m.revenueGfa, revenueGfa, 0.01);
  near(m.realisation, revenueGfa * 2422, 0.5);
  near(m.grossRent, revenueGfa * 115, 0.5);
  near(m.netRent, revenueGfa * 115 * 0.9, 0.5); // outgoings 10 percent of gross rent (assumption)
  near(m.endValue, (revenueGfa * 115 * 0.9) / 0.0725, 0.5);
  near(m.land, 900000, 0.01);
  near(m.build, 1627.2 * 1500, 0.5); // 2,440,800: the low end of the analyst range (see the buildRate note)
  // site works on the developed area only: footprint 1,440 m2 plus the paved block of each parking row (truck apron, aisle, bays)
  near(f.devM2, 3165, 1); // 3108 plus the site access driveway (siteAccess, 6 m wide to the front boundary)
  near(f.restM2, 9000 - f.devM2, 0.001);
  assert.ok(f.devM2 > 1440 && f.devM2 < f.lotM2);
  near(m.siteDev, f.devM2 * 120, 0.01);
  near(m.siteRest, f.restM2 * 15, 0.01);
  near(m.siteWorks, m.siteDev + m.siteRest, 0.01);
  const construction = m.build + m.siteWorks;
  near(m.fees, construction * 0.08, 0.5);
  near(m.contingency, construction * 0.075, 0.5);
  // Council charges: NSW s7.12 at 1 percent of building and site works (above 200,000), an ESTIMATE default, added after fees and contingency (15/11/2026).
  near(m.charges, construction * 0.01, 0.5);
  near(m.cost, m.land + construction + m.fees + m.contingency + m.charges, 0.5);
  near(m.cost, 4287966, 1); // golden: 4,258,884 before council charges were added (15/11/2026), plus 29,081 of s7.12
  near(m.marginSale, m.realisation - m.cost, 0.01);
  near(m.marginSalePct, (m.marginSale / m.cost) * 100, 1e-6);
  near(m.grossYieldOnCostPct, (m.grossRent / m.cost) * 100, 1e-6);
  // per unit rows use each unit's own GFA and add up to the whole
  assert.equal(f.perUnit.length, 16);
  near(f.perUnit[0].gfa, 101.7, 0.01);
  near(f.perUnit[0].price, (90 + 11.7 * 0.5) * 2422, 0.5);
  near(f.perUnit.reduce((s, u) => s + u.price, 0), m.realisation, 0.5);
  near(f.perUnit.reduce((s, u) => s + u.rent, 0), m.grossRent, 0.5);
  assert.equal(summaryRows(f)[1][1], `$${Math.round(m.realisation).toLocaleString('en-AU')}`);
  assert.match(summaryRows(f).map((r) => r[0]).join('|'), /Net rent per year \(after 10% outgoings\).*End value by capitalisation \(net rent \/ net yield\)/);
  assert.equal(feasibility({ ...p.commercial, feasibility: { area: null, v: { landscapeRate: 30 } } }, p.site.lot).mid.siteRest, f.restM2 * 30);
  assert.equal(costRows(f).at(-1)[1], `$${Math.round(m.cost).toLocaleString('en-AU')}`);
  assert.equal(costRows(f).length, 8, 'land, building, site works, landscaping, fees, contingency, council charges, total');
  assert.match(costRows(f)[3][0], /Clearing and landscaping, rest of lot \(\$15 per m²/);
  assert.equal(f.inputs.landscapeRate.status, 'ESTIMATE');
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
  // low case: low sale rate (the Tamworth range is the minimum to maximum of seven listed comps, 1,489 to 3,403, 15/11/2026), high cost ends
  near(base.low.saleRate, 1489, 0);
  near(base.high.saleRate, 3403, 0);
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
  assert.equal(CAVEAT, 'Estimates only, not a valuation. Enter your own values in any field. Defaults come from portal listings and published reports; check with a registered valuer and quantity surveyor before relying on them.');
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

// Queensland areas, the state defaults, fallback chains, the regional cost factor and council charges (15/11/2026) ---------------------

test('area resolution: Queensland councils, Brisbane north and south, street names, state defaults', () => {
  const q = (lga, extra = {}) => resolveArea({ state: 'QLD', lga, ...extra });
  const want = { 'Townsville City': 'townsville', 'Cairns Regional': 'cairns', 'Mackay Regional': 'mackay', 'Rockhampton Regional': 'rockhampton', 'Gladstone Regional': 'gladstone', 'Bundaberg Regional': 'bundaberg', 'Toowoomba Regional': 'toowoomba', 'Sunshine Coast Regional': 'sunshine-coast', 'Noosa Shire': 'sunshine-coast', 'Gold Coast City': 'gold-coast', 'Ipswich City': 'ipswich', 'Logan City': 'logan', 'Moreton Bay Regional': 'brisbane-north', 'Fraser Coast Regional': 'hervey-bay', 'Mount Isa City': 'mount-isa' };
  for (const [lga, key] of Object.entries(want)) assert.deepEqual([q(lga).key, q(lga).via], [key, 'lga'], lga);
  // Brisbane City is placed north or south by the suburb in the address
  assert.equal(q('Brisbane City', { address: '12 Smith Street Geebung QLD' }).key, 'brisbane-north');
  assert.equal(q('Brisbane City', { address: '12 Smith Street Acacia Ridge QLD' }).key, 'brisbane-south');
  assert.equal(q('Brisbane City').key, 'brisbane-south');
  // no council: the suburb or town is used; a town in a street name is not
  assert.deepEqual([resolveArea({ state: 'QLD', address: '5 Hubert Street Garbutt QLD' }).key, resolveArea({ state: 'QLD', address: '5 Hubert Street Garbutt QLD' }).via], ['townsville', 'town']);
  assert.equal(resolveArea({ state: 'QLD', address: '9 Mackay Street Hervey Bay QLD' }).key, 'hervey-bay');
  assert.equal(resolveArea({ state: 'NSW', address: '3 Parkes Street Tamworth NSW' }).key, 'tamworth');
  assert.equal(resolveArea({ address: '3 Orange Grove Road Gunnedah NSW' }).key, 'gunnedah');
  // the state comes from the lot, else from the address
  assert.equal(stateOf({ state: 'QLD' }), 'QLD');
  assert.equal(stateOf({ address: '12 Example Road Cairns QLD 4870' }), 'QLD');
  assert.equal(stateOf({ address: '12 Example Road Tamworth NSW 2340' }), 'NSW');
  assert.equal(stateOf({}), null);
  // unmatched lots fall back to the default of their state; a Queensland council never lands on a NSW area
  assert.deepEqual(resolveArea({ state: 'QLD', lga: 'Longreach Regional' }), { key: 'default-qld', via: 'default', state: 'QLD' });
  assert.equal(resolveArea({ state: 'NSW', lga: 'WARRUMBUNGLE' }).key, 'default');
  assert.equal(resolveArea({ state: 'QLD', lga: 'TAMWORTH REGIONAL' }).key, 'default-qld');
  assert.equal(areaKeyFor({ address: '1 Example Road Longreach QLD' }), 'default-qld');
  // new NSW areas
  const n = { WOLLONGONG: 'wollongong', 'CENTRAL COAST': 'central-coast', SHOALHAVEN: 'nowra', 'GOULBURN MULWAREE': 'goulburn', 'QUEANBEYAN-PALERANG': 'queanbeyan', TWEED: 'tweed-heads', GRIFFITH: 'griffith', PARKES: 'parkes', 'BROKEN HILL': 'broken-hill', PENRITH: 'western-sydney', CAMPBELLTOWN: 'western-sydney' };
  for (const [lga, key] of Object.entries(n)) assert.equal(areaKeyFor({ state: 'NSW', lga }), key, lga);
  // every area exists in market.json with its state and a cost region
  for (const a of AREAS) { const m = market.areas[a.m]; assert.equal(m.state, a.state, a.key); assert.ok(market.regionalCostFactors.factors[m.costRegion], a.key); }
});

test('fallbackTo chains end in a state default and never loop', () => {
  assert.deepEqual(areaChain('mackay'), ['mackay', 'townsville', 'default-qld']);
  assert.deepEqual(areaChain('gladstone'), ['gladstone', 'rockhampton', 'default-qld']);
  assert.deepEqual(areaChain('hervey-bay'), ['hervey-bay', 'bundaberg', 'default-qld']);
  assert.deepEqual(areaChain('mount-isa'), ['mount-isa', 'default-qld']);
  assert.deepEqual(areaChain('gold-coast'), ['gold-coast', 'brisbane-south', 'default-qld']);
  assert.deepEqual(areaChain('bathurst'), ['bathurst', 'orange', 'dubbo', 'tamworth', 'default']);
  assert.deepEqual(areaChain('port-macquarie'), ['port-macquarie', 'coffs-harbour', 'default']);
  assert.deepEqual(areaChain('default-qld'), ['default-qld']);
  for (const a of AREAS) {
    const c = areaChain(a.key);
    assert.equal(new Set(c).size, c.length, a.key);
    assert.equal(c[c.length - 1], a.state === 'QLD' ? 'default-qld' : 'default', a.key);
    const first = market.areas[a.m].fallbackTo;
    if (first) assert.ok(market.areas[first], `${a.key} fallbackTo ${first} exists`);
  }
});

test('area line and chips name the area, state, as-at date and status; the estimates caveat stays', () => {
  const f = feasibility({ ...p.commercial, feasibility: { area: 'townsville', v: {} } }, p.site.lot);
  assert.equal(f.areaState, 'QLD');
  assert.equal(f.marketDate, '15/11/2026');
  assert.equal(MARKET_DATE, '15/11/2026');
  const line = areaStatusLine(f);
  assert.match(line, /^Townsville, QLD\. Chosen by you\. Market data as at 15\/11\/2026\. Sale rate Estimate, rent Estimate, yield Estimate, land Estimate\. Confidence medium\.$/);
  const mk = areaStatusLine(feasibility({ ...p.commercial, feasibility: { area: 'mackay', v: {} } }, p.site.lot));
  assert.match(mk, /Thin evidence is anchored to Townsville\./);
  const t = areaStatusLine(feasibility(p.commercial, p.site.lot));
  assert.match(t, /^Tamworth, NSW\. Found from the council area\. Market data as at 15\/11\/2026\. Sale rate Listing, rent Listing, yield Estimate, land Estimate\./);
  // an area with verified listing ranges says Listing in its chip; estimates say Estimate with the date
  const d = areaDefaults('bathurst').inputs;
  assert.equal(d.landRate.dataStatus, 'VERIFIED_LISTING');
  assert.match(d.landRate.chip, /^Listing, range \d+ to \d+ \(15\/11\/2026\)$/);
  assert.match(areaDefaults('townsville').inputs.landRate.chip, /^Estimate, range 60 to 120 \(15\/11\/2026\)$/);
  assert.match(areaDefaults('townsville').inputs.yieldPct.chip, /^Estimate, range 6\.5 to 8 \(15\/11\/2026\)$/);
  const ui = readFileSync(new URL('../src/commercial/ui/panel-commercial.js', import.meta.url), 'utf8');
  assert.match(ui, /areaStatusLine/);
  assert.match(ui, /fz-area-meta/);
  assert.match(CAVEAT, /^Estimates only, not a valuation\. Enter your own values in any field\./);
});

test('regional cost factor: the midpoint of the conflicting published factors, applied to the published rates only', () => {
  const F = market.regionalCostFactors.factors;
  // (0.92 + 1.32) / 2, (0.90 + 1.30) / 2, regional NSW 0.90 to 1.10 around 1.00, regional QLD midway between regional NSW and North QLD
  assert.deepEqual([F.seQLD.value, F.northQLD.value, F.regionalNSW.value, F.regionalQLD.value], [1.12, 1.1, 1, 1.05]);
  assert.equal((F.seQLD.low + F.seQLD.high) / 2, F.seQLD.value);
  assert.equal(Math.round(((F.northQLD.low + F.northQLD.high) / 2) * 100) / 100, F.northQLD.value);
  assert.match(market.regionalCostFactors.method, /midpoint/);
  const base = feasibility({ ...p.commercial, feasibility: { area: 'tamworth', v: {} } }, p.site.lot);
  const tv = feasibility({ ...p.commercial, feasibility: { area: 'townsville', v: {} } }, p.site.lot);
  const sc = feasibility({ ...p.commercial, feasibility: { area: 'sunshine-coast', v: {} } }, p.site.lot);
  assert.equal(base.inputs.costFactor.value, 1);
  assert.equal(tv.inputs.costFactor.value, 1.1);
  assert.equal(sc.inputs.costFactor.value, 1.12);
  assert.equal(areaDefaults('toowoomba').inputs.costFactor.value, 1.05);
  assert.match(tv.inputs.costFactor.chip, /^Estimate, midpoint of published 0\.9 to 1\.3 \(15\/11\/2026\)$/);
  // the factor scales the build rate and the developed area site works, not land or landscaping; the rate input itself stays 1,500
  near(tv.mid.build, tv.gfa * 1500 * 1.1, 0.5);
  near(tv.mid.siteDev, tv.devM2 * 120 * 1.1, 0.5);
  near(tv.mid.siteRest, tv.restM2 * 15, 0.01);
  assert.equal(tv.inputs.buildRate.value, 1500);
  assert.match(costRows(tv).map((r) => r[0]).join('|'), /Building \(\$1,500 per m² x 1\.1 regional factor x /);
  // a rate the person typed is used as entered, a typed factor replaces the default, and the band is not widened by the factor
  const typed = feasibility({ ...p.commercial, feasibility: { area: 'townsville', v: { buildRate: 2000, costFactor: 1.3 } } }, p.site.lot);
  near(typed.mid.build, typed.gfa * 2000, 0.5);
  near(typed.mid.siteDev, typed.devM2 * 120 * 1.3, 0.5);
  assert.equal(typed.inputs.costFactor.edited, true);
  assert.equal(tv.low.costFactor, tv.high.costFactor);
  // catalogue buildings are scaled too
  assert.ok(feasibility({ ...p.commercial, feasibility: { area: 'sunshine-coast', v: {} } }, p.site.lot).mid.cost > base.mid.cost);
});

test('council charges: Townsville, Mackay and Toowoomba per m2 GFA by use, NSW s7.12, an estimate elsewhere, editable', () => {
  const at = (area, v = {}) => feasibility({ ...p.commercial, feasibility: { area, v } }, p.site.lot);
  // the fixture: 16 units, 1,440 m2 ground floor and 187.2 m2 of mezzanine office, developed area about 3,165 m2
  const g = 1627.2 - 187.2;
  const tv = at('townsville');
  near(tv.mid.charges, g * 66.94 + 187.2 * 187.48, 0.5); // Townsville 2026/27, warehouse 66.94 and office 187.48 per m2 GFA (VERIFIED_REPORT)
  assert.equal(tv.inputs.councilCharges.dataStatus, 'VERIFIED_REPORT');
  assert.match(tv.inputs.councilCharges.chip, /^Report, Townsville charges resolution \(15\/11\/2026\)$/);
  assert.equal(tv.inputs.councilCharges.value, Math.round(tv.mid.charges));
  const mk = at('mackay');
  near(mk.mid.charges, g * 65.45 + 187.2 * 183.35 + mk.devM2 * 13.1, 0.5); // plus stormwater per m2 impervious (the developed area)
  const tb = at('toowoomba');
  near(tb.mid.charges, mk.mid.charges, 0.5); // identical prescribed base
  // other Queensland councils: the prescribed base amounts, an ESTIMATE; NSW: 1 percent above 200,000, an ESTIMATE
  const sc = at('sunshine-coast');
  near(sc.mid.charges, tb.mid.charges, 0.5);
  assert.equal(sc.inputs.councilCharges.dataStatus, 'ESTIMATE');
  assert.match(sc.inputs.councilCharges.chip, /^Estimate, prescribed base amounts, council not read \(15\/11\/2026\)$/);
  const tw = at('tamworth');
  near(tw.mid.charges, (tw.mid.build + tw.mid.siteWorks) * 0.01, 0.5);
  assert.match(tw.inputs.councilCharges.chip, /^Estimate, s7\.12 at 1% above \$200,000 \(15\/11\/2026\)$/);
  assert.match(tw.inputs.councilCharges.rule.sources[0], /^https:\/\/www\.planningportal\.nsw\.gov\.au/);
  assert.equal(tw.inputs.councilCharges.rule.asAt, '15/11/2026');
  assert.match(chargesLabel(tv), /^Council charges \(Townsville charges resolution, per m² GFA by use, Report, 15\/11\/2026\)$/);
  // below the threshold there is no s7.12 levy
  const tiny = feasibility({ ...p.commercial, feasibility: { area: 'tamworth', v: { buildRate: 0, siteRate: 0, landscapeRate: 0 } } }, p.site.lot);
  assert.equal(tiny.mid.charges, 0);
  // editable: the person's total replaces the default in every scenario and is in the total cost; reset is the default again
  const ed = at('townsville', { councilCharges: 250000 });
  assert.equal(ed.mid.charges, 250000);
  assert.equal(ed.low.charges, 250000);
  assert.equal(ed.high.charges, 250000);
  assert.equal(ed.inputs.councilCharges.edited, true);
  assert.equal(ed.inputs.councilCharges.chip, 'Edited by you');
  assert.equal(ed.inputs.councilCharges.defaultValue, Math.round(tv.mid.charges));
  near(ed.mid.cost - tv.mid.cost, 250000 - tv.mid.charges, 0.5);
  assert.equal(at('townsville', { councilCharges: 0 }).mid.charges, 0);
  assert.equal(chargesLabel(ed), 'Council charges (entered by you)');
  assert.ok(costRows(tv).some(([k]) => /^Council charges \(/.test(k)));
});

test('review fixes 15/11/2026: near councils, street types, full state names, postcode, removed towns', () => {
  const r = (lot) => { const x = resolveArea(lot); return [x.key, x.via]; };
  assert.deepEqual(r({ state: 'NSW', lga: 'PORT STEPHENS' }), ['newcastle', 'near']);
  assert.deepEqual(r({ state: 'NSW', lga: 'LIVERPOOL' }), ['western-sydney', 'near']);
  assert.deepEqual(r({ state: 'QLD', lga: 'REDLAND' }), ['brisbane-south', 'near']);
  assert.deepEqual(r({ state: 'QLD', lga: 'LIVINGSTONE' }), ['rockhampton', 'near']);
  assert.deepEqual(r({ state: 'QLD', lga: 'SCENIC RIM' }), ['ipswich', 'near']);
  assert.deepEqual(r({ state: 'QLD', lga: 'GYMPIE' }), ['sunshine-coast', 'near']);
  // an area's own council still resolves by council, and an unknown council uses the state default
  assert.deepEqual(r({ state: 'QLD', lga: 'TOWNSVILLE' }), ['townsville', 'lga']);
  assert.deepEqual(r({ state: 'QLD', lga: 'LONGREACH' }), ['default-qld', 'default']);
  // a street type word that was missing no longer lets a street name pose as a town
  assert.equal(resolveArea({ state: 'QLD', address: '4 Townsville Terrace Longreach QLD' }).key, 'default-qld');
  assert.equal(resolveArea({ state: 'NSW', address: '2 Tamworth Grove Warren NSW' }).key, 'default');
  assert.equal(resolveArea({ state: 'NSW', address: '8 Industrial Road Warren NSW' }).key, 'default'); // Warren is not Tamworth
  assert.equal(resolveArea({ state: 'QLD', address: '3 Smith Street Kawana QLD', lga: '' }).key !== 'rockhampton', true); // Kawana is not Rockhampton
  assert.equal(resolveArea({ state: 'QLD', address: '1 Pine Street Yatala' }).key !== 'logan', true);
  // state names and postcodes
  assert.equal(stateOf({ state: 'Queensland' }), 'QLD');
  assert.equal(stateOf({ state: 'New South Wales' }), 'NSW');
  assert.equal(stateOf({ postcode: '4810' }), 'QLD');
  assert.equal(stateOf({ postcode: '2340' }), 'NSW');
  assert.equal(stateOf({ postcode: '2600' }), null); // ACT
  assert.equal(stateOf({}), null);
});

test('a building over 400 m2 with no sold evidence starts at the low end of the sale range', () => {
  const small = areaDefaults('toowoomba', { avgUnitGfaM2: 100 }).inputs.saleRate;
  const big = areaDefaults('toowoomba', { avgUnitGfaM2: 2500 }).inputs.saleRate;
  const r = market.areas.Toowoomba.saleRatePerM2GFA;
  assert.equal(big.value, Math.round(r.low));
  assert.equal(small.value, Math.round((r.low + r.high) / 2 / 50) * 50);
  assert.match(big.note, /over 400 m2/);
  assert.ok(big.value < small.value);
});

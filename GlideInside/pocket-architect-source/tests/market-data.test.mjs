// Data validation for src/commercial/data/market.json (market.v1, extended 15/11/2026) and catalogue/data/build-rates.json:
// every numeric range or value has a status, an as-at date (DD/MM/YYYY) and at least one source; the area records share one key set;
// fallback chains are acyclic; yields stay inside the evidence tiers; comps do their own arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import market from '../src/commercial/data/market.json' with { type: 'json' };
import rates from '../src/commercial/catalogue/data/build-rates.json' with { type: 'json' };

const DATE = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/20\d\d$/;
const STATUS = new Set(Object.keys(market.statusKey));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SKIP_KEYS = new Set(['components', 'tiers']); // parts of a parent that carries the status, date and sources
const COMP_KEYS = new Set(['saleComps', 'rentComps', 'showroomComps', 'officeComps', 'retailComps', 'landEvidence', 'evidence']);

/** Every object that carries a number as a range or value (low, high, value, pct, rates) must carry status, asAt and sources. */
function collect(node, path, out) {
  if (Array.isArray(node)) { node.forEach((v, i) => collect(v, `${path}[${i}]`, out)); return; }
  if (!node || typeof node !== 'object') return;
  const numeric = ['low', 'high', 'value', 'pct', 'threshold', 'industry'].some((k) => isNum(node[k])) || (node.rates && typeof node.rates === 'object');
  if (numeric) out.push([path, node]);
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEYS.has(k) || COMP_KEYS.has(k)) continue;
    collect(v, `${path}/${k}`, out);
  }
}

test('market.v1: header, status key, schema notes and the generated date', () => {
  assert.equal(market.schema, 'market.v1');
  assert.match(market.generated, DATE);
  assert.equal(market.generated, '15/11/2026');
  assert.deepEqual([...STATUS].sort(), ['ESTIMATE', 'VERIFIED_LISTING', 'VERIFIED_REPORT']);
  const notes = market.schemaNotes.join('\n');
  for (const word of ['state', 'costRegion', 'fallbackTo', 'showroomRentPerM2PerYr', 'smallOfficeRentPerM2PerYr', 'smallRetailRentPerM2PerYr', 'derivedNetYieldPct', 'regionalCostFactors', 'charges', 'carriedFrom']) assert.match(notes, new RegExp(word), `schemaNotes document ${word}`);
  for (const k of ['areas', 'buildCost', 'regionalCostFactors', 'charges', 'softCosts', 'yieldMethod', 'generalSources', 'caveats']) assert.ok(market[k], k);
});

test('every numeric value has a status, an as-at date (DD/MM/YYYY) and at least one source', () => {
  const found = [];
  for (const k of ['areas', 'buildCost', 'regionalCostFactors', 'charges', 'softCosts']) collect(market[k], k, found);
  assert.ok(found.length > 300, `walked ${found.length} numeric records`);
  const bad = [];
  for (const [path, o] of found) {
    const problems = [];
    if (!STATUS.has(o.status)) problems.push(`status ${o.status}`);
    if (!DATE.test(String(o.asAt))) problems.push(`asAt ${o.asAt}`);
    if (!Array.isArray(o.sources) || !o.sources.length || o.sources.some((x) => typeof x !== 'string' || !x.trim())) problems.push('sources');
    if (problems.length) bad.push(`${path}: ${problems.join(', ')}`);
  }
  assert.deepEqual(bad, []);
  // the yield evidence rows and the yield method carry the same fields
  for (const e of market.yieldMethod.evidence) { assert.ok(STATUS.has(e.status), e.id); assert.match(e.asAt, DATE); assert.match(e.url, /^https:\/\//); assert.ok(e.figure && e.publisher && e.location, e.id); }
  assert.ok(STATUS.has(market.yieldMethod.status)); assert.match(market.yieldMethod.asAt, DATE); assert.ok(market.yieldMethod.sources.length);
});

test('area records share one key set, state, cost region and an acyclic fallbackTo chain', () => {
  const REQUIRED = ['state', 'costRegion', 'fallbackTo', 'confidence', 'saleRatePerM2GFA', 'saleComps', 'saleCompNotes', 'grossRentPerM2PerYr', 'rentComps', 'rentCompNotes', 'netYieldPct', 'industrialLandPerM2', 'landEvidence', 'vacancyDemand'];
  const OPTIONAL = ['derivedNetYieldPct', 'showroomRentPerM2PerYr', 'showroomComps', 'smallOfficeRentPerM2PerYr', 'officeComps', 'smallRetailRentPerM2PerYr', 'retailComps'];
  const names = Object.keys(market.areas);
  assert.equal(names.length, 52);
  for (const [name, a] of Object.entries(market.areas)) {
    for (const k of REQUIRED) assert.ok(k in a, `${name} has ${k}`);
    for (const k of Object.keys(a)) assert.ok(REQUIRED.includes(k) || OPTIONAL.includes(k), `${name} has an unknown key ${k}`);
    assert.ok(['NSW', 'QLD'].includes(a.state), name);
    assert.ok(market.regionalCostFactors.factors[a.costRegion], `${name} cost region ${a.costRegion}`);
    assert.ok(['low', 'medium', 'high'].includes(a.confidence), name);
    for (const k of ['saleComps', 'rentComps', 'saleCompNotes', 'rentCompNotes', 'landEvidence']) assert.ok(Array.isArray(a[k]), `${name} ${k}`);
    // optional fields come with their comps
    for (const [f, c] of [['showroomRentPerM2PerYr', 'showroomComps'], ['smallOfficeRentPerM2PerYr', 'officeComps'], ['smallRetailRentPerM2PerYr', 'retailComps']]) if (a[f]) assert.ok(Array.isArray(a[c]), `${name} ${c}`);
    // chain: fallbackTo names an area of the same state, ends in null, never loops
    const seen = new Set([name]);
    for (let n = a.fallbackTo; n; n = market.areas[n].fallbackTo) {
      assert.ok(market.areas[n], `${name} fallbackTo ${n}`);
      assert.equal(market.areas[n].state, a.state, `${name} fallbackTo crosses state`);
      assert.ok(!seen.has(n), `${name} fallbackTo loops at ${n}`);
      seen.add(n);
    }
  }
  // each state has its default and every other area of the state differs from it
  assert.equal(market.areas['Regional NSW default'].state, 'NSW');
  assert.equal(market.areas['Regional QLD default'].state, 'QLD');
  assert.equal(names.filter((n) => market.areas[n].state === 'NSW').length, 36);
  assert.equal(names.filter((n) => market.areas[n].state === 'QLD').length, 16);
  // the 13/11/2026 NSW areas are all still present
  for (const n of ['Tamworth', 'Gunnedah', 'Narrabri', 'Moree', 'Armidale', 'Glen Innes', 'Inverell', 'Dubbo', 'Orange', 'Bathurst', 'Mudgee', 'Wagga Wagga', 'Albury', 'Kempsey', 'Port Macquarie', 'Coffs Harbour', 'Grafton (Clarence Valley)', 'Lismore', 'Ballina', 'Muswellbrook', 'Singleton', 'Cessnock', 'Maitland', 'Lake Macquarie', 'Newcastle']) assert.ok(market.areas[n], n);
});

test('ranges are ordered and yields come from the evidence tiers, not from asking prices', () => {
  const T = market.yieldMethod.tiers;
  const evIds = new Set(market.yieldMethod.evidence.map((e) => e.id));
  for (const [name, a] of Object.entries(market.areas)) {
    for (const k of ['saleRatePerM2GFA', 'grossRentPerM2PerYr', 'industrialLandPerM2', 'netYieldPct']) { const r = a[k]; assert.ok(r.low > 0 && r.high >= r.low, `${name} ${k} ${r.low} to ${r.high}`); }
    const y = a.netYieldPct;
    assert.ok(y.low >= 5 && y.high <= 10.5, `${name} yield ${y.low} to ${y.high}`);
    assert.ok(T[y.tier], `${name} tier`);
    assert.equal(y.status, 'ESTIMATE', name);
    assert.ok(y.sources.every((u) => /^https:\/\//.test(u)), `${name} yield sources are the evidence URLs`);
    assert.ok(a.saleRatePerM2GFA.high <= 8000 && a.grossRentPerM2PerYr.high <= 400 && a.industrialLandPerM2.high <= 1200, name);
    for (const id of T[y.tier].evidence.split(',')) assert.ok(evIds.has(id), `${name} evidence ${id}`);
    if (a.derivedNetYieldPct) {
      assert.match(a.derivedNetYieldPct.note, /NOT used/, name);
      assert.ok(a.derivedNetYieldPct.low < a.netYieldPct.high, name);
    }
    // SE Queensland and Western Sydney are tighter than the regional towns of the same state
  }
  const y = (n) => market.areas[n].netYieldPct;
  assert.ok(y('Western Sydney fringe (Penrith/Campbelltown)').high < y('Tamworth').high);
  assert.ok(y('Sunshine Coast').high <= y('Townsville').high);
  assert.ok(y('Newcastle').low < y('Tamworth').low);
  assert.ok(y('Tamworth').low >= 6.5, 'Tamworth is not pulled down to the 3 to 5 percent asking price derivation');
  // the method is explained in the data
  assert.match(market.yieldMethod.whyNotDerived, /asking/);
  assert.match(market.yieldMethod.summary, /not derived from asking prices/);
});

test('comps carry a source URL and a date, and their per m2 figure matches price over area', () => {
  const bad = [];
  let n = 0;
  for (const [name, a] of Object.entries(market.areas)) {
    for (const f of ['saleComps', 'rentComps', 'showroomComps', 'officeComps', 'retailComps']) {
      for (const c of a[f] || []) {
        n++;
        if (!/^https?:\/\//.test(c.source || '')) bad.push(`${name} ${f} ${c.address}: source`);
        if (!c.date) bad.push(`${name} ${f} ${c.address}: date`);
        const amount = c.price ?? c.rent_pa;
        const per = c.per_m2 ?? c.per_m2_pa;
        if (isNum(amount) && isNum(c.gfa_m2) && isNum(per) && c.gfa_m2 > 0) {
          const calc = amount / c.gfa_m2;
          if (Math.abs(calc - per) / per > 0.03) bad.push(`${name} ${f} ${c.address}: ${per} listed, ${Math.round(calc)} worked out`);
        }
      }
    }
  }
  assert.ok(n > 250, `${n} comps`);
  assert.deepEqual(bad, []);
});

test('council charges, soft costs and build costs: sources, dates and the figures the feasibility reads', () => {
  const C = market.charges;
  assert.equal(C.NSW_s7_12.pct, 1);
  assert.equal(C.NSW_s7_12.threshold, 200000);
  assert.equal(C.NSW_s7_12.status, 'ESTIMATE');
  for (const n of ['Townsville', 'Mackay', 'Toowoomba']) { assert.equal(C.QLD.councils[n].status, 'VERIFIED_REPORT', n); assert.match(C.QLD.councils[n].sources[0], /^https:\/\/www\./); assert.ok(C.QLD.councils[n].industry > 0); }
  assert.deepEqual([C.QLD.councils.Townsville.industry, C.QLD.councils.Townsville.office, C.QLD.councils.Mackay.industry, C.QLD.councils.Toowoomba.stormwaterPerM2Impervious], [66.94, 187.48, 65.45, 13.1]);
  assert.equal(C.QLD.estimateDefault.status, 'ESTIMATE');
  assert.equal(market.softCosts.rbaCashRate.low, 4.85);
  assert.equal(market.buildCost.professionalFeesPct.low, 8);
  assert.equal(market.buildCost.nsw.strataWorkshopMezzanine_regionalNSW.low, 1500);
  assert.equal(market.buildCost.qld.strataWorkshopMezzanine_brisbane.high, 3170);
  // build-rates.json: ordered ranges, status, an as-at date, and its provenance
  assert.match(rates.asAt, DATE);
  for (const [k, r] of Object.entries(rates.rates)) { assert.ok((r.low > 0 || (r.perM2Wall && r.low === 0)) && r.high >= r.low, k); assert.ok(STATUS.has(r.status), k); assert.ok(r.source, k); }
});

test('wording in the data: no dashes, no compliant, dates in DD/MM/YYYY', () => {
  const text = JSON.stringify(market) + JSON.stringify(rates);
  assert.doesNotMatch(text, /[–—]/);
  assert.doesNotMatch(text, /compliant/i);
  assert.doesNotMatch(text, /nearmap/i);
  assert.doesNotMatch(text, /"(asAt|generated)":"\d{4}-\d{2}-\d{2}"/);
});

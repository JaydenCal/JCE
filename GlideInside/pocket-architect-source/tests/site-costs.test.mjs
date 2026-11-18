// Indicative site cost estimate: the maths (cut, fill, import and export, retaining, driveway, services, surcharge bands, contingency, range),
// the rate defaults (source and date on every one), the overrides and Reset, and the grading adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers/grading-harness.mjs';
import { estimateSiteCosts, siteCostsForFinance, slopeBand, accessBand } from '../src/premium/site-costs/estimate.js';
import { clearances } from '../src/site/lotplan.js';
import { readEarthworks } from '../src/premium/site-costs/earthworks-adapter.js';
import { RATE_DEFS, RATES_DATE, defaultSettings, resetSettings, loadSettings, saveSettings, rateOf, regionOf, isCustomised } from '../src/premium/site-costs/rates.js';

const EW = (o = {}) => ({ available: true, cutM3: 100, fillM3: 60, padAreaM2: 300, slopePct: 1, retaining: { lengthM: 0, faceM2: 0, tallFaceM2: 0, maxHeightM: 0 }, ...o });
const line = (e, id) => e.lines.find((l) => l.id === id);
const project = () => H.residential({ fall: 0.2 });

test('rates: every default has NSW and QLD figures, a source note and a date', () => {
  assert.match(RATES_DATE, /^\d{2}\/\d{2}\/\d{4}$/);
  for (const d of RATE_DEFS) {
    assert.ok(d.nsw >= 0 && d.qld >= 0, d.id);
    assert.ok(d.source && d.source.length > 20, `source note ${d.id}`);
    assert.ok(d.lowF <= 1 && d.highF >= 1, `range factors ${d.id}`);
    assert.ok(!/[–—]/.test(d.source + d.label), 'no en or em dashes');
    assert.ok(!/compliant/i.test(d.source + d.label));
  }
  assert.deepEqual(new Set(RATE_DEFS.map((d) => d.id)).size, RATE_DEFS.length, 'unique ids');
});

test('estimate: earthworks lines use the grading volumes, with net export bulked', () => {
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW() });
  assert.equal(e.ok, true);
  assert.equal(line(e, 'cut_excavate').qty, 100);
  assert.equal(line(e, 'cut_excavate').likely, 100 * 28);
  assert.equal(line(e, 'fill_place').likely, 60 * 32);
  const ex = line(e, 'export_spoil');
  assert.equal(ex.qty, 50, 'net 40 m3 bulked by 1.25');
  assert.equal(ex.likely, 50 * 46);
  assert.equal(line(e, 'import_fill'), undefined);
  assert.equal(line(e, 'site_prep').likely, 300 * 14);
});

test('estimate: a shortfall is imported, not exported', () => {
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ cutM3: 20, fillM3: 90 }) });
  assert.equal(line(e, 'import_fill').qty, 70);
  assert.equal(line(e, 'import_fill').likely, 70 * 58);
  assert.equal(line(e, 'export_spoil'), undefined);
});

test('estimate: retaining only where batters do not fit, with the taller wall factor', () => {
  const none = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW() });
  assert.equal(line(none, 'retain_face'), undefined);
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ retaining: { lengthM: 12, faceM2: 20, tallFaceM2: 8, maxHeightM: 1.6 } }) });
  assert.equal(line(e, 'retain_face').qty, 12);
  assert.equal(line(e, 'retain_face').likely, 12 * 380);
  assert.equal(line(e, 'retain_tall').qty, 8);
  assert.equal(line(e, 'retain_tall').likely, 8 * 380 * 1.4);
});

test('estimate: rock allowance is an option, off by default', () => {
  const off = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW() });
  assert.equal(line(off, 'rock_extra'), undefined);
  const s = { ...defaultSettings(), rock: { enabled: true, fractionOfCut: 0.3 } };
  const on = estimateSiteCosts(project(), { settings: s, earthworks: EW() });
  assert.equal(line(on, 'rock_extra').qty, 30);
  assert.equal(line(on, 'rock_extra').likely, 30 * 150);
  assert.ok(on.total.likely > off.total.likely);
  assert.ok(line(on, 'rock_extra').high / line(on, 'rock_extra').likely > 2, 'rock has a wide high figure');
});

test('estimate: driveway, crossover and services by distance from the street', () => {
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW() });
  assert.ok(line(e, 'drive_slab').qty > 0 && line(e, 'crossover').qty > 0);
  const run = e.inputs.serviceRunM;
  assert.ok(run > 2);
  assert.equal(line(e, 'water_run').qty, Math.round(run * 100) / 100);
  assert.equal(line(e, 'water_conn').likely, 1600);
  assert.ok(line(e, 'sewer_run'), 'sewer on a suburban lot');
  const front = Math.min(...clearances(project()).rows.filter((r) => r.kind === 'front' || r.kind === 'secondaryFront').map((r) => r.clearanceM));
  assert.equal(run, front + 2, 'run is the building to street distance plus 2 m to the connection');
  assert.equal(line(e, 'power_run').likely, run * 70);
});

test('estimate: a rural lot has no sewer and an on site wastewater system', () => {
  const p = project();
  p.site.lot.areaM2 = 20000;
  p.site.lot.registeredAreaM2 = 20000;
  p.site.lot.zoning = { code: 'RU1', name: 'Primary Production' };
  const e = estimateSiteCosts(p, { settings: defaultSettings(), earthworks: EW() });
  assert.equal(e.rural, true);
  assert.equal(line(e, 'sewer_run'), undefined);
  assert.equal(line(e, 'onsite_wastewater').likely, 18000);
});

test('estimate: slope and access surcharge bands', () => {
  assert.equal(slopeBand(1), 0);
  assert.equal(slopeBand(5), 1);
  assert.equal(slopeBand(10), 2);
  assert.equal(slopeBand(20), 3);
  assert.equal(accessBand({ frontage: 15, driveLengthM: 12 }), 0);
  assert.equal(accessBand({ frontage: 8, driveLengthM: 12 }), 1);
  assert.equal(accessBand({ frontage: 15, driveLengthM: 35 }), 1);
  assert.equal(accessBand({ frontage: 3.5, driveLengthM: 12 }), 2);
  const flat = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ slopePct: 1 }) });
  const steep = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ slopePct: 10 }) });
  assert.equal(flat.surcharges.find((s) => /^Slope/.test(s.label)).likely, 0);
  const sl = steep.surcharges.find((s) => /^Slope/.test(s.label));
  assert.ok(Math.abs(sl.likely - steep.lines.reduce((a, l) => a + l.likely, 0) * 0.09) < 0.01, 'steep band is 9 percent of the works');
});

test('estimate: contingency is a percentage of the works and the total adds up; low is under likely is under high', () => {
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ slopePct: 5, retaining: { lengthM: 10, faceM2: 6, tallFaceM2: 0, maxHeightM: 0.6 } }) });
  const works = e.lines.reduce((a, l) => a + l.likely, 0) + e.surcharges.reduce((a, l) => a + l.likely, 0);
  assert.ok(Math.abs(e.contingency.likely - works * 0.1) < 0.01);
  assert.ok(Math.abs(e.totalExact.likely - works * 1.1) < 0.01);
  assert.ok(e.total.low < e.total.likely && e.total.likely < e.total.high);
  assert.equal(e.total.likely % 50, 0, 'rounded to 50 dollars');
  for (const l of e.lines) assert.ok(l.low <= l.likely && l.likely <= l.high, l.id);
});

test('estimate: QLD defaults differ from NSW and the region follows the lot state or the setting', () => {
  const p = project();
  p.site.lot.state = 'NSW';
  const nsw = estimateSiteCosts(p, { settings: defaultSettings(), earthworks: EW() });
  assert.equal(nsw.region, 'nsw');
  assert.equal(line(nsw, 'cut_excavate').rate, 28);
  p.site.lot.state = 'QLD';
  const qld = estimateSiteCosts(p, { settings: defaultSettings(), earthworks: EW() });
  assert.equal(qld.region, 'qld');
  assert.equal(line(qld, 'cut_excavate').rate, 30);
  assert.ok(qld.total.likely > nsw.total.likely);
  const forced = estimateSiteCosts(p, { settings: { ...defaultSettings(), region: 'nsw' }, earthworks: EW() });
  assert.equal(forced.region, 'nsw');
});

test('rates: an override changes the estimate and is marked custom; Reset puts the defaults back', () => {
  const p = project();
  const base = estimateSiteCosts(p, { settings: defaultSettings(), earthworks: EW() });
  const s = { ...defaultSettings(), rates: { cut_excavate: { nsw: 50 } } };
  const mine = estimateSiteCosts(p, { settings: s, earthworks: EW() });
  assert.equal(line(mine, 'cut_excavate').rate, 50);
  assert.equal(line(mine, 'cut_excavate').custom, true);
  assert.equal(mine.ratesCustomised, true);
  assert.ok(mine.total.likely > base.total.likely);
  assert.equal(isCustomised(s, 'cut_excavate', 'nsw'), true);
  // storage round trip with a tiny in memory localStorage
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    assert.ok(saveSettings(s));
    assert.equal(rateOf(loadSettings(), 'cut_excavate', 'nsw'), 50);
    assert.equal(estimateSiteCosts(p, { earthworks: EW() }).ratesCustomised, true, 'estimateSiteCosts(project) reads the saved rates');
    const back = resetSettings();
    assert.deepEqual(back, defaultSettings());
    assert.equal(rateOf(loadSettings(), 'cut_excavate', 'nsw'), 28);
    assert.equal(estimateSiteCosts(p, { earthworks: EW() }).total.likely, base.total.likely);
  } finally { delete globalThis.localStorage; }
  // bad stored data is ignored
  globalThis.localStorage = { getItem: () => '{"rates":{"cut_excavate":{"nsw":"abc"},"nope":{"nsw":1}},"region":"zzz"}', setItem() {}, removeItem() {} };
  try { assert.equal(rateOf(loadSettings(), 'cut_excavate', 'nsw'), 28); assert.equal(loadSettings().region, 'auto'); } finally { delete globalThis.localStorage; }
  assert.equal(regionOf(null, defaultSettings()), 'nsw');
});

test('estimate: no lot gives ok false; no ground levels uses a flat allowance and says so', () => {
  assert.equal(estimateSiteCosts({ site: {} }, { settings: defaultSettings() }).ok, false);
  const e = estimateSiteCosts(project(), { settings: defaultSettings(), earthworks: EW({ available: false, cutM3: 0, fillM3: 0, slopePct: null }) });
  assert.ok(line(e, 'flat_allowance'));
  assert.equal(line(e, 'cut_excavate'), undefined);
  assert.ok(e.assumptions.some((a) => /No ground levels/.test(a)));
});

test('estimate: finance export gives whole dollars and no dashes or the word compliant in any text', () => {
  const p = project();
  const f = siteCostsForFinance(p, { settings: defaultSettings(), earthworks: EW() });
  assert.ok(f.lowAud < f.likelyAud && f.likelyAud < f.highAud);
  assert.equal(f.indicative, true);
  const e = estimateSiteCosts(p, { settings: defaultSettings(), earthworks: EW({ retaining: { lengthM: 5, faceM2: 6, tallFaceM2: 2, maxHeightM: 1.3 } }) });
  const all = JSON.stringify([e.lines.map((l) => l.label + l.note), e.assumptions, e.disclaimer]);
  assert.ok(!/[–—]/.test(all));
  assert.ok(!/compliant/i.test(all));
  assert.equal(siteCostsForFinance({ site: {} }), null);
});

test('adapter: reads cut, fill, slope and retaining from the grading engine, and nothing when there are no ground levels', () => {
  const gentle = readEarthworks(H.residential({ fall: 0.2 }));
  const steep = readEarthworks(H.residential({ fall: 8 }));
  assert.equal(gentle.available, true);
  assert.ok(steep.cutM3 + steep.fillM3 > gentle.cutM3 + gentle.fillM3, 'a steeper lot moves more earth');
  assert.ok(steep.slopePct > gentle.slopePct);
  assert.ok(steep.retaining.faceM2 >= gentle.retaining.faceM2);
  assert.ok(gentle.padAreaM2 > 0);
  const p = H.residential();
  delete p.site.lot.terrain;
  const none = readEarthworks(p);
  assert.equal(none.available, false);
  assert.equal(none.cutM3, 0);
  assert.equal(readEarthworks({ site: {} }).available, false);
});

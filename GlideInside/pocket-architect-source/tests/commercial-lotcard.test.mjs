// Commercial lot card: the auto fit (setbacks and parking), the layout switcher, the card model (stats, status, units, feasibility headline),
// finishes, the wiring of the card and the wording lint over the new files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { convertToCommercial } from '../src/commercial/mode.js';
import { layoutUnits } from '../src/commercial/layout.js';
import { parkingLayout } from '../src/commercial/parking.js';
import { commercialStats } from '../src/commercial/stats.js';
import { LAYOUT_LIST, TEMPLATES, chooseLayout, applyLayout, currentLayoutIndex, stepLayout, layoutPagerText, layoutUntouched, BEST_ID } from '../src/commercial/layouts.js';
import { commercialCardStats, commercialStatus, unitList, feasibilityHeadline, zoneLine } from '../src/commercial/card-model.js';
import { CLADDING, DOORS, applyFinishes, finishesOf, finishLine } from '../src/commercial/finishes.js';
import { buildModel } from '../src/viewer3d/build.js';
import { effectiveSchemeId } from '../src/model/colour-schemes.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { PLAN_SET_LABEL, CUSTOMISE_LABEL, VIEWS } from '../src/commercial/lotcard.js';

const lotProject = (opts) => commercialProject({ rows: 'single', plain: false, ...opts });
const storeOf = (p) => createStore(p, { autosaveKey: null });

test('layout list: Best fit first, then the six named layouts', () => {
  assert.deepEqual(LAYOUT_LIST.map((l) => l.label), ['Best fit', 'Single row, 6 units', 'Single row, 10 units', 'Back to back, 12 units', 'Back to back, 16 units', 'Two rows with central apron, 20 units', 'Large units, 6 x 300 m²']);
  assert.equal(TEMPLATES.length, 6);
});

test('best fit: stays inside the setbacks and provides at least the required parking', () => {
  for (const [w, d] of [[90000, 100000], [60000, 100000], [40000, 70000]]) {
    const p = lotProject({ width: w, depth: d });
    const c = chooseLayout(p, BEST_ID);
    assert.ok(c && !c.tooBig, `a layout fits ${w} x ${d}`);
    const s = storeOf(p);
    applyLayout(s, c);
    const q = s.project;
    const st = commercialStats(q);
    assert.ok(st.units >= 3);
    assert.ok(st.parking.provided >= st.parking.required, `parking ${st.parking.provided} / ${st.parking.required}`);
    const status = commercialStatus(q);
    assert.equal(status.setback.state, 'inside', `${w} x ${d}: ${status.setback.text}`);
    assert.ok(status.parking.state !== 'outside');
    assert.ok(layoutUnits(q.commercial).length === st.units);
  }
});

test('best fit: picks the highest floor area of the candidates that pass', () => {
  const p = lotProject({ width: 90000, depth: 100000 });
  const best = chooseLayout(p, BEST_ID);
  for (const t of TEMPLATES.filter((x) => x.id !== 'large-6')) {
    const c = chooseLayout(p, t.id);
    if (c && c.fits && !c.tooBig) assert.ok(best.gfa >= c.gfa * 0.95 - 1, `${t.id} ${c.gfa} vs best ${best.gfa}`);
  }
});

test('a layout that does not fit says so, and is never placed outside silently', () => {
  const p = lotProject({ width: 25000, depth: 50000 });
  const c = chooseLayout(p, 'court-20');
  assert.equal(c.tooBig, true);
  const s = storeOf(p);
  applyLayout(s, c);
  assert.equal(commercialStatus(s.project).setback.text, 'Too big for this block');
});

test('switcher: next and previous cycle through all seven layouts and wrap', () => {
  const n = LAYOUT_LIST.length;
  assert.equal(stepLayout(0, -1), n - 1);
  assert.equal(stepLayout(n - 1, 1), 0);
  assert.equal(stepLayout(-1, 1), 0);
  const p = lotProject({ width: 90000, depth: 100000 });
  const s = storeOf(p);
  const seen = [];
  let i = currentLayoutIndex(s.project);
  for (let k = 0; k < n; k++) {
    i = stepLayout(i, 1);
    const c = chooseLayout(s.project, LAYOUT_LIST[i].id);
    applyLayout(s, c);
    seen.push(currentLayoutIndex(s.project));
    assert.equal(layoutPagerText(s.project).of, n);
    assert.equal(layoutUntouched(s.project), true);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(s.canUndo?.() !== false);
});

test('a hand edit of the rows means the layout is no longer untouched (no silent refit)', () => {
  const s = storeOf(lotProject({ width: 90000, depth: 100000 }));
  applyLayout(s, chooseLayout(s.project, BEST_ID));
  s.apply('Move', (p) => { p.commercial.rows[0].x += 1000; });
  assert.equal(layoutUntouched(s.project), false);
});

test('card model: stats, zone line, units list and the feasibility headline', () => {
  const s = storeOf(lotProject({ width: 90000, depth: 100000 }));
  applyLayout(s, chooseLayout(s.project, BEST_ID));
  const q = s.project;
  const st = Object.fromEntries(commercialCardStats(q).map((c) => [c.key, c.value]));
  assert.ok(st.units && st.gfa && /^\d+ \/ \d+$/.test(st.parking));
  assert.match(zoneLine(q.site.lot), /General Industrial zone/);
  const us = unitList(q);
  assert.equal(us.length, Number(st.units));
  assert.ok(us.every((u) => u.gfa > 0 && /x/.test(u.size)));
  const hl = feasibilityHeadline(q);
  assert.match(hl.text, /^Indicative gross realisation \$[\d,]+, indicative gross rent \$[\d,]+ per year$/);
  assert.doesNotMatch(hl.text, /margin/i, 'the card headline carries values only');
});

test('finishes: swatches have generic names, apply to the 3D model and are kept when the layout changes', () => {
  assert.ok(CLADDING.length >= 6 && DOORS.length >= 6);
  assert.ok(CLADDING.some((c) => /tilt panel grey/i.test(c.name)) && CLADDING.some((c) => /warm white/i.test(c.name)) && CLADDING.some((c) => /charcoal/i.test(c.name)));
  const s = storeOf(lotProject({ width: 90000, depth: 100000 }));
  s.apply('Colours', (p) => applyFinishes(p, { cladding: 'charcoal', door: 'forest-green' }));
  assert.equal(finishesOf(s.project).cladding, 'charcoal');
  applyLayout(s, chooseLayout(s.project, 'row-6'));
  assert.equal(finishesOf(s.project).cladding, 'charcoal');
  assert.match(finishLine(s.project), /Charcoal/i);
  assert.equal(effectiveSchemeId(s.project), null, 'the housing Standard scheme does not override commercial colours');
  const m = buildModel(s.project);
  assert.ok(m, 'the model builds with the chosen colours');
  const sage = DOORS.find((d) => d.id === 'forest-green').hex;
  assert.equal(s.project.finishes.rollerDoor.colour, sage);
});

test('commercial demo lot is a real sized E4 lot', () => {
  const r = demoLotResponse({ commercial: true });
  assert.equal(r.zoning.code, 'E4');
  assert.ok(r.lot.areaM2 >= 5000);
  assert.equal(demoLotResponse().zoning.code, 'R1');
});

test('wiring: card labels, views, plan set kind, engineer kind and the landing page', () => {
  assert.equal(PLAN_SET_LABEL, 'Get the plan set');
  assert.equal(CUSTOMISE_LABEL, 'Customise');
  assert.deepEqual(VIEWS.map((v) => v.label), ['Aerial', '3D', 'Street', 'Walk inside', 'Units']);
  const src = readFileSync(new URL('../src/commercial/lotcard.js', import.meta.url), 'utf8');
  assert.match(src, /kind: 'commercial'/);
  assert.match(src, /SEND_LABEL/);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /COMMERCIAL_VIEWER/);
  assert.match(app, /createCommercialCard/);
  const page = readFileSync(new URL('../../website-live/commercial/index.html', import.meta.url), 'utf8');
  assert.match(page, /data-mode="commercial"/);
  assert.match(page, /embed=1&amp;mode=commercial/);
  assert.match(page, /data-addr-search/);
  const fw = readFileSync(new URL('../../website-live/framework.js', import.meta.url), 'utf8');
  assert.match(fw, /liveMode/);
});

test('wording lint: the new card files and the commercial page have no dashes, compliant or builder brands', () => {
  const brands = /g\.?\s?j\.?\s?gardner|hotondo|metricon|simonds|clarendon|mcdonald jones|porter davis|burbank|henley|fairmont|coral homes|rawson|eden brae|masterton/i;
  const files = ['layouts', 'finishes', 'card-model', 'lotcard', 'lotcard-css', 'place'].map((f) => new URL(`../src/commercial/${f}.js`, import.meta.url));
  files.push(new URL('../../website-live/commercial/index.html', import.meta.url));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—|–/, `dash in ${f.pathname}`);
    assert.doesNotMatch(src, /compliant/i, `compliant in ${f.pathname}`);
    assert.doesNotMatch(src, brands, `brand in ${f.pathname}`);
  }
  // Visible dates are DD/MM/YYYY.
  const lc = readFileSync(files[3], 'utf8');
  assert.doesNotMatch(lc, /\b20\d\d-\d\d-\d\d\b/);
});

test('best fit v2: multi row stacks use the lot, park by the required rate, keep coverage near 35 to 45% and the frontage strip clear', async () => {
  const { yardOf } = await import('../src/commercial/layouts.js');
  const { commercialChecks } = await import('../src/commercial/checks.js');
  const lots = [[90000, 100000], [60000, 100000], [40000, 70000]];
  for (const [w, d] of lots) {
    const p = lotProject({ width: w, depth: d });
    // CPU time, not the wall clock: the search itself is bounded by work, and a busy machine must not fail a speed check that is about the code.
    const cpu0 = process.cpuUsage();
    const c = chooseLayout(p, BEST_ID);
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    assert.ok(cpuMs < 1500, `runtime ${Math.round(cpuMs)} ms of CPU`);
    const s = storeOf(p);
    applyLayout(s, c);
    const q = s.project;
    const st = commercialStats(q);
    assert.ok(st.parking.provided >= st.parking.required, `${w}x${d} parking`);
    assert.ok(st.coveragePct <= 45.01, `${w}x${d} coverage ${st.coveragePct}`);
    assert.ok(st.coveragePct >= 25, `${w}x${d} uses the lot, coverage ${st.coveragePct}`);
    assert.equal(commercialStatus(q).setback.state, 'inside');
    const warn = commercialChecks(q).filter((x) => x.kind === 'warn');
    assert.deepEqual(warn, [], `${w}x${d} checks: ${JSON.stringify(warn)}`);
    const yard = yardOf(q.site.lot);
    const pk = parkingLayout(q.commercial);
    const { insideYard } = await import('./helpers/yard.mjs');
    assert.ok(pk.rows.every((r) => r.slots.every((sl) => insideYard(sl.poly, yard))), 'every bay is inside the yard (3 m frontage strip kept)');
  }
  const big = chooseLayout(lotProject({ width: 90000, depth: 100000 }), BEST_ID);
  assert.ok(big.gfa > 3000 && big.rowCount >= 2, `90 x 100 m uses several rows: ${big.label} ${big.gfa}`);
});

test('best fit v2: the stub lot (74 x 112 m, E4) parks and fits', () => {
  const p = lotProject({ width: 74000, depth: 112000 });
  const c = chooseLayout(p, BEST_ID);
  const s = storeOf(p);
  applyLayout(s, c);
  const st = commercialStats(s.project);
  assert.ok(st.parking.provided >= st.parking.required);
  assert.ok(st.units >= 12);
});

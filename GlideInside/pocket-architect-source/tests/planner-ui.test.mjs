// Lot viewer in the Lot Planner layout: the design switcher data source (public samples versus a signed in organisation's own library),
// the setback auto fit on first placement ("Too big for this block" when nothing fits), and the wiring of the two plan set PDF buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { designsFor, builderDesigns, PUBLIC_TEMPLATE_IDS } from '../src/lotcard/designs.js';
import { poseFor, swapHouse } from '../src/lotcard/swap.js';
import { setbackStatusLine, TOO_BIG } from '../src/site/lot-checks.js';
import { lotHeading } from '../src/lotcard/stats.js';
import { createStore } from '../src/model/store.js';
import { buildingHull } from '../src/site/lotplan.js';
import { houseBounds } from '../src/portal/place-house.js';

const BUILDER_BRANDS = /mcdonald|jones homes|hotondo|masterton|coral homes|allworth|gardner|hunter homes|montgomery|tullipan|mojo|brand/i;
const emptyLot = () => {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  p.site.lot = buildSiteLot({ lot: demoLotResponse(), address: '', source: 'sample' });
  return p;
};
const withSetbacks = (p) => { p.site.lot.setbacks = { front: 6, side: 0.9, rear: 3 }; p.site.lot.envelope = null; return p; };
const library = (id) => migrate(catalogue.createFromTemplate(id));
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test('switcher: anonymous visitors cycle the public sample designs, with no builder names', async () => {
  const p = withSetbacks(emptyLot());
  const list = await designsFor({ catalogue, project: p, provider: null });
  assert.ok(list.length >= 2, 'there is something to cycle');
  for (const d of list) {
    assert.ok(PUBLIC_TEMPLATE_IDS.includes(d.id), `${d.id} is a public template`);
    assert.equal(d.group, 'public');
    assert.ok(!BUILDER_BRANDS.test(d.name), `no builder brand in "${d.name}"`);
  }
});

test('switcher: a signed in builder or client cycles their own organisation library and only that', async () => {
  const p = withSetbacks(emptyLot());
  const all = [
    { id: 'h1', name: 'Own One', group: 'builder', project: library('house_single') },
    { id: 'h2', name: 'Own Two', group: 'builder', project: library('house_double') },
    { id: 'g1', name: 'Glide Generic', group: 'glide', project: library('house_single') },
  ];
  let asked = 0;
  const provider = async (project) => { asked += 1; return builderDesigns(project, all, { allowGlide: false }); };
  const list = await designsFor({ catalogue, project: p, provider });
  assert.equal(asked, 1, 'the portal provider is the data source, not the public templates');
  assert.deepEqual(list.map((d) => d.id).sort(), ['h1', 'h2']);
  assert.ok(!list.some((d) => PUBLIC_TEMPLATE_IDS.includes(d.id)), 'no public template leaks into a signed in carousel');
});

test('lot tag: LOT n DP for a registered lot, PROPOSED LOT for a concept lot', () => {
  const lot = { lotNumber: '12', planLabel: 'DP 123456' };
  assert.equal(lotHeading(lot).toUpperCase(), 'LOT 12 DP 123456');
  assert.equal(lotHeading({ proposed: true, lotNumber: '1' }).toUpperCase(), 'PROPOSED LOT 1');
});

test('auto fit: a design that can fit the setbacks is placed inside them with the garage to the street', () => {
  const p = withSetbacks(emptyLot());
  const house = library('house_single');
  const { pose, fits, tooBig } = poseFor(p, house);
  assert.equal(fits, true);
  assert.equal(tooBig, false);
  const store = createStore(p, { autosaveKey: null, opContext: { catalogue } });
  swapHouse(store, house, { id: 'house_single', name: 'Single' });
  const line = setbackStatusLine(store.project);
  assert.equal(line.state, 'inside', line.text);
  assert.ok(pose && Number.isFinite(pose.rotation));
});

test('auto fit: a block that only fits the house turned square is searched, not reported outside', () => {
  const p = emptyLot();
  const house = library('house_single');
  const b = houseBounds(house);
  const w = Math.max(b.width, b.depth);
  const d = Math.min(b.width, b.depth);
  // An envelope that is long in plan x and short in y, so the house must be turned to match whichever way it is drawn.
  p.site.lot.envelope = rect(-(w + 800) / 2, -(d + 800) / 2, (w + 800) / 2, (d + 800) / 2);
  const { pose, fits } = poseFor(p, house);
  assert.equal(fits, true, 'a turn and position that fit exist and are found');
  const store = createStore(p, { autosaveKey: null, opContext: { catalogue } });
  swapHouse(store, house, { id: 'house_single', name: 'Single' });
  const hull = buildingHull(store.project);
  assert.ok(hull.length >= 3 && pose);
  assert.equal(setbackStatusLine(store.project).state, 'inside');
});

test('auto fit: a block too small for the house says "Too big for this block"', () => {
  const p = emptyLot();
  p.site.lot.envelope = rect(-2500, -2500, 2500, 2500);
  const house = library('house_double');
  const store = createStore(p, { autosaveKey: null, opContext: { catalogue } });
  const r = swapHouse(store, house, { id: 'house_double', name: 'Double' });
  assert.equal(r.fits, false);
  assert.equal(r.tooBig, true);
  const line = setbackStatusLine(store.project);
  assert.equal(line.state, 'outside');
  assert.equal(line.text, TOO_BIG);
  assert.equal(TOO_BIG, 'Too big for this block');
});

test('viewer wiring: the card has Site plan PDF and House plan PDF buttons that call exportPlanSet, and the embed look is on', () => {
  const src = readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8');
  assert.match(src, /'Site plan PDF'/);
  assert.match(src, /'House plan PDF'/);
  assert.match(src, /exportPlanSet\(\{ project: store\.project, lot, kind, builderName/);
  assert.match(src, /planset\/index\.js/);
  assert.match(src, /Search a NSW or QLD address/);
  assert.match(src, /Concept only · Glide Inside · JCE Infrastructure/);
});

test('rules: no dashes and no "compliant" in the viewer UI text', () => {
  for (const f of ['../src/lotcard/lot-card.js', '../src/lotcard/lot-card-css.js', '../src/site/lot-checks.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const strings = [...src.matchAll(/'([^'\n]{3,})'/g)].map((m) => m[1]).filter((t) => /\s/.test(t) && !/^[.#\w:\[\]=>~*"-]+$/.test(t));
    for (const t of strings) {
      assert.ok(!/[\u2013\u2014]/.test(t), `dash in "${t}"`);
      assert.ok(!/compliant/i.test(t) || /never/i.test(t), `compliant in "${t}"`);
    }
  }
});

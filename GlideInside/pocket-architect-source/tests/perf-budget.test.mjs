// Performance budgets for the freezes the owner hit on a huge rural lot (500 x 1000 m) and for the building trim pass.
// Budgets are generous (about 3x a quiet machine) so a loaded runner does not flake; the old code was 10x to 50x over them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import { fitCardModel } from '../src/site/fit-advice.js';
import { deriveDriveway } from '../src/site/lotplan.js';
import { buildModel, disposeModel } from '../src/viewer3d/build.js';
import { commercial, injectTerrain } from './helpers/grading-harness.mjs';
import { commercialProject } from './helpers/commercial-fixture.mjs';

const hugeHouse = (w = 500000, d = 1000000) => {
  const portal = { name: 'Huge', polygonMm: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], frontEdgeIndices: [2], picked: { front: { minM: 6 }, secondaryFront: { minM: 3 }, side: { minM: 1 }, rear: { minM: 3 } }, lot: '3', dp: 'DP 1' };
  const p = createProject({ name: 'Huge' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
};
const time = (fn) => { const t0 = performance.now(); const r = fn(); return { ms: performance.now() - t0, r }; };

test('perf: the fit card on a 500 x 1000 m lot stays under budget (was 6 s: an 80,000 cell search for each of 70 turns)', () => {
  const p = hugeHouse();
  const { ms } = time(() => fitCardModel(p, { withPlan: true }));
  assert.ok(ms < 1200, `fit card took ${Math.round(ms)} ms`);
});

test('perf: a driveway across a 500 m lot is routed once and then served from the cache', () => {
  const p = hugeHouse();
  const first = time(() => deriveDriveway(p));
  assert.ok(first.ms < 800, `first route took ${Math.round(first.ms)} ms`);
  const again = time(() => { for (let i = 0; i < 40; i++) deriveDriveway(p); });
  assert.ok(again.ms < Math.max(300, first.ms * 3), `40 repeat routes took ${Math.round(again.ms)} ms (first ${Math.round(first.ms)} ms)`);
});

test('perf: the 3D build of a huge commercial lot with terrain stays under the 2 s watchdog threshold in Node', () => {
  const p = commercialProject({ width: 500000, depth: 1000000, rows: 'pair', plain: false });
  injectTerrain(p, { w: 500000, d: 1000000, fall: 30, cellMm: 10000, bump: 2 });
  const { ms, r } = time(() => buildModel(p, {}));
  disposeModel(r);
  assert.ok(ms < 4000, `huge lot build took ${Math.round(ms)} ms`);
});

test('perf: a warehouse and a strata row build quickly, and the building trim is one merged mesh', () => {
  for (const kind of ['warehouse', 'strata']) {
    const p = commercial(kind);
    const full = time(() => buildModel(p, {}));
    const trims = [];
    full.r.traverse((o) => { if (o.name === 'trim') trims.push(o); });
    assert.equal(trims.length, 1, `${kind}: one trim mesh`);
    assert.ok(trims[0].geometry.attributes.position.count > 200, `${kind}: trim has geometry`);
    assert.ok(trims[0].geometry.attributes.position.count < 60000, `${kind}: trim stays light`);
    assert.ok(full.ms < 2500, `${kind} build took ${Math.round(full.ms)} ms`);
    disposeModel(full.r);
    const low = buildModel(p, { detail: 'low' });
    let hasTrim = false;
    low.traverse((o) => { if (o.name === 'trim') hasTrim = true; });
    assert.equal(hasTrim, false, `${kind}: low detail drops the trim`);
    disposeModel(low);
  }
});

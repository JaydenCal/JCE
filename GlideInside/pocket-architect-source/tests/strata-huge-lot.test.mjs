// Strata estates on a huge rural lot: the estate is capped near the frontage, the rest is balance land, the bulky goods showroom has no run of
// repeated slabs, and the feasibility costs the land on the development area with plain wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as L from '../src/commercial/layouts.js';
import { layoutUnits } from '../src/commercial/layout.js';
import { feasibility, costRows, feasibilityNotes } from '../src/commercial/feasibility.js';
import { checkSummary } from '../src/flow/com-logic.js';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { pavementAreas } from '../src/commercial/catalogue/pavements/logic.js';
import * as G from '../src/model/geometry.js';

// 509,265 m2: 700 m x 727.5 m
const huge = () => commercialProject({ rows: 'none', width: 700000, depth: 727500, plain: false });

test('huge lot: the strata estate is capped near 40 units and the rest is labelled balance of lot', () => {
  const store = createStore(huge(), { autosaveKey: null });
  const ch = L.chooseLayout(store.project, 'best');
  L.applyLayout(store, ch);
  const c = store.project.commercial;
  const n = layoutUnits(c).length;
  assert.ok(n >= 1 && n <= 44, `units ${n}`);
  assert.ok(c.siteWorks.balance && c.siteWorks.balance.polygons.length >= 1, 'balance of lot polygons');
  assert.equal(c.siteWorks.balance.label, 'BALANCE OF LOT');
  const lot = store.project.site.lot;
  const lotArea = Math.abs(G.polygonArea(lot.boundary)) / 1e6;
  assert.ok(c.siteWorks.balance.areaM2 > lotArea * 0.7, 'most of the lot is balance');
});

test('huge lot: bulky goods showroom has no long run of repeated pavement slabs along the road', () => {
  const store = createStore(huge(), { autosaveKey: null });
  applyBuildingChoice(store, chooseBuilding(store.project, 'bulky-goods-showroom'));
  const c = store.project.commercial;
  const areas = pavementAreas(c);
  const spans = areas.map((a) => { const xs = a.polygon.map((q) => q.x); return Math.max(...xs) - Math.min(...xs); });
  assert.ok(Math.max(...spans, 0) < 150000, `longest pavement area ${Math.max(...spans)} mm`);
  assert.ok(areas.length < 40, `${areas.length} pavement areas`);
});

test('feasibility on a huge lot: land is costed on the development area only, and says so', () => {
  const store = createStore(huge(), { autosaveKey: null });
  L.applyLayout(store, L.chooseLayout(store.project, 'best'));
  const f = feasibility(store.project.commercial, store.project.site.lot);
  assert.ok(f.hugeLot);
  assert.ok(f.landM2 < f.lotM2 * 0.5, `land basis ${f.landM2} of ${f.lotM2}`);
  const land = costRows(f)[0][0];
  assert.match(land, /development area only/);
  assert.ok(feasibilityNotes(f).some((t) => /development area only/.test(t)));
});

test('step 4 wording on a huge lot: provided and required bays, coverage under 0.1%, truck access not applicable, low margin reason', () => {
  const store = createStore(huge(), { autosaveKey: null });
  L.applyLayout(store, L.chooseLayout(store.project, 'best'));
  const s = checkSummary(store.project);
  assert.match(s.accessibleText, /^\d+ provided, (\d+ required|none required)$/);
  assert.doesNotMatch(s.accessibleText, / of /);
  const vast = createStore(commercialProject({ rows: 'none', width: 4000000, depth: 4000000, plain: false }), { autosaveKey: null });
  L.applyLayout(vast, L.chooseLayout(vast.project, 'best'));
  const sv = checkSummary(vast.project);
  assert.equal(sv.coverageText, '<0.1%');
  assert.ok(sv.lines.some((t) => t.includes('<0.1%')));
  const small = createStore(commercialProject({ rows: 'none', plain: false }), { autosaveKey: null });
  applyBuildingChoice(small, chooseBuilding(small.project, 'bulky-goods-showroom'));
  assert.ok(typeof checkSummary(small.project).truck.has === 'boolean');
  const f = feasibility(store.project.commercial, store.project.site.lot);
  if (f.mid.marginSalePct < -50) assert.ok(s.lines.some((t) => /margin is below -50%/.test(t)), 'reason given for a margin below -50%');
});

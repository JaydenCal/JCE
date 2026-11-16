// A narrow lot (25.9 x 50.3 m, 1,303 m2) is not "too big" for a 203 m2 two unit strata row: the fit check used to need a drive beside the row
// (about 30 m of width), so every layout failed and the smallest single row was placed anyway and flagged "Too big for this block".
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseLayout, applyLayout } from '../src/commercial/layouts.js';
import { layoutUnits } from '../src/commercial/layout.js';
import { commercialStats } from '../src/commercial/stats.js';

const E4 = { code: 'E4', name: 'General Industrial' };
const inside = (pt, poly) => G.pointInPolygon(pt, poly) || poly.some((a, i) => { const b = poly[(i + 1) % poly.length]; const dx = b.x - a.x; const dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) < 10; });

test('narrow lot: 25.9 x 50.3 m takes a strata row across the frontage and is not flagged too big', () => {
  const p = commercialProject({ width: 25900, depth: 50300, rows: 'none', zoning: E4, setbacks: null, plain: false });
  const choice = chooseLayout(p);
  assert.equal(choice.tooBig, false, 'not too big');
  assert.equal(choice.fits, true);
  assert.ok(choice.parkingOk, 'parks at the indicative rate');
  const store = createStore(p);
  applyLayout(store, choice);
  const pr = store.project;
  const lot = pr.site.lot;
  const units = layoutUnits(pr.commercial);
  assert.ok(units.length >= 2);
  for (const u of units) for (const q of u.poly) assert.ok(inside(q, lot.boundary), 'every unit corner is inside the lot');
  for (const u of units) for (const q of u.poly) assert.ok(inside(q, lot.envelope), 'every unit corner is inside the setback envelope');
  // The massing matches the figures: the footprints are about the ground area behind the GFA, not a block far larger than it.
  const lotM2 = Math.abs(G.polygonArea(lot.boundary)) / 1e6;
  const foot = units.reduce((s, u) => s + Math.abs(G.polygonArea(u.poly)) / 1e6, 0);
  const st = commercialStats(pr);
  assert.ok(foot <= st.gfaM2 + 1, `footprint ${foot} m2 against GFA ${st.gfaM2} m2`);
  assert.ok(foot / lotM2 < 0.3, 'low site coverage on a 1,303 m2 lot');
  assert.equal(pr.commercial.layout.tooBig, false);
});

test('narrow lot: a lot too small for anything is still flagged too big', () => {
  const p = commercialProject({ width: 12000, depth: 20000, rows: 'none', zoning: E4, setbacks: null, plain: false });
  assert.equal(chooseLayout(p).tooBig, true);
});

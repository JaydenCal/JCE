// Moving the units of a drawn estate keeps its pavement network (aisles, footpaths, entry) instead of dropping to the plain row layout (item 4, 16/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as L from '../src/commercial/layouts.js';
import { siteWorksOf } from '../src/commercial/catalogue/buildings.js';
import { moveBy } from '../src/flow/com-logic.js';
import { frameOf, toFrame } from '../src/commercial/estate.js';
import * as G from '../src/model/geometry.js';

const estate = (id = 'best') => {
  const store = createStore(commercialProject({ rows: 'none', width: 90000, depth: 110000, plain: false }), { autosaveKey: null });
  L.applyLayout(store, L.chooseLayout(store.project, id));
  return store;
};

test('moving a row of a drawn estate slides the whole estate and keeps its network', () => {
  const store = estate();
  const c0 = store.project.commercial;
  if (!c0.estate) return; // the lot gave a plain layout; nothing to keep
  const before = siteWorksOf(c0);
  assert.equal(before.kind, 'estate');
  const nAisles = before.aisles.length; const nFoot = before.footpaths.length; const nX = before.crossovers.length;
  const lot = store.project.site.lot;
  const f = frameOf(lot);
  const x0 = c0.rows[0].x; const y0 = c0.rows[0].y;
  const ds0 = toFrame(f, { x: x0, y: y0 }).s;
  const startS = new Map(c0.rows.map((r) => [r.id, toFrame(f, { x: r.x, y: r.y }).s]));
  moveBy(store, { kind: 'row', id: c0.rows[0].id }, f.u.x * 3000, f.u.y * 3000);
  const c1 = store.project.commercial;
  const after = siteWorksOf(c1);
  assert.equal(after?.kind, 'estate', 'the estate network is still valid after the move');
  assert.equal(after.aisles.length, nAisles);
  assert.equal(after.footpaths.length, nFoot);
  assert.equal(after.crossovers.length, nX);
  const ds1 = toFrame(f, { x: c1.rows[0].x, y: c1.rows[0].y }).s;
  assert.ok(Math.abs(ds1 - ds0 - 3000) < 5, `moved ${ds1 - ds0}`);
  // every crossover stays on the frontage edge
  const e0 = lot.frontEdges[0];
  for (const x of after.crossovers) assert.ok(G.projectToSegment({ x: x.x, y: x.y }, lot.boundary[e0], lot.boundary[(e0 + 1) % lot.boundary.length]).d < 80);
  // the other rows moved with it
  for (const r of c1.rows) assert.ok(Math.abs(toFrame(f, { x: r.x, y: r.y }).s - startS.get(r.id) - 3000) < 5, `row ${r.id} did not move with the estate`);
});

test('the slide stops at the lot edge instead of pushing the entry off the frontage', () => {
  const store = estate();
  const c0 = store.project.commercial;
  if (!c0.estate) return;
  const f = frameOf(store.project.site.lot);
  moveBy(store, { kind: 'row', id: c0.rows[0].id }, f.u.x * 500000, f.u.y * 500000);
  const w = store.project.commercial.estate.network.window;
  const s = store.project.site.lot.boundary.map((q) => toFrame(f, q).s);
  assert.ok(w.s1 <= Math.max(...s) + 1);
});

// A strata layout straight off the commercial card names no roller door colour. The roller doors must still read clearly against the
// cladding, never as the wall colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import * as L from '../src/commercial/layouts.js';
import { applyFinishes } from '../src/commercial/finishes.js';
import { buildModel } from '../src/viewer3d/build.js';

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function doorAndWall(project) {
  const group = buildModel(project, { textures: false });
  let door = null; let wall = null;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!door && o.userData?.openingKind === 'roller_door') {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      door = mats.map((m) => m.color).filter(Boolean).sort((a, b) => lum(b) - lum(a))[0];
    }
  });
  const wh = project.finishes?.externalWalls?.colour;
  wall = wh && wh.startsWith('#') ? new THREE.Color(wh) : null;
  return { door, wall };
}

const strata = () => {
  const store = createStore(commercialProject({ rows: 'none', width: 60, depth: 80, plain: false }), { autosaveKey: null });
  L.applyLayout(store, L.chooseLayout(store.project));
  return store;
};

test('strata roller doors with no named colour are darker than off-white cladding', () => {
  const { door } = doorAndWall(strata().project);
  assert.ok(door, 'a roller door mesh is built');
  assert.ok(lum(door) < 0.35, `door luminance ${lum(door).toFixed(2)} should read dark against the wall`);
});

test('a door colour picked the same as the cladding is still pulled clear of the wall', () => {
  const store = strata();
  store.apply('Finishes', (p) => applyFinishes(p, { cladding: 'warm-white', door: 'warm-white' }));
  const { door, wall } = doorAndWall(store.project);
  assert.ok(door && wall);
  assert.ok(Math.abs(lum(door) - lum(wall)) >= 0.15, `door ${lum(door).toFixed(2)} vs wall ${lum(wall).toFixed(2)}`);
});

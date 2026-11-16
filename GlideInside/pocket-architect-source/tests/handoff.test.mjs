import test from 'node:test';
import assert from 'node:assert/strict';
import { takeHandoff, HANDOFF_KEY, sameAddress, openFullEditor } from '../src/ui/embed-viewer.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { flowOf, flowInProgress } from '../src/flow/state.js';
import { shouldStart } from '../src/flow/index.js';
import { migrate, createLevel } from '../src/model/schema.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('street addresses match despite postcode, commas, state and a shorter link', () => {
  assert.ok(sameAddress('56 Inglis Street, Mudgee NSW 2850', '56 Inglis Street Mudgee NSW'));
  assert.ok(sameAddress('14 Sample Street Calala NSW 2340', '14 sample street calala'));
  assert.ok(!sameAddress('56 Inglis Street, Mudgee NSW 2850', '58 Inglis Street Mudgee NSW'));
  assert.ok(!sameAddress('', '56 Inglis Street'));
});

function embedProject() {
  const p = commercialProject({ rows: 'pair' });
  p.site.lot.address = '56 Inglis Street, Mudgee NSW 2850';
  p.commercial.rows[0].rotationDeg = 17;
  p.commercial.rows[0].x = 21500;
  return p;
}

// Run openFullEditor the way the embed does, with a fake window and storage, and return what the editor would read.
function handOver(project, storage) {
  const nav = [];
  globalThis.localStorage = storage;
  globalThis.window = { top: { location: { assign: (u) => nav.push(u) } }, location: {} };
  try { openFullEditor({ ...project, flow: { kind: project.mode === 'commercial' ? 'commercial' : 'residential', step: 5 } }); } finally { delete globalThis.window; }
  const handed = takeHandoff(storage);
  delete globalThis.localStorage;
  return { handed, nav };
}

test('commercial handoff opens the same layout: rows, position, rotation and lot', () => {
  const src = embedProject();
  const { handed, nav } = handOver(src, memory());
  assert.ok(handed, 'the project is handed over');
  const got = handed.project;
  assert.equal(got.site.lot.address, src.site.lot.address);
  assert.equal(got.commercial.rows[0].id, src.commercial.rows[0].id);
  assert.equal(got.commercial.rows[0].x, 21500);
  assert.equal(got.commercial.rows[0].rotationDeg, 17);
  assert.equal(got.commercial.rows.length, src.commercial.rows.length);
  assert.match(nav[0], /mode=commercial/);
  // the editor opens on the editor, not the guided "Find your lot" step, even from an address link
  assert.equal(flowOf(got).step, 5);
  assert.equal(shouldStart({ project: got, search: '?mode=commercial&address=56+Inglis+Street+Mudgee+NSW', fromAutosave: true }), false);
  assert.equal(flowInProgress(got), false);
});

test('residential handoff keeps the placed design id and its position and rotation on the lot', () => {
  const p = migrate(commercialProject({ rows: 'none' }));
  for (const k of ['mode', 'type', 'designType', 'commercial']) delete p[k];
  p.site.lot.address = '14 Sample Street, Calala NSW 2340';
  p.placedHouse = { id: 'house_double', name: 'Double' };
  p.levels = [createLevel({ name: 'Ground', elevation: 0, height: 2700 })];
  p.levels[0].walls = [{ id: 'w1', a: { x: 12345, y: 6789 }, b: { x: 17000, y: 9000 } }]; // rotated 25 degrees off the lot axes
  const { handed } = handOver(p, memory());
  assert.ok(handed);
  assert.equal(handed.project.placedHouse.id, 'house_double');
  assert.deepEqual(handed.project.levels[0].walls[0].a, { x: 12345, y: 6789 });
  assert.deepEqual(handed.project.levels[0].walls[0].b, { x: 17000, y: 9000 });
  assert.equal(handed.project.site.lot.address, p.site.lot.address);
  assert.equal(flowOf(handed.project).step, 5);
});

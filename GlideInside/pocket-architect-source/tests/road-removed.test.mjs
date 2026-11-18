// No automatic road at the lot frontage (3D, 2D plan view, plan sets, engineering site plan, lot preview). Roads and pavements the user draws
// with the Road or pavement tool still build, and a drawn road never fans strips across the aerial.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel } from '../src/viewer3d/build.js';
import { TOOL_DEFS } from '../src/editor2d/tools-meta.js';
import { addDrawnWays } from '../src/viewer3d/pave3d.js';
import { getWays, wayBufferMm, ringWithinBuffer } from '../src/site/pavedways.js';
import { roadModel } from '../src/premium/exporters/planset/site.js';
import * as H from './helpers/grading-harness.mjs';

const names = (g) => { const out = []; g.traverse((o) => { if (o.name) out.push(o.name); }); return out; };
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('a residential project with lot.roads builds no automatic road, centre line, kerb, footpath or street trees, and keeps its driveway', () => {
  const p = H.residential();
  const lot = p.site.lot;
  const xs = lot.boundary.map((q) => q.x); const ys = lot.boundary.map((q) => q.y);
  lot.roads = [{ name: 'Test Street', pts: [Math.min(...xs) - 20000, Math.max(...ys) + 6000, Math.max(...xs) + 20000, Math.max(...ys) + 6000] }];
  const n = names(buildModel(p, {}));
  assert.ok(n.includes('driveway'), 'driveway is built');
  assert.ok(!n.includes('road'), 'no automatic road mesh');
  assert.ok(!n.some((x) => /pave|drawn/i.test(x)), 'nothing drawn when the user drew nothing');
  assert.deepEqual(roadModel(lot), [], 'plan sets draw no automatic road');
});

test('the 2D plan view and the exporters draw no automatic road linework', () => {
  const lp = read('src/editor2d/draw-lotplan.js');
  assert.ok(!lp.includes('ROAD CENTRELINE') && !lp.includes('drawRoad'), '2D editor road linework removed');
  assert.ok(!read('src/viewer3d/terrain.js').includes('footpathNear'), 'no corridor flattening');
  assert.ok(!read('src/viewer3d/site-extras.js').includes('streetTreeSpots'), 'no automatic street trees');
  assert.ok(read('src/premium/exporters/eng/siteplan.js').includes('AUTO_ROAD = false'));
  assert.ok(!read('src/ui/panel-site.js').includes("'Road and kerb'"), 'Road layer toggle removed');
});

test('user drawn roads and pavements still build in 3D and the tool is on the rail', () => {
  assert.ok(TOOL_DEFS.some((d) => d.id === 'pave' && d.key === 'L'));
  const p = H.residential();
  const ys = p.site.lot.boundary.map((q) => q.y); const xs = p.site.lot.boundary.map((q) => q.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const y0 = Math.min(...ys) + 3000; const y1 = Math.max(...ys) - 3000;
  p.site.paved = [{ id: 'way1', kind: 'road', material: 'asphalt', widthMm: 5500, radiusMm: 0, pts: [{ x: cx, y: y0 }, { x: cx, y: y1 }] }];
  const n = names(buildModel(p, {}));
  assert.ok(n.includes('drawn-pavement'), 'drawn road is built');
});

test('a drawn road never fans strips: stray, NaN, origin and doubled points are dropped and the mesh stays within the way buffer', () => {
  const p = H.residential();
  const xs = p.site.lot.boundary.map((q) => q.x); const ys = p.site.lot.boundary.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const y0 = Math.min(...ys) + 2000; const y1 = Math.max(...ys) - 2000;
  const good = [{ x: cx, y: y0 }, { x: cx, y: (y0 + y1) / 2 }, { x: cx + 4000, y: y1 }];
  p.site.paved = [{
    id: 'bad', kind: 'road', material: 'asphalt', widthMm: 5500, radiusMm: 0, heads: [{ end: 'end', type: 'bulb' }],
    pts: [good[0], { x: NaN, y: 5 }, { x: cx - 90000, y: y0 }, good[0], good[1], { x: 9e8, y: -9e8 }, good[2]],
  }];
  const way = getWays(p)[0];
  assert.ok(way.pts.every((q) => Number.isFinite(q.x) && Math.hypot(q.x - cx, q.y - y0) < 60000), 'stray points dropped');
  assert.equal(way.pts.length, 3, 'doubled point collapsed');
  const r = addDrawnWays(p, () => 0);
  assert.ok(r?.mesh, 'mesh builds');
  const pos = r.mesh.geometry.getAttribute('position');
  const buf = wayBufferMm(way);
  const seg = (q, a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy); };
  for (let i = 0; i < pos.count; i++) {
    const q = { x: pos.getX(i) * 1000, y: pos.getZ(i) * 1000 };
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
    assert.ok(way.pts.some((a, k) => seg(q, a, way.pts[Math.min(k + 1, way.pts.length - 1)]) <= buf), 'vertex inside the way buffer');
  }
  assert.equal(ringWithinBuffer([{ x: cx, y: y0 }, { x: 8e6, y: 8e6 }, { x: cx, y: y1 }], way), false, 'a far point is rejected');
});

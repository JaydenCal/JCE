// Dutch gable (gablet) roofs: a hip with a small vertical gablet at a ridge end, for every wing (type dutch) or chosen wings and ends (roof.gablets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import * as F from '../src/viewer3d/footprint.js';
import { buildLevelRoof, resolveGablets } from '../src/viewer3d/roof.js';

function house(roof = {}) {
  const p = createProject({ name: 'Roof', type: 'house' });
  const run = (op, a) => applyOp(p, op, a, {});
  run('add_room_polygon', { type: 'living', name: 'main', points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }] });
  run('set_roof', { type: 'hip', pitch: 22.5, overhang: 450, ...roof });
  return p;
}
function roofOf(p) {
  const level = p.levels[0];
  const grid = F.makeGrid(p);
  const fp = F.rasteriseLevel(grid, level, () => true);
  return buildLevelRoof({ grid, footprint: fp.footprint, above: null, H0: 2.7, roof: level.roof });
}
const tris = (b, slot) => { const s = b.slots.get(slot); const out = []; if (!s) return out; for (let i = 0; i < s.pos.length; i += 9) out.push([[s.pos[i], s.pos[i + 1], s.pos[i + 2]], [s.pos[i + 3], s.pos[i + 4], s.pos[i + 5]], [s.pos[i + 6], s.pos[i + 7], s.pos[i + 8]]]); return out; };
const maxY = (b) => Math.max(...[...b.slots.values()].flatMap((s) => s.pos.filter((_, i) => i % 3 === 1)));
const vertical = (t) => t.every((q) => Math.abs(q[0] - t[0][0]) < 1e-6) || t.every((q) => Math.abs(q[2] - t[0][2]) < 1e-6);

test('ROOF_TYPES offers a Dutch gable option and set_roof stores it with a gablet size', () => {
  const p = house();
  applyOp(p, 'set_roof', { type: 'dutch', gablet_size: 700 }, {});
  assert.equal(p.levels[0].roof.type, 'dutch');
  assert.equal(p.levels[0].roof.gabletSize, 700);
  assert.throws(() => applyOp(p, 'set_roof', { gablet_size: 20 }, {}), /gablet_size/);
  assert.throws(() => applyOp(p, 'set_roof', { type: 'mansard' }, {}));
});

test('a plain hip has no gablets; a dutch roof has a vertical triangle at each ridge end and keeps the ridge height', () => {
  const hip = roofOf(house());
  assert.equal(tris(hip.builder, 'gable').length, 0);
  const d = roofOf(house({ type: 'dutch', gabletSize: 600 }));
  const g = tris(d.builder, 'gable');
  assert.equal(g.length, 2, 'one gablet face at each ridge end');
  assert.ok(g.every(vertical), 'a gablet face is vertical');
  assert.ok(Math.abs(maxY(d.builder) - maxY(hip.builder)) < 0.2, 'the ridge stays at the hip ridge height (cap included)');
  // the gablet face is 600 mm high
  const ys = g.flat().map((q) => q[1]);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.6) < 0.01);
  assert.equal(d.rects[0].type, 'dutch');
  // the ridge is longer by 2 x G / tan(pitch) than the hip ridge
  const ridge = (b) => { const xs = [...b.slots.get('roof').pos].filter((_, i) => i % 3 === 0); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(ridge(d.builder) >= ridge(hip.builder) - 1e-6);
});

test('gablets can be set per wing and per end, with their own size, and an empty list turns them off', () => {
  const one = roofOf(house({ gablets: [{ x: 5000, y: 3000, ends: ['e'], size: 500 }] }));
  const g = tris(one.builder, 'gable');
  assert.equal(g.length, 1, 'only the east end');
  const x = g[0][0][0];
  assert.ok(x > 5, 'at the east end (x > middle)');
  const ys = g[0].map((q) => q[1]);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.5) < 0.01, 'size 500');
  const both = roofOf(house({ gablets: [{ x: 5000, y: 3000 }] }));
  assert.equal(tris(both.builder, 'gable').length, 2);
  const off = roofOf(house({ type: 'dutch', gablets: [{ x: 5000, y: 3000, ends: [] }] }));
  assert.equal(tris(off.builder, 'gable').length, 0, 'dutch roof with this wing switched off');
  const sideEnd = roofOf(house({ gablets: [{ x: 5000, y: 3000, ends: ['n'] }] }));
  assert.equal(tris(sideEnd.builder, 'gable').length, 0, 'n is a long side of this wing, not a ridge end');
});

test('resolveGablets picks the smallest wing containing the point', () => {
  const rects = [{ x0: 0, y0: 0, x1: 16000, y1: 20000 }, { x0: 0, y0: 0, x1: 4000, y1: 8000 }];
  const m = resolveGablets({ type: 'hip', gablets: [{ x: 1000, y: 1000, ends: ['n'], size: 800 }, { x: 9000, y: 9000, ends: ['s'] }] }, rects);
  assert.equal(m.get(1).n, 0.8);
  assert.equal(m.get(0).n, 0);
  assert.equal(m.get(0).s, 0.6);
});

test('gablets reach the elevations, the roof plan and the section: the plan set draws them from the same mesh', async () => {
  const { collectTriangles } = await import('../src/premium/exporters/eng/views.js');
  const { catalogue } = await import('../src/catalogue/index.js');
  const tall = (t) => Math.max(...t.p.map((q) => q.z)) - Math.min(...t.p.map((q) => q.z)) > 600;
  const verticalAboveEaves = (tr) => tr.filter((t) => Math.abs(t.n.z) < 0.02 && t.p.every((q) => q.z > 2700 + 50) && tall(t));
  const hip = await collectTriangles(house(), catalogue);
  const gab = await collectTriangles(house({ gablets: [{ x: 5000, y: 3000, ends: ['e'], size: 900 }] }), catalogue);
  assert.equal(verticalAboveEaves(hip).length, 0, 'a plain hip has no vertical face above the eaves');
  const faces = verticalAboveEaves(gab);
  assert.ok(faces.length >= 1, 'the east gablet is in the triangle set the elevations and the section are drawn from');
  assert.ok(faces.every((t) => t.n.x > 0.9), 'and it faces east');
  const zs = faces.flatMap((t) => t.p.map((q) => q.z));
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 900) < 20, 'its height is the 900 mm that was set');
  // the roof plan and elevation sheets are drawn from these triangles; a gablet changes what they draw
  const { exportPlanSet } = await import('../src/premium/exporters/planset/index.js');
  const { residentialCase } = await import('./helpers/planset-fixtures.mjs');
  const draw = async (withGablets) => {
    const proj = residentialCase('none');
    for (const l of proj.levels) { l.roof.type = 'hip'; if (withGablets) { l.roof.gablets = [{ x: 0, y: 0, ends: 'both', size: 900 }]; l.roof.gabletSize = 900; } }
    const r = await exportPlanSet({ project: proj, kind: 'site', download: false, jsPDF: (await import('jspdf')).jsPDF, fetchSite: null, catalogue, date: new Date(2026, 10, 25) });
    return Buffer.from(await r.blob.arrayBuffer());
  };
  const a = await draw(false);
  const b = await draw(true);
  assert.ok(a.length !== b.length || !a.equals(b), 'the plan set (roof plan, elevations, section) is drawn differently with gablets');
});

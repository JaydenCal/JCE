// The road tool and every automatic road surface are gone from the 3D model: the aerial imagery is the only road. Saved roads still open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel } from '../src/viewer3d/build.js';
import { TOOL_DEFS } from '../src/editor2d/tools-meta.js';
import * as H from './helpers/grading-harness.mjs';

const names = (g) => { const out = []; g.traverse((o) => { if (o.name) out.push(o.name); }); return out; };

test('a residential project with lot.roads and saved pave roads builds a 3D model with no road meshes and still has its driveway', () => {
  const p = H.residential();
  const lot = p.site.lot;
  const before = names(buildModel(p, {}));
  assert.ok(before.includes('driveway'), 'driveway is built');
  assert.ok(!before.includes('road'), 'no automatic road mesh');
  const xs = lot.boundary.map((q) => q.x); const ys = lot.boundary.map((q) => q.y);
  lot.roads = [{ name: 'Test Street', pts: [Math.min(...xs) - 20000, Math.max(...ys) + 6000, Math.max(...xs) + 20000, Math.max(...ys) + 6000] }, { name: 'Other Road', pts: [0, Math.max(...ys) + 30000, 40000, Math.min(...ys) - 30000] }];
  p.site.paved = [
    { id: 'way1', kind: 'road', material: 'asphalt', widthMm: 7000, radiusMm: 0, pts: [{ x: -30000, y: Math.max(...ys) + 8000 }, { x: 60000, y: Math.max(...ys) + 8000 }] },
    { id: 'way2', kind: 'driveway', material: 'concrete', widthMm: 3500, radiusMm: 0, kerbEdge: 0, pts: [{ x: 0, y: 0 }, { x: 0, y: 5000 }] },
  ];
  const snapshot = JSON.stringify(p.site.paved);
  const g = buildModel(p, {});
  const after = names(g);
  assert.ok(!after.includes('road'), 'no mesh named road');
  assert.ok(!after.some((n) => /pave|drawn/i.test(n)), 'no mesh from the removed pave section');
  assert.ok(after.includes('driveway'), 'the house driveway is still built');
  assert.equal(JSON.stringify(p.site.paved), snapshot, 'saved pave data is left alone');
  assert.equal(p.site.lot.roads.length, 2);
});

test('the Road or pavement tool is not on the tool rail and L is free', () => {
  assert.ok(!TOOL_DEFS.some((d) => d.id === 'pave' || d.key === 'L'));
  const toolbox = fs.readFileSync(new URL('../src/ui/toolbox.js', import.meta.url), 'utf8');
  assert.ok(!toolbox.includes("'pave'"));
  for (const f of ['src/editor2d/tool-pave.js', 'src/editor2d/pave-controller.js', 'src/editor2d/pave-state.js', 'src/ui/panel-pave.js', 'src/viewer3d/pave3d.js']) assert.ok(!fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} removed`);
});

// Parked car MESH orientation, checked on the real instanced geometry in world space (not the placement record): for each car in the
// 3D entourage, the longest horizontal extent of the transformed mesh must run along the bay depth (within 5 degrees), and the mesh footprint
// must lie inside the bay polygon.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { typeById } from '../src/commercial/catalogue/types/index.js';
import { addCommercialEntourage } from '../src/commercial/catalogue/entourage3d.js';

const LOTS = [
  { name: 'small', width: 40000, depth: 60000, type: 'office' },
  { name: 'deep narrow', width: 30000, depth: 120000, type: 'warehouse' },
  { name: 'large', width: 100000, depth: 140000, type: 'warehouse' },
];
const bayOf = (sw, pt) => sw.bayRows.flatMap((r) => r.slots).filter((s) => !s.kind || s.kind === 'bay').find((b) => G.pointInPolygon(pt, b.poly));

const segD = (q, a, b) => { const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1))); return Math.hypot(q.x - a.x - t * (b.x - a.x), q.y - a.y - t * (b.y - a.y)); };
const polyDist = (q, poly) => (G.pointInPolygon(q, poly) ? 0 : Math.min(...poly.map((a, j) => segD(q, a, poly[(j + 1) % poly.length]))));

for (const spec of LOTS) {
  test(`3D car meshes, ${spec.name} lot: world space long axis along the bay depth, footprint inside the bay`, () => {
    const store = createStore(commercialProject({ width: spec.width, depth: spec.depth, rows: 'none', plain: false }));
    if (typeById(spec.type)) applyBuildingChoice(store, chooseBuilding(store.project, spec.type));
    const sw = store.project.commercial.siteWorks;
    const root = new THREE.Group();
    addCommercialEntourage(root, store.project, () => 0);
    root.updateMatrixWorld(true);
    let mesh = null; root.traverse((o) => { if (o.name === 'entourage-cars') mesh = o; });
    assert.ok(mesh && mesh.count >= 1, 'car mesh present');
    const pos = mesh.geometry.getAttribute('position');
    const m = new THREE.Matrix4(); const v = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld);
      const pts = [];
      for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(m); pts.push({ x: v.x * 1000, y: v.z * 1000 }); } // world x,z = plan x,y
      // Oriented bounding box (minimum area over directions); its longer side is the car's long axis.
      let best = { area: Infinity, len: 0, ang: 0 };
      for (let a = 0; a < 90; a += 0.5) {
        const c = Math.cos(a * Math.PI / 180); const s = Math.sin(a * Math.PI / 180);
        const u = pts.map((q) => q.x * c + q.y * s); const w = pts.map((q) => -q.x * s + q.y * c);
        const lu = Math.max(...u) - Math.min(...u); const lw = Math.max(...w) - Math.min(...w);
        if (lu * lw < best.area) best = lu >= lw ? { area: lu * lw, len: lu, ang: a } : { area: lu * lw, len: lw, ang: a + 90 };
      }
      const cen = { x: pts.reduce((t, q) => t + q.x, 0) / pts.length, y: pts.reduce((t, q) => t + q.y, 0) / pts.length };
      const bay = bayOf(sw, cen);
      assert.ok(bay, `${spec.name}: car ${i} is not in a bay`);
      const [p0, , , p3] = bay.poly;
      const depth = Math.atan2(p3.y - p0.y, p3.x - p0.x) * 180 / Math.PI;
      let d = Math.abs(best.ang - depth) % 180; if (d > 90) d = 180 - d;
      assert.ok(d <= 5, `${spec.name}: car ${i} long axis is ${d.toFixed(1)} degrees off the bay depth`);
      assert.ok(best.len > 4000 && best.len < 5000, `${spec.name}: car length ${best.len}`);
      // Nose in: the nose (+x of the car) ends up farther from the nearest aisle than the tail.
      const fwd = new THREE.Vector3(1, 0, 0).transformDirection(m); const nose = { x: cen.x + fwd.x * 2000, y: cen.y + fwd.z * 2000 }; const tail = { x: cen.x - fwd.x * 2000, y: cen.y - fwd.z * 2000 };
      const dAisle = (pt) => Math.min(...sw.pavedAisles.map((a) => polyDist(pt, a.polygon)));
      assert.ok(dAisle(nose) > dAisle(tail), `${spec.name}: car ${i} is not nose in`);
      for (const q of pts) assert.ok(G.pointInPolygon(q, bay.poly) || bay.poly.some((a, j) => { const b = bay.poly[(j + 1) % 4]; const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1))); return Math.hypot(q.x - a.x - t * (b.x - a.x), q.y - a.y - t * (b.y - a.y)) < 60; }), `${spec.name}: car ${i} mesh outside its bay`);
    }
  });
}

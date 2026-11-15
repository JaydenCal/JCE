// Commercial entry and exit: auto placement stays on the first frontage edge (also on a corner lot), and the stored edits move, resize and reset them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/model/geometry.js';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { editAccess, offsetAlongFront } from '../src/flow/com-logic.js';

function station({ corner = false } = {}) {
  const p = commercialProject({ width: 60000, depth: 80000, rows: 'none' });
  if (corner) p.site.lot.frontEdges = [p.site.lot.frontEdges[0], (p.site.lot.frontEdges[0] + 1) % p.site.lot.boundary.length];
  const store = createStore(p);
  applyBuildingChoice(store, chooseBuilding(store.project, 'service-station'));
  return store;
}
const lotOf = (s) => s.project.site.lot;
const onFrontEdge = (lot, pt) => { const e0 = lot.frontEdges[0]; const a = lot.boundary[e0]; const b = lot.boundary[(e0 + 1) % lot.boundary.length]; return G.projectToSegment(pt, a, b).d < 60; };

for (const corner of [false, true]) {
  test(`auto entry and exit sit on the first frontage edge, inside the lot${corner ? ', clear of the corner street' : ''}`, () => {
    const s = station({ corner });
    const lot = lotOf(s);
    const sw = s.project.commercial.siteWorks;
    assert.ok(sw.crossovers.length >= 2);
    for (const x of sw.crossovers) {
      assert.ok(onFrontEdge(lot, x), `${x.role} is off the frontage edge`);
      // the pad's inner end is inside the lot
      const inner = x.polygon.filter((q) => G.pointInPolygon(q, lot.boundary) || G.projectToSegment(q, lot.boundary[lot.frontEdges[0]], lot.boundary[(lot.frontEdges[0] + 1) % lot.boundary.length]).d < 60);
      assert.ok(inner.length >= 2);
      if (corner) {
        // at least 6 m from the end of the edge that meets the other street
        const e0 = lot.frontEdges[0]; const a = lot.boundary[e0]; const b = lot.boundary[(e0 + 1) % lot.boundary.length];
        const L = Math.hypot(b.x - a.x, b.y - a.y); const off = offsetAlongFront(lot, x);
        assert.ok(off >= 5900 && off <= L - 5900, `offset ${off} of ${L}`);
      }
    }
  });
}

test('dragging an end moves it along the frontage; width changes; reset restores the automatic placement', () => {
  const s = station();
  const lot = lotOf(s);
  const auto = s.project.commercial.siteWorks.crossovers.map((x) => ({ role: x.role, off: offsetAlongFront(lot, x), w: x.widthMm }));
  const out0 = auto.find((x) => x.role === 'out');
  s.apply('t', (p) => { editAccess(p, { role: 'out', offsetMm: out0.off - 6000 }); });
  const moved = s.project.commercial.siteWorks.crossovers.find((x) => x.role === 'out');
  assert.ok(Math.abs(offsetAlongFront(lot, moved) - (out0.off - 6000)) < 1000, 'the exit moved');
  s.apply('t', (p) => { editAccess(p, { widthMm: 8000 }); });
  assert.equal(s.project.commercial.siteWorks.crossovers[0].widthMm, 8000);
  assert.ok(s.project.commercial.accessEdit, 'stored in the project');
  s.apply('t', (p) => { editAccess(p, null); });
  assert.equal(s.project.commercial.accessEdit, undefined);
  const back = s.project.commercial.siteWorks.crossovers.find((x) => x.role === 'out');
  assert.ok(Math.abs(offsetAlongFront(lot, back) - out0.off) < 300);
});

test('an edit past the end of the frontage is held inside it', () => {
  const s = station();
  const lot = lotOf(s);
  s.apply('t', (p) => { editAccess(p, { role: 'in', offsetMm: -99999 }); });
  const x = s.project.commercial.siteWorks.crossovers.find((q) => q.role === 'in');
  assert.ok(onFrontEdge(lot, x) && G.pointInPolygon(x, lot.boundary) || onFrontEdge(lot, x));
  assert.ok(offsetAlongFront(lot, x) > 0);
});

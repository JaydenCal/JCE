// Driveway draw start: the first click on (or beside) the confirmed street frontage must start the driveway, at every zoom, even when the
// frontage comes only from the person's confirmation and the lot carries no road data. The kerb is a verge (4 m) outside the boundary, so the
// pick distance is measured to the frontage strip, not to the kerb line alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as G from '../src/model/geometry.js';
import * as L from '../src/site/lotplan.js';
import * as D from '../src/site/drivepi.js';
import { createDrivePIController } from '../src/editor2d/drivepi-controller.js';
import { createStore } from '../src/model/store.js';

// A lot whose frontage is only the person's confirmation: no road centrelines, no setback classification, no portal envelope data.
function confirmedOnly() {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '314', dp: 'DP 1278464' };
  const p = createProject({ name: 'Lot 314' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const lot = p.site.lot;
  lot.roads = [];
  delete lot.setbacks;
  lot.frontageConfirmed = true;
  lot.frontageMethod = 'builder';
  const h = catalogue.createFromTemplate('granny_studio');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
const frontEdge = (p) => {
  const lot = p.site.lot;
  const r = L.roadReserve(lot)[0];
  return { r, a: lot.boundary[r.edge], b: lot.boundary[(r.edge + 1) % lot.boundary.length] };
};

test('a lot with a confirmed frontage and no road data still has a street reserve and can draw', () => {
  const p = confirmedOnly();
  assert.equal(p.site.lot.roads.length, 0);
  const rr = L.roadReserve(p.site.lot);
  assert.equal(rr.length, 1);
  assert.equal(rr[0].source, 'default');
  assert.equal(D.driveEditState(p).canDraw, true);
});

for (const mmPerPx of [2, 5, 10, 20, 50, 100]) {
  test(`a click on the boundary edge starts the driveway at ${mmPerPx} mm per pixel and snaps to the kerb`, () => {
    const store = createStore(confirmedOnly());
    const { r, a, b } = frontEdge(store.project);
    const ctl = createDrivePIController({ store, scale: () => 1 / mmPerPx });
    const onEdge = G.lerp(a, b, 0.4);
    ctl.pointerDown(onEdge);
    assert.equal(ctl.isDrawing(), true, 'the click on the confirmed frontage starts the driveway');
    // the start sits on the kerb line, a verge outside the boundary
    const k = D.kerbSnap(store.project, onEdge);
    assert.ok(Math.abs(G.dot(G.sub(k.point, a), r.outward) - r.vergeM * 1000) < 1);
    assert.ok(Math.abs(k.offsetMm - G.dot(G.sub(onEdge, a), r.u)) < 1, 'snapped along the frontage under the click');
  });
}

test('clicks inside the lot beside the frontage and on the street side both start the driveway', () => {
  const { r, a, b } = frontEdge({ site: { lot: confirmedOnly().site.lot } });
  for (const mmPerPx of [5, 20, 80]) {
    for (const dy of [-600, 600, 2500]) { // 0.6 m inside the lot, then 0.6 m and 2.5 m out on the street side
      const store = createStore(confirmedOnly());
      const ctl = createDrivePIController({ store, scale: () => 1 / mmPerPx });
      const pt = G.add(G.lerp(a, b, 0.5), G.mul(r.outward, dy));
      ctl.pointerDown(pt);
      assert.equal(ctl.isDrawing(), true, `mm/px ${mmPerPx}, ${dy} mm`); // inside the lot by under a metre, or within the verge strip
    }
  }
});

test('a click far from the frontage is still refused at every zoom', () => {
  for (const mmPerPx of [2, 10, 50, 100]) {
    const store = createStore(confirmedOnly());
    const { r, a, b } = frontEdge(store.project);
    const ctl = createDrivePIController({ store, scale: () => 1 / mmPerPx });
    const far = G.add(G.lerp(a, b, 0.5), G.mul(r.outward, -15000)); // 15 m into the lot
    ctl.pointerDown(far);
    assert.equal(ctl.isDrawing(), false, `mm/px ${mmPerPx}`);
    const away = G.add(G.lerp(a, b, 0.5), G.mul(r.outward, 25000)); // 25 m across the street
    ctl.pointerDown(away);
    assert.equal(ctl.isDrawing(), false, `mm/px ${mmPerPx}, street side`);
  }
});

test('the old kerb-only tolerance refused a click on the boundary edge once zoomed in (regression)', () => {
  const p = confirmedOnly();
  const { a, b } = frontEdge(p);
  const k = D.kerbSnap(p, G.lerp(a, b, 0.5));
  const mmPerPx = 10; // 40 px * 10 + 3000 = 3400 mm, less than the 4000 mm verge
  assert.ok(k.distMm > 40 * mmPerPx + 3000, 'kerb distance exceeds the old tolerance');
  assert.ok(k.pickMm < 40 * mmPerPx + 1500, 'frontage-strip distance is inside the new one');
});

test('a drawn driveway from a click on the boundary edge completes and derives', () => {
  const store = createStore(confirmedOnly());
  const { a, b } = frontEdge(store.project);
  const ctl = createDrivePIController({ store, scale: () => 1 / 10 });
  ctl.pointerDown(G.lerp(a, b, 0.5));
  const bld = L.nearestOnBuilding(store.project, G.lerp(a, b, 0.5));
  ctl.pointerDown(bld);
  ctl.dblClick(bld);
  assert.equal(store.project.site.driveway?.drawn, true);
  assert.equal(L.deriveDriveway(store.project).ok, true);
});

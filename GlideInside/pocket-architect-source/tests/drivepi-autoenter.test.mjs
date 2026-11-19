// Clicking the driveway with Select or Move house switches to Driveway PIs (residential only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import * as L from '../src/site/lotplan.js';
import { driveClick, DRIVE_ENTER_FROM } from '../src/editor2d/drivepi-autoenter.js';

function setup() {
  const portal = { name: 'T', polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name: 'Drive' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  placeHouse(p, catalogue.createFromTemplate('house_double'), autoPose(p, catalogue.createFromTemplate('house_double')).pose);
  return p;
}

test('a click on the centreline is a centreline hit; far from the driveway is not a driveway click', () => {
  const p = setup();
  const d = L.deriveDriveway(p);
  const mid = d.centre[Math.floor(d.centre.length / 2)];
  const r = driveClick(p, mid, 0.05);
  assert.ok(r && r.hit && r.hit.kind === 'line', JSON.stringify(r));
  assert.equal(driveClick(p, { x: mid.x + 60000, y: mid.y + 60000 }, 0.05), null);
});

test('a click on a PI selects it (pi hit)', () => {
  const p = setup();
  const a = L.deriveDriveway(p);
  const mid = a.centre[Math.floor(a.centre.length / 2)];
  L.setStoredDriveway(p, { endOffsetMm: a.endOffsetMm, pis: [{ x: mid.x + 2500, y: mid.y }], radiusM: 5 });
  const d = L.deriveDriveway(p);
  const r = driveClick(p, d.pis[0], 0.05);
  assert.equal(r.hit.kind, 'pi');
  assert.equal(r.hit.index, 0);
});

test('not for a commercial design or a click on the house', () => {
  const p = setup();
  const d = L.deriveDriveway(p);
  const mid = d.centre[Math.floor(d.centre.length / 2)];
  assert.ok(driveClick(p, mid, 0.05));
  assert.equal(driveClick({ ...p, mode: 'commercial' }, mid, 0.05), null);
});

test('the editor enters from Select and Move house only, Escape and an off-driveway click return, commercial tools are untouched', () => {
  assert.deepEqual(DRIVE_ENTER_FROM, ['select', 'movehouse']);
  const s = fs.readFileSync(new URL('../src/editor2d/editor.js', import.meta.url), 'utf8');
  assert.match(s, /setTool\(store, 'drivepi'\)/);
  assert.match(s, /e\.key === 'Escape' && store\.ui\.tool === 'drivepi' && state\.drivePrev/);
});

import { driveWorksPoints, allInView } from '../src/editor2d/drivepi-autoenter.js';
test('the Driveway PI tool frames the building and the nearest spot on the frontage; off screen is detected', () => {
  const project = { site: { lot: { boundary: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 40000 }, { x: 0, y: 40000 }], frontEdges: [0] } } };
  const hull = [{ x: 6000, y: 20000 }, { x: 14000, y: 20000 }, { x: 14000, y: 30000 }, { x: 6000, y: 30000 }];
  const pts = driveWorksPoints(project, hull);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts.at(-1), { x: 10000, y: 0 }, 'the frontage point straight in front of the house');
  assert.deepEqual(driveWorksPoints({ site: {} }, hull), []);
  const size = { w: 800, h: 600 };
  const fit = { scale: 0.015, ox: 250, oy: 50 };
  assert.equal(allInView(fit, size, pts), true);
  assert.equal(allInView({ scale: 0.015, ox: 250, oy: -200 }, size, pts), false, 'frontage scrolled off the top');
  assert.equal(allInView({ scale: 0.05, ox: 0, oy: 0 }, size, pts), false, 'zoomed in too far to hold both');
});

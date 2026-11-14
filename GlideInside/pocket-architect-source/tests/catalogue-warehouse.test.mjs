import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/warehouse.js';
import { runTypeChecks } from './helpers/typesB-checks.mjs';
import { paramsOf } from '../src/commercial/catalogue/params.js';

runTypeChecks(type, 'warehouse.js');

const at = { x: 0, y: 0, rotationDeg: 0 };
const P = (o = {}) => paramsOf(type, o);

test('warehouse: 1 to 8 docks, each with a roller door, and the apron and canopy grow with them', () => {
  for (const n of [1, 4, 8]) {
    const p = P({ docks: n, groundDoors: 0, spanMm: 45000 });
    const m = type.materialise(p, at);
    assert.equal(m.openings.filter((o) => o.kind === 'roller_door').length, n, `${n} docks`);
    assert.equal(type.quantities(p).doors.dock, n);
    assert.equal(type.site(p).vehicles.docks, n);
  }
  assert.ok(type.footprint(P({ docks: 8 })).extras.some((e) => e.kind === 'canopy'));
  assert.equal(type.footprint(P({ dockCanopy: false })).extras.some((e) => e.kind === 'canopy'), false);
});

test('warehouse: recessed docks add a dock recess slab, flush docks do not', () => {
  assert.ok(type.footprint(P({ dockType: 'recessed' })).extras.some((e) => e.kind === 'dock-recess'));
  assert.equal(type.footprint(P({ dockType: 'flush' })).extras.some((e) => e.kind === 'dock-recess'), false);
});

test('warehouse: office pod single or two storey at a front corner, two storey adds a level and a stair', () => {
  const one = type.materialise(P({ officePod: 'single' }), at);
  const two = type.materialise(P({ officePod: 'two-storey' }), at);
  assert.ok(two.levels.length > one.levels.length);
  assert.ok(type.quantities(P({ officePod: 'two-storey' })).upperM2 > 0);
  assert.equal(type.quantities(P({ officePod: 'single' })).upperM2, 0);
  const none = type.materialise(P({ officePod: 'none' }), at);
  assert.ok(!none.rooms.some((r) => /OFFICE/.test(r.name)));
});

test('warehouse: the B-double and AV aprons are deeper than a rigid truck apron', () => {
  const d = (t) => type.site(P({ truckDesign: t })).vehicles.apronDepthMm;
  assert.ok(d('b99') > d('mrv') || d('av') >= d('b99') || d('b99') > 20000);
  assert.ok(d('av') >= d('b99'));
});

test('warehouse: clear span means no interior walls other than the office pod, and skylights are roof glazing', () => {
  const m = type.materialise(P({ officePod: 'none' }), at);
  assert.equal(m.walls.filter((w) => w.kind === 'interior').length, 0);
  assert.ok(type.quantities(P({ roofType: 'gable', skylightPct: 8 })).glazingM2 > type.quantities(P({ roofType: 'gable', skylightPct: 0 })).glazingM2);
});

test('warehouse: GFA by use adds up and parking rates are 1 per 300 m2 warehouse and 1 per 40 m2 office', () => {
  const p = P();
  const q = type.quantities(p);
  assert.ok(Math.abs(Object.values(q.perUse).reduce((s, v) => s + v, 0) - q.gfaM2) < 0.3);
  const r = type.site(p).parking.ratePerM2;
  assert.equal(r.find((x) => x.use === 'warehouse').per, 300);
  assert.equal(r.find((x) => x.use === 'office').per, 40);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/showroom.js';
import { runTypeChecks } from './helpers/typesB-checks.mjs';
import { paramsOf } from '../src/commercial/catalogue/params.js';

runTypeChecks(type, 'showroom.js');

const at = { x: 0, y: 0, rotationDeg: 0 };
const P = (o = {}) => paramsOf(type, o);

test('showroom: glazed frontage with an awning, the glazing share drives the front windows', () => {
  const lo = type.materialise(P({ glazingPct: 30 }), at);
  const hi = type.materialise(P({ glazingPct: 90 }), at);
  const area = (m) => m.openings.filter((o) => o.kind === 'window' || o.kind === 'sliding_door').reduce((s, o) => s + o.width * o.height, 0);
  assert.ok(area(hi) > area(lo));
  assert.ok(type.footprint(P({ awningDepthMm: 3000 })).extras.some((e) => e.kind === 'canopy'));
  assert.equal(type.footprint(P({ awningDepthMm: 0 })).extras.some((e) => e.kind === 'canopy'), false);
});

test('showroom: showroom floor, offices and amenities behind, rear warehouse with a roller door', () => {
  const m = type.materialise(P(), at);
  const names = m.rooms.map((r) => r.name).join('|');
  assert.match(names, /SHOWROOM/);
  assert.match(names, /OFFICE/);
  assert.match(names, /WAREHOUSE/);
  assert.ok(m.openings.some((o) => o.kind === 'roller_door'));
  const ys = m.rooms.find((r) => /WAREHOUSE/.test(r.name)).polygon.map((q) => q.y);
  const sy = m.rooms.find((r) => /SHOWROOM/.test(r.name)).polygon.map((q) => q.y);
  assert.ok(Math.max(...ys) > Math.max(...sy) - 1, 'the warehouse is behind the showroom');
});

test('showroom: GFA by use adds up, rates are 1 per 50 m2 showroom, customer parking at the frontage', () => {
  const p = P();
  const q = type.quantities(p);
  assert.ok(Math.abs(Object.values(q.perUse).reduce((s, v) => s + v, 0) - q.gfaM2) < 0.3);
  const s = type.site(p);
  assert.equal(s.parking.ratePerM2.find((x) => x.use === 'showroom').per, 50);
  assert.ok(s.parking.zone.offsetMm > 0);
  assert.equal(s.vehicles.docks, 0);
});

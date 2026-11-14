import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/vehicle-workshop.js';
import { runTypeChecks, polyArea } from './helpers/typesB-checks.mjs';

runTypeChecks(type, 'vehicle-workshop.js');

const d = type.defaults();
test('vehicle-workshop: one roller door per bay plus the wash bay and parts door', () => {
  for (const bays of [3, 8, 12]) {
    const q = type.quantities({ ...d, bays, washBay: true });
    assert.equal(q.doors.roller, bays + 1 + 1);
    assert.equal(type.quantities({ ...d, bays, washBay: false }).doors.roller, bays + 1);
  }
});
test('vehicle-workshop: hoists and the wash bay produce 3D extras', () => {
  const kinds = type.view3d({ ...d, hoistBays: 3 }, {}).items.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === 'hoistBeam').length, 3);
  assert.ok(kinds.includes('washPit') && kinds.includes('washBund'));
  assert.ok(!type.view3d({ ...d, washBay: false }, {}).items.some((i) => i.kind === 'washPit'));
});
test('vehicle-workshop: parking hint is 1 per 40 m2 or 1 per bay', () => {
  const s = type.site(d);
  assert.equal(s.parking.ratePerM2[0].m2, 40);
  assert.equal(s.parking.perBay, 1);
});

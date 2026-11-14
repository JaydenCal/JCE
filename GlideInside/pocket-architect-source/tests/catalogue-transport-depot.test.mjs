import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/transport-depot.js';
import { runTypeChecks, polyArea } from './helpers/typesB-checks.mjs';

runTypeChecks(type, 'transport-depot.js');

const d = type.defaults();
test('transport-depot: marked bays match the count and grow with the design vehicle', () => {
  for (const vehicle of ['HRV', 'AV', 'B-double']) {
    const bays = type.footprint({ ...d, vehicle, truckBays: 9 }).extras.filter((e) => e.kind === 'bay');
    assert.equal(bays.length, 9);
  }
  const area = (v) => type.quantities({ ...d, vehicle: v }).hardstandM2;
  assert.ok(area('HRV') < area('AV') && area('AV') < area('B-double'));
  assert.equal(type.site({ ...d, vehicle: 'HRV' }).vehicles.design, 'HRV');
  assert.equal(type.site({ ...d, vehicle: 'B-double' }).vehicles.designVehicle, 'B-double');
});
test('transport-depot: weighbridge, fuel and wash options appear in extras and 3D', () => {
  const off = type.footprint({ ...d, weighbridge: false, refuelling: false }).extras.map((e) => e.kind);
  const on = type.footprint({ ...d, weighbridge: true, refuelling: true }).extras.map((e) => e.kind);
  assert.ok(!off.includes('weighbridge') && !off.includes('fuel-canopy'));
  assert.ok(on.includes('weighbridge') && on.includes('fuel-canopy'));
  const kinds = type.view3d({ ...d, weighbridge: true }, {}).items.map((i) => i.kind);
  assert.ok(kinds.includes('weighbridgeDeck') && kinds.includes('bowser') && kinds.includes('truckCab'));
  assert.ok(type.materialise({ ...d, washBay: true }, {}).rooms.some((r) => r.name === 'PROPOSED TRUCK WASH BAY'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/service-station.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/service-station.js', { variants: [{ pumps: 2, kioskM2: 80, airWater: false, tanks: 2 }, { pumps: 8, kioskM2: 300, truckDiesel: true, carWash: 'automatic', tanks: 6 }, { carWash: 'bay' }] });

test('service-station: islands, tank pad, truck island, car wash', () => {
  const d = type.defaults();
  for (const n of [2, 5, 8]) assert.equal(type.footprint({ ...d, pumps: n }).extras.filter((e) => e.kind === 'pump-island').length, n);
  const k = (p) => type.footprint(p).extras.map((e) => e.kind);
  assert.ok(k(d).includes('underground-tank-pad') && k(d).includes('air-water-bay') && k(d).includes('fuel-canopy'));
  assert.ok(!k(d).includes('truck-canopy') && !k(d).includes('car-wash'));
  assert.ok(k({ ...d, truckDiesel: true }).includes('truck-canopy'));
  assert.ok(k({ ...d, carWash: 'automatic' }).includes('car-wash'));
  assert.equal(type.quantities({ ...d, pumps: 6 }).fuellingPositions, 12);
  assert.equal(type.site({ ...d, truckDiesel: true }).vehicles.design, 'HRV');
  assert.ok(type.quantities({ ...d, carWash: 'automatic' }).carWashM2 > type.quantities({ ...d, carWash: 'bay' }).carWashM2);
});

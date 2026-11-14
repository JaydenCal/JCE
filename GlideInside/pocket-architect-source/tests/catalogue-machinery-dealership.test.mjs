import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/machinery-dealership.js';
import { runTypeChecks, polyArea } from './helpers/typesB-checks.mjs';

runTypeChecks(type, 'machinery-dealership.js');

const d = type.defaults();
test('machinery-dealership: outline is the six point two block shape and rooms tile it', () => {
  assert.equal(type.footprint(d).outline.length, 6);
  const q = type.quantities(d);
  assert.ok(q.perUse.showroom > 200 && q.perUse.workshop > 0 && q.perUse.parts > 0 && q.perUse.office > 0);
});
test('machinery-dealership: showroom glazing grows with the glazing percentage, workshop doors are tall', () => {
  assert.ok(type.quantities({ ...d, glazingPct: 90 }).glazingM2 > type.quantities({ ...d, glazingPct: 30 }).glazingM2);
  const m = type.materialise({ ...d, doorHeightM: 6, eaveHeightM: 9 }, {});
  assert.ok(m.openings.some((o) => o.kind === 'roller_door' && o.height >= 5900));
});
test('machinery-dealership: display yard vehicles are massing items in the yard', () => {
  const items = type.view3d({ ...d, yardVehicles: 6 }, {}).items.filter((i) => i.kind === 'tractor' || i.kind === 'machine');
  assert.equal(items.length, 6);
  assert.ok(items.every((i) => i.y1 < 0), 'in front of the building');
  assert.equal(type.view3d({ ...d, yardVehicles: 0 }, {}).items.filter((i) => i.kind === 'tractor').length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES_GARAGE } from '../src/commercial/catalogue/types/garage.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

for (const type of TYPES_GARAGE) {
  checkType(type, '../../src/commercial/catalogue/types/garage.js', { noParking: true, variants: [{ doorKind: 'sectional' }, { sideDoor: false, sideWindow: true, slab: false }] });
}

test('garages: door type, count and size follow the parameters', () => {
  const [one, two, three] = TYPES_GARAGE;
  assert.equal(one.quantities({ ...one.defaults(), doorKind: 'roller' }).doors.roller, 1);
  assert.equal(two.quantities({ ...two.defaults(), doorKind: 'sectional', doorCount: 2 }).doors.roller, 2);
  assert.equal(two.materialise({ ...two.defaults(), doorKind: 'sectional' }, {}).openings.filter((o) => o.kind === 'garage_door').length, 2);
  assert.equal(two.materialise(two.defaults(), {}).openings.filter((o) => o.kind === 'roller_door').length, 2);
  assert.equal(three.quantities(three.defaults()).doors.roller, 2);
  assert.equal(three.quantities({ ...three.defaults(), doorCount: 3 }).doors.roller, 3);
  assert.ok(two.quantities({ ...two.defaults(), W: 7200, D: 8000 }).groundM2 > two.quantities(two.defaults()).groundM2);
  assert.ok(two.presets.length >= 3 && two.presets.every((p) => two.validate(two.normalise(p.params)).length === 0));
  assert.deepEqual(two.footprint(two.defaults()).extras, []);
});

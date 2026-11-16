import test from 'node:test';
import assert from 'node:assert/strict';
import { duplex, townhouseRow, terraceRow, TYPES_HOUSING } from '../src/commercial/catalogue/types/housing.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

const variants = {
  duplex: [{ storeys: 1, garage: 'double', unitW: 11000 }, { garage: 'none', doorKind: 'roller', yardD: 0 }],
  'townhouse-row': [{ dwellings: 10, storeys: 3, garage: 'double' }, { dwellings: 3, garage: 'none', yardD: 0 }],
  'terrace-row': [{ dwellings: 8, storeys: 3, unitW: 4000 }, { rearLane: false, garage: 'single' }],
};
for (const type of TYPES_HOUSING) checkType(type, '../../src/commercial/catalogue/types/housing.js', { variants: variants[type.id] });

test('housing: dwellings, storeys and width set the size and GFA', () => {
  const d = townhouseRow.defaults();
  const fp = (p) => { const o = townhouseRow.footprint({ ...d, ...p }).outline; return Math.max(...o.map((q) => q.x)); };
  assert.equal(fp({ dwellings: 6, unitW: 6000 }), 36000);
  const q1 = townhouseRow.quantities({ ...d, storeys: 1 });
  const q2 = townhouseRow.quantities({ ...d, storeys: 2 });
  assert.ok(Math.abs(q2.gfaM2 - 2 * q1.gfaM2) < 0.3);
  assert.equal(townhouseRow.quantities(d).dwellings, 4);
  assert.equal(duplex.quantities(duplex.defaults()).dwellings, 2);
  assert.equal(terraceRow.materialise(terraceRow.defaults(), {}).levels.length, 2);
});

test('housing: party walls on every level, one entry per dwelling, garages follow the setting', () => {
  const d = townhouseRow.defaults();
  const m = townhouseRow.materialise(d, {});
  assert.equal(m.walls.filter((w) => w.kind === 'interior').length, (d.dwellings - 1) * d.storeys);
  assert.equal(m.openings.filter((o) => o.kind === 'door').length, d.dwellings);
  assert.equal(m.openings.filter((o) => o.kind === 'garage_door').length, d.dwellings);
  assert.equal(townhouseRow.materialise({ ...d, garage: 'none' }, {}).openings.filter((o) => o.kind === 'garage_door').length, 0);
  assert.equal(townhouseRow.materialise({ ...d, doorKind: 'roller' }, {}).openings.filter((o) => o.kind === 'roller_door').length, d.dwellings);
  assert.equal(townhouseRow.materialise({ ...d, unitW: 4500, garage: 'double' }, {}).openings.filter((o) => o.kind === 'garage_door').length, 0);
});

test('housing: parking is higher without garages and the rear lane is an extra', () => {
  const d = terraceRow.defaults();
  const need = (p) => terraceRow.site({ ...d, ...p }).parking.ratePerM2.reduce((a, r) => a + r.m2 / r.per, 0);
  assert.ok(need({ garage: 'none' }) > need({ garage: 'single' }) + 1);
  assert.ok(terraceRow.footprint(d).extras.some((e) => e.kind === 'service-lane'));
  assert.ok(!terraceRow.footprint({ ...d, rearLane: false }).extras.some((e) => e.kind === 'service-lane'));
  for (const t of TYPES_HOUSING) { assert.ok(t.presets.length >= 3); for (const p of t.presets) assert.deepEqual(t.validate(t.normalise(p.params)), [], p.id); }
});

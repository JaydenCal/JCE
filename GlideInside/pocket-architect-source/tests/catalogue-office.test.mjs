import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/office.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/office.js', { variants: [{ storeys: 1, corePos: 'left' }, { storeys: 3, corePos: 'rear', layout: 'tenancies', parking: 'basement' }, { corePos: 'centre', layout: 'tenancies', tenancies: 5, canopy: false }] });

test('office: storeys scale GFA, tenancies listed, basement hint', () => {
  const d = type.defaults();
  const q1 = type.quantities({ ...d, storeys: 1 }); const q3 = type.quantities({ ...d, storeys: 3 });
  assert.ok(Math.abs(q3.gfaM2 - 3 * q1.gfaM2) < 0.3);
  const m = type.materialise({ ...d, layout: 'tenancies', tenancies: 4, storeys: 2 }, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(m.levels.length, 2);
  assert.ok(m.rooms.filter((r) => r.name.includes('TENANCY') && r.level === 'Ground').length >= 3);
  assert.equal(type.site(d).parking.ratePerM2[0].per, 40);
  assert.ok(type.quantities({ ...d, parking: 'basement' }).basementM2 > 0);
  assert.equal(type.quantities(d).basementM2, 0);
  assert.ok(type.footprint({ ...d, canopy: true }).extras.some((e) => e.kind === 'canopy'));
});

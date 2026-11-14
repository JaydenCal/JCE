import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/retail-strip.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/retail-strip.js', { variants: [{ shops: 2, shopW: 4000, cafeEnd: false, serviceLane: false, binStore: false }, { shops: 12, shopW: 10000, continuousAwning: false }, { shops: 7, outdoorDining: false }] });

test('retail-strip: shop count, cafe end, lane, bin store, default rate', () => {
  const d = type.defaults();
  const m = type.materialise({ ...d, shops: 6 }, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(m.rooms.filter((r) => r.name.startsWith('PROPOSED SHOP')).length, 5);
  assert.equal(m.rooms.filter((r) => r.name === 'PROPOSED CAFE').length, 1);
  const ex = type.footprint(d).extras.map((e) => e.kind);
  for (const k of ['awning', 'outdoor-dining', 'service-lane', 'bin-store']) assert.ok(ex.includes(k), k);
  assert.equal(type.site(d).parking.ratePerM2[0].per, 25);
  assert.ok(type.quantities(d).outdoorSeats > 0);
  assert.ok(type.site(d).notes.join(' ').includes('check with council'));
  assert.equal(type.quantities({ ...d, shops: 3, shopW: 8000 }).groundM2, 3 * 8 * 15);
});

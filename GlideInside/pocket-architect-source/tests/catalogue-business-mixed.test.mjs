import test from 'node:test';
import assert from 'node:assert/strict';
import { businessPark, mixedUse, TYPES_BUSINESS_MIXED } from '../src/commercial/catalogue/types/business-mixed.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(businessPark, '../../src/commercial/catalogue/types/business-mixed.js', { variants: [{ doorSide: 'rear', awning: false, apronD: 0 }, { units: 20, unitW: 5000, doorW: 3200, doorSide: 'front' }, { units: 2, unitW: 15000, D: 45000 }] });
checkType(mixedUse, '../../src/commercial/catalogue/types/business-mixed.js', { variants: [{ levelsAbove: 3, shops: 8, balconies: false }, { serviceLane: false, awning: false, shops: 2, shopW: 5000 }, { levelsAbove: 2, shopW: 12000 }] });

test('business park: every unit has its own entry, roller door and rear access, none overlap on a wall', () => {
  for (const doorSide of ['front', 'rear']) {
    const d = { ...businessPark.defaults(), doorSide };
    const m = businessPark.materialise(d, {});
    assert.equal(m.openings.filter((o) => o.kind === 'roller_door').length, d.units);
    const byWall = new Map();
    for (const o of m.openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) || []), o]);
    for (const list of byWall.values()) { const s = [...list].sort((a, b) => a.offset - b.offset); for (let i = 1; i < s.length; i++) assert.ok(s[i].offset >= s[i - 1].offset + s[i - 1].width, `${doorSide} overlap`); }
  }
  const q = businessPark.quantities(businessPark.defaults());
  assert.ok(q.perUse.office > 0 && q.perUse.warehouse > q.perUse.office);
  assert.equal(q.units, 6);
  assert.equal(businessPark.site(businessPark.defaults()).parking.ratePerM2.length, 2);
});

test('mixed use: shops on the ground, homes on each level above, separate entries', () => {
  const d = mixedUse.defaults();
  const m = mixedUse.materialise({ ...d, levelsAbove: 2 }, {});
  assert.equal(m.levels.length, 3);
  assert.equal(m.rooms.filter((r) => r.name.startsWith('PROPOSED SHOP')).length, d.shops);
  assert.equal(m.rooms.filter((r) => r.name.startsWith('PROPOSED HOME')).length, d.shops * 2);
  assert.equal(m.openings.filter((o) => o.kind === 'door' && o.level === 'Ground').length >= d.shops * 3, true);
  const q = mixedUse.quantities({ ...d, levelsAbove: 2 });
  assert.equal(q.homes, d.shops * 2);
  assert.ok(Math.abs(q.perUse.residential - 2 * q.perUse.retail) < 0.5);
  const bays = (p) => mixedUse.site({ ...d, ...p }).parking.ratePerM2.reduce((a, r) => a + r.m2 / r.per, 0);
  assert.ok(bays({ levelsAbove: 3 }) > bays({ levelsAbove: 1 }));
  assert.ok(mixedUse.footprint(d).extras.some((e) => e.kind === 'awning'));
  assert.ok(!mixedUse.footprint({ ...d, serviceLane: false }).extras.some((e) => e.kind === 'service-lane'));
});

test('business park and mixed use presets are valid', () => {
  for (const t of TYPES_BUSINESS_MIXED) { assert.ok(t.presets.length >= 3); for (const p of t.presets) assert.deepEqual(t.validate(t.normalise(p.params)), [], p.id); }
});

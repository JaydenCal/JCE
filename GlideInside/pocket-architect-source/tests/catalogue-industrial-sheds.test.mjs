import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSpanShed, machineryShed } from '../src/commercial/catalogue/types/industrial-sheds.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(clearSpanShed, '../../src/commercial/catalogue/types/industrial-sheds.js', { variants: [{ office: false, sideDoors: 2, doorCount: 4, doorPos: 'spread' }, { W: 48000, D: 120000, doorCount: 4, doorPos: 'left', yardDepth: 0 }, { W: 12000, officeW: 12000, doorCount: 3 }] });
checkType(machineryShed, '../../src/commercial/catalogue/types/industrial-sheds.js', { noParking: true, variants: [{ closedDepth: 0 }, { W: 30000, D: 24000, posts: 8, apron: false }] });

test('clear-span shed: office splits the floor, doors sit clear of the office, side doors double up', () => {
  const d = clearSpanShed.defaults();
  const q = clearSpanShed.quantities(d);
  assert.ok(q.perUse.office > 0 && q.perUse.shed > q.perUse.office);
  assert.equal(clearSpanShed.quantities({ ...d, office: false }).perUse.office, 0);
  const m = clearSpanShed.materialise({ ...d, doorCount: 3, doorPos: 'spread' }, {});
  const front = m.openings.filter((o) => o.kind === 'roller_door');
  assert.ok(front.length >= 1 && front.length <= 3);
  assert.ok(front.every((o) => o.offset >= d.officeW));
  assert.equal(clearSpanShed.quantities({ ...d, office: false, doorCount: 2, sideDoors: 2 }).doors.roller, 6);
  assert.ok(clearSpanShed.footprint(d).extras.some((e) => e.kind === 'apron'));
  assert.equal(clearSpanShed.footprint({ ...d, yardDepth: 0 }).extras.length, 0);
  assert.ok(clearSpanShed.site(d).parking.ratePerM2.length === 2);
});

test('machinery shed: open front bay and an optional enclosed store', () => {
  const d = machineryShed.defaults();
  const kinds = (p) => machineryShed.materialise({ ...d, ...p }, {}).openings.map((o) => o.kind);
  assert.ok(kinds({}).filter((k) => k === 'opening').length === 3);
  assert.ok(kinds({}).includes('roller_door'));
  assert.ok(!kinds({ closedDepth: 0 }).includes('roller_door'));
  assert.ok(machineryShed.quantities(d).perUse.store > 0);
  assert.equal(machineryShed.quantities({ ...d, closedDepth: 0 }).perUse.store, 0);
  assert.equal(machineryShed.site(d).parking.ratePerM2.length, 0);
  assert.ok(machineryShed.presets.length >= 3 && clearSpanShed.presets.length >= 3);
  for (const t of [machineryShed, clearSpanShed]) for (const p of t.presets) assert.deepEqual(t.validate(t.normalise(p.params)), [], p.id);
});

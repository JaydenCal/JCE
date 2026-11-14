import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/community-centre.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/community-centre.js', { variants: [{ variant: 'medical', consultRooms: 12 }, { variant: 'childcare', places: 120, dropOffBays: 12 }, { variant: 'childcare', places: 20, dropOffBays: 2 }] });

test('community-centre: play area only for childcare, drop-off bays, accessible entry', () => {
  const d = type.defaults();
  const k = (p) => type.footprint(p).extras.map((e) => e.kind);
  assert.ok(k(d).includes('play-area-fenced') && k(d).includes('drop-off-bays') && k(d).includes('accessible-path'));
  assert.ok(!k({ ...d, variant: 'medical' }).includes('play-area-fenced'));
  assert.equal(type.quantities(d).playAreaM2, 420);
  const m = type.materialise({ ...d, places: 100 }, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(m.rooms.filter((r) => r.name.includes('ACTIVITY ROOM')).length, 4);
  const med = type.materialise({ ...d, variant: 'medical', consultRooms: 8 }, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(med.rooms.filter((r) => r.name.includes('CONSULTING ROOM')).length, 8);
  assert.ok(m.openings.some((o) => o.kind === 'door' && o.width >= 1800));
  assert.ok(type.site(d).notes.join(' ').includes('check with council'));
});

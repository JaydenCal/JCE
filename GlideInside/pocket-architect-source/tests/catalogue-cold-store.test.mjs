import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/cold-store.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/cold-store.js', { variants: [{ chillers: 1, freezers: 1, roomW: 8000, docks: 12 }, { chillers: 4, freezers: 4, docks: 12, roomD: 40000 }] });

test('cold-store: rooms, docks with seals and shelters, plant, pod', () => {
  const d = type.defaults();
  const m = type.materialise(d, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(m.rooms.filter((r) => r.name.includes('CHILLER')).length, 2);
  assert.equal(m.rooms.filter((r) => r.name.includes('FREEZER')).length, 2);
  assert.ok(m.rooms.some((r) => r.name === 'PROPOSED OFFICE POD'));
  const docks = m.openings.filter((o) => o.dockDoor);
  assert.equal(docks.length, 4);
  assert.ok(docks.every((o) => o.seal && o.shelter && o.sill > 0));
  assert.equal(type.site(d).vehicles.docks, 4);
  const k = type.footprint(d).extras.map((e) => e.kind);
  assert.ok(k.includes('plant-platform') && k.includes('dock-shelter') && k.includes('dock-apron'));
  const small = { ...d, chillers: 1, freezers: 1, roomW: 8000, docks: 12 };
  assert.equal(type.site(small).vehicles.docks, type.quantities(small).doors.dock);
});

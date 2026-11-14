import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/self-storage.js';
import { runTypeChecks, polyArea } from './helpers/typesB-checks.mjs';

runTypeChecks(type, 'self-storage.js');

const d = type.defaults();
test('self-storage: two storey adds an upper level, a lift core and gallery', () => {
  const m = type.materialise({ ...d, storeys: 2 }, {});
  assert.ok(m.levels.some((l) => l.name === 'Level 1'));
  assert.ok(m.rooms.some((r) => r.name === 'LIFT AND STAIR CORE'));
  const q = type.quantities({ ...d, storeys: 2 });
  assert.ok(q.upperM2 > 0 && q.gfaM2 > type.quantities(d).gfaM2);
});
test('self-storage: climate block replaces roller doors with doors and adds a corridor', () => {
  const m = type.materialise({ ...d, climateBlock: true, climateBlockLengthM: 12 }, {});
  assert.ok(m.rooms.some((r) => r.name.startsWith('CLIMATE CONTROLLED CORRIDOR')));
  assert.ok(type.quantities({ ...d, climateBlock: true }).perUse.climateStorage > 0);
});
test('self-storage: aisles and lockup sizes stay in range', () => {
  for (const mix of ['compact', 'standard', 'large']) for (const aw of [6, 7]) {
    const m = type.materialise({ ...d, lockupMix: mix, aisleWidthM: aw, aislesCount: 2 }, {});
    const units = m.rooms.filter((r) => r.name.startsWith('STORAGE UNIT'));
    assert.ok(units.length > 10);
    for (const u of units) { const xs = u.polygon.map((p) => p.x); const w = Math.max(...xs) - Math.min(...xs); assert.ok(w >= 1499, `${u.name} ${w}`); }
  }
  assert.equal(type.quantities({ ...d, aislesCount: 3 }).doors.roller > type.quantities({ ...d, aislesCount: 1 }).doors.roller, true);
});

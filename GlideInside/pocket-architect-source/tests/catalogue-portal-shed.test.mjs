import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/portal-shed.js';
import { runTypeChecks, polyArea } from './helpers/typesB-checks.mjs';

runTypeChecks(type, 'portal-shed.js');

const d = type.defaults();
const ext = (o) => { const xs = o.map((p) => p.x); const ys = o.map((p) => p.y); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; };
test('portal-shed: span, bays and frontage set the plan size', () => {
  assert.deepEqual(ext(type.footprint({ ...d, spanM: 30, bays: 4, baySpacingM: 8, frontage: 'side' }).outline), [32000, 30000]);
  assert.deepEqual(ext(type.footprint({ ...d, spanM: 30, bays: 4, baySpacingM: 8, frontage: 'gable' }).outline), [30000, 32000]);
});
test('portal-shed: mezzanine office adds a level and area, lean-to and awning are extras', () => {
  const m = type.materialise({ ...d, mezzanineOffice: true }, {});
  assert.ok(m.levels.some((l) => l.name === 'Mezzanine'));
  assert.ok(type.quantities({ ...d, mezzanineOffice: true }).upperM2 > 0);
  const kinds = type.footprint({ ...d, awning: true, leanTo: true }).extras.map((e) => e.kind);
  assert.ok(kinds.includes('awning') && kinds.includes('lean-to') && kinds.includes('yard'));
  assert.ok(type.quantities({ ...d, leanTo: true }).roofM2 > type.quantities(d).roofM2);
});
test('portal-shed: door counts follow the parameters', () => {
  const q = type.quantities({ ...d, sideDoorsPerSide: 3, gableDoors: 1 });
  assert.equal(q.doors.roller, 7);
});

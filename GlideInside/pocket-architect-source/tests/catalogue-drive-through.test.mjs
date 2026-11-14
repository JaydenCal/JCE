import test from 'node:test';
import assert from 'node:assert/strict';
import type from '../src/commercial/catalogue/types/drive-through.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

checkType(type, '../../src/commercial/catalogue/types/drive-through.js', { variants: [{ gfaM2: 150, queueVehicles: 4, payWindow: false, bypassLane: false, outdoorSeating: false }, { gfaM2: 400, queueVehicles: 24, orderPoints: 2, diningPct: 65 }] });

test('drive-through: area, queue default 12, windows, rear leg for long queues', () => {
  const d = type.defaults();
  assert.equal(d.queueVehicles, 12);
  for (const g of [150, 250, 400]) assert.ok(Math.abs(type.quantities({ ...d, gfaM2: g }).groundM2 - g) < 0.2);
  const m = type.materialise(d, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(m.openings.filter((o) => o.kind === 'window' && o.style === 'sliding').length, 2);
  const one = type.materialise({ ...d, payWindow: false }, { x: 0, y: 0, rotationDeg: 0 });
  assert.equal(one.openings.filter((o) => o.kind === 'window' && o.style === 'sliding').length, 1);
  const lanes = (p) => type.footprint(p).extras.filter((e) => e.kind === 'queue-lane').length;
  assert.equal(lanes({ ...d, queueVehicles: 24 }), 2);
  assert.ok(type.quantities(d).queueLaneM >= 72);
  assert.ok(type.site(d).notes[0].includes('12 vehicles'));
});

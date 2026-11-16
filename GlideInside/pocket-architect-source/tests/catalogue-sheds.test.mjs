import test from 'node:test';
import assert from 'node:assert/strict';
import { gableShed, skillionShed, barnShed, carport, TYPES_SHEDS } from '../src/commercial/catalogue/types/sheds.js';
import { checkType } from './helpers/catalogue-type-check.mjs';

const variants = {
  'gable-shed': [{ W: 12000, D: 18000, doorCount: 3, doorPos: 'spread', windows: 4, personnelDoors: 2 }, { W: 3000, D: 3000, doorW: 6000, doorCount: 4 }],
  'skillion-shed': [{ roofPitchDeg: 15, doorCount: 0 }, { W: 9000, doorCount: 2, doorPos: 'left' }],
  'barn-shed': [{ sideLeanTos: false }, { W: 12000, D: 24000, doorCount: 2, doorPos: 'right' }],
  'lean-to-carport': [{ mode: 'lean-to' }, { W: 12000, posts: 6 }],
};
for (const type of TYPES_SHEDS) checkType(type, '../../src/commercial/catalogue/types/sheds.js', { noParking: true, variants: variants[type.id] });

test('sheds: door count, width and position follow the parameters, doors never overlap or leave the wall', () => {
  const d = gableShed.defaults();
  for (const pos of ['centre', 'left', 'right', 'spread']) {
    const m = gableShed.materialise({ ...d, W: 12000, doorCount: 3, doorW: 3000, doorPos: pos }, {});
    const ds = m.openings.filter((o) => o.kind === 'roller_door').sort((a, b) => a.offset - b.offset);
    assert.equal(ds.length, 3, pos);
    for (let i = 0; i < ds.length; i++) { assert.ok(ds[i].offset >= 0 && ds[i].offset + ds[i].width <= 12000, pos); if (i) assert.ok(ds[i].offset >= ds[i - 1].offset + ds[i - 1].width, pos); }
  }
  assert.equal(gableShed.quantities({ ...d, doorCount: 0 }).doors.roller, 0);
  assert.equal(gableShed.quantities({ ...d, W: 3000, doorW: 6000, doorCount: 4 }).doors.roller, 1);
});

test('sheds: roof type and pitch follow the type', () => {
  assert.equal(gableShed.materialise(gableShed.defaults(), {}).roofs[0].type, 'gable');
  assert.equal(skillionShed.materialise(skillionShed.defaults(), {}).roofs[0].type, 'skillion');
  assert.equal(barnShed.materialise(barnShed.defaults(), {}).roofs[0].pitchDeg, 30);
  assert.ok(gableShed.quantities({ ...gableShed.defaults(), roofPitchDeg: 30 }).roofM2 > gableShed.quantities({ ...gableShed.defaults(), roofPitchDeg: 5 }).roofM2);
  assert.ok(gableShed.quantities({ ...gableShed.defaults(), roofPitchDeg: 30 }).ridgeHeightM > gableShed.quantities({ ...gableShed.defaults(), roofPitchDeg: 5 }).ridgeHeightM);
});

test('barn shed lean-tos are footprint extras; carport modes differ in open sides', () => {
  assert.equal(barnShed.footprint(barnShed.defaults()).extras.length, 2);
  assert.equal(barnShed.footprint({ ...barnShed.defaults(), sideLeanTos: false }).extras.length, 0);
  const openCount = (mode) => carport.materialise({ ...carport.defaults(), mode }, {}).openings.filter((o) => o.kind === 'opening').length;
  assert.equal(openCount('carport'), 4);
  assert.equal(openCount('lean-to'), 3);
});

test('sheds: presets are valid and each type has at least three', () => {
  for (const t of TYPES_SHEDS) { assert.ok(t.presets.length >= 3, t.id); for (const p of t.presets) assert.deepEqual(t.validate(t.normalise(p.params)), [], `${t.id} ${p.id}`); }
});

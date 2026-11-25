// Granny flat design with typed sizes (src/model/granny-sizes.js): resizing the outline and one room, adjoining walls, floor area, the Add room
// presets and the warnings (60 m2, bedroom under 2.4 m, bathroom under 1.5 m). Pure model tests on the library's own granny flat plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { catalogue } from '../src/catalogue/index.js';
import * as S from '../src/model/granny-sizes.js';
import * as G from '../src/model/geometry.js';
import { SRC } from './helpers/phone-harness.mjs';

const granny = () => catalogue.createFromTemplate('granny_flat');
const rooms = (p) => Object.fromEntries(S.roomsOf(p).map((r) => [r.name, r]));
const asProject = (p, fn) => { const q = structuredClone(p); fn(q); return q; };

test('the outline is the box round the enclosed rooms, and typed metres become millimetres', () => {
  const p = granny();
  assert.deepEqual(S.overallOf(p), { x: 0, y: 0, width: 9600, length: 6200 });
  assert.equal(S.mmFromMetres('6.0'), 6000);
  assert.equal(S.mmFromMetres('10'), 10000);
  assert.equal(S.mmFromMetres('6,5'), 6500, 'a comma works as a decimal point');
  assert.equal(S.mmFromMetres(''), null);
  assert.equal(S.mmFromMetres('abc'), null);
  assert.equal(S.mmFromMetres('-2'), null);
  assert.equal(S.metresText(6000), '6.0');
});

test('typing an overall width and length redraws the outline and moves the rooms and walls along the east and south edges', () => {
  const p = granny();
  const q = asProject(p, (x) => S.setOverall(x, { width: 10600, length: 7000 }));
  assert.deepEqual(S.overallOf(q), { x: 0, y: 0, width: 10600, length: 7000 });
  const r = rooms(q);
  assert.equal(r['Bed 1'].width, 5000, 'the room on the east edge grew by the 1.0 m');
  assert.equal(r.Living.width, 5000);
  assert.equal(r['Bed 2'].width, 3000, 'a room that is not on the edge keeps its width');
  assert.equal(r.Laundry.depth, 3800, 'the south rooms grew by the 0.8 m');
  const level = q.levels[0];
  const xs = level.walls.flatMap((w) => [w.a.x, w.b.x]);
  assert.equal(Math.max(...xs), 10600, 'the east wall moved with it');
  assert.ok(level.walls.every((w) => G.wallLength(w) > 1), 'no wall is left with no length');
});

test('shrinking the outline works too, and a size that would squash a room is refused with a plain message', () => {
  const p = granny();
  const ok = S.planOverall(p, { width: 9000, length: 6200 });
  assert.equal(ok.ok, true);
  assert.equal(S.overallOf(ok.result).width, 9000);
  const bad = S.planOverall(p, { width: 3000, length: 6200 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /squash|bigger/);
  assert.throws(() => S.setOverall(asProject(p, () => {}), { width: 3000, length: 6200 }), /squash|bigger/);
  const tiny = S.planOverall(p, { width: 1000, length: 6200 });
  assert.equal(tiny.ok, false);
  assert.match(tiny.error, /between 2\.4 m and 30\.0 m/);
});

test('typing a room size: the walls it shares with its neighbours move, so the neighbours adjust', () => {
  const p = granny();
  const living = S.roomsOf(p).find((r) => r.name === 'Kitchen and dining');
  assert.equal(living.width, 4000);
  const plan = S.planRoomSize(p, living.id, { width: 3500, depth: 3000 });
  assert.equal(plan.ok, true);
  const q = asProject(p, (x) => S.setRoomSize(x, living.id, { width: 3500, depth: 3000 }));
  const r = rooms(q);
  assert.equal(r['Kitchen and dining'].width, 3500);
  assert.equal(r.Living.width, 4500, 'the room east of it, which shares the wall, grew by the 0.5 m');
  assert.equal(r.Living.x, 5100);
  assert.equal(S.overallOf(q).width, 9600, 'the outline did not change: the neighbour took it up');
  assert.ok(plan.neighbours.length >= 1, 'the preview names the neighbours that adjust');
});

test('a room on the outer edge pushes the outline out when it grows, and the area follows', () => {
  const p = granny();
  const bed1 = S.roomsOf(p).find((r) => r.name === 'Bed 1');
  const before = S.floorAreaM2(p);
  const q = asProject(p, (x) => S.setRoomSize(x, bed1.id, { width: 5000, depth: 3200 }));
  assert.equal(S.overallOf(q).width, 10600);
  assert.ok(S.floorAreaM2(q) > before + 3, 'the floor area went up by about the 1.0 m x 3.2 m');
  assert.ok(Math.abs(S.floorAreaM2(q) - (before + 3.2)) < 0.01);
});

test('a room cannot be made smaller than 0.5 m, and the message says so', () => {
  const p = granny();
  const bed = S.roomsOf(p).find((r) => r.name === 'Bed 2');
  const r = S.planRoomSize(p, bed.id, { width: 300, depth: 3200 });
  assert.equal(r.ok, false);
  assert.match(r.error, /at least 0\.5 m/);
  assert.equal(S.planRoomSize(p, 'nope', { width: 3000, depth: 3000 }).ok, false);
});

test('floor area counts enclosed rooms only: decks and carports are left out', () => {
  const p = granny();
  const a = S.floorAreaM2(p);
  assert.ok(Math.abs(a - 59.52) < 0.01);
  const withDeck = asProject(p, (x) => S.addPresetRoom(x, 'deck'));
  assert.equal(S.floorAreaM2(withDeck), a, 'a deck is not floor area');
  const car = catalogue.createFromTemplate('granny_2bed_carport');
  assert.ok(S.floorAreaM2(car) <= 60);
});

test('Add room presets: the five sizes, which the person can type over', () => {
  assert.deepEqual(S.ROOM_PRESETS.map((x) => [x.label, x.width, x.depth]), [
    ['Bedroom', 3000, 3000], ['Bathroom', 2400, 2000], ['Kitchen and living', 4500, 5000], ['Laundry', 1800, 2000], ['Deck', 3000, 4000],
  ]);
  const p = granny();
  const q = structuredClone(p);
  const id = S.addPresetRoom(q, 'bedroom');
  const r = S.roomsOf(q).find((x) => x.id === id);
  assert.equal(r.name, 'Bedroom');
  assert.deepEqual([r.width, r.depth], [3000, 3000]);
  const id2 = S.addPresetRoom(q, 'bedroom', { width: 3300, depth: 2800 });
  const r2 = S.roomsOf(q).find((x) => x.id === id2);
  assert.equal(r2.name, 'Bedroom 2', 'names do not repeat');
  assert.deepEqual([r2.width, r2.depth], [3300, 2800], 'a typed size overrides the preset');
  // none of the new rooms sit on another room
  const all = S.roomsOf(q);
  for (const a of all) for (const b of all) if (a.id < b.id) assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.depth <= b.y + 1 || b.y + b.depth <= a.y + 1, `${a.name} and ${b.name} overlap`);
  const deck = S.addPresetRoom(q, 'deck');
  assert.equal(S.roomsOf(q).find((x) => x.id === deck).outdoor, true);
  assert.throws(() => S.addPresetRoom(q, 'castle'), /Pick one/);
  assert.throws(() => S.addPresetRoom(q, 'laundry', { width: 200, depth: 2000 }), /at least 0\.5 m/);
});

test('warnings: over 60 m2 is a clear warning that does not block, and small rooms are named', () => {
  const p = granny();
  assert.equal(S.checkDesign(p).overArea, false);
  assert.deepEqual(S.checkDesign(p).warnings, []);
  // add a kitchen and living preset: 22.5 m2 more, so about 82 m2
  const big = asProject(p, (x) => S.addPresetRoom(x, 'kitchen-living'));
  const chk = S.checkDesign(big);
  assert.equal(chk.overArea, true);
  assert.match(chk.warnings[0], /over by/);
  assert.match(chk.warnings[0], /60 m2/);
  assert.ok(S.floorAreaM2(big) > 60, 'the design is still there: a warning, not a block');
  // bedroom under 2.4 m either way
  const bed = S.roomsOf(p).find((r) => r.name === 'Bed 2');
  const small = asProject(p, (x) => S.setRoomSize(x, bed.id, { width: 2200, depth: 3200 }));
  const w = S.checkDesign(small);
  assert.equal(w.rooms.length, 1);
  assert.match(w.rooms[0].warning, /Bed 2 is 2\.2 x 3\.2 m\. A bedroom is usable from 2\.4 m/);
  const narrow = asProject(p, (x) => S.setRoomSize(x, bed.id, { width: 3000, depth: 2300 }));
  assert.match(S.checkDesign(narrow).warnings.join(' '), /Bed 2/);
  // exactly 2.4 is fine
  assert.equal(S.checkDesign(asProject(p, (x) => S.setRoomSize(x, bed.id, { width: 2400, depth: 3200 }))).rooms.length, 0);
  // bathroom under 1.5 m
  const bath = S.roomsOf(p).find((r) => r.name === 'Bathroom');
  assert.equal(S.checkDesign(p).rooms.length, 0, 'the library bathroom is 1.5 m wide: usable');
  const tight = asProject(p, (x) => S.setRoomSize(x, bath.id, { width: 1400, depth: 3200 }));
  assert.match(S.checkDesign(tight).warnings.join(' '), /Bathroom is 1\.4 x 3\.2 m\. A bathroom is usable from 1\.5 m/);
});

test('the copy follows the text rules: no dashes, never "compliant", no Pocket Architect', () => {
  const src = fs.readFileSync(path.join(SRC, 'src/model/granny-sizes.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'src/ui/granny-designer.js'), 'utf8');
  const strings = [...src.matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] || m[2]);
  for (const t of strings) { assert.ok(!/[–—]/.test(t), `dash in: ${t}`); assert.ok(!/compliant/i.test(t), t); assert.ok(!/pocket architect/i.test(t), t); }
});

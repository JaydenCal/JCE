import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validate } from '../src/model/schema.js';
import { applyOp, toolSchemas, OPS } from '../src/model/ops.js';
import { createStore } from '../src/model/store.js';
import * as G from '../src/model/geometry.js';

const wallAt = (level, x1, y1, x2, y2) => level.walls.find((w) =>
  (G.samePoint(w.a, { x: x1, y: y1 }) && G.samePoint(w.b, { x: x2, y: y2 })) ||
  (G.samePoint(w.a, { x: x2, y: y2 }) && G.samePoint(w.b, { x: x1, y: y1 })));

test('rooms share walls and classify interior/exterior', () => {
  const p = createProject({ name: 'T' });
  const L = p.levels[0];
  const a = applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 3000 }).id;
  applyOp(p, 'add_room', { type: 'bedroom', x: 4000, y: 0, width: 4000, depth: 3000 });
  assert.equal(L.walls.length, 7);
  const shared = wallAt(L, 4000, 0, 4000, 3000);
  assert.ok(shared, 'shared wall exists');
  assert.equal(shared.kind, 'interior');
  assert.equal(shared.thickness, 100);
  const north = wallAt(L, 0, 0, 4000, 0);
  assert.equal(north.kind, 'exterior');
  // north wall runs east, normal points south (into the room), so outdoors is -n
  assert.equal(north.outside, G.samePoint(north.a, { x: 0, y: 0 }) ? -1 : 1);
  assert.deepEqual(validate(p), []);
  assert.ok(a);
});

test('resize_room pushes a side and splits shared walls correctly', () => {
  const p = createProject();
  const L = p.levels[0];
  const A = applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 4000, depth: 3000 }).id;
  const B = applyOp(p, 'add_room', { type: 'bedroom', x: 4000, y: 0, width: 4000, depth: 3000 }).id;
  const shared = wallAt(L, 4000, 0, 4000, 3000);
  const door = applyOp(p, 'add_opening', { wall: shared.id, kind: 'door', offset: 1500 }).id;
  applyOp(p, 'resize_room', { id: A, side: 'south', delta: 2000 });
  const roomA = L.rooms.find((r) => r.id === A);
  assert.equal(G.bbox(roomA.polygon).maxY, 5000);
  assert.ok(wallAt(L, 0, 5000, 4000, 5000), 'south wall moved');
  const lower = wallAt(L, 4000, 3000, 4000, 5000);
  assert.ok(lower, 'shared wall extended and split');
  assert.equal(lower.kind, 'exterior');
  assert.equal(wallAt(L, 4000, 0, 4000, 3000).kind, 'interior');
  applyOp(p, 'resize_room', { id: B, side: 'north', delta: 1000 });
  assert.ok(wallAt(L, 4000, -1000, 8000, -1000), 'B north moved');
  assert.ok(wallAt(L, 4000, -1000, 4000, 0), 'west wall of B extension');
  const d = L.openings.find((o) => o.id === door);
  const dw = L.walls.find((w) => w.id === d.wallId);
  const c = G.pointOnWall(dw, d.offset);
  assert.ok(G.samePoint(c, { x: 4000, y: 1500 }, 2), `door stays put, got ${JSON.stringify(c)}`);
  assert.deepEqual(validate(p), []);
});

test('openings, move_wall, delete room, mirror, levels, tanks, finishes', () => {
  const p = createProject();
  const L = p.levels[0];
  const A = applyOp(p, 'add_room', { type: 'living', x: 0, y: 0, width: 6000, depth: 4000 }).id;
  const B = applyOp(p, 'add_room', { type: 'garage', x: 6000, y: 0, width: 6000, depth: 6000 }).id;
  const win = applyOp(p, 'add_opening', { kind: 'window', x: 3000, y: 50 }).id;
  assert.ok(L.openings.find((o) => o.id === win));
  assert.throws(() => applyOp(p, 'add_opening', { kind: 'window', x: 3000, y: 0 }), /overlaps/);
  const west = wallAt(L, 0, 0, 0, 4000);
  applyOp(p, 'move_wall', { id: west.id, dx: -1000, dy: 0 });
  assert.equal(G.bbox(L.rooms.find((r) => r.id === A).polygon).minX, -1000);
  applyOp(p, 'delete', { id: B });
  assert.equal(L.rooms.length, 1);
  assert.ok(L.walls.every((w) => w.kind === 'exterior'), 'garage walls gone, shared wall now exterior');
  applyOp(p, 'add_furniture', { item: 'sofa_3', room: A });
  const before = G.projectBounds(p);
  applyOp(p, 'mirror_plan', { axis: 'left_right' });
  const after = G.projectBounds(p);
  assert.equal(Math.round(before.cx), Math.round(after.cx));
  const lvl = applyOp(p, 'add_level', {}).id;
  assert.equal(p.levels.length, 2);
  assert.ok(p.levels[1].walls.length >= 4 && p.levels[1].id === lvl);
  assert.equal(p.levels[1].elevation, 3000);
  const t = applyOp(p, 'add_tank', { capacity_l: 5000 }).id;
  assert.equal(p.site.tanks.find((x) => x.id === t).diameter, 1850);
  applyOp(p, 'set_finish', { target: 'roof', colour: 'steel-charcoal' });
  applyOp(p, 'set_roof', { type: 'gable', pitch: 25 });
  applyOp(p, 'set_status', { ids: ['*'], status: 'existing' });
  assert.ok(L.walls.every((w) => w.status === 'existing'));
  assert.deepEqual(validate(p), []);
});

test('store undo, redo and batch reporting', () => {
  const s = createStore(createProject());
  s.run('add_room', { type: 'bedroom', x: 0, y: 0, width: 3000, depth: 3000 });
  assert.equal(s.project.levels[0].rooms.length, 1);
  const res = s.runBatch('AI change', [
    { op: 'set_finish', args: { target: 'roof', colour: 'steel-charcoal' } },
    { op: 'resize_room', args: { id: 'nope', side: 'east', delta: 100 } },
  ]);
  assert.equal(res[0].ok, true);
  assert.equal(res[1].ok, false);
  assert.ok(s.undo());
  assert.ok(s.undo());
  assert.equal(s.project.levels[0].rooms.length, 0);
  assert.ok(s.redo());
  assert.equal(s.project.levels[0].rooms.length, 1);
  assert.throws(() => s.run('add_room', { type: 'bedroom', x: 0, y: 0, width: 10, depth: 10 }));
  assert.equal(s.project.levels[0].rooms.length, 1, 'failed op leaves project unchanged');
});

test('tool schemas are valid Anthropic tool definitions', () => {
  const tools = toolSchemas({ furniture: ['sofa_3'], colours: ['steel-charcoal'] });
  assert.equal(tools.length, Object.keys(OPS).length);
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(t.input_schema.type, 'object');
    for (const r of t.input_schema.required) assert.ok(t.input_schema.properties[r], `${t.name}.${r}`);
  }
  assert.ok(JSON.stringify(tools).length < 40000);
});

test('design type: granny flat replaces the design, keeps the title block, one undo step', async () => {
  const { catalogue } = await import('../src/catalogue/index.js');
  const { buildDesignType, applyDesignType, changeDesignType, designTypeOf, DESIGN_TYPES } = await import('../src/ui/design-type.js');
  const { createStore } = await import('../src/model/store.js');
  const { validate } = await import('../src/model/schema.js');
  const store = createStore(catalogue.createFromTemplate('house_single'), { opContext: { catalogue } });
  store.run('set_titleblock', { projectName: 'Smith granny flat', client: 'J Smith', address: '1 Test St', lotDp: 'Lot 1 DP 123' });
  store.run('set_drawing', { scale: 100, paper: 'A1' });
  const id = store.project.id;
  const before = JSON.stringify(store.project.levels);
  assert.equal(designTypeOf(store.project), 'house');
  const depth = store.canUndo();
  applyDesignType(store, 'granny_flat', catalogue);
  assert.equal(designTypeOf(store.project), 'granny_flat');
  assert.equal(store.project.id, id);
  assert.equal(store.project.titleBlock.projectName, 'Smith granny flat');
  assert.equal(store.project.titleBlock.client, 'J Smith');
  assert.equal(store.project.titleBlock.lotDp, 'Lot 1 DP 123');
  assert.deepEqual(store.project.drawing, { scale: 100, paper: 'A1' });
  assert.ok(store.project.levels[0].rooms.some((r) => /Bed 2/.test(r.name)));
  assert.ok(!store.project.levels[0].rooms.some((r) => /Garage/.test(r.name)));
  assert.deepEqual(validate(store.project), []);
  assert.equal(store.undoLabel(), 'Change to granny flat');
  store.undo();
  assert.ok(depth);
  assert.equal(JSON.stringify(store.project.levels), before, 'undo restores the house');
  for (const d of DESIGN_TYPES) assert.equal(designTypeOf(buildDesignType(store.project, d.id, catalogue)), d.id);
  // The confirmation is asked in page; declining keeps the design.
  let asked = '';
  assert.equal(await changeDesignType(store, 'shed', catalogue, { confirm: async (o) => ((asked = o.message), false) }), false);
  assert.equal(designTypeOf(store.project), 'house');
  assert.equal(await changeDesignType(store, 'granny_flat', catalogue, { confirm: async (o) => ((asked = o.message), true) }), true);
  assert.equal(asked, 'Replace this design with a generic 2 bedroom granny flat? You can undo.');
  assert.equal(await changeDesignType(store, 'granny_flat', catalogue, { confirm: async () => assert.fail('no question for the same type') }), false);
});

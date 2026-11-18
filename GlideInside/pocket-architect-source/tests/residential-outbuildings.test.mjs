import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { createStore } from '../src/model/store.js';
import { validate } from '../src/model/schema.js';

import { OUTBUILDINGS, addOutbuilding } from '../src/catalogue/tpl/outbuildings.js';
import { TOOL_DEFS } from '../src/editor2d/tools-meta.js';

test('residential Add building: every outbuilding merges into the plan, valid, one undo step', () => {
  assert.ok(OUTBUILDINGS.length >= 6);
  for (const o of OUTBUILDINGS) {
    const store = createStore(catalogue.createFromTemplate('house_single'), { opContext: { catalogue } });
    const rooms = store.project.levels[0].rooms.length;
    addOutbuilding(store, o.id);
    assert.ok(store.project.levels[0].rooms.length > rooms, o.id);
    assert.deepEqual(validate(store.project), [], o.id);
    store.undo();
    assert.equal(store.project.levels[0].rooms.length, rooms, `${o.id} undo`);
  }
});

test('the Road or pavement tool is gone from the tool rail', () => {
  assert.equal(TOOL_DEFS.find((d) => d.id === 'pave'), undefined);
  assert.ok(!TOOL_DEFS.some((d) => d.key === 'L'));
});

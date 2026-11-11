// Save and share: the parts that need no server. The wire client and edit keys are covered against the real Worker in
// tests/live-merge.test.mjs (section 4). Here: link format, read only store, own copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { forkProject, shareIdFromSearch, shareKey } from '../src/ui/cloud.js';

const sample = () => {
  const p = createProject({ id: 'p_orig0001', name: 'Smith residence' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  return p;
};

test('the live link format ?share=<id> is read from the address, with other parameters around it', () => {
  assert.equal(shareIdFromSearch('?share=AbC_123-xyzAbC_123-xyz'), 'AbC_123-xyzAbC_123-xyz');
  assert.equal(shareIdFromSearch('?template=house_single&share=AbC_123-xyzAbC_123-xyz&view=3d'), 'AbC_123-xyzAbC_123-xyz');
  assert.equal(shareIdFromSearch('?view=3d'), null);
  assert.equal(shareIdFromSearch('?share='), null);
  assert.equal(shareIdFromSearch(''), null);
  assert.equal(shareIdFromSearch(undefined), null);
  assert.equal(shareKey('p_abc'), 'ps.share.p_abc', 'edit keys live under the same localStorage names as the live app');
});

test('a shared design is read only: every change is refused, opening a design is not, and autosave stays off', () => {
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (k, v) => writes.push(k), removeItem() {} };
  try {
    const store = createStore(sample(), { autosaveKey: 'ps.autosave.v1' });
    store.setAutosave(false);
    store.replace(sample()); // opening the shared design is allowed
    store.readOnly = true;
    assert.throws(() => store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 }), (e) => e.name === 'ReadOnlyError' && /read only/.test(e.message));
    assert.throws(() => store.apply('x', (p) => { p.name = 'changed'; }), { name: 'ReadOnlyError' });
    assert.equal(store.project.name, 'Smith residence');
    assert.equal(store.canUndo(), false);
    store.saveNow();
    assert.deepEqual(writes, [], 'a read only design never overwrites the design saved in this browser');
    // making a copy turns it back into a normal design
    store.readOnly = false;
    store.setAutosave(true);
    store.replace(forkProject(store.project));
    store.run('add_room', { type: 'bedroom', name: 'Bed', x: 7000, y: 0, width: 3000, depth: 3000 });
    store.saveNow();
    assert.deepEqual(writes, ['ps.autosave.v1']);
  } finally {
    delete globalThis.localStorage;
  }
});

test('Make my own copy: new id, "(copy)" name, no tracing underlay, same design', () => {
  const p = sample();
  p.site.underlay = { key: 'x' };
  const copy = forkProject(p, { now: new Date('2026-11-11T00:00:00Z') });
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.name, 'Smith residence (copy)');
  assert.equal(copy.site.underlay, null);
  assert.equal(copy.createdAt, '2026-11-11T00:00:00.000Z');
  assert.equal(copy.levels[0].rooms.length, p.levels[0].rooms.length);
  assert.equal(p.site.underlay.key, 'x', 'the original is untouched');
});

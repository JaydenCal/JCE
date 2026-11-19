// Two tabs on one design: the autosave version counter and the banner state (src/model/store.js, src/ui/tab-guard.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const listeners = [];
globalThis.window = { addEventListener: (t, f) => { if (t === 'storage') listeners.push(f); } };
const { createStore } = await import('../src/model/store.js');
const storage = (key) => listeners.forEach((f) => f({ key }));

const KEY = 'ps.autosave.v1';
const named = (n) => ({ ...createProject(), name: n });

test('tab guard: a stale tab does not overwrite a newer save, and Keep editing lets it', () => {
  mem.clear();
  const a = createStore(named('A'), { autosaveKey: KEY });
  const b = createStore(named('B'), { autosaveKey: KEY });
  assert.notEqual(a.tabId, b.tabId);
  let conflicts = 0;
  b.on('autosave-conflict', () => { conflicts++; });
  a.saveNow();
  assert.equal(JSON.parse(mem.get(KEY)).name, 'A');
  const v1 = JSON.parse(mem.get(`${KEY}.meta`));
  assert.equal(v1.tab, a.tabId);
  assert.equal(v1.v, 1);
  storage(KEY); // the storage event reaches the other tab only; a's own listener sees its own write as its own tab
  assert.equal(conflicts, 1, 'tab B is told');
  assert.equal(b.autosaveStale, true);
  assert.equal(a.autosaveStale, false);
  b.saveNow();
  assert.equal(JSON.parse(mem.get(KEY)).name, 'A', 'stale tab B did not overwrite');
  b.keepEditing();
  assert.equal(b.autosaveStale, false);
  b.saveNow();
  assert.equal(JSON.parse(mem.get(KEY)).name, 'B', 'after Keep editing B saves');
  assert.equal(JSON.parse(mem.get(`${KEY}.meta`)).v, 2);
});

test('tab guard: a missed storage event is caught at save time; one tab alone never sees a conflict', () => {
  mem.clear();
  const a = createStore(named('A'), { autosaveKey: KEY });
  a.saveNow();
  a.saveNow();
  assert.equal(JSON.parse(mem.get(`${KEY}.meta`)).v, 2);
  assert.equal(a.autosaveStale, false);
  const b = createStore(named('B'), { autosaveKey: KEY }); // opened after: knows version 2
  b.saveNow();
  assert.equal(b.autosaveStale, false);
  a.saveNow(); // a missed b's event
  assert.equal(a.autosaveStale, true);
  assert.equal(JSON.parse(mem.get(KEY)).name, 'B');
});

test('tab guard: the banner has the agreed wording and the Reload and Keep editing buttons', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/ui/tab-guard.js', import.meta.url), 'utf8');
  assert.ok(src.includes("This design was changed in another tab. Reload to see it, or keep editing here (the other tab's changes will be replaced)."));
  assert.ok(src.includes("'Reload'") && src.includes("'Keep editing'"));
});

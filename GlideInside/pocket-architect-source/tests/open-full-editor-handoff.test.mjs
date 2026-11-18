// Regression (owner 18/11/2026): "Open full editor" on the /commercial/ page (no "For the full tool set" tag) navigated straight to the app, so the
// editor started a fresh guided flow with the tutorial on top instead of continuing the embedded layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { HANDOFF_KEY } from '../src/toolmode.js';
import { takeHandoff } from '../src/ui/embed-viewer.js';
import { convertToCommercial } from '../src/commercial/mode.js';
import { createProject } from '../src/model/schema.js';
import { flowOf } from '../src/flow/state.js';

const live = resolve(dirname(new URL(import.meta.url).pathname), '../../website-live');

test('every "Open full editor" link gets the handoff click handler, tag or not', () => {
  const js = readFileSync(resolve(live, 'framework.js'), 'utf8');
  assert.match(js, /querySelectorAll\("\.lh-edit"\)\.forEach\(function \(link\)/, 'handler is attached per link');
  assert.ok(!/querySelectorAll\("\[data-edit-tag\]"\)\.forEach/.test(js), 'the handler must not depend on the pulsing tag');
  assert.match(js, /gi:open-editor/);
  for (const page of ['index.html', 'commercial/index.html']) assert.ok(/class="lh-edit"/.test(readFileSync(resolve(live, page), 'utf8')), page);
});

test('a handed over commercial project is read back whole, at the editor step, with no earlier autosave replacing it', () => {
  const p = convertToCommercial(createProject({ name: 'U shape' }), { name: 'U shape' });
  p.site.lot = { address: '', boundary: [{ x: 0, y: 0 }, { x: 60000, y: 0 }, { x: 60000, y: 90000 }, { x: 0, y: 90000 }] };
  p.flow = { kind: 'commercial', step: 5 };
  const mem = new Map([[HANDOFF_KEY, JSON.stringify({ at: Date.now(), project: p })]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const got = takeHandoff(storage);
  assert.ok(got?.project);
  assert.equal(got.project.name, 'U shape');
  assert.equal(got.project.mode, 'commercial');
  assert.deepEqual(got.project.site.lot.boundary, p.site.lot.boundary);
  assert.equal(flowOf(got.project)?.step, 5, 'the editor step, so no guided step 1 or tutorial');
  assert.equal(mem.has(HANDOFF_KEY), false, 'read once');
});

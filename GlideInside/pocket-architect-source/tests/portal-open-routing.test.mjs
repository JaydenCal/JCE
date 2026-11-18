// Opening an existing design or project from the builder portal goes straight into the editor, never the guided steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStart } from '../src/flow/index.js';
import { portalDeepLink, forEditing, flowInProgress, flowOf } from '../src/flow/state.js';
import { createProject } from '../src/model/schema.js';
import { designLink, appLink } from '../src/portal/links.js';

const fresh = () => createProject({ name: 'My home' });

test('portal links: project, house and glide open the editor; a new start or a public visit keeps the guided flow', () => {
  for (const s of ['?project=p_1', '?house=h_1', '?glide=glide:house_single', '?design=1&project=p_1']) {
    assert.equal(portalDeepLink(s), true, s);
    assert.equal(shouldStart({ project: fresh(), search: s, fromAutosave: false }), false, `${s}: no guided steps even on a fresh open`);
  }
  for (const s of ['', '?design=new', '?signin=1', '?design=1']) {
    assert.equal(portalDeepLink(s), false, s);
    assert.equal(shouldStart({ project: fresh(), search: s, fromAutosave: false }), true, `${s}: brand new start keeps the guided flow`);
  }
});

test('portal links built by the portal carry the parameters the routing looks for', () => {
  assert.equal(portalDeepLink(new URL(appLink({ project: 'p_9' })).search), true);
  assert.equal(portalDeepLink(new URL(appLink({ house: 'h_9' })).search), true);
  assert.equal(portalDeepLink(new URL(designLink({ project: 'p_9' })).search), true, 'Open as client view');
  assert.equal(portalDeepLink(new URL(designLink()).search), false, 'Design on a lot starts a new design');
});

test('a design saved part way through the guided flow is moved to the editing step, an untouched one is returned as is', () => {
  const mid = { ...fresh(), flow: { kind: 'residential', step: 2, designId: 'x' } };
  assert.equal(flowInProgress(mid), true);
  const ed = forEditing(mid);
  assert.equal(flowInProgress(ed), false);
  assert.equal(flowOf(ed).step, 5);
  assert.equal(flowOf(ed).designId, 'x');
  assert.equal(mid.flow.step, 2, 'the input is not mutated');
  const plain = fresh();
  assert.equal(forEditing(plain), plain);
  const done = { ...fresh(), flow: { kind: 'residential', step: 5 } };
  assert.equal(forEditing(done), done);
});

test('the viewer, demo and share link rules are unchanged', () => {
  assert.equal(shouldStart({ project: fresh(), search: '', viewer: true }), false);
  assert.equal(shouldStart({ project: fresh(), search: '', demo: true }), false);
  assert.equal(shouldStart({ project: { ...fresh(), flow: { kind: 'residential', step: 3 } }, search: '', fromAutosave: true }), true, 'a refresh part way through a fresh start resumes');
});

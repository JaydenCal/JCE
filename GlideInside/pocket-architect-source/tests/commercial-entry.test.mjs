// Commercial entry points: an address link and the embedded viewer's Open full editor go through the guided steps first, a design that
// already finished the flow goes straight to the editor, and an address link never opens a kept design for a different address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldStart, commercialAddressAsked } from '../src/flow/index.js';
import { fullEditorUrl, addressFromSearch } from '../src/ui/embed-viewer.js';
import { flowOf } from '../src/flow/state.js';

const base = { project: { mode: 'commercial' }, viewer: false, demo: false, shareId: null };
const LINK = '?mode=commercial&address=369+Shaw+Road+Shaw+QLD';
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const flowSrc = readFileSync(new URL('../src/flow/index.js', import.meta.url), 'utf8');

test('commercial address link: opens the guided flow over a kept design that has no flow record, and over a fresh start', () => {
  assert.equal(commercialAddressAsked(LINK), true);
  assert.equal(commercialAddressAsked('?mode=commercial'), false);
  assert.equal(commercialAddressAsked('?mode=residential&address=1+A+St'), false);
  assert.equal(shouldStart({ ...base, search: LINK, fromAutosave: true }), true);
  assert.equal(shouldStart({ ...base, search: LINK, fromAutosave: false }), true);
});

test('a design that finished the flow, or a flow part way through, behaves as before', () => {
  const done = { project: { mode: 'commercial', flow: { kind: 'commercial', step: 5 } } };
  assert.equal(shouldStart({ ...base, ...done, search: LINK, fromAutosave: true }), false, 'step 5 goes straight to the editor');
  const mid = { project: { mode: 'commercial', flow: { kind: 'commercial', step: 3 } } };
  assert.equal(shouldStart({ ...base, ...mid, search: LINK, fromAutosave: true }), true, 'a flow part way through resumes');
});

test('plain ?mode=commercial and the residential rules are unchanged', () => {
  assert.equal(shouldStart({ ...base, search: '?mode=commercial', fromAutosave: false }), true, 'fresh open starts the flow');
  assert.equal(shouldStart({ ...base, search: '?mode=commercial', fromAutosave: true }), false, 'a returning visitor is not interrupted');
  const resi = { project: {} };
  assert.equal(shouldStart({ ...base, ...resi, search: '?mode=residential&address=1+A+St', fromAutosave: true }), false);
  for (const search of [LINK + '&flow=0', LINK + '&template=x']) assert.equal(shouldStart({ ...base, search, fromAutosave: true }), false);
  assert.equal(shouldStart({ ...base, search: LINK, viewer: true, fromAutosave: true }), false);
  assert.equal(shouldStart({ ...base, search: LINK, shareId: 'a', fromAutosave: true }), false);
});

test('the full editor address link keeps the commercial tool', () => {
  const lot = { lotLabel: 'Lot 1', address: '369 Shaw Road Shaw QLD' };
  assert.equal(fullEditorUrl({ mode: 'commercial', site: { lot } }), '/plan-studio/app/?mode=commercial&address=369%20Shaw%20Road%20Shaw%20QLD');
  assert.equal(fullEditorUrl({ site: { lot } }), '/plan-studio/app/?address=369%20Shaw%20Road%20Shaw%20QLD');
  assert.equal(addressFromSearch(LINK), '369 Shaw Road Shaw QLD');
});

test('app wiring: commercial Open full editor opens the guided steps, the address rule for a different address is kept, a kept lot opens at step 2', () => {
  assert.match(app, /createCommercialCard\(\{[^\n]*onEdit: openGuided, onFullEditor: openGuided/);
  assert.match(app, /COMMERCIAL_VIEWER \? openGuided : openEditorDirect/);
  assert.match(app, /norm\(savedAddr\) !== norm\(askedAddress\)/);
  assert.match(flowSrc, /kept \? 2 : 1/);
});

test('no dashes in the new text', () => {
  assert.ok(!/[–—]/.test(flowSrc.match(/commercial address link goes[^\n]*/)[0]));
  assert.equal(flowOf({}), null);
});

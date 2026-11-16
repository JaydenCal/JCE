import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { LOTS, toMarkdown } from '../tools/dev-type-matrix.mjs';
import { TYPES, STRATA_ID } from '../src/commercial/catalogue/types/index.js';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';

const lot = (id) => LOTS.find((l) => l.id === id);

test('matrix lots build commercial projects with a lot boundary', () => {
  for (const l of LOTS.filter((x) => x.id !== 'shaw')) {
    const p = l.make();
    assert.equal(p.mode, 'commercial', l.id);
    assert.ok(p.site.lot.boundary.length >= 4, l.id);
  }
});

test('every new development type fits the large lot and reaches its doors', () => {
  const ids = ['garage-single', 'garage-double', 'garage-triple', 'gable-shed', 'skillion-shed', 'barn-shed', 'lean-to-carport', 'clear-span-shed', 'machinery-shed', 'duplex', 'townhouse-row', 'terrace-row', 'business-park', 'mixed-use'];
  for (const id of ids) {
    assert.ok(TYPES.find((t) => t.id === id), id);
    const s = createStore(lot('large').make(), { autosaveKey: null });
    const ch = chooseBuilding(s.project, id);
    assert.ok(ch && !ch.tooBig, `${id} fits`);
    applyBuildingChoice(s, ch);
    const sw = s.project.commercial.siteWorks;
    assert.deepEqual(sw?.summary?.unreachable || [], [], `${id} doors reached`);
  }
});

test('docks aprons and display yards are drivable: cold store and machinery dealership doors are reached', () => {
  for (const id of ['cold-store', 'machinery-dealership']) {
    const s = createStore(lot('large').make(), { autosaveKey: null });
    applyBuildingChoice(s, chooseBuilding(s.project, id));
    assert.deepEqual(s.project.commercial.siteWorks?.summary?.unreachable || [], [], id);
  }
});

test('a building that would only fit side-on to the street is not a fit', () => {
  const s = createStore(lot('narrow12').make(), { autosaveKey: null });
  const ch = chooseBuilding(s.project, 'amenities-block');
  assert.equal(ch.tooBig, true);
});

test('markdown grid lists every type and lot', () => {
  const types = TYPES.filter((t) => t.id === 'duplex' || t.id === 'garage-single');
  const lots = [lot('large'), lot('corner')];
  const results = types.flatMap((t) => lots.map((l) => ({ type: t.id, lot: l.id, status: 'PASS', preset: 'standard', setbacks: 'ok', coveragePct: 5, parking: '3 of 2', unreachable: [], outside: [], warnings: [], error: null })));
  const md = toMarkdown(results, types, lots);
  assert.match(md, /\| duplex \| pass \| pass \|/);
  assert.match(md, /4 combinations: \*\*4 pass\*\*/);
  assert.ok(TYPES.some((t) => t.id === STRATA_ID));
});

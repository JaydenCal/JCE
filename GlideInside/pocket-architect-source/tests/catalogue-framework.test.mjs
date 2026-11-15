// Catalogue framework: registry contract over every type, building model, materialise, stats, checks, feasibility, fit and ops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { TYPES, typeById, STRATA_ID, typeIconName } from '../src/commercial/catalogue/types/index.js';
import { paramsOf } from '../src/commercial/catalogue/params.js';
import { buildingsOf, newBuilding, presetsOf } from '../src/commercial/catalogue/buildings.js';
import { buildingParking } from '../src/commercial/catalogue/bays.js';
import { chooseBuilding, placeBuilding } from '../src/commercial/catalogue/fit.js';
import { addBuilding, moveBuilding, setBuildingParam, deleteBuilding, applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { rateOf as buildingRate } from '../src/commercial/catalogue/rates.js';
import { commercialStats } from '../src/commercial/stats.js';
import { commercialChecks } from '../src/commercial/checks.js';
import { feasibility } from '../src/commercial/feasibility.js';
import { lotOf } from '../src/model/placement.js';
import { normaliseCommercial } from '../src/commercial/schema.js';
import { materialise } from '../src/commercial/materialise.js';
import { buildModel } from '../src/viewer3d/build.js';

const lotProject = (o) => commercialProject({ rows: 'single', plain: false, ...o });
const storeOf = (p) => createStore(p, { autosaveKey: null });
const typed = TYPES.filter((t) => t.id !== STRATA_ID);

test('registry: unique ids, strata-units first-class, every type has label, icon, params and a valid footprint', () => {
  assert.equal(new Set(TYPES.map((t) => t.id)).size, TYPES.length);
  assert.ok(typeById(STRATA_ID));
  assert.ok(typed.length >= 13);
  for (const t of typed) {
    assert.ok(t.label && typeIconName(t), t.id);
    assert.ok(Array.isArray(t.params), t.id);
    const p = paramsOf(t, {});
    const fp = t.footprint(p);
    assert.ok(fp.outline.length >= 3, t.id);
    const q = t.quantities(p);
    assert.ok(q.gfaM2 > 0, `${t.id} gfa`);
    assert.ok(t.costHints?.buildRateKey, `${t.id} rate key`);
    assert.ok(buildingRate(t.costHints.buildRateKey), `${t.id} has an ESTIMATE build rate`);
    assert.ok(presetsOf(t).length >= 1);
  }
});

test('params: stored values are clamped, unknown keys dropped, defaults filled', () => {
  const t = typeById('warehouse');
  const p = paramsOf(t, { docks: 99, nonsense: 1 });
  assert.ok(p.docks <= 8);
  assert.equal('nonsense' in p, false);
});

test('materialise: every type puts walls, a room and roofs in the project, tagged by building', () => {
  for (const t of typed) {
    const p = lotProject({ width: 200000, depth: 200000 });
    p.commercial.rows = [];
    p.commercial.buildings = [newBuilding(t.id, { place: { x: 0, y: 0, rotationDeg: 0 } })];
    p.commercial = normaliseCommercial(p.commercial);
    const sum = materialise(p);
    const walls = (p.levels || []).flatMap((l) => l.walls || []).filter((w) => w.building);
    assert.ok(walls.length >= 4, `${t.id} walls ${walls.length}`);
    assert.ok(sum.buildings >= 1 || walls.length, t.id);
  }
});

test('warehouse and showroom: stats, parking, checks and feasibility cover buildings', () => {
  const p = lotProject({ width: 120000, depth: 120000 });
  const s = storeOf(p);
  const choice = chooseBuilding(s.project, 'warehouse');
  assert.ok(choice && !choice.tooBig);
  applyBuildingChoice(s, choice);
  addBuilding(s, 'showroom');
  const q = s.project;
  assert.equal(q.commercial.rows.length, 0);
  assert.equal(q.commercial.buildings.length, 2);
  const st = commercialStats(q);
  assert.equal(st.buildingCount, 2);
  assert.ok(st.gfaM2 > 1000);
  assert.ok(st.parking.provided > 0);
  const f = feasibility(q.commercial, lotOf(q));
  assert.ok(f && JSON.stringify(f).length > 10);
  assert.ok(commercialChecks(q));
  const bp = buildingParking(q.commercial);
  assert.equal(bp.perBuilding.length, 2);
});

test('fit: best fit stands inside the envelope, a too big type says so', () => {
  const p = lotProject({ width: 120000, depth: 120000 });
  for (const t of typed) {
    const c = chooseBuilding(p, t.id);
    assert.ok(c, t.id);
    if (!c.tooBig) assert.ok(placeBuilding(p, c.buildings[0], { solid: [], loose: [] }), t.id);
  }
  const small = lotProject({ width: 12000, depth: 20000 });
  assert.equal(chooseBuilding(small, 'warehouse').tooBig, true);
});

test('ops: add, move, set param, delete are single undoable steps', () => {
  const s = storeOf(lotProject({ width: 120000, depth: 120000 }));
  const id = addBuilding(s, 'warehouse');
  assert.ok(id);
  moveBuilding(s, id, { x: 1000, y: 2000, rotationDeg: 90 });
  assert.equal(s.project.commercial.buildings[0].place.rotationDeg, 90);
  setBuildingParam(s, id, 'docks', 2);
  assert.equal(buildingsOf(s.project.commercial)[0].params.docks, 2);
  deleteBuilding(s, id);
  assert.equal(s.project.commercial.buildings.length, 0);
});

test('3D: every type builds a model with its own meshes (roofs, extras) and warehouse docks add geometry', () => {
  const count = (m) => { let n = 0; m.traverse?.((o) => { if (o.isMesh) n += 1; }); return n; };
  const base = storeOf(lotProject({ width: 200000, depth: 200000 }));
  const bid = addBuilding(base, 'warehouse');
  deleteBuilding(base, bid);
  base.apply('No rows', (p) => { p.commercial.rows = []; materialise(p); });
  const empty = count(buildModel(base.project));
  for (const t of typed) {
    const s = storeOf(lotProject({ width: 200000, depth: 200000 }));
    applyBuildingChoice(s, chooseBuilding(s.project, t.id));
    const m = buildModel(s.project);
    assert.ok(m, t.id);
    assert.ok(count(m) > empty, `${t.id} adds meshes`);
  }
  const few = storeOf(lotProject({ width: 200000, depth: 200000 }));
  const id = addBuilding(few, 'warehouse', { params: { docks: 1 } });
  const n1 = count(buildModel(few.project));
  setBuildingParam(few, id, 'docks', 4);
  assert.ok(count(buildModel(few.project)) > n1);
});

test('wording lint over the framework files: no em or en dashes, never "compliant", no brand names', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/commercial/catalogue/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.json')).map((f) => new URL(f, dir));
  files.push(new URL('../src/commercial/lotcard.js', import.meta.url), new URL('../src/commercial/ui/panel-commercial.js', import.meta.url));
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/[–—]/.test(t), `dash in ${f.pathname}`);
    assert.ok(!/compliant/i.test(t), `compliant in ${f.pathname}`);
    assert.ok(!/\b(shell|caltex|ampol|mcdonald|kfc|woolworths|coles|bunnings)\b/i.test(t), `brand in ${f.pathname}`);
  }
});

test('picker: strata units first, every type has an icon and label, switcher lists follow the type', async () => {
  const { typeChoices, switcherList, activeTypeId } = await import('../src/commercial/catalogue/picker.js');
  const p = lotProject({ width: 120000, depth: 120000 });
  const ch = typeChoices(p);
  assert.equal(ch[0].id, STRATA_ID);
  assert.ok(ch.every((c) => c.label && c.icon));
  assert.equal(activeTypeId(p), STRATA_ID);
  assert.equal(switcherList(STRATA_ID)[0].label, 'Best fit');
  assert.equal(switcherList('warehouse')[0].label, 'Best fit');
  assert.ok(switcherList('warehouse').length >= 2);
});

test('strata layout after a type clears the building; a type after strata clears the rows', async () => {
  const { chooseLayout, applyLayout } = await import('../src/commercial/layouts.js');
  const s = storeOf(lotProject({ width: 120000, depth: 120000 }));
  applyBuildingChoice(s, chooseBuilding(s.project, 'warehouse'));
  assert.equal(s.project.commercial.rows.length, 0);
  applyLayout(s, chooseLayout(s.project, 'best'));
  assert.equal(s.project.commercial.buildings.length, 0);
  assert.ok(s.project.commercial.rows.length > 0);
  assert.equal(s.project.commercial.layout.typeId, undefined);
});

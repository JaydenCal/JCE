// The commercial AI assistant: context, tools (each one undoable), the best fit search, the three option comparison, the brief, the
// prompt and chips, the mock and the server wiring. No network: the mock stands in for the model and a fixture catalogue follows the
// catalogue interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { buildingParking } from '../src/commercial/catalogue/bays.js';
import { buildingsOf as catalogueBuildings } from '../src/commercial/catalogue/buildings.js';
import { frontRotation } from '../src/commercial/catalogue/fit.js';
import { materialise } from '../src/commercial/materialise.js';
import { commercialStats } from '../src/commercial/stats.js';
import { feasibility } from '../src/commercial/feasibility.js';
import { setCommercialTypes, commercialTypes, typeById } from '../src/premium/ai/commercial-catalogue.js';
import { COMMERCIAL_SCHEMAS, COMMERCIAL_OP_NAMES, commercialToolSchemas } from '../src/premium/ai/commercial-schemas.js';
import '../src/premium/ai/commercial-ops.js';
import { measure, buildingsOf, applyScheme, compareOptions, searchSchemes, pickBest } from '../src/premium/ai/commercial-core.js';
import { optionsTable } from '../src/premium/ai/commercial-ops.js';
import { buildCommercialContext } from '../src/premium/ai/commercial-context.js';
import { draftBrief, cleanWording } from '../src/premium/ai/commercial-brief.js';
import { buildTools, checkToolCall, isCommercialContext } from '../src/premium/ai/tools.js';
import { SYSTEM_PROMPT, COMMERCIAL_PROMPT, systemPromptFor } from '../src/premium/ai/prompt.js';
import { COMMERCIAL_PROMPTS, chipsFor, promptsFor } from '../src/premium/ai/suggestions.js';
import { mockReply, createMockApi } from '../src/premium/ai/mock.js';
import { describeOp } from '../src/premium/ai/summary.js';
import { buildRequest } from '../server/lib/anthropic.js';
import { OPS, toolSchemas } from '../src/model/ops.js';
import { layoutUnits } from '../src/commercial/layout.js';
import { estimateTokens } from '../src/premium/ai/context.js';

const fixture = (opts = {}) => commercialProject({ rows: 'single', plain: false, ...opts });
const storeOf = (p) => createStore(p, { autosaveKey: null });
const run = (store, op, args) => {
  const [r] = store.runBatch(`AI: ${op}`, [{ op, args }]);
  return r;
};
// The assistant works on the real catalogue (src/commercial/catalogue/types), so there is nothing to install for a test.
const withCatalogue = (fn) => async () => {
  setCommercialTypes(null);
  await fn();
};
const BRANDS = /colou?rbond|zincalume|lysaght|stramit|bluescope|boral|hanson|bobcat|caterpillar|toyota|hino/i;
const lint = (text, what = 'text') => {
  assert.ok(!/[–—]/.test(text), `${what}: no em or en dashes`);
  assert.ok(!/compliant/i.test(text), `${what}: never "compliant"`);
  assert.ok(!BRANDS.test(text), `${what}: no brand names`);
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(text), `${what}: dates are DD/MM/YYYY`);
};
const signature = (p) => JSON.stringify([p.commercial.rows, p.commercial.buildings || [], p.commercial.parking.extra || [], p.commercial.finishes || null, p.commercial.feasibility || null, p.commercial.brief || null, p.name]);

test('tool list: twelve commercial tools, the housing list is unchanged', () => {
  const tools = commercialToolSchemas();
  assert.deepEqual(tools.map((t) => t.name), ['set_layout', 'add_building', 'update_building', 'move_building', 'remove_building', 'set_unit_options', 'set_finishes', 'set_feasibility_inputs', 'run_best_fit', 'compare_options', 'explain_checks', 'draft_brief']);
  assert.deepEqual(buildTools(null, 'commercial').map((t) => t.name), tools.map((t) => t.name));
  assert.deepEqual(buildTools(null).map((t) => t.name), Object.keys(OPS), 'housing tools are exactly the registry, as before');
  assert.equal(toolSchemas({}, 'commercial').length, 12);
  for (const t of tools) { assert.ok(t.description.length > 30); lint(t.description, t.name); lint(JSON.stringify(t.input_schema), `${t.name} schema`); }
  assert.ok(!COMMERCIAL_OP_NAMES.includes('apply_option'), 'the table action is not offered to the model');
});

test('tool calls are checked: unknown names, wrong types and out of list ids are refused', () => {
  assert.equal(checkToolCall('set_layout', { layout: 'b2b-12' }).ok, true);
  assert.equal(checkToolCall('set_layout', { layout: 'nonsense' }).ok, false);
  assert.equal(checkToolCall('run_best_fit', { goal: 'max_units', constraints: { minUnitM2: 100, extra: 1 } }).ok, true);
  assert.equal(checkToolCall('run_best_fit', { goal: 'cheapest' }).ok, false);
  assert.equal(checkToolCall('add_building', { type: 'warehouse', params: [1, 2] }).ok, false, 'params must be an object');
  assert.equal(checkToolCall('set_finishes', { cladding: 'sand', doors: 'forest-green' }).ok, true);
  assert.equal(checkToolCall('set_finishes', { cladding: 'zinc' }).ok, false);
  assert.equal(checkToolCall('compare_options', {}).ok, true);
  assert.equal(checkToolCall('bogus', {}).ok, false);
});

test('set_layout: a named layout and best fit replace the rows in one undo step', () => {
  const s = storeOf(fixture());
  const before = signature(s.project);
  const r = run(s, 'set_layout', { layout: 'b2b-12' });
  assert.ok(r.ok, r.error);
  assert.equal(s.project.commercial.rows.length, 2);
  assert.equal(s.project.commercial.layout.id, 'b2b-12');
  assert.match(r.result.report, /unit/);
  assert.ok(s.project.levels[0].rooms.length > 0, 'the model is rebuilt');
  assert.equal(s.undoLabel(), 'AI: set_layout');
  s.undo();
  assert.equal(signature(s.project), before);
  const b = run(s, 'set_layout', { layout: 'best' });
  assert.ok(b.ok && s.project.commercial.layout.id === 'best');
  const st = measure(s.project);
  assert.ok(st.valid, st.issues.join('; '));
});

test('add, update, move and remove building: each is one undo step and the building stays inside the setbacks', withCatalogue(() => {
  const s = storeOf(fixture());
  const base = signature(s.project);
  const add = run(s, 'add_building', { type: 'vehicle-workshop' });
  assert.ok(add.ok, add.error);
  let b = buildingsOf(s.project);
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'vehicle-workshop');
  assert.equal(b[0].params.bays, 6, 'defaults fill the parameters');
  assert.deepEqual(Object.keys(b[0].place).sort(), ['rotationDeg', 'x', 'y']);
  const ms = measure(s.project);
  assert.ok(!ms.issues.some((i) => /outside|overlap/.test(i)), ms.issues.join('; '));
  assert.ok(!(s.project.commercial.parking.extra || []).some((e) => e.forBuilding), 'the catalogue draws the building bays, not assistant strips');
  assert.ok(buildingParking(s.project.commercial).totalBays > 0, 'the catalogue puts bays in front of the building');
  assert.ok(ms.byUse.workshop > 0 && ms.gfaM2 > ms.strataGfaM2);
  s.undo();
  assert.equal(signature(s.project), base);
  s.redo();
  const id = buildingsOf(s.project)[0].id;
  const up = run(s, 'update_building', { id, params: { bays: 4, hoistBays: 1 } });
  assert.ok(up.ok, up.error);
  assert.equal(buildingsOf(s.project)[0].params.bays, 4);
  assert.equal(buildingsOf(s.project)[0].params.bayDepthM, 9, 'other parameters stay');
  const bad = run(s, 'update_building', { id, params: { bays: 500 } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /between 3 and 12/);
  const wide = run(s, 'add_building', { type: 'warehouse', params: { spanMm: 60000, depthMm: 120000 } });
  assert.equal(wide.ok, false, 'a building that has no room is refused with a reason');
  assert.match(wide.error, /no room for Warehouse/);
  const bad2 = run(s, 'update_building', { id, params: { colour: 'red' } });
  assert.equal(bad2.ok, false);
  const place0 = { ...buildingsOf(s.project)[0].place };
  const mv = run(s, 'move_building', { id, place: { x: place0.x + 1000, rotationDeg: 90 } });
  assert.ok(mv.ok);
  const moved = buildingsOf(s.project)[0].place;
  assert.equal(moved.x, place0.x + 1000);
  assert.equal(moved.y, place0.y);
  assert.equal(moved.rotationDeg, 90);
  assert.equal(s.undoLabel(), 'AI: move_building');
  s.undo();
  assert.equal(buildingsOf(s.project)[0].place.rotationDeg, place0.rotationDeg);
  const rm = run(s, 'remove_building', { id });
  assert.ok(rm.ok);
  assert.equal(buildingsOf(s.project).length, 0);
  assert.ok(!(s.project.commercial.parking.extra || []).some((e) => e.forBuilding), 'its bays go with it');
  s.undo();
  assert.equal(buildingsOf(s.project).length, 1);
  const unknown = run(s, 'add_building', { type: 'castle' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Types available: .*warehouse/);
  const nope = run(s, 'move_building', { id: 'bld_nope', place: { x: 1 } });
  assert.equal(nope.ok, false);
}));

test('add_building: with no catalogue the assistant offers strata units only', () => {
  setCommercialTypes([]);
  const s = storeOf(fixture());
  const r = run(s, 'add_building', { type: 'warehouse' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not available in this version/);
  assert.equal(commercialTypes().length, 0);
  const ctx = buildCommercialContext(s.project).text;
  assert.match(ctx, /TYPES none/);
  assert.match(chipsFor(s.project, { hasCatalogue: false }).note, /strata units only/);
  setCommercialTypes(null);
});

test('add_building: auto placement keeps clear of units and bays, an explicit place is used as given', withCatalogue(() => {
  const s = storeOf(fixture());
  const first = run(s, 'add_building', { type: 'vehicle-workshop' });
  const second = run(s, 'add_building', { type: 'vehicle-workshop', params: { bays: 4 } });
  assert.ok(first.ok && second.ok);
  const [a, b] = buildingsOf(s.project);
  assert.notDeepEqual(a.place, b.place);
  const ms = measure(s.project);
  assert.ok(!ms.issues.some((i) => /overlap|outside/.test(i)), ms.issues.join('; '));
  const exact = run(s, 'add_building', { type: 'vehicle-workshop', place: { x: 40000, y: 20000, rotationDeg: 0 } });
  assert.ok(exact.ok);
  assert.deepEqual(buildingsOf(s.project).at(-1).place, { x: 40000, y: 20000, rotationDeg: 0 });
}));

test('set_unit_options: one row or all, validated, one undo step', () => {
  const s = storeOf(fixture({ rows: 'pair' }));
  const base = signature(s.project);
  const r = run(s, 'set_unit_options', { target: 'all', options: { widthMm: 5000, depthMm: 16000, doors: 2, mezzanine: false, office: false, windows: 'shopfront', doorSize: '4.0x4.5' } });
  assert.ok(r.ok, r.error);
  for (const row of s.project.commercial.rows) {
    assert.equal(row.unit.widthMm, 5000);
    assert.equal(row.unit.depthMm, 16000);
    assert.equal(row.unit.doors.count, 2);
    assert.equal(row.unit.doors.widthMm, 4000);
    assert.equal(row.unit.mezzanine.enabled, false);
    assert.equal(row.unit.office.enabled, false);
    assert.equal(row.unit.windows.front, 'shopfront');
  }
  assert.equal(measure(s.project).unitAreas[0], 80);
  s.undo();
  assert.equal(signature(s.project), base);
  const id = s.project.commercial.rows[0].id;
  assert.ok(run(s, 'set_unit_options', { target: id, options: { widthMm: 7000 } }).ok);
  assert.equal(s.project.commercial.rows[0].unit.widthMm, 7000);
  assert.notEqual(s.project.commercial.rows[1].unit.widthMm, 7000, 'only the named row changes');
  assert.equal(run(s, 'set_unit_options', { target: 'row_nope', options: { widthMm: 7000 } }).ok, false);
  assert.equal(run(s, 'set_unit_options', { target: 'all', options: { widthMm: 100 } }).ok, false);
  assert.equal(run(s, 'set_unit_options', { target: 'all', options: { windows: 'bay' } }).ok, false);
  assert.equal(run(s, 'set_unit_options', { target: 'all', options: { chimney: true } }).ok, false);
});

test('set_finishes: generic colours written to the project and the finishes the model reads', () => {
  const s = storeOf(fixture());
  const base = signature(s.project);
  const r = run(s, 'set_finishes', { cladding: 'sage', doors: 'forest-green' });
  assert.ok(r.ok, r.error);
  assert.deepEqual(s.project.commercial.finishes, { cladding: 'sage', door: 'forest-green' });
  assert.equal(s.project.finishes.rollerDoor.colour, '#3f5a48');
  assert.match(r.result.report, /Sage green cladding, Forest green doors/);
  s.undo();
  assert.equal(signature(s.project), base);
  assert.equal(run(s, 'set_finishes', {}).ok, false);
  assert.equal(run(s, 'set_finishes', { cladding: 'zinc' }).ok, false);
});

test('set_feasibility_inputs: overrides stored, null clears, bad values refused, indicative figures come back', () => {
  const s = storeOf(fixture());
  const base = signature(s.project);
  const r = run(s, 'set_feasibility_inputs', { inputs: { saleRate: 3200, landPrice: 1200000, yieldPct: 8 } });
  assert.ok(r.ok, r.error);
  assert.deepEqual(s.project.commercial.feasibility.v, { saleRate: 3200, landPrice: 1200000, yieldPct: 8 });
  assert.match(r.result.report, /Indicative/);
  assert.ok(run(s, 'set_feasibility_inputs', { inputs: { saleRate: null } }).ok);
  assert.equal(s.project.commercial.feasibility.v.saleRate, undefined);
  assert.equal(run(s, 'set_feasibility_inputs', { inputs: { yieldPct: 150 } }).ok, false);
  assert.equal(run(s, 'set_feasibility_inputs', { inputs: { saleRate: -5 } }).ok, false);
  assert.equal(run(s, 'set_feasibility_inputs', { inputs: { magic: 1 } }).ok, false);
  while (s.canUndo() && signature(s.project) !== base) s.undo(); // the refused calls leave empty steps, the app removes those
  assert.equal(signature(s.project), base);
});

test('run_best_fit: every goal gives a valid layout inside the setbacks, one undo step', () => {
  const results = {};
  for (const goal of ['max_gfa', 'max_units', 'max_margin', 'min_cost']) {
    const s = storeOf(fixture({ width: 90000, depth: 100000 }));
    const base = signature(s.project);
    const r = run(s, 'run_best_fit', { goal });
    assert.ok(r.ok, `${goal}: ${r.error}`);
    const m = measure(s.project);
    assert.ok(m.valid, `${goal}: ${m.issues.join('; ')}`);
    results[goal] = m;
    assert.equal(s.undoLabel(), 'AI: run_best_fit');
    s.undo();
    assert.equal(signature(s.project), base);
  }
  assert.ok(results.max_gfa.gfaM2 >= results.max_units.gfaM2, 'max_gfa has the most floor area');
  assert.ok(results.max_units.units >= results.max_gfa.units, 'max_units has the most units');
  assert.ok(results.min_cost.value ? results.min_cost.value.cost / results.min_cost.gfaM2 <= results.max_gfa.value.cost / results.max_gfa.gfaM2 + 1e-6 : true);
});

test('run_best_fit: unit size, bay and budget limits are respected', () => {
  const p = fixture();
  const s = storeOf(p);
  const r = run(s, 'run_best_fit', { goal: 'max_units', constraints: { minUnitM2: 250, maxUnitM2: 450 } });
  assert.ok(r.ok, r.error);
  assert.ok(measure(s.project).unitAreas.every((a) => a >= 250 && a <= 450), measure(s.project).unitAreas.join(','));
  const bays = run(storeOf(fixture()), 'run_best_fit', { goal: 'max_gfa', constraints: { parkingMin: 60 } });
  assert.ok(bays.ok);
  const s2 = storeOf(fixture());
  run(s2, 'run_best_fit', { goal: 'max_gfa', constraints: { parkingMin: 60 } });
  assert.ok(measure(s2.project).parking.provided >= 60);
  const s3 = storeOf(fixture());
  const open = measure(s3.project, { value: true });
  const tiny = run(s3, 'run_best_fit', { goal: 'max_gfa', constraints: { budgetAud: 1000 } });
  assert.equal(tiny.ok, false, 'a budget nothing can meet is refused');
  assert.match(tiny.error, /No layout meets/);
  assert.ok(open);
  const impossible = run(storeOf(fixture()), 'run_best_fit', { goal: 'max_units', constraints: { minUnitM2: 9000 } });
  assert.equal(impossible.ok, false);
});

test('run_best_fit with building types: must include and mix place the buildings inside the setbacks', withCatalogue(() => {
  const s = storeOf(fixture());
  const r = run(s, 'run_best_fit', { goal: 'max_gfa', constraints: { mustInclude: ['warehouse'], mix: [{ type: 'vehicle-workshop', count: 2 }] } });
  assert.ok(r.ok, r.error);
  const types = buildingsOf(s.project).map((b) => b.type).sort();
  assert.deepEqual(types, ['vehicle-workshop', 'vehicle-workshop', 'warehouse']);
  const m = measure(s.project);
  assert.ok(m.valid, m.issues.join('; '));
  assert.ok(m.byUse.warehouse > 0 && m.byUse.workshop > 0);
  s.undo();
  assert.equal(buildingsOf(s.project).length, 0);
  const none = run(s, 'run_best_fit', { goal: 'max_gfa', constraints: { mustInclude: ['castle'] } });
  assert.equal(none.ok, false);
}));

test('compare_options: three valid, different options on the 90 x 100 fixture, with a table the person can apply', () => {
  const s = storeOf(fixture({ width: 90000, depth: 100000 }));
  const base = signature(s.project);
  const r = run(s, 'compare_options', { n: 3 });
  assert.ok(r.ok, r.error);
  assert.equal(r.result.changed, false);
  assert.equal(r.result.options.length, 3);
  assert.equal(signature(s.project), base, 'comparing changes nothing');
  const sigs = new Set();
  for (const o of r.result.options) {
    sigs.add(JSON.stringify(o.scheme.rows.map((x) => [x.count, x.unit.widthMm, x.x, x.y])));
    const p2 = structuredClone(s.project);
    applyScheme(p2, o.scheme);
    const m = measure(p2);
    assert.ok(m.valid, `${o.id}: ${m.issues.join('; ')}`);
    assert.ok(layoutUnits(p2.commercial).length >= 1);
  }
  assert.equal(sigs.size, 3, 'the options differ');
  const t = r.result.table;
  assert.deepEqual(t.columns, ['Option', 'GFA', 'Units', 'Coverage', 'Parking', 'Indicative value', 'Indicative margin']);
  assert.equal(t.rows.length, 3);
  for (const row of t.rows) {
    assert.equal(row.cells.length, 7);
    assert.match(row.cells[1], /m²$/);
    assert.match(row.cells[3], /%$/);
    assert.match(row.cells[4], /^\d+ of \d+$/);
    assert.match(row.cells[5], /^\$/);
  }
  lint(JSON.stringify(t), 'table');
  // The person applies option B: one undo step.
  const opt = r.result.options[1];
  s.apply('AI: Applied option B', (p) => applyScheme(p, opt.scheme));
  assert.equal(s.project.commercial.rows.length, opt.scheme.rows.length);
  assert.ok(measure(s.project).valid);
  s.undo();
  assert.equal(signature(s.project), base);
  // Two options on request, and the hidden apply operation works from the last comparison.
  assert.equal(compareOptions(s.project, 2).length, 2);
  run(s, 'compare_options', { n: 3 });
  const ap = run(s, 'apply_option', { optionId: 'C' });
  assert.ok(ap.ok, ap.error);
  assert.equal(run(s, 'apply_option', { optionId: 'Z' }).ok, false);
});

test('compare_options with building types: the third option is a mix', withCatalogue(() => {
  const s = storeOf(fixture());
  const r = run(s, 'compare_options', { n: 3 });
  assert.ok(r.ok, r.error);
  assert.equal(r.result.options.length, 3);
  assert.ok(r.result.options.some((o) => (o.scheme.buildings || []).length > 0), 'one option carries a building');
  for (const o of r.result.options) {
    const p2 = structuredClone(s.project);
    applyScheme(p2, o.scheme);
    assert.ok(measure(p2).valid, o.label);
  }
  assert.ok(optionsTable(r.result.options.map((o) => ({ ...o, m: measure({ commercial: { ...s.project.commercial, rows: o.scheme.rows, buildings: o.scheme.buildings, parking: { ...s.project.commercial.parking, extra: o.scheme.extra } }, site: s.project.site }, { value: false }) }))).rows.length === 3);
}));

test('compare_options on other lot shapes still gives valid options', () => {
  for (const [w, d] of [[60000, 100000], [40000, 70000]]) {
    const s = storeOf(fixture({ width: w, depth: d }));
    const r = run(s, 'compare_options', { n: 3 });
    assert.ok(r.ok, `${w}x${d}: ${r.error}`);
    assert.ok(r.result.options.length >= 2);
    for (const o of r.result.options) { const p2 = structuredClone(s.project); applyScheme(p2, o.scheme); assert.ok(measure(p2).valid, `${w}x${d} ${o.label}`); }
  }
});

test('explain_checks: parking working and the checks in plain words, nothing changes', () => {
  const s = storeOf(fixture({ rows: 'pair' }));
  const base = signature(s.project);
  const r = run(s, 'explain_checks', {});
  assert.ok(r.ok, r.error);
  assert.match(r.result.report, /^Parking: \d+ bays indicated, \d+ shown\./);
  assert.match(r.result.report, /1 space per 75/);
  assert.match(r.result.report, /Accessible bays/);
  assert.match(r.result.report, /check with council/i);
  lint(r.result.report, 'explain');
  assert.equal(signature(s.project), base);
});

test('draft_brief: required sections, sources and status on controls, dates DD/MM/YYYY, wording lint, kept with the plan set', withCatalogue(() => {
  const s = storeOf(fixture());
  run(s, 'run_best_fit', { goal: 'max_gfa', constraints: { mix: [{ type: 'vehicle-workshop' }] } });
  const r = run(s, 'draft_brief', {});
  assert.ok(r.ok, r.error);
  const { text, sections } = r.result.brief;
  assert.deepEqual(sections.map((x) => x.title), ['Site', 'Controls, sources and status', 'Proposed mix', 'Yield', 'Indicative feasibility', 'Risks', 'Next steps']);
  for (const want of ['BYDA', 'survey', 'geotechnical', 'flood', 'traffic', 'engineer']) assert.match(text, new RegExp(want, 'i'), want);
  assert.match(text, /Front setback: 10 m\. Source: Default table|Front setback: 10 m\. Source: Indicative default table/i);
  assert.match(text, /Status: indicative default table, not a confirmed control/);
  assert.match(text, /VERIFIED_(PRIMARY|SECONDARY)/);
  assert.match(text, /Parking: 1 space per 75/);
  assert.match(text, /Indicative gross realisation \$[\d,]+/);
  assert.match(text, /Not an approval|not an approval/i);
  assert.match(text, /\b\d{2}\/\d{2}\/\d{4}\b/);
  assert.match(text, /Vehicle repair/);
  lint(text, 'brief');
  assert.equal(s.project.commercial.brief.text, text, 'stored with the project for the plan set');
  s.undo();
  assert.equal(s.project.commercial.brief, undefined);
  assert.ok(draftBrief(s.project).text.length > 600);
}));

test('draft_brief: a lot with no loaded setbacks says so and states none', () => {
  const p = fixture();
  p.site.lot.setbacks = null;
  p.site.lot.envelope = null;
  const b = draftBrief(p);
  assert.match(b.text, /Setbacks: not loaded for this lot, so none are stated/);
  lint(b.text, 'brief');
});

test('cleanWording removes dashes and the forbidden word', () => {
  assert.equal(cleanWording('a — b and c–d'), 'a, b and c-d');
  assert.ok(!/compliant/i.test(cleanWording('fully compliant')));
});

test('context: lot, controls with sources, rows, buildings, stats, checks, feasibility and the catalogue, under a sensible budget', withCatalogue(() => {
  const s = storeOf(fixture({ rows: 'pair' }));
  assert.ok(run(s, 'add_building', { type: 'vehicle-workshop' }).ok);
  const { text, tokens, trimmed } = buildCommercialContext(s.project);
  assert.match(text.split('\n')[0], /^PROJECT ".*" type=commercial mode=commercial units=mm/);
  assert.ok(isCommercialContext(text));
  assert.match(text, /\nLOT NSW "27 Conadilly Street Gunnedah NSW" .*zone="IN1 General Industrial" class=industrial area=9000m2 frontage=90m depth=100m/);
  assert.match(text, /\nSETBACKS front=10m\[default table\] side=3m\[default table\] rear=3m\[default table\] .*status=indicative_check_with_council/);
  assert.match(text, /\nROW row_\S+ .* unit=6x15m /);
  assert.match(text, /\nBUILDING bld_\S+ type=vehicle-workshop params=\{.*"bays":6/);
  assert.match(text, /\nSTATS units=16 gfa=\d+m2 by_use=.*workshop:\d+m2/);
  assert.match(text, /\nPARKING required=\d+ provided=\d+ accessible_required=\d+ accessible_provided=\d+ rate=1_per_75m2/);
  assert.match(text, /\nCHECK info \[VERIFIED_/);
  assert.match(text, /\nFEASIBILITY area="Tamworth".*\[PORTAL\].*\[ESTIMATE\]/);
  assert.match(text, /\nFEASIBILITY_OUT realisation=\$[\d,]+ cost=\$[\d,]+ margin=/);
  assert.match(text, /\nTYPE warehouse "Warehouse with loading docks" industrial zones=E4\/E5\/IN1\/IN2 params: spanMm\(15000\.\.60000 mm\)=30000/);
  assert.match(text, /\nTYPE vehicle-workshop /);
  assert.ok(!/\nROOM |\nWALL /.test(text), 'the generated walls and rooms are not sent');
  assert.ok(tokens < 4000, `context ${tokens} tokens`);
  assert.equal(trimmed, false);
  lint(text, 'context');
  console.log(`commercial context: ${tokens} tokens (${text.length} characters), 2 rows of 8 units, 1 building, 2 catalogue types`);
}));

test('context: a busy design stays under the budget and trims the checks before the lot lines', withCatalogue(() => {
  const s = storeOf(fixture({ rows: 'pair' }));
  for (let i = 0; i < 4; i++) run(s, 'add_building', { type: 'vehicle-workshop', params: { bays: 3 + (i % 2) } });
  const full = buildCommercialContext(s.project);
  assert.ok(full.tokens < 4500, `${full.tokens}`);
  const tight = buildCommercialContext(s.project, { maxTokens: 700 });
  assert.ok(tight.tokens <= 700);
  assert.match(tight.text, /^PROJECT [^\n]*\nLOT /, 'the lot comes first so truncation keeps it');
  assert.match(tight.text, /SETBACKS /);
  console.log(`busy commercial context: ${full.tokens} tokens with 4 buildings and 16 units`);
}));

test('context: an existing lot with a corner lot, no lot or no frontage is handled', () => {
  const p = fixture();
  p.site.lot = null;
  const t = buildCommercialContext(p).text;
  assert.match(t, /LOT none/);
  assert.match(t, /FEASIBILITY /);
});

test('prompt: commercial section covers the rules asked for and passes the wording lint', () => {
  assert.equal(systemPromptFor('commercial'), COMMERCIAL_PROMPT);
  assert.equal(systemPromptFor(null), SYSTEM_PROMPT);
  for (const needle of ['development feasibility and site planning assistant', 'regional New South Wales', 'source and status', 'VERIFIED_PRIMARY', 'Never claim that anything is approved', 'check with council', 'DD/MM/YYYY', 'em dashes or en dashes', 'ask one short question', 'Never ask more than one question', 'Do not name builders', 'call the tools']) {
    assert.ok(COMMERCIAL_PROMPT.includes(needle), needle);
  }
  assert.ok(!/compliant/i.test(COMMERCIAL_PROMPT.replace('Do not use the word "compliant".', '')));
  assert.ok(!/[–—]/.test(COMMERCIAL_PROMPT.replace(/em dashes or en dashes/, '')));
  assert.ok(!BRANDS.test(COMMERCIAL_PROMPT));
});

test('chips: the six commercial chips in commercial mode, the usual ones otherwise', () => {
  assert.deepEqual(COMMERCIAL_PROMPTS, ['Fit the most units', 'Mix workshops and a warehouse', 'Best layout for my budget', 'Explain the parking', 'Compare three options', 'Write a development brief']);
  const p = fixture();
  assert.deepEqual(chipsFor(p, { hasCatalogue: true }).prompts, COMMERCIAL_PROMPTS);
  assert.equal(chipsFor(p, { hasCatalogue: true }).note, null);
  const house = { site: {}, mode: null };
  assert.deepEqual(chipsFor(house).prompts, promptsFor(house).prompts);
  for (const c of COMMERCIAL_PROMPTS) lint(c, 'chip');
});

test('mock: each chip gets a reply whose operations the tool check accepts and that run on the fixture', withCatalogue(() => {
  const s = storeOf(fixture());
  for (const chip of COMMERCIAL_PROMPTS) {
    const reply = mockReply(chip, s.project);
    lint(reply.reply, `mock reply to "${chip}"`);
    for (const o of reply.ops) {
      const c = checkToolCall(o.op, o.args);
      assert.ok(c.ok, `${chip}: ${o.op}: ${c.error}`);
      assert.ok(describeOp(o.op, o.args, s.project).length > 5);
    }
  }
  assert.equal(mockReply('Best layout for my budget', s.project).ops.length, 0, 'it asks one question first');
  assert.match(mockReply('Best layout for my budget', s.project).reply, /budget/);
  const withBudget = mockReply('my budget is $4.5m', s.project);
  assert.equal(withBudget.ops[0].args.constraints.budgetAud, 4500000);
  assert.equal(mockReply('Mix workshops and a warehouse', s.project).ops[0].args.constraints.mix.length, 2);
  assert.equal(mockReply('Compare three options', s.project).ops[0].op, 'compare_options');
}));

test('mock: without the catalogue a mix request is answered honestly with no change', () => {
  setCommercialTypes([]);
  try {
  const r = mockReply('Mix workshops and a warehouse', fixture());
  assert.equal(r.ops.length, 0);
  assert.match(r.reply, /not available yet/);
  } finally { setCommercialTypes(null); }
});

test('mock api: credits and gating are the existing model, a commercial reply costs credits and a question is free', async () => {
  const p = fixture();
  const api = createMockApi({ getProject: () => p, session: { kind: 'public' }, delayMs: 0, cost: 2 });
  const free = await api.edit('t', { message: 'Best layout for my budget' });
  assert.equal(free.credits.charged, 0);
  assert.equal(free.ops.length, 0);
  const paid = await api.edit('t', { message: 'Compare three options' });
  assert.equal(paid.credits.charged, 2);
  assert.deepEqual(paid.ops.map((o) => o.op), ['compare_options']);
  assert.equal(api.state.used, 2);
  const noMoney = createMockApi({ getProject: () => p, session: { kind: 'public', credits: { total: 1, used: 1 } }, delayMs: 0 });
  await assert.rejects(() => noMoney.edit('t', { message: 'Fit the most units' }), (e) => e.code === 'CREDITS_EXHAUSTED');
});

test('server: a commercial context gets the commercial prompt and tools, housing is unchanged', () => {
  const p = fixture();
  const ctx = buildCommercialContext(p).text;
  const config = { anthropicModel: 'm', maxOutputTokens: 1500 };
  const body = buildRequest({ config, tools: buildTools(null, 'commercial'), history: [], context: ctx, message: 'Compare three options' });
  assert.equal(body.system[0].text, COMMERCIAL_PROMPT);
  assert.deepEqual(body.tools.map((t) => t.name).slice(0, 3), ['set_layout', 'add_building', 'update_building']);
  assert.equal(body.max_tokens, 1500);
  assert.match(body.messages.at(-1).content, /Request: Compare three options$/);
  const house = buildRequest({ config, tools: buildTools(null), history: [], context: 'PROJECT "x" type=house units=mm', message: 'hi' });
  assert.equal(house.system[0].text, SYSTEM_PROMPT);
  assert.equal(isCommercialContext('PROJECT "x" type=house units=mm'), false);
  assert.equal(isCommercialContext('PROJECT "Mode=commercial" type=house'), false);
});

test('a project that is not in commercial mode refuses the tools without changing anything', () => {
  const p = fixture();
  p.mode = null;
  const s = storeOf(p);
  const r = run(s, 'set_layout', { layout: 'best' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not in commercial mode/);
});

test('pickBest and searchSchemes: goals order the same pool differently', () => {
  const p = fixture();
  const pool = searchSchemes(p, {});
  assert.ok(pool.length >= 10);
  assert.ok(pool.every((x) => x.m.valid));
  const g = pickBest(pool, 'max_gfa');
  const u = pickBest(pool, 'max_units');
  assert.ok(g.m.gfaM2 >= u.m.gfaM2 && u.m.units >= g.m.units);
  assert.ok(pickBest(pool, 'max_margin'));
  assert.ok(pickBest(pool, 'min_cost'));
});

test('typeById is a guarded lookup and a type that throws does not break measuring', () => {
  setCommercialTypes([{ id: 'bad', label: 'Bad', category: 'storage', params: [], footprint() { throw new Error('boom'); } }]);
  assert.ok(typeById('bad'));
  const s = storeOf(fixture());
  const r = run(s, 'add_building', { type: 'bad' });
  assert.equal(r.ok, false);
  const p = fixture();
  p.commercial.buildings = [{ id: 'bld_x', type: 'bad', params: {}, place: { x: 0, y: 0, rotationDeg: 0 } }];
  const m = measure(p);
  assert.ok(m.issues.some((i) => /not in the catalogue/.test(i)));
  setCommercialTypes(null);
});

test('brief site lines: state, plan and council are not duplicated and read in title case', async () => {
  const { addressLine, lotPlanLine, councilName } = await import('../src/premium/ai/commercial-brief.js');
  assert.equal(addressLine({ address: '12 Industrial Drive, Westdale NSW', state: 'NSW' }), '12 Industrial Drive, Westdale NSW');
  assert.equal(addressLine({ address: '12 Industrial Drive, Westdale NSW 2340', state: 'NSW' }), '12 Industrial Drive, Westdale NSW 2340');
  assert.equal(addressLine({ address: '12 Industrial Drive, Westdale, New South Wales', state: 'NSW' }), '12 Industrial Drive, Westdale, New South Wales');
  assert.equal(addressLine({ address: '12 Industrial Drive, Westdale', state: 'NSW' }), '12 Industrial Drive, Westdale NSW');
  assert.equal(addressLine({}), 'not recorded');
  assert.equal(lotPlanLine({ lotLabel: 'Lot 12 DP 1198432', planLabel: 'DP 1198432' }), 'Lot 12 DP 1198432');
  assert.equal(lotPlanLine({ lotLabel: 'Lot 12', planLabel: 'DP 1198432' }), 'Lot 12 DP 1198432');
  assert.equal(lotPlanLine({ planLabel: 'DP 1198432' }), 'DP 1198432');
  assert.equal(councilName('TAMWORTH REGIONAL'), 'Tamworth Regional Council');
  assert.equal(councilName('Tamworth Regional Council'), 'Tamworth Regional Council');
  assert.equal(councilName("PORT STEPHENS"), 'Port Stephens Council');
  assert.equal(councilName(''), 'not recorded');
  const p = fixture();
  p.site.lot = { ...p.site.lot, address: '12 Industrial Drive, Westdale NSW', state: 'NSW', lotLabel: 'Lot 12 DP 1198432', planLabel: 'DP 1198432', lga: 'TAMWORTH REGIONAL' };
  const t = draftBrief(p).text;
  assert.match(t, /Address: 12 Industrial Drive, Westdale NSW\n/);
  assert.match(t, /Lot and plan: Lot 12 DP 1198432\n/);
  assert.match(t, /Council area: Tamworth Regional Council\n/);
  assert.doesNotMatch(t, /NSW, NSW|DP 1198432 DP 1198432/);
  assert.match(t.split('\n')[0], /^Development brief/);
});

test('zone offer does not show when the page opens in commercial mode', async () => {
  const { offerCommercial } = await import('../src/commercial/mode.js');
  const s = storeOf(fixture());
  s.project.mode = 'residential';
  let shown = 0;
  globalThis.location = { search: '?mode=commercial' };
  try { assert.equal(offerCommercial(s, { toast: () => { shown++; return {}; }, available: true }), null); } finally { delete globalThis.location; }
  assert.equal(shown, 0);
});

test('catalogue alignment: the assistant adds the catalogue building record, facing the street, drawn by the catalogue', () => {
  const s = storeOf(fixture());
  const r = run(s, 'add_building', { type: 'warehouse', params: { spanMm: 20000, depthMm: 25000 } });
  assert.ok(r.ok, r.error);
  const rec = buildingsOf(s.project)[0];
  for (const k of ['id', 'type', 'params', 'place']) assert.ok(k in rec, `the record has ${k}, as the catalogue shape does`);
  assert.ok(catalogueBuildings(s.project.commercial).length === 1, 'the catalogue resolves the building');
  // Front orientation: the catalogue front (local y = 0, street toward -y) points at the street edge, so the building is turned to frontRotation or a quarter turn.
  const lot = s.project.site.lot;
  const rotations = [0, 90, 180, 270].map((k) => Math.round((((frontRotation(lot) + k) % 360) + 360) % 360));
  assert.ok(rotations.includes(Math.round(((rec.place.rotationDeg % 360) + 360) % 360)), `rotation ${rec.place.rotationDeg}`);
  const placed = catalogueBuildings(s.project.commercial)[0];
  // On a bare lot the first choice is the street facing one.
  const bare = storeOf(fixture());
  bare.project.commercial.rows = [];
  assert.ok(run(bare, 'add_building', { type: 'warehouse' }).ok);
  assert.equal(Math.round(((buildingsOf(bare.project)[0].place.rotationDeg % 360) + 360) % 360), Math.round(((frontRotation(lot) % 360) + 360) % 360), 'faces the street');
  // Drawn by the catalogue: materialise holds walls and a PROPOSED room for it, stats count it, the parking uses the {use, per, m2} rate shape.
  const sum = materialise(s.project);
  assert.equal(sum.buildings, 1, 'materialise reports the building');
  assert.ok(s.project.levels.flatMap((l) => l.rooms).some((x) => /PROPOSED WAREHOUSE/.test(x.name)), 'a PROPOSED WAREHOUSE room exists');
  const st = commercialStats(s.project);
  assert.equal(st.buildingCount, 1);
  const rows = placed.site.parking.ratePerM2;
  assert.ok(rows.every((x) => 'use' in x && 'per' in x && 'm2' in x), 'rate rows are {use, per, m2}');
  const m = measure(s.project);
  assert.equal(m.parking.required, st.parking.required, 'the assistant measure reads the catalogue parking, no second count');
  assert.equal(m.parking.provided, st.parking.provided);
  assert.equal(m.gfaM2, st.gfaM2, 'building floor area is counted once');
  assert.equal(m.groundM2, st.footprintM2);
});

test('catalogue alignment: the options and the feasibility price the buildings once', () => {
  const s = storeOf(fixture());
  const before = measure(s.project, { value: true }).value;
  run(s, 'add_building', { type: 'warehouse', params: { spanMm: 20000, depthMm: 25000 } });
  const after = measure(s.project, { value: true }).value;
  const f = feasibility(s.project.commercial, s.project.site.lot);
  assert.equal(Math.round(after.cost), Math.round(f.mid.cost), 'the cost is the catalogue feasibility cost, with no second building charge');
  assert.ok(after.cost > before.cost);
});

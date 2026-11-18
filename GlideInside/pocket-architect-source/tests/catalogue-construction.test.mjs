// Construction systems: tilt-up panel layout (count, joints, openings, minimum width), 3D build, rates and feasibility, the C104 sheet, the AI keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createStore } from '../src/model/store.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice, setBuildingParam } from '../src/commercial/catalogue/ops.js';
import { buildModel } from '../src/viewer3d/build.js';
import { layoutWall, layoutStats, panelEnds, panelWallLayout, JOINT_MM, MIN_PANEL_MM } from '../src/commercial/catalogue/panels.js';
import { CONSTRUCTION_KEYS, CONSTRUCTION_DEFAULTS, constructionSpec, SYSTEMS, paramApplies, CONSTRUCTION_PARAMS } from '../src/commercial/catalogue/construction.js';
import { TYPES } from '../src/commercial/catalogue/types/index.js';
import { wallCost, rateOf, BUILD_RATES } from '../src/commercial/catalogue/rates.js';
import { feasibility, costRows } from '../src/commercial/feasibility.js';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { COMMERCIAL_SCHEMAS as TOOLS } from '../src/premium/ai/commercial-schemas.js';

const widths = (lay) => lay.panels.map((p) => p.x1 - p.x0);

test('layout: a plain wall is cut into panels no wider than the maximum, joints between them', () => {
  const lay = layoutWall({ length: 30000, top: 7000, openings: [], maxWidth: 4000 });
  assert.equal(lay.panels.length, Math.ceil(30000 / 4000));
  assert.equal(lay.joints.length, lay.panels.length - 1);
  for (const w of widths(lay)) assert.ok(w <= 4000 + 1, `panel ${w} within maximum`);
  for (const p of lay.panels) assert.ok(p.x1 - p.x0 >= MIN_PANEL_MM, 'minimum panel width');
  assert.equal(JOINT_MM, 20);
});

test('layout: a smaller maximum gives more panels', () => {
  const a = layoutStats(layoutWall({ length: 24000, top: 6000, maxWidth: 4500 }));
  const b = layoutStats(layoutWall({ length: 24000, top: 6000, maxWidth: 3000 }));
  assert.ok(b.panels > a.panels);
});

test('layout: openings are cut inside the panels, never across a joint', () => {
  const openings = [
    { id: 'w1', kind: 'window', offset: 5000, width: 1800, height: 1200, sill: 900 },
    { id: 'd1', kind: 'door', offset: 14000, width: 4800, height: 4200, sill: 0 },
    { id: 'w2', kind: 'window', offset: 22000, width: 2400, height: 1500, sill: 900 },
  ];
  const lay = layoutWall({ length: 28000, top: 7500, openings, maxWidth: 4000 });
  assert.deepEqual(lay.issues, []);
  for (const o of openings) {
    const x0 = o.offset - o.width / 2;
    const x1 = o.offset + o.width / 2;
    // no joint passes through the opening at the heights it occupies, unless it is a lintel or spandrel joint above or below it
    for (const j of lay.joints) {
      const cuts = lay.panels.some((p) => p.rects.some((r) => (r.x1 === j || r.x0 === j) && r.y0 < o.sill + o.height && r.y1 > o.sill && j > x0 + 1 && j < x1 - 1));
      assert.ok(!cuts, `joint ${j} stays out of opening ${o.id}`);
    }
    // the opening is not covered by panel rectangles
    for (const p of lay.panels) for (const r of p.rects) {
      const overlap = r.x0 < x1 - 1 && r.x1 > x0 + 1 && r.y0 < o.sill + o.height - 1 && r.y1 > o.sill + 1;
      assert.ok(!overlap, `panel ${p.id} does not overlap opening ${o.id}`);
    }
  }
  assert.ok(lay.panels.some((p) => p.kind === 'lintel'), 'a lintel panel over the wide door');
});

test('layout: no sliver panels, reveals and feature band appear when asked', () => {
  const lay = layoutWall({ length: 17300, top: 8000, openings: [{ id: 'w', kind: 'window', offset: 8000, width: 1500, height: 1200, sill: 1000 }], maxWidth: 4200, reveals: 'two', featureBand: true });
  for (const w of widths(lay)) assert.ok(w >= MIN_PANEL_MM - 1);
  assert.equal(lay.reveals.length, 2);
  assert.ok(lay.band);
});

test('layout: signage band only on the street frontage', () => {
  const on = layoutWall({ length: 20000, top: 7000, maxWidth: 4000, frontage: true, signage: true });
  const off = layoutWall({ length: 20000, top: 7000, maxWidth: 4000, frontage: false, signage: true });
  assert.ok(on.signage);
  assert.equal(off.signage, null);
});

test('spec: defaults, normalising and which settings apply', () => {
  assert.equal(constructionSpec({}).system, 'metal_clad');
  assert.equal(constructionSpec({ construction: 'nonsense' }).system, 'metal_clad');
  assert.equal(constructionSpec({ construction: 'tilt_up', panelMaxWidthMm: 99999 }).maxWidthMm, 6000);
  assert.deepEqual(SYSTEMS.map((s) => s.id), ['metal_clad', 'tilt_up', 'precast', 'tilt_up_metal_upper', 'blockwork']);
  const dado = CONSTRUCTION_PARAMS.find((p) => p.key === 'dadoHeightMm');
  assert.equal(paramApplies(dado, { construction: 'tilt_up' }), false);
  assert.equal(paramApplies(dado, { construction: 'tilt_up_metal_upper' }), true);
});

test('every catalogue type carries the construction parameters and defaults to metal clad', () => {
  assert.ok(TYPES.length > 5);
  for (const t of TYPES) {
    for (const k of CONSTRUCTION_KEYS) assert.ok(t.params.some((p) => p.key === k), `${t.id} has ${k}`);
    const d = t.defaults({});
    assert.equal(d.construction, 'metal_clad', t.id);
    assert.equal(d.panelFinish, CONSTRUCTION_DEFAULTS.panelFinish);
  }
});

function warehouseStore(sys, extra = {}) {
  const s = createStore(commercialProject({ plain: false, width: 120000, depth: 130000 }), { autosaveKey: null });
  applyBuildingChoice(s, chooseBuilding(s.project, 'warehouse'));
  const id = s.project.commercial.buildings[0].id;
  setBuildingParam(s, id, 'construction', sys);
  for (const [k, v] of Object.entries(extra)) setBuildingParam(s, id, k, v);
  return { s, id };
}

test('tilt-up warehouse: every exterior wall has panels, the layout has no issues and no sliver', () => {
  const { s } = warehouseStore('tilt_up');
  const walls = s.project.levels.flatMap((l) => l.walls).filter((w) => w.panel);
  assert.ok(walls.length >= 4);
  const ends = panelEnds(walls);
  let panels = 0;
  for (const w of walls) {
    const lvl = s.project.levels.find((l) => l.walls.includes(w));
    const ops = lvl.openings.filter((o) => o.wallId === w.id);
    const { layout } = panelWallLayout(w, ops, { ends: ends.get(w.id), wallHeightMm: w.height || lvl.height });
    assert.deepEqual(layout.issues, [], `wall ${w.id}`);
    for (const x of widths(layout)) assert.ok(x >= MIN_PANEL_MM - 1);
    for (const x of widths(layout)) assert.ok(x <= w.panel.maxWidthMm * 1.6, 'panel width sensible');
    panels += layoutStats(layout).panels;
  }
  assert.ok(panels >= 20, `panel count ${panels}`);
});

test('3D: panel walls build real joint geometry and few meshes; metal clad has none', () => {
  const count = (m) => { let meshes = 0; let tris = 0; m.traverse((o) => { if (o.isMesh) { meshes += 1; tris += o.geometry.attributes.position.count / 3; } }); return { meshes, tris }; };
  const metal = count(buildModel(warehouseStore('metal_clad').s.project, {}));
  for (const sys of ['tilt_up', 'precast', 'tilt_up_metal_upper', 'blockwork']) {
    const m = buildModel(warehouseStore(sys).s.project, {});
    const c = count(m);
    assert.ok(c.tris > 0 && c.meshes < metal.meshes + 400, `${sys} meshes ${c.meshes}`);
  }
  const tilt = count(buildModel(warehouseStore('tilt_up').s.project, {}));
  assert.ok(tilt.tris > metal.tris, 'joints add geometry');
});

test('rates: wall keys have low, value, high, ESTIMATE and a source', () => {
  const keys = Object.keys(BUILD_RATES).filter((k) => k.startsWith('wall-'));
  assert.ok(keys.length >= 6);
  for (const k of keys) {
    const r = BUILD_RATES[k];
    assert.equal(r.status, 'ESTIMATE', k);
    assert.ok(r.low <= r.value && r.value <= r.high, `${k} order`);
    assert.ok(typeof r.source === 'string' && r.source.length > 20, `${k} source`);
    assert.ok(!/[–—]/.test(JSON.stringify(r)), `${k} no dashes`);
  }
  assert.ok(rateOf('wall-tilt_up').value < rateOf('wall-precast').value);
});

test('rates: wallCost scales with area, finish adds, an override replaces the system line', () => {
  const spec = constructionSpec({ construction: 'tilt_up', panelFinish: 'aggregate' });
  const basis = { system: 'tilt_up', panelWallM2: 1000, wallM2: 900 };
  const a = wallCost(basis, spec, 'mid');
  const b = wallCost({ ...basis, panelWallM2: 2000 }, spec, 'mid');
  assert.ok(Math.abs(b.total - 2 * a.total) < 1e-6);
  assert.ok(wallCost(basis, spec, 'low').total < a.total && a.total < wallCost(basis, spec, 'high').total);
  const o = wallCost(basis, spec, 'mid', 300);
  assert.equal(o.lines[0].amount, 300000);
  assert.equal(wallCost({ system: 'metal_clad', panelWallM2: 0 }, spec, 'mid').total, 0);
});

test('feasibility: switching to tilt-up raises the build cost, the lines show, and the override works', () => {
  const base = warehouseStore('metal_clad').s.project;
  const tilt = warehouseStore('tilt_up', { panelFinish: 'honed' }).s.project;
  const fb = feasibility(base.commercial, base.site.lot);
  const ft = feasibility(tilt.commercial, tilt.site.lot);
  assert.ok(ft.mid.build > fb.mid.build);
  assert.ok(ft.high.cost < ft.low.cost, 'high case uses the low cost end');
  const lines = costRows(ft).map((r) => r[0]).join('\n');
  assert.match(lines, /Tilt-up concrete panels/);
  assert.match(lines, /ESTIMATE/);
  const own = feasibility(tilt.commercial, tilt.site.lot, { overrides: { wallRate: 1 } });
  assert.ok(own.mid.build < ft.mid.build);
});

test('feasibility: strata rows in tilt-up cost more than metal clad rows', () => {
  const a = commercialProject({ plain: false });
  const b = commercialProject({ plain: false });
  for (const r of b.commercial.rows) Object.assign(r.unit, { construction: 'tilt_up', panelFinish: 'painted' });
  const fa = feasibility(a.commercial, a.site.lot);
  const fb = feasibility(b.commercial, b.site.lot);
  assert.ok(fb.mid.build > fa.mid.build);
  assert.ok(fb.rowWalls.length > 0);
});

test('plan set: the C200 elevations sheet is present and labelled Concept only', async () => {
  const p = commercialProject({ plain: false });
  for (const r of p.commercial.rows) Object.assign(r.unit, { construction: 'tilt_up' });
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...rest) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...rest)); } }
  const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  assert.ok(r.sheets.some((x) => x.no.endsWith('-C200')), 'the elevations are C200');
  assert.ok(r.sheets.some((x) => x.no.endsWith('-C300')), 'the sections are C300');
  const all = texts.join('\n');
  assert.match(all, /ELEVATION/);
  assert.match(all, /Concept only/);
  assert.match(all, /RL/);
  assert.ok(!/[–—]/.test(all));
  const codes = planSetSheets({ project: p, lot: null, kind: 'commercial' }).map((x) => x.code);
  assert.deepEqual(codes.filter((c) => !/^C[23]/.test(c)), ['C000', 'C100', 'C101', 'C110', 'C900', 'C910']);
});

test('AI: set_unit_options accepts the construction keys', () => {
  const props = TOOLS.set_unit_options.params.options.properties;
  for (const k of CONSTRUCTION_KEYS) assert.ok(props[k], k);
  assert.deepEqual(props.construction.enum, SYSTEMS.map((s) => s.id));
});

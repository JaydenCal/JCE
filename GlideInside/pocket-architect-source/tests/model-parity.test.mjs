// Parity of the 3D model across residential and commercial, and across the viewer and the offline HTML export (18/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { buildModel } from '../src/viewer3d/build.js';
import { kerbDropScale } from '../src/viewer3d/site-extras.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildExport } from '../src/premium/exporters/index.js';

test('kerbDropScale takes several crossover spans, the lowest scale wins', () => {
  assert.equal(kerbDropScale(5, [[4, 6], [20, 24]]), 0);
  assert.equal(kerbDropScale(22, [[4, 6], [20, 24]]), 0);
  assert.equal(kerbDropScale(13, [[4, 6], [20, 24]]), 1);
  assert.ok(kerbDropScale(6.3, [[4, 6], [20, 24]], 0.6) < 1);
});

test('commercial: the street kerb is built and the pavement model has crossover (layback) kerbs to drop it across', () => {
  const p = commercialProject({ plain: false });
  const m = pavementModel(p.commercial, p.site.lot);
  assert.ok(m.kerbs.some((k) => k.crossover), 'a crossover kerb exists');
  const root = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' });
  assert.ok(root.getObjectByName('road'), 'the road with its kerbs is built');
});

test('model export bakes the lawn inside the lots and the paddock outside into vertex colours', () => {
  const p = commercialProject({ plain: false });
  const root = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all', bakeGround: true });
  const t = root.getObjectByName('site-terrain');
  assert.ok(t?.geometry.getAttribute('color'), 'terrain carries vertex colours');
  assert.ok(t.material.vertexColors);
  const c = t.geometry.getAttribute('color');
  const seen = new Set();
  for (let i = 0; i < c.count; i += 7) seen.add(`${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)}`);
  assert.ok(seen.size >= 2, 'two ground tones');
  const plain = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' }).getObjectByName('site-terrain');
  assert.ok(!plain.geometry.getAttribute('color'), 'the online viewer keeps its own ground material');
});

test('html export of a commercial site carries the lot labels for the viewer', async () => {
  const p = commercialProject({ plain: false });
  p.site.lot.lotNumber = '12'; p.site.lot.planLabel = 'DP 1198432'; p.site.lot.areaM2 = 9000;
  const f = await buildExport('html', p, { catalogue, config: {}, date: new Date('2026-11-18T00:00:00Z') });
  const html = new TextDecoder().decode(f.bytes);
  const m = html.match(/<script id="pa-labels" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'labels script present');
  const labels = JSON.parse(m[1]);
  assert.ok(labels.some((l) => l.k === 'lot' && l.t[0] === 'Lot 12'));
  p.site.lot.layers = { ...(p.site.lot.layers || {}), labels: false };
  const f2 = await buildExport('html', p, { catalogue, config: {}, date: new Date('2026-11-18T00:00:00Z') });
  assert.ok(!/id="pa-labels"/.test(new TextDecoder().decode(f2.bytes)), 'labels off stays off in the export');
});

// ---- parity harness (tests/helpers/parity-harness.mjs): every sample built in every place it is shown --------------------------------
import { jsPDF } from 'jspdf';
import { liftDarkHex } from '../src/model/colour-lift.js';
import { SCHEMES, schemeColours } from '../src/model/colour-schemes.js';
import { layoutUnits } from '../src/commercial/layout.js';
import * as H from './helpers/parity-harness.mjs';
import { PUBLIC_TEMPLATE_IDS } from '../src/lotcard/designs.js';
import { createProject, migrate } from '../src/model/schema.js';
import { placeHouse } from '../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../src/portal/envelope.js';
import { autoPose } from '../src/portal/auto-place.js';
import { createStore } from '../src/model/store.js';
import { commercialEdit } from '../src/commercial/mode.js';
import { addBuilding } from '../src/commercial/catalogue/ops.js';
import { topViewFill, applyFinishes } from '../src/commercial/finishes.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';

const SAMPLES = H.sampleProjects();
// Documented differences between the editor and the offline file: the ground is baked into vertex colours in the GLB (src/viewer3d/terrain.js bakeGround).
const EXPORT_IGNORE_COLOURS = ['site-terrain'];
const compareExport = (a, b) => H.compareInventories(a, b, { ignore: [] }).filter((p) => !EXPORT_IGNORE_COLOURS.some((k) => p.startsWith(`${k}: colours`)));

for (const s of SAMPLES) {
  test(`parity ${s.id}: editor, embed, HTML export (client and server path) and a saved/handed over copy have the same mesh inventory`, async () => {
    const editor = H.inventory(H.buildEditor(s.project));
    assert.ok(editor.wall && editor.roof && editor.slab, 'the model has walls, a roof and a slab');
    assert.deepEqual(H.compareInventories(editor, H.inventory(H.buildEmbed(s.project, { sameLayers: true }))), [], 'embed');
    assert.deepEqual(compareExport(editor, H.inventory(await H.buildExport(s.project))), [], 'export, client path');
    assert.deepEqual(compareExport(editor, H.inventory(await H.buildExport(s.project, { server: true }))), [], 'export, server path (JSON and migrate)');
    const handed = migrate(JSON.parse(JSON.stringify(s.project)));
    assert.deepEqual(H.compareInventories(editor, H.inventory(H.buildEditor(handed))), [], 'handoff to the full editor');
  });

  test(`parity ${s.id}: the plan geometry (walls, openings, rooms, furniture, stairs, outline) is what the model builds`, () => {
    assert.deepEqual(H.comparePlanToModel(s.project, H.buildEditor(s.project)), []);
  });

  test(`parity ${s.id}: the lot card top view shows the model's roof colour, footprint, units, buildings and tanks`, async () => {
    assert.deepEqual(await H.compareTopViewToModel(s.project, H.buildEditor(s.project)), []);
  });
}

test('parity: roller door, cladding, roof, fascia and downpipe colours are the same in the editor and the export', async () => {
  for (const id of ['com-warehouse', 'com-strata-red']) {
    const p = SAMPLES.find((x) => x.id === id).project;
    const fin = p.finishes;
    const want = new THREE.Color(fin.rollerDoor.colour).getHexString();
    for (const root of [H.buildEditor(p), H.buildEmbed(p), await H.buildExport(p)]) {
      assert.ok(H.openingColours(root).roller_door.includes(want), `${id}: roller door ${want}`);
      const inv = H.inventory(root);
      assert.ok(inv.wall.colours.includes(new THREE.Color(fin.externalWalls.colour).getHexString()), `${id}: cladding`);
      assert.ok(inv.roof.colours.includes(new THREE.Color(fin.fascia.colour).getHexString()), `${id}: fascia and gutter`);
      assert.ok(inv.trim.colours.includes('cfd2d3'), `${id}: downpipes`);
    }
  }
});

test('parity: a residential design keeps its driveway, tank, fence and letterbox in every context', async () => {
  const p = SAMPLES.find((x) => x.id === 'res-single').project;
  for (const root of [H.buildEditor(p), H.buildEmbed(p), await H.buildExport(p)]) {
    const inv = H.inventory(root);
    for (const k of ['driveway', 'tank', 'fences', 'letterbox', 'trim', 'garden-beds']) assert.ok(inv[k], `${k} present`);
  }
});

test('parity: a commercial warehouse keeps its trees, parking and pavement in every context', async () => {
  const p = SAMPLES.find((x) => x.id === 'com-warehouse').project;
  for (const root of [H.buildEditor(p), H.buildEmbed(p), await H.buildExport(p)]) {
    const inv = H.inventory(root);
    for (const k of ['trees', 'tree-trunks', 'pavement-areas', 'pavement-kerbs', 'pavement-markings', 'entourage-cars', 'extras']) assert.ok(inv[k], `${k} present`);
  }
});

test('parity: every public design, placed on a lot, matches its plan, its top view and its export', async () => {
  for (const [i, id] of PUBLIC_TEMPLATE_IDS.entries()) {
    const portal = { name: id, polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
    const p = createProject({ name: id });
    p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
    const h = catalogue.createFromTemplate(id);
    placeHouse(p, h, autoPose(p, h).pose);
    const g = H.buildEditor(p);
    assert.deepEqual(H.comparePlanToModel(p, g), [], `${id} plan`);
    assert.deepEqual(await H.compareTopViewToModel(p, g), [], `${id} top view`);
    if (i % 3 === 0) assert.deepEqual(compareExport(H.inventory(g), H.inventory(await H.buildExport(p))), [], `${id} export`); // the GLB round trip is the slow part
  }
});

test('parity: the top view shows the roof colour of the cladding, and a new commercial layout carries the card default colours', () => {
  const s = createStore(commercialProject({ rows: 'none', width: 60000, depth: 80000, plain: false }), { autosaveKey: null });
  assert.equal(s.project.commercial.finishes.cladding, 'warm-white', 'default finishes are written on conversion');
  for (const cladding of ['tilt-panel-grey', 'charcoal', 'sand']) {
    s.apply('Finishes', (p) => applyFinishes(p, { cladding }));
    const roofs = H.inventory(H.buildEditor(s.project)).roof.colours;
    assert.ok(roofs.includes(topViewFill(s.project).replace('#', '')), `${cladding}: top view fill is a roof colour of the 3D model`);
  }
});

function recorder() {
  const texts = [];
  class Rec extends jsPDF {
    constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (x, ...r) => (texts.push(Array.isArray(x) ? x.join(' ') : String(x)), t(x, ...r)); }
  }
  return { Rec, texts };
}

test('parity: the commercial plan set names every unit and building the model has, and its docks and canopy', async () => {
  const strata = SAMPLES.find((x) => x.id === 'com-strata').project;
  const a = recorder();
  await exportPlanSet({ project: strata, kind: 'commercial', download: false, jsPDF: a.Rec, fetchSite: null, includeAerial: false });
  const nUnits = layoutUnits(strata.commercial).length;
  assert.ok(nUnits > 0);
  for (let n = 1; n <= nUnits; n++) assert.ok(a.texts.some((t) => new RegExp(`UNIT ${n}\\b`).test(t)), `UNIT ${n}`);
  const s = createStore(commercialProject({ rows: 'none', width: 90000, depth: 100000, plain: false }), { autosaveKey: null });
  commercialEdit(s, 'Clear rows', (c) => { c.rows = []; });
  addBuilding(s, 'warehouse', { params: { docks: 3, groundDoors: 1, spanMm: 36000 } });
  const b = recorder();
  await exportPlanSet({ project: s.project, kind: 'commercial', download: false, jsPDF: b.Rec, fetchSite: null, includeAerial: false });
  assert.ok(b.texts.some((t) => /^B1 /.test(t)), 'building label B1');
  assert.ok(b.texts.some((t) => /3 DOCKS/.test(t)), 'dock count');
  assert.ok(b.texts.some((t) => /DOCK CANOPY/.test(t)), 'dock canopy');
  assert.ok(H.inventory(H.buildEditor(s.project)).extras, 'the model draws the canopy and dock extras');
});

test('parity: the residential engineering plan set names every room of the model', async () => {
  const p = SAMPLES.find((x) => x.id === 'res-double').project;
  const r = recorder();
  await toEngineeringPDF(p, { jsPDF: r.Rec, catalogue, config: {} });
  const all = r.texts.join('\n').toUpperCase();
  const missing = p.levels.flatMap((l) => l.rooms).filter((x) => x.name && !all.includes(String(x.name).toUpperCase().replace(/\s+/g, ' ').slice(0, 6))).map((x) => x.name);
  assert.deepEqual(missing, []);
});

test('parity: the pure dark colour lift matches the three.js lift the 3D roof used', () => {
  const ref = (hexStr, minL) => { const c = new THREE.Color(hexStr); const hsl = {}; c.getHSL(hsl); if (hsl.l >= minL) return hexStr; c.setHSL(hsl.h, hsl.s, minL); return `#${c.getHexString()}`; };
  for (const h of ['#2b2d30', '#42474c', '#6c7074', '#464a4f', '#9b5a43', '#d2cabb', '#000000', '#5c5247', '#3f444a', '#8c3f30', '#35506b']) assert.equal(liftDarkHex(h, 0.27), ref(h, 0.27), h);
});

test('parity: the residential top view and plan use the roof colour of every colour scheme as the 3D model shows it', () => {
  for (const sc of SCHEMES) {
    const p = structuredClone(SAMPLES.find((x) => x.id === 'res-single').project);
    p.colourScheme = sc.id;
    const roofs = H.inventory(H.buildEditor(p)).roof.colours;
    assert.ok(roofs.includes(schemeColours(p).roof.replace('#', '')), `${sc.id}: ${schemeColours(p).roof} in ${roofs}`);
  }
});

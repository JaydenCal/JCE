// Engineering style plan set: sheets, title block fields, wording rules and the branding switch. Uses the real jsPDF and the
// Tamworth sample lot with a Glide library house.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { createProject } from '../src/model/schema.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { siteLotSetbacks } from '../src/site/setbacks.js';
import { autoPose } from '../src/portal/auto-place.js';
import { placeHouse } from '../src/portal/place-house.js';
import { toEngineeringPDF, engineeringSheets } from '../src/premium/exporters/eng/index.js';
import { clean, hatchSegments, placeCallouts, clipSegment } from '../src/premium/exporters/eng/kit.js';
import { ddmmyy, drawingNo, projectCode, projectTitle, brandOf, attribution } from '../src/premium/exporters/eng/brand.js';
import { buildExport } from '../src/premium/exporters/index.js';

const rules = JSON.parse(fs.readFileSync(new URL('../../setbacks-data/setback-rules.json', import.meta.url), 'utf8'));
function sample({ template = 'house_double', state = null } = {}) {
  const f = FIXTURES[0];
  const lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  const r = siteLotSetbacks(lot, rules, { storeys: 2, wallHeightM: 5.4, buildingHeightM: 8 });
  lot.setbacks = r.setbacks;
  lot.envelope = r.envelope;
  if (state) lot.state = state;
  const p = createProject({ name: 'Sample Residence' });
  p.site.lot = lot;
  Object.assign(p.titleBlock, { client: 'A Sample Client', company: 'Sample Designs Pty Ltd', drawnBy: 'AB', checkedBy: 'CD', jobNumber: 'TAM24' });
  const h = catalogue.createFromTemplate(template);
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}

// Collect everything the PDF writes as text, through a recording subclass.
function recorder() {
  const texts = [];
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, ...r) => (texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
    }
  }
  return { Rec, texts };
}

test('sheet set: cover, site plan, floor plans, roof, elevations, section, analysis, schedules', async () => {
  const p = sample();
  const { Rec } = recorder();
  const bytes = await toEngineeringPDF(p, { jsPDF: Rec, catalogue, date: new Date(2026, 10, 11) });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const kinds = bytes.layout.pages;
  assert.deepEqual(kinds, ['cover', 'site', 'level', 'level', 'roof', 'elevations', 'section', 'analysis', 'schedule']);
  assert.equal(bytes.layout.sheets.length, 9);
  const pageCount = (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pageCount, 9);
  assert.deepEqual(bytes.layout.sheets.map((s) => s.number), Array.from({ length: 9 }, (_, i) => `GI-TAM24-A-${String(i + 1).padStart(3, '0')}`));
  assert.match(bytes.layout.sheets[1].scale, /^1:\d+ @ A3$/);
});

test('A1 option multiplies the page size and keeps the layout', async () => {
  const p = sample();
  p.drawing.paper = 'A1';
  const bytes = await toEngineeringPDF(p, { jsPDF, catalogue });
  assert.equal(bytes.layout.paper, 'A1');
  assert.match(bytes.layout.sheets[1].scale, /@ A1$/);
  assert.match(Buffer.from(bytes).toString('latin1'), /MediaBox\s*\[\s*0\s+0\s+2383\.9/);
});

test('title block, drawing list and footer carry the required fields', async () => {
  const p = sample();
  p.titleBlock.address = '14 Sample Street Calala NSW';
  const { Rec, texts } = recorder();
  await toEngineeringPDF(p, { jsPDF: Rec, catalogue, date: new Date(2026, 10, 11) });
  const all = texts.join('\n');
  for (const want of ['SAMPLE RESIDENCE', 'A Sample Client', 'GI-TAM24-A-002', '11/11/2026', 'AB', 'CD', 'TAM24', 'Prepared by Sample Designs Pty Ltd', 'SITE PLAN', 'GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'ROOF PLAN', 'NORTH elevation'.toUpperCase().replace('ELEVATION', 'ELEVATION'), 'SECTION A-A', 'SITE ANALYSIS AND SETBACKS']) {
    assert.ok(all.includes(want), `missing text: ${want}`);
  }
  assert.ok(/CONCEPT ONLY\. TO BE VERIFIED BY A SUITABLY QUALIFIED PERSON/.test(all));
  assert.ok(/NSW Spatial Services \(CC BY\)/.test(all));
  assert.ok(/Inside the indicative setback envelope/.test(all));
  assert.ok(/Check with council/i.test(all));
  // Site plan content: bearings, lot and DP on their own lines, FFL and NSL, call outs.
  assert.ok(/\d+°\d\d'\d\d"/.test(all));
  assert.ok(texts.includes('DP 1234567'));
  assert.ok(texts.some((t) => /^LOT \d+$/.test(t)));
  assert.ok(texts.some((t) => /^FFL \d+\.\d\d$/.test(t)) && texts.some((t) => /^NSL \d+\.\d$/.test(t)));
  assert.ok(texts.includes('PROPOSED DRIVEWAY') && texts.includes('PROPOSED CROSSOVER'));
  assert.ok(texts.includes('1:100 @ A3'));
});

test('no em or en dashes and never the word compliant anywhere on the sheets', async () => {
  const p = sample();
  p.titleBlock.projectName = 'Compliant – test — house';
  p.titleBlock.notes = 'non-compliant, complying';
  const { Rec, texts } = recorder();
  await toEngineeringPDF(p, { jsPDF: Rec, catalogue });
  const all = texts.join('\n');
  assert.ok(!/[–—]/.test(all), 'dash found');
  assert.ok(!/compliant/i.test(all), 'forbidden word found');
  assert.equal(clean('a – b — c'), 'a - b - c');
  assert.ok(!/compliant/i.test(clean('This is Compliant and non-compliant')));
  assert.equal(clean('Area 12 m² at 45°'), 'Area 12 m² at 45°');
});

test('branding switch: public leads with Glide Inside and the user fields, builder leads with the builder', async () => {
  const p = sample();
  const pub = recorder();
  const a = await toEngineeringPDF(p, { jsPDF: pub.Rec, catalogue, builder: null });
  assert.equal(a.layout.mode, 'public');
  assert.ok(pub.texts.includes('Prepared by Sample Designs Pty Ltd'));
  assert.ok(!pub.texts.some((t) => /Prepared with Glide Inside/.test(t)));
  const b = recorder();
  const bb = await toEngineeringPDF(p, { jsPDF: b.Rec, catalogue, builder: { name: 'Sample Builder Homes', logo: null } });
  assert.equal(bb.layout.mode, 'builder');
  assert.ok(b.texts.includes('Sample Builder Homes'));
  assert.ok(b.texts.includes('Prepared with Glide Inside'));
  assert.ok(!b.texts.some((t) => /Prepared by Sample Designs/.test(t)));
  assert.equal(brandOf(p, { builder: null, logo: null }).mode, 'public');
  assert.equal(brandOf(p, { builder: { name: 'X' }, logo: null }).mode, 'builder');
});

test('drawing numbers, dates and attribution', () => {
  const p = createProject({ id: 'p_abc123xyz', name: 'SI38NGLE storey,   4 bedroom ' });
  // Never from the free text name: the short id, then the lot and plan, then a typed job number
  assert.equal(projectCode(p), 'PABC12');
  assert.equal(drawingNo(p, 7), 'GI-PABC12-A-007');
  p.site.lot = { lotNumber: '3', planLabel: 'DP 263990' };
  assert.equal(drawingNo(p, 1), 'GI-L3DP263990-A-001');
  p.titleBlock.jobNumber = 'tam-24';
  assert.equal(drawingNo(p, 1), 'GI-TAM24-A-001');
  assert.equal(projectTitle(p), 'SINGLE storey, 4 bedroom');
  assert.equal(projectTitle(createProject({ name: '   ' })), 'Concept house');
  assert.equal(ddmmyy(new Date(2026, 0, 5)), '05/01/2026');
  assert.match(attribution({ state: 'NSW' }), /NSW Spatial Services \(CC BY\)/);
  assert.match(attribution({ state: 'QLD' }), /Queensland Government \(CC BY 4\.0\).*CC BY-SA/);
});

test('without a lot or a building the set still builds and says so', async () => {
  const p = createProject({ name: 'Bare' });
  const { Rec, texts } = recorder();
  const bytes = await toEngineeringPDF(p, { jsPDF: Rec, catalogue });
  assert.equal(bytes.layout.sheets.length, 8);
  assert.ok(texts.some((t) => /NO LOT LOADED/.test(t)));
});

test('QLD lot carries the Queensland attribution in the footer', async () => {
  const p = sample({ state: 'QLD' });
  const { Rec, texts } = recorder();
  await toEngineeringPDF(p, { jsPDF: Rec, catalogue });
  assert.ok(texts.some((t) => /Queensland Government \(CC BY 4\.0\)/.test(t)));
});

test('buildExport makes the engineering set by default and the standard sheets on request', async () => {
  const p = sample();
  const eng = await buildExport('pdf', p, { jsPDF, catalogue });
  assert.equal(eng.bytes.layout.style, 'engineering');
  const old = await buildExport('pdf', p, { jsPDF, catalogue, style: 'legacy' });
  assert.equal(old.bytes.layout.style, undefined);
  assert.equal(old.bytes.layout.pages[0], 'title');
});

test('engineeringSheets lists the sheets without drawing', () => {
  const p = sample();
  const plan = engineeringSheets(p, { catalogue });
  assert.equal(plan.list.length, 9);
  assert.equal(plan.list[0].kind, 'cover');
});

// Drafting kit -------------------------------------------------------------------------------------------------------------------
test('hatch lines stay inside the polygon and are evenly spaced', () => {
  const poly = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const segs = hatchSegments(poly, 0, 2);
  assert.equal(segs.length, 5);
  for (const [a, b] of segs) {
    for (const q of [a, b]) assert.ok(q.x >= -1e-6 && q.x <= 20 + 1e-6 && q.y >= -1e-6 && q.y <= 10 + 1e-6);
  }
  const diag = hatchSegments(poly, 45, 2);
  assert.ok(diag.length > 8);
  assert.deepEqual(hatchSegments([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, 1), []);
});

test('call outs do not overlap each other or the obstacles, and leaders do not cross', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const items = [
    { id: 'a', lines: ['ONE', 'first line'], at: { x: 100, y: 100 } },
    { id: 'b', lines: ['TWO', 'second line'], at: { x: 104, y: 102 } },
    { id: 'c', lines: ['THREE', 'third line'], at: { x: 98, y: 106 } },
    { id: 'd', lines: ['FOUR'], at: { x: 106, y: 98 } },
  ];
  const obstacle = { x0: 90, y0: 90, x1: 112, y1: 112 };
  const out = placeCallouts(doc, items, { obstacles: [obstacle], area: { x0: 10, y0: 10, x1: 300, y1: 200 } });
  assert.equal(out.length, 4);
  const ov = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  for (let i = 0; i < out.length; i++) {
    assert.ok(!ov(out[i].box, obstacle), `${out[i].id} sits on the obstacle`);
    for (let j = i + 1; j < out.length; j++) assert.ok(!ov(out[i].box, out[j].box), `${out[i].id} overlaps ${out[j].id}`);
  }
});

test('segment clipping keeps what is inside the viewport', () => {
  const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.deepEqual(clipSegment({ x: -5, y: 5 }, { x: 15, y: 5 }, r), [{ x: 0, y: 5 }, { x: 10, y: 5 }]);
  assert.equal(clipSegment({ x: -5, y: -5 }, { x: -1, y: -1 }, r), null);
});

import { nearestTown } from '../src/premium/exporters/eng/towns.js';
import { normDate } from '../src/premium/exporters/eng/brand.js';
import { LabelField } from '../src/premium/exporters/eng/kit.js';

test('towns, date normalising and the label field', () => {
  const t = nearestTown(150.93, -31.09);
  assert.ok(t && /Tamworth/i.test(t.name));
  assert.equal(normDate('2026-11-11'), '11/11/2026');
  const f = new LabelField();
  assert.ok(f);
});

import { distanceBearing } from '../src/premium/exporters/eng/towns.js';
import { roadNameOnly } from '../src/premium/exporters/eng/siteplan.js';
import { clipConvex } from '../src/premium/exporters/eng/sheets.js';
import { dimensionsFor, wallShapes } from '../src/premium/exporters/shared.js';

test('bearing and distance to a town: south is 180, east is 90, north west is between 270 and 360', () => {
  assert.ok(Math.abs(distanceBearing(150, -31, 150, -32).bearingDeg - 180) < 0.01);
  assert.ok(Math.abs(distanceBearing(150, -31, 150, -32).km - 111.2) < 0.5);
  assert.ok(Math.abs(distanceBearing(150, -31, 151, -31).bearingDeg - 90) < 0.5);
  const nw = distanceBearing(150.97, -31.12, 150.93, -31.09).bearingDeg;
  assert.ok(nw > 270 && nw < 360);
});

test('road name only: no number, suburb, state or postcode', () => {
  assert.equal(roadNameOnly('SAMPLE STREET CALALA NSW'), 'SAMPLE STREET');
  assert.equal(roadNameOnly('14 Sample Street Calala NSW 2340'), 'Sample Street');
  assert.equal(roadNameOnly('14 Sample Street, Calala NSW'), 'Sample Street');
});

test('footer attribution has no duplicated label or stray full stop', () => {
  const t = attribution({ state: 'NSW', aerial: { attribution: 'Imagery: NSW Spatial Services (c) Department of Customer Service 2020. Sample picture only.' } }, { aerial: true });
  assert.ok(!/Imagery: Imagery/i.test(t) && !/Aerial underlay: Imagery/i.test(t));
  assert.ok(!/only\.\s*[.,]/.test(t));
  assert.match(t, /Reduced resolution, not for measurement\./);
});

test('convex clip keeps the part inside', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const out = clipConvex([{ x: -5, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 8 }, { x: -5, y: 8 }], sq);
  const area = Math.abs(out.reduce((a, p, i) => a + (p.x * out[(i + 1) % out.length].y - out[(i + 1) % out.length].x * p.y), 0) / 2);
  assert.ok(Math.abs(area - 30) < 1e-6);
});

test('plan dimension chains add up to the overall dimension on every side', () => {
  const p = sample();
  for (const level of p.levels) {
    const dims = dimensionsFor(level, wallShapes(level));
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const ds = dims.filter((d) => d.side === side);
      if (ds.length < 3) continue;
      const overall = ds.reduce((a, d) => (Number(d.text) > Number(a.text) ? d : a));
      const chain = ds.filter((d) => d !== overall);
      assert.equal(chain.reduce((a, d) => a + Number(d.text), 0), Number(overall.text), `${level.name} ${side}`);
    }
  }
});

test('one ridge height on the roof data, elevations and section; no invented initials; CHECK for tall side setbacks', async () => {
  const p = sample();
  p.titleBlock.drawnBy = '';
  p.titleBlock.checkedBy = '';
  p.titleBlock.company = '';
  const { Rec, texts } = recorder();
  const bytes = await toEngineeringPDF(p, { jsPDF: Rec, catalogue, date: new Date(2026, 10, 11) });
  assert.equal(bytes.layout.sheets.length, 9);
  const ridge = texts.filter((t) => /^RIDGE( RL)? [\d.]+$/.test(t)).map((t) => t.replace(/[^\d.]/g, ''));
  assert.ok(ridge.length >= 5);
  assert.equal(new Set(ridge).size, 1);
  const hp = texts.find((t) => /m above FFL, RL [\d.]+/.test(t));
  assert.ok(hp && hp.endsWith(ridge[0]), hp);
  assert.ok(texts.some((t) => /m ABOVE FFL/.test(t)));
  assert.ok(!texts.includes('AB') && !texts.includes('CD'));
  assert.ok(!texts.some((t) => /Sample Designs|heightModelInfo/.test(t)));
  assert.ok(texts.some((t) => /Prepared with Glide Inside/.test(t)));
  assert.ok(texts.some((t) => /^CHECK\./.test(t)));
  assert.ok(texts.some((t) => /NOT CHECKED/.test(t)));
});

test('site area: one figure on every sheet, hectares over 10,000 m2, a stored figure that disagrees with the lot never wins', async () => {
  const { fmtArea, siteAreaOf, siteAreaText, lotIdLines } = await import('../src/premium/exporters/eng/area.js');
  assert.equal(fmtArea(789.4), '789 m²');
  assert.equal(fmtArea(10000), '10000 m²');
  assert.equal(fmtArea(509300), '50.93 ha');
  const sq = (m) => [{ x: 0, y: 0 }, { x: m * 1000, y: 0 }, { x: m * 1000, y: m * 1000 }, { x: 0, y: m * 1000 }];
  // The drawn lot decides when no registered area is held
  assert.equal(siteAreaOf({ boundary: sq(100), areaM2: 789 }).m2, 10000);
  // A registered area larger than the outline loaded is the legal figure (the outline is part of the lot)
  const partial = { boundary: sq(28), areaM2: 789, registeredAreaM2: 509300 };
  assert.equal(siteAreaOf(partial).m2, 509300);
  assert.match(siteAreaText(partial), /^50\.93 ha \(registered area/);
  // Registered area in hectares is recognised
  assert.equal(siteAreaOf({ boundary: sq(1000), registeredAreaM2: 100 }).m2, 1000000);
  assert.deepEqual(lotIdLines({ titleBlock: { lotDp: 'Lot 3 DP 263990' } }, { lotNumber: '3', planLabel: 'DP 0254' }), { first: 'LOT 3', second: 'DP 263990', proposed: false });
});

test('large rural lot: site plan shows the house and surrounds with a key plan window, frontage road named from the nearest road, wide locality', async () => {
  const { ruralProject } = await import('../tools/engplans-sample.mjs');
  const { siteView, siteFacts, frontageRoadName, localityView } = await import('../src/premium/exporters/eng/siteplan.js');
  const { project, fetchAerial, aerial } = await ruralProject();
  const facts = siteFacts(project);
  const v = siteView(project, facts, 1);
  assert.equal(v.focus, true);
  assert.ok(v.n <= 500, `site plan scale 1:${v.n}`);
  assert.equal(v.windowPlan.length, 4);
  assert.equal(frontageRoadName(project.site.lot, facts), 'QUIA ROAD');
  project.site.lot.address = '';
  assert.equal(frontageRoadName(project.site.lot, facts), 'QUIA ROAD'); // nearest road, not the first the lookup listed (River Street)
  const box = { x0: 212, y0: 28, x1: 408, y1: 277 };
  const ideal = localityView(project, box, { minSpanM: 280, k: 1, ideal: true });
  assert.ok(ideal.n >= 5000, `locality 1:${ideal.n}`);
  const narrow = localityView(project, box, { minSpanM: 280, k: 1, extent: project.site.lot.aerial.extent });
  assert.ok(narrow.n <= ideal.n, 'without a wider aerial the view is no more zoomed out than the ideal');
  // The whole set builds, with the wider aerial supplied and without it
  const bytes = await toEngineeringPDF(project, { jsPDF, catalogue, date: new Date(2026, 10, 11), aerial, fetchAerial });
  assert.ok(bytes.length > 20000);
  const bytes2 = await toEngineeringPDF(project, { jsPDF, catalogue, date: new Date(2026, 10, 11), aerial });
  assert.ok(bytes2.length > 20000);
});

test('footer text is dark grey and at least 6.5 pt', async () => {
  const p = sample();
  const calls = [];
  class Spy extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, ...r) => {
        const s = Array.isArray(t) ? t.join(' ') : String(t);
        if (/^CONCEPT ONLY|^Cadastre, imagery/.test(s)) calls.push([s, this.getFontSize(), this.getTextColor()]);
        return text(t, ...r);
      };
    }
  }
  await toEngineeringPDF(p, { jsPDF: Spy, catalogue });
  assert.ok(calls.length >= 2);
  for (const [t, fs, col] of calls) {
    assert.ok(fs >= 6.5, `footer ${fs} pt: ${t.slice(0, 20)}`);
    const rgb = String(col).startsWith('#') ? [1, 3, 5].map((i) => parseInt(String(col).slice(i, i + 2), 16)) : null;
    if (rgb) assert.ok(rgb[0] < 110 && rgb[0] - rgb[1] < 30, `footer colour ${col}`);
  }
});

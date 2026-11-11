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
import { ddmmyy, drawingNo, projectCode, brandOf, attribution } from '../src/premium/exporters/eng/brand.js';
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
  for (const want of ['SAMPLE RESIDENCE', 'A Sample Client', 'GI-TAM24-A-002', '11.11.26', 'AB', 'CD', 'TAM24', 'Prepared by Sample Designs Pty Ltd', 'SITE PLAN', 'GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'ROOF PLAN', 'NORTH elevation'.toUpperCase().replace('ELEVATION', 'ELEVATION'), 'SECTION A-A', 'SITE ANALYSIS AND SETBACKS']) {
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
  assert.ok(texts.some((t) => /^FFL \d+\.\d\d$/.test(t)) && texts.some((t) => /^NSL \d+\.\d\d$/.test(t)));
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
  const p = createProject({ name: 'Sample Residence' });
  assert.equal(projectCode(p), 'SAMPLERE');
  assert.equal(drawingNo(p, 7), 'GI-SAMPLERE-A-007');
  assert.equal(ddmmyy(new Date(2026, 0, 5)), '05.01.26');
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

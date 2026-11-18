// Siting report additions: constraints, contours and fall page, commercial report, commercial estimate maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { residential, overlaysFor } from './helpers/siting-fixture.mjs';
import * as H from './helpers/grading-harness.mjs';
import { toSitingReport } from '../src/premium/exporters/siting-report.js';
import { lotFall, fallSentence, constraintFacts, setbackFacts } from '../src/premium/exporters/siting-facts.js';
import { estimateSiteCost, cleanRates, DEFAULT_RATES, estimateForProject } from '../src/premium/site-costs/commercial-estimate.js';

function recorder() {
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (x, ...r) => (texts.push(Array.isArray(x) ? x.join(' ') : String(x)), t(x, ...r)); } }
  return { Rec, texts };
}

test('commercial estimate: lines are quantity times rate, surplus cut, contingency on subtotal, bad input never NaN', () => {
  const q = { cutM3: 100, fillM3: 40, drivewayM2: 50, crossoverM2: 10, retainingM2: 12, waterM: 10, sewerM: 10, stormwaterM: 10, powerTelcoM: 10, connections: 5 };
  const r = { cutPerM3: 20, fillPerM3: 50, cartAwayPerM3: 30, reuseCutPct: 50, drivewayPerM2: 100, crossoverPerM2: 200, retainingPerM2: 400, waterPerM: 10, sewerPerM: 20, stormwaterPerM: 30, powerTelcoPerM: 40, connectionEach: 1000, contingencyPct: 10 };
  const e = estimateSiteCost(q, r);
  const by = Object.fromEntries(e.lines.map((l) => [l.id, l]));
  assert.equal(by.cart.qty, 60);
  assert.equal(by.cart.amount, 1800);
  assert.equal(by.retaining.amount, 4800);
  assert.equal(e.subtotal, 2000 + 2000 + 1800 + 5000 + 2000 + 4800 + 1000 + 5000);
  assert.equal(e.total, e.subtotal + Math.round(e.subtotal * 0.1));
  assert.equal(cleanRates({ cutPerM3: -4, reuseCutPct: 400 }).reuseCutPct, 100);
  assert.equal(cleanRates({ cutPerM3: -4 }).cutPerM3, DEFAULT_RATES.cutPerM3);
  assert.ok(Number.isFinite(estimateSiteCost({ cutM3: 'a' }).total));
});

test('commercial estimate: a warehouse gets hardstand and earthworks from the design', async () => {
  const r = await estimateForProject(H.commercial('warehouse'));
  assert.ok(r.quantities.paveworksM2 > 0 && r.quantities.drivewayM2 === 0);
});

test('lotFall: a plane rising 1 percent to the east falls west at 1 percent; no levels gives null', () => {
  const p = residential();
  const lot = p.site.lot;
  const cols = 80; const rows = 80; const cellMm = 2000; const x0 = -80000; const y0 = -80000; const values = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values.push(100 + ((x0 + i * cellMm) / 1000) * 0.01);
  lot.terrain = { cols, rows, cellMm, x0, y0, values };
  const f = lotFall(lot);
  assert.ok(Math.abs(f.fallPct - 1) < 0.15);
  assert.equal(f.direction, 'west');
  assert.match(fallSentence(f), /falls towards the west/);
  assert.equal(lotFall({ boundary: lot.boundary }), null);
});

test('facts: constraints say check the council map where there is no open data; setbacks name their source', () => {
  const p = residential();
  const cf = constraintFacts(p.site.lot);
  assert.equal(cf.find((r) => r.id === 'flood').answer, 'Yes');
  assert.match(cf.find((r) => r.id === 'heritage').detail, /Check the council map/);
  assert.match(cf.find((r) => r.id === 'easement').detail, /council map/i);
  const sb = setbackFacts(p);
  assert.ok(sb.available && sb.basis && sb.source);
  assert.ok(overlaysFor(p.site.lot).layers.length === 3);
});

test('report: residential has a constraints and ground page with limitations, no dashes, no banned word', async () => {
  const p = residential();
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(p, { jsPDF: Rec });
  assert.deepEqual(bytes.layout.sections, ['cover', 'site', 'ground', 'design', 'next']);
  const all = texts.join('\n').toUpperCase();
  for (const w of ['Site constraints (indicative)', 'Contours and fall across the lot', 'Limitations', 'Check the council map', 'Not a survey']) assert.ok(all.includes(w.toUpperCase()), w);
  assert.ok(!/[–—]/.test(all));
  assert.ok(!/compliant/i.test(all));
});

test('report: a commercial layout makes a report with the building summary and the allowance estimate', async () => {
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(H.commercial('warehouse'), { jsPDF: Rec });
  const all = texts.join('\n');
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.match(all, /BUILDING SUMMARY/i);
  assert.match(all, /Gross floor area/i);
  assert.match(all, /INDICATIVE ALLOWANCE ONLY|Indicative allowance only/i);
});

test('report: a design with no lot still builds', async () => {
  const { createProject } = await import('../src/model/schema.js');
  const bytes = await toSitingReport(createProject({ name: 'Bare' }), { jsPDF });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
});

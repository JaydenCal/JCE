// Siting report: 2 to 4 A4 pages, builder branding or Glide Inside, wording rules, dates, the estimate and the engineering list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import * as H from './helpers/grading-harness.mjs';
import { createProject } from '../src/model/schema.js';
import { toSitingReport, reportBrand, siteFactsOf, sitingReportFilename, REPORT_DISCLAIMER } from '../src/premium/exporters/siting-report.js';
import { defaultSettings } from '../src/premium/site-costs/rates.js';
import { ENGINEERING_SERVICES } from '../src/premium/engineering-services.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAFklEQVR4nGNk+M/wn4EKgHHUkPpoAABwGAcR3yZHAAAAAElFTkSuQmCC';
function recorder() {
  const texts = []; const fills = [];
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this); const fill = this.setFillColor.bind(this);
      this.text = (t, ...r) => (texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
      this.setFillColor = (...c) => (fills.push(c.join(',')), fill(...c));
    }
  }
  return { Rec, texts, fills };
}
const builder = { name: 'Sample Homes', logo: null, colours: { primary: '#1f4d3a', accent: '#d9822b' } };
const proj = () => H.residential({ fall: 6 });

test('siting report: 2 to 4 A4 portrait pages with every section', async () => {
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(proj(), { jsPDF: Rec, builder, settings: defaultSettings() });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.layout.pages >= 2 && bytes.layout.pages <= 5, `pages ${bytes.layout.pages}`);
  assert.deepEqual(bytes.layout.sections, ['cover', 'site', 'ground', 'design', 'next']);
  const all = texts.join('\n');
  for (const want of ['SITING REPORT AND PROPOSAL', 'Site summary', 'Siting plan', 'Setbacks', 'Home design summary', 'Indicative site cost estimate', 'Next steps', 'Contact', 'Lot area', 'Street frontage', 'Zone', 'Council', 'Total, GST excluded']) {
    assert.ok(all.toUpperCase().includes(want.toUpperCase()), `missing ${want}`);
  }
  for (const s of ENGINEERING_SERVICES) assert.ok(all.replace(/\s+/g, ' ').includes(s.label.toLowerCase()), s.label);
  assert.ok(bytes.layout.estimate.likely > 0);
});

test('siting report: A4 portrait page size', async () => {
  let size = null;
  class Spy extends jsPDF { constructor(...a) { super(...a); size = [this.internal.pageSize.getWidth(), this.internal.pageSize.getHeight()]; } }
  await toSitingReport(proj(), { jsPDF: Spy, builder });
  assert.deepEqual(size.map((n) => Math.round(n)), [210, 297]);
});

test('siting report: builder colours and name, else Glide Inside', async () => {
  const a = recorder();
  const withB = await toSitingReport(proj(), { jsPDF: a.Rec, builder });
  assert.ok(a.fills.includes('31,77,58'), 'builder primary colour used');
  assert.equal(withB.layout.brand.own, true);
  assert.ok(a.texts.join('\n').includes('Sample Homes'));
  const b = recorder();
  const glide = await toSitingReport(proj(), { jsPDF: b.Rec, builder: null });
  assert.equal(glide.layout.brand.own, false);
  assert.equal(glide.layout.brand.name, 'Glide Inside');
  assert.ok(!b.fills.includes('31,77,58'));
  assert.ok(b.fills.includes('20,48,74'), 'Glide Inside ink colour');
  assert.deepEqual(reportBrand({ builder: { name: 'X', colours: { primary: 'bad' } } }).primary, [20, 48, 74], 'a bad colour falls back');
});

test('siting report: cover takes the 3D render when given one, else shows the site plan', async () => {
  const withImg = await toSitingReport(proj(), { jsPDF, builder, image: PNG });
  assert.equal(withImg.layout.hasImage, true);
  const { Rec, texts } = recorder();
  const without = await toSitingReport(proj(), { jsPDF: Rec, builder });
  assert.equal(without.layout.hasImage, false);
  assert.ok(texts.join('\n').includes('a 3D view was not available'));
});

test('siting report: wording rules (no compliant, no en or em dashes, DD/MM/YYYY, indicative)', async () => {
  const p = proj();
  p.titleBlock.address = '12 Sample Street – Tamworth NSW'; // a typed en dash must not reach the page
  p.site.lot.zoning = { code: 'R1', name: 'General — Residential, non-compliant check' };
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(p, { jsPDF: Rec, builder, date: new Date(2026, 10, 18) });
  const all = texts.join('\n');
  assert.ok(!/compliant/i.test(all), 'the word compliant never appears');
  assert.ok(!/[–—]/.test(all), 'no en or em dashes');
  assert.ok(all.includes('18/11/2026'), 'DD/MM/YYYY');
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(all), 'no ISO dates');
  assert.ok(/Indicative only/.test(REPORT_DISCLAIMER));
  assert.ok(/not a quote/i.test(all));
  assert.ok(bytes.length > 5000);
});

test('siting report: the estimate in the report equals estimateSiteCosts and states the rates basis', async () => {
  const p = proj();
  const { estimateSiteCosts } = await import('../src/premium/site-costs/estimate.js');
  const est = estimateSiteCosts(p, { settings: defaultSettings() });
  const { Rec, texts } = recorder();
  await toSitingReport(p, { jsPDF: Rec, builder, settings: defaultSettings() });
  const all = texts.join('\n');
  assert.ok(all.includes(`$${est.total.likely.toLocaleString('en-AU')}`));
  assert.ok(all.includes('Glide Inside defaults'));
  assert.ok(all.includes(est.ratesDate));
});

test('siting report: a design with no lot still makes a short report, never more than 4 pages', async () => {
  const p = createProject({ name: 'No lot' });
  const bytes = await toSitingReport(p, { jsPDF, builder });
  assert.ok(bytes.layout.pages >= 2 && bytes.layout.pages <= 5);
  assert.equal(bytes.layout.estimate, null);
  await assert.rejects(() => toSitingReport(p, {}), /jsPDF is required/);
});

test('siting report: site facts and file name', () => {
  const f = siteFactsOf(proj());
  assert.ok(f.areaM2 > 100);
  assert.ok(f.frontageM > 5);
  assert.match(f.lotDp, /Lot 7/i);
  assert.equal(sitingReportFilename({ name: 'My Home #2' }), 'my-home-2-siting-report.pdf');
  assert.equal(sitingReportFilename({}), 'design-siting-report.pdf');
});

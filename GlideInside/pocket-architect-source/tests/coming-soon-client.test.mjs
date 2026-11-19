// Coming soon features, client side: site cost rate precedence and GST, the one page summary, the site sheet cost note, the widget mode helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import * as H from './helpers/grading-harness.mjs';
import { mergeSettings, diffSettings, effectiveSettings, settingsSource, defaultSettings, rateOf } from '../src/premium/site-costs/rates.js';
import { estimateSiteCosts } from '../src/premium/site-costs/estimate.js';
import { gstOf, GST_NOTE } from '../src/premium/site-costs/gst.js';
import { toSitingReport, sitingSummaryFilename } from '../src/premium/exporters/siting-report.js';
import { siteCostNote } from '../src/premium/site-costs/note.js';
import { widgetIdFromSearch, hostOrigin } from '../src/portal/widget-mode.js';

const proj = () => H.residential({ fall: 6 });
const withBuilder = (settings, fn) => { const prev = globalThis.__ps; globalThis.__ps = { siteCostDefaults: { get: () => settings } }; try { return fn(); } finally { globalThis.__ps = prev; } };
function recorder() {
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (x, ...r) => (texts.push(Array.isArray(x) ? x.join(' ') : String(x)), t(x, ...r)); } }
  return { Rec, texts };
}

test('rates: design over builder default over standard', () => {
  const p = proj();
  const std = rateOf(effectiveSettings(p), 'cut_excavate', 'nsw');
  assert.ok(std > 0);
  withBuilder({ rates: { cut_excavate: { nsw: 99 } } }, () => {
    assert.equal(rateOf(effectiveSettings(p), 'cut_excavate', 'nsw'), 99);
    assert.equal(settingsSource(p), 'builder');
    p.siteCosts = { rates: { cut_excavate: { nsw: 123 } } };
    assert.equal(rateOf(effectiveSettings(p), 'cut_excavate', 'nsw'), 123);
    assert.equal(settingsSource(p), 'design');
  });
});

test('rates: an override changes the estimate and a diff round trips', () => {
  const p = proj();
  const a = estimateSiteCosts(p, {});
  const s = mergeSettings(defaultSettings(), { rates: { cut_excavate: { nsw: 500, qld: 500 } } });
  const b = estimateSiteCosts(p, { settings: s });
  if (a.ok && a.inputs.cutM3 > 0) assert.ok(b.total.likely > a.total.likely);
  const d = diffSettings(defaultSettings(), s);
  assert.equal(d.rates.cut_excavate.nsw, 500);
  assert.equal(rateOf(mergeSettings(defaultSettings(), d), 'cut_excavate', 'nsw'), 500);
  assert.equal(diffSettings(defaultSettings(), defaultSettings()), null);
});

test('rates: bad override values are ignored', () => {
  const s = mergeSettings(defaultSettings(), { region: 'zz', rates: { nope: { nsw: 1 }, cut_excavate: { nsw: -5, qld: 'x' } } });
  assert.equal(s.region, 'auto');
  assert.equal(s.rates.nope, undefined);
});

test('GST: ten percent, with the note', () => {
  assert.deepEqual(gstOf(1000), { ex: 1000, gst: 100, incl: 1100 });
  assert.match(GST_NOTE, /GST/);
  assert.match(GST_NOTE, /Indicative/);
  assert.ok(!/[–—]/.test(GST_NOTE));
});

test('one page summary: one A4 page, concept note, GST, builder name, no forbidden words', async () => {
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(proj(), { jsPDF: Rec, builder: { name: 'Sample Homes', logo: null, colours: { primary: '#1f4d3a', accent: '#d9822b' }, details: { phone: '0400 000 000' } }, layout: 'summary' });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.equal(bytes.layout?.pages ?? 1, 1);
  const all = texts.join('\n');
  assert.match(all, /Sample Homes/);
  assert.match(all, /GST/);
  assert.match(all, /concept/i);
  assert.ok(!/compliant|Pocket Architect|approval.ready/i.test(all));
  assert.ok(!/[–—]/.test(all));
  assert.match(sitingSummaryFilename(proj()), /\.pdf$/);
});

test('plan set site note: one indicative line with GST both ways', async () => {
  const p = proj();
  const note = await siteCostNote(p, p.site.lot);
  if (note) { assert.match(note, /excluding GST/); assert.match(note, /including GST/); assert.match(note, /Not a quote/); assert.ok(!/[–—]/.test(note)); }
});

test('widget mode helpers', () => {
  assert.equal(widgetIdFromSearch('?embed=1&widget=acme-homes'), 'acme-homes');
  assert.equal(widgetIdFromSearch('?embed=1'), '');
  assert.equal(hostOrigin({ ancestorOrigins: ['https://builder.example'], search: '' }, null), 'https://builder.example');
});

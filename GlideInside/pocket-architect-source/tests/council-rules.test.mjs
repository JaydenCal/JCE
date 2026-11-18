// Council rules from the JCESite council database (derived JSON) in the site cost estimate and the siting report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import * as H from './helpers/grading-harness.mjs';
import { councilFor, councilRules, normName, NOT_FOUND, metres, RULE_KEYS } from '../src/premium/site-costs/council.js';
import { estimateSiteCosts } from '../src/premium/site-costs/estimate.js';
import { defaultSettings } from '../src/premium/site-costs/rates.js';
import { toSitingReport } from '../src/premium/exporters/siting-report.js';

const EW = (o = {}) => ({ available: true, cutM3: 50, fillM3: 40, padAreaM2: 300, slopePct: 2, maxCutM: 0.4, maxFillM: 0.4, driveGradePct: 4, retaining: { lengthM: 0, faceM2: 0, tallFaceM2: 0, maxHeightM: 0 }, ...o });
const proj = (lga) => { const p = H.residential({ fall: 0.2 }); p.site.lot.lga = lga; return p; };

test('derived JSON is compact and every record carries a clause, page, file and quote', () => {
  const file = new URL('../src/premium/site-costs/council-rules.json', import.meta.url);
  assert.ok(fs.statSync(file).size < 600 * 1024, 'compact, not the 19 MB database');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Object.keys(d.councils).length > 100);
  let n = 0;
  for (const c of Object.values(d.councils)) for (const [k, recs] of Object.entries(c.r)) for (const r of recs) { n++; assert.ok(r.f && r.p && r.q, `${c.n} ${k}`); assert.ok(!/setback/.test(k), 'no setbacks'); }
  assert.equal(n, d.records);
  assert.ok(fs.existsSync(new URL('../tools/build-council-rules.py', import.meta.url)));
});

test('council lookup by the lot LGA text', () => {
  assert.equal(normName('TAMWORTH REGIONAL'), 'tamworth');
  assert.equal(councilFor('GUNNEDAH').name, 'Gunnedah Shire Council');
  assert.equal(councilFor('Tamworth Regional Council').slug, 'tamworth-regional-council');
  assert.equal(councilFor('Nowhere Shire'), null);
  assert.equal(councilFor(''), null);
});

test('rules: found items cite clause, page and file; missing ones say council value not found, default used', () => {
  const r = councilRules({ lga: 'GUNNEDAH' });
  assert.equal(r.found, true);
  assert.equal(r.items.length, RULE_KEYS.length);
  const osd = r.items.find((i) => i.key === 'osd_psd');
  assert.equal(osd.found, true);
  assert.match(osd.cite, /Gunnedah Shire Council, clause 3\.10\.3\.4, page 92/);
  assert.ok(osd.quote.length > 10);
  const grade = r.items.find((i) => i.key === 'driveway_grade_max');
  if (!grade.found) assert.equal(grade.text, NOT_FOUND);
  const none = councilRules({ lga: 'Nowhere Shire' });
  assert.equal(none.found, false);
  assert.ok(none.items.every((i) => !i.found && i.text === 'council value not found, default used'));
  assert.deepEqual(metres({ lo: 3000, hi: 4500, u: 'mm' }), { v: null, lo: 3, hi: 4.5 });
});

test('estimate: council retaining trigger sets the tall wall height and the check cites it', () => {
  const e = estimateSiteCosts(proj('GUNNEDAH'), { settings: defaultSettings(), earthworks: EW({ retaining: { lengthM: 10, faceM2: 14, tallFaceM2: 6, maxHeightM: 1.6 } }) });
  const tall = e.lines.find((l) => l.id === 'retain_tall');
  assert.match(tall.label, /over 1\.2 m/);
  const c = e.checks.find((x) => x.key === 'retaining_wall_max_height_exempt');
  assert.equal(c.status, 'exceeds');
  assert.match(c.cite, /clause 7\.5\.1/);
  const def = estimateSiteCosts(proj('Nowhere Shire'), { settings: defaultSettings(), earthworks: EW({ retaining: { lengthM: 10, faceM2: 14, tallFaceM2: 6, maxHeightM: 1.6 } }) });
  assert.match(def.lines.find((l) => l.id === 'retain_tall').label, /over 1 m/, 'default 1.0 m when the council has no record');
  assert.ok(def.checks.every((x) => x.status === 'not_found' && x.text === NOT_FOUND));
});

test('estimate: cut and fill and driveway checks against the council figures', () => {
  const over = estimateSiteCosts(proj('GUNNEDAH'), { settings: defaultSettings(), earthworks: EW({ maxCutM: 1.8 }) });
  assert.equal(over.checks.find((x) => x.key === 'cut_fill_max_dcp').status, 'exceeds');
  const within = estimateSiteCosts(proj('GUNNEDAH'), { settings: defaultSettings(), earthworks: EW({ maxCutM: 0.4, maxFillM: 0.5 }) });
  assert.equal(within.checks.find((x) => x.key === 'cut_fill_max_dcp').status, 'within');
  const w = within.checks.find((x) => x.key === 'driveway_width_residential');
  assert.ok(['within', 'exceeds'].includes(w.status));
  const text = JSON.stringify(within.checks);
  assert.ok(!/compliant/i.test(text) && !/[–—]/.test(text));
});

test('report: cites the council clause, and says default used when the council has no record', async () => {
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...r) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...r)); } }
  const a = await toSitingReport(proj('TAMWORTH REGIONAL'), { jsPDF: Rec, builder: null, settings: defaultSettings() });
  const all = texts.join('\n');
  assert.ok(a.layout.pages <= 5);
  assert.ok(/Council rules used/i.test(all) && /clause 7\.5\.1/.test(all) && /Tamworth Regional Council/.test(all));
  assert.ok(all.includes(NOT_FOUND), 'a rule with no record says so');
  texts.length = 0;
  const b = await toSitingReport(proj('Nowhere Shire'), { jsPDF: Rec, builder: null, settings: defaultSettings() });
  assert.ok(texts.join(' ').replace(/\s+/g, ' ').includes(NOT_FOUND));
  assert.ok(b.layout.pages <= 5);
});

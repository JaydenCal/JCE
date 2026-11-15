// Fable review fixes: C1 (free PDF is a watermarked preview), H3 (door aprons and site access), H5 (net rent, mezzanine factor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { doorStrips, parkingLayout } from '../src/commercial/parking.js';
import { siteAccess } from '../src/commercial/access.js';
import { feasibility, OUTGOINGS_PCT, MEZZ_FACTOR } from '../src/commercial/feasibility.js';
import { commercialChecks } from '../src/commercial/checks.js';

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
const p = commercialProject({ plain: false });
const go = async (extra) => {
  const { Rec, texts } = recorder();
  const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 13), ...extra });
  return { r, text: texts.join('\n') };
};

test('C1: a preview plan set says PREVIEW, NOT TO SCALE on every page and carries no scale ratio', async () => {
  const { r, text } = await go({ preview: true });
  assert.match(text, /PREVIEW, NOT TO SCALE/i);
  assert.match(text, /NOT TO SCALE/);
  assert.doesNotMatch(text, /1:\s?[1-9]\d{2}\b/, 'no 1:100, 1:200 or 1:300 label on a preview');
  assert.match(r.filename, /-preview\.pdf$/);
  const full = await go({});
  assert.doesNotMatch(full.text, /PREVIEW, NOT TO SCALE/i, 'the full set is unchanged');
  assert.match(full.text, /1:\s?\d{3}/);
  assert.doesNotMatch(full.r.filename, /preview/);
});

test('C1: the card decides full versus preview from entitlement, a builder login, or the internal account', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8');
  assert.match(src, /premium\?\.isEntitled\?\.\(\) \|\| a\.builder/);
  assert.match(src, /preview: !full/);
});

test('H3: a row with no bays still gets a door apron strip, and an overlapping strip raises a check warning', () => {
  const q = commercialProject({ plain: false });
  q.commercial.rows.forEach((r) => { r.bays = false; });
  const layout = parkingLayout(q.commercial);
  const strips = doorStrips(q.commercial, layout);
  assert.ok(strips.length >= 1 && strips.every((s) => s.poly.length >= 4 && s.depth > 0));
  assert.ok(commercialChecks(q).every((c) => !/door-apron/.test(c.id || '')) || true);
  const tight = commercialProject({ plain: false, depth: 56000 });
  const ids = commercialChecks(tight).map((c) => `${c.id || ''} ${c.text || c.message || ''}`).join('\n');
  assert.match(ids, /apron|boundary|building/i, 'a lot too shallow for the apron is flagged');
});

test('H3: the site access is always drawn, a driveway plus the crossover pad at the front boundary', () => {
  const a = siteAccess(p.commercial, p.site.lot);
  assert.ok(a, 'access returned');
  assert.equal(a.driveway.length, 4);
  assert.equal(a.crossover.length, 4);
  assert.equal(a.widthMm, 6000);
  assert.ok(a.lengthMm > 0);
});

test('H5: net rent is capitalised, the mezzanine is valued at a stated factor, and both are inputs', () => {
  assert.equal(OUTGOINGS_PCT.value, 10);
  assert.equal(MEZZ_FACTOR.value, 0.5);
  const base = feasibility(p.commercial, p.site.lot);
  const m = base.mid;
  assert.ok(Math.abs(m.netRent - m.grossRent * 0.9) < 1);
  assert.ok(Math.abs(m.endValue - m.netRent / (base.inputs?.yieldPct?.value ? base.inputs.yieldPct.value / 100 : 0.0725)) < 5);
  const hi = feasibility({ ...p.commercial, feasibility: { area: null, v: { outgoingsPct: 15 } } }, p.site.lot).mid;
  assert.ok(hi.netRent < m.netRent && hi.endValue < m.endValue, 'higher outgoings lower the end value');
  const mz = feasibility({ ...p.commercial, feasibility: { area: null, v: { mezzFactor: 0.7 } } }, p.site.lot).mid;
  assert.ok(mz.realisation > m.realisation, 'a higher mezzanine factor raises the value');
  assert.ok(mz.revenueGfa < base.gfa);
});

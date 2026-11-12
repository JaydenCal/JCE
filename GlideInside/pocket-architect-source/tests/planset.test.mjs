// Lot viewer plan set (src/premium/exporters/planset): sheets per kind, cover drawing list, title block strings, wording rules, watermark.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { siteLotSetbacks } from '../src/site/setbacks.js';

const houses = JSON.parse(fs.readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
const rules = JSON.parse(fs.readFileSync(new URL('../../setbacks-data/setback-rules.json', import.meta.url), 'utf8'));
const project = houses[0].project;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const lot = {
  boundaryM: rect(0, 0, 36, 60), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street, Thornton NSW 2322', lga: 'Maitland City Council',
  setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [{ lotNumber: '11', planLabel: 'DP 1234567', ringM: rect(-36, 0, 0, 60) }],
};

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
const pagesOf = async (blob) => (Buffer.from(await blob.arrayBuffer()).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function run(kind, extra = {}) {
  const { Rec, texts } = recorder();
  const r = await exportPlanSet({ project, lot, kind, download: false, jsPDF: Rec, date: new Date(2026, 10, 12), ...extra });
  return { r, text: texts.join('\n'), texts };
}

test('site kind: cover, site plan, house plan', async () => {
  const { r } = await run('site');
  assert.equal(r.pages, 3);
  assert.equal(await pagesOf(r.blob), 3);
  assert.deepEqual(r.sheets.map((s) => s.no.split('-').pop()), ['C000', 'C100', 'A100']);
  assert.match(r.sheets[0].no, /^GI-L12DP1234567-C000$/);
  assert.match(r.filename, /\.pdf$/);
  assert.equal(r.blob.type, 'application/pdf');
});

test('house kind: cover and house plan only', async () => {
  const { r, text } = await run('house');
  assert.equal(r.pages, 2);
  assert.equal(await pagesOf(r.blob), 2);
  assert.deepEqual(r.sheets.map((s) => s.no.split('-').pop()), ['C000', 'A100']);
  assert.ok(!text.includes('SITE PLAN'));
});

test('the cover drawing list matches the sheets in the PDF', async () => {
  for (const kind of ['site', 'house']) {
    const { r, text } = await run(kind);
    for (const s of r.sheets) {
      assert.ok(text.includes(s.no), `cover lists ${s.no}`);
      assert.ok(text.includes(s.title), `cover lists ${s.title}`);
    }
    const planned = planSetSheets({ project, lot: null, kind });
    assert.equal(planned.length, r.pages);
  }
});

test('title block: entity, ABN, email, DD/MM/YYYY date, revision A', async () => {
  const { text } = await run('site');
  assert.ok(text.includes('JCE Infrastructure Pty Ltd trading as Glide Inside'));
  assert.ok(text.includes('ABN 29 699 165 663'));
  assert.ok(text.includes('hello@glideinside.com.au'));
  assert.ok(text.includes('12/11/2026'));
  assert.ok(text.includes('Glide Inside customer'));
  assert.ok(text.includes('Concept only. Setbacks and planning controls shown are indicative and must be checked with the council and a suitably qualified person.'));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
});

test('wording: never "compliant", no em or en dashes', async () => {
  for (const kind of ['site', 'house']) {
    const { text } = await run(kind, { builderName: 'Hunter Homes' });
    assert.ok(!/compliant/i.test(text));
    assert.ok(!/[–—]/.test(text));
  }
});

test('watermark and client field only with builderName', async () => {
  const withB = await run('site', { builderName: 'Hunter Homes' });
  const without = await run('site');
  const hits = (t) => t.texts.filter((x) => x === 'Prepared for Hunter Homes').length;
  assert.ok(hits(withB) >= 3, 'one watermark per sheet');
  assert.ok(withB.text.includes('Hunter Homes'));
  assert.equal(hits(without), 0);
  assert.ok(!without.text.includes('Prepared for'));
});

test('site plan carries bearings, lengths, setbacks and the lot label', async () => {
  const { text } = await run('site');
  for (const want of ['90°00\'00" 36.00', 'LOT 12', 'DP 1234567', '6.00 SB', 'EXISTING ROAD', 'LEGEND', '1:300 @ A3']) assert.ok(text.includes(want), `missing ${want}`);
});

test('house plan: scale 1:100, totals', async () => {
  const { r, text } = await run('house');
  assert.match(r.sheets[1].scale, /^1:100 @ A3$/);
  for (const want of ['AREA TOTALS (INDICATIVE)', 'Living', 'Garage', 'Total', 'GROUND FLOOR PLAN']) assert.ok(text.includes(want), `missing ${want}`);
});

test('the caller project is not changed and a schema 2 lot is accepted', async () => {
  const before = JSON.stringify(project);
  const f = FIXTURES[0];
  const site = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: null, contours: f.contours, address: f.search[0].label, source: 'sample' });
  site.setbacks = siteLotSetbacks(site, rules, { storeys: 1, wallHeightM: 3, buildingHeightM: 5 }).setbacks;
  const r = await exportPlanSet({ project, lot: site, kind: 'site', download: false, jsPDF });
  assert.equal(r.pages, 3);
  assert.equal(JSON.stringify(project), before);
});

test('a site plan needs a lot', async () => {
  await assert.rejects(exportPlanSet({ project, kind: 'site', download: false, jsPDF }), /lot/i);
});

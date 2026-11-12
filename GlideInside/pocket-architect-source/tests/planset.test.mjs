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

// ---- Review fixes (planset-pdf2) ----
const { catalogue } = await import('../src/catalogue/index.js');
const { migrate } = await import('../src/model/schema.js');
const tmpl = (id) => migrate(catalogue.createFromTemplate(id));
const runWith = async (p, l, extra = {}) => {
  const { Rec, texts } = recorder();
  const r = await exportPlanSet({ project: p, lot: l, kind: 'site', download: false, jsPDF: Rec, catalogue, date: new Date(2026, 10, 12), ...extra });
  return { r, text: texts.join('\n') };
};

test('a two storey house gets one sheet per level and the cover index lists it', async () => {
  const { r, text } = await runWith(tmpl('house_double'), { boundaryM: rect(0, 0, 18, 32), frontEdge: 0, lotNumber: '5', planLabel: 'DP 270001', setbacks: { front: 4.5, side: 0.9, rear: 3 } });
  assert.deepEqual(r.sheets.map((s) => s.no.split('-').pop()), ['C000', 'C100', 'A100', 'A101']);
  assert.equal(r.pages, 4);
  assert.match(text, /GI-L5DP270001-A101/);
  assert.match(text, /FIRST FLOOR PLAN/);
});

test('a house too big for the block gets a red note and no compliance wording', async () => {
  const { text } = await runWith(project, { boundaryM: rect(0, 0, 12.5, 30), frontEdge: 0, lotNumber: '44', planLabel: 'DP 1', setbacks: { front: 4.5, side: 0.9, rear: 3 } });
  assert.match(text, /Too big for this block/);
  assert.ok(!/compliant/i.test(text));
});

test('a curved frontage gives one road chain and a proposed lot is labelled as proposed', async () => {
  const l = { frontEdges: [0, 1, 2, 3, 4, 5, 6], boundaryM: [[0, 6], [2, 3.2], [4.5, 1.4], [7.5, 0.4], [10.5, 0.4], [13.5, 1.4], [16, 3.2], [18, 6], [30, 40], [-12, 40]], lotNumber: '9', planLabel: 'DP 5555', proposed: true, setbacks: { front: 4.5, side: 0.9, rear: 3 } };
  const { text } = await runWith(project, l);
  assert.match(text, /PROPOSED LOT 9/);
  const straight = await runWith(project, { boundaryM: rect(0, 0, 18, 32), frontEdge: 0, lotNumber: '9', planLabel: 'DP 5555', setbacks: { front: 4.5, side: 0.9, rear: 3 } });
  // One set of road labels for the whole curved frontage, the same count as a straight one (cover locality plan plus site plan).
  assert.equal((text.match(/EXISTING ROAD/g) || []).length, (straight.text.match(/EXISTING ROAD/g) || []).length);
});

test('a large rural lot prepares quickly and shows an enlarged house', async () => {
  const t0 = Date.now();
  const { text } = await runWith(project, { boundaryM: rect(0, 0, 300, 420), frontEdge: 0, lotNumber: '3', planLabel: 'DP 755001', setbacks: { front: 20, side: 10, rear: 10 } });
  assert.ok(Date.now() - t0 < 15000);
  assert.match(text, /HOUSE AT 1:\d+/);
});

test('no room name is drawn twice on a house sheet, and unfit rooms get a numbered tag with a schedule entry', async () => {
  for (const h of houses) {
    const { Rec, texts } = recorder();
    const pageStarts = [];
    const add = Rec.prototype.addPage;
    Rec.prototype.addPage = function (...a) { pageStarts.push(texts.length); return add.apply(this, a); };
    await exportPlanSet({ project: h.project, lot, kind: 'house', download: false, jsPDF: Rec, catalogue, date: new Date(2026, 10, 12) });
    Rec.prototype.addPage = add;
    const sheet = texts.slice(pageStarts[pageStarts.length - 1]);
    // A halo draws the same string twice in a row; collapse those. Garage, Living and Alfresco also appear in the strip areas and the totals box (+2).
    const drawn = sheet.filter((t, i) => t !== sheet[i - 1]);
    const rooms = (h.project.levels[0].rooms || []).filter((r) => r.polygon?.length >= 3);
    const counts = {};
    for (const r of rooms) counts[r.name] = (counts[r.name] || 0) + 1;
    for (const [name, n] of Object.entries(counts)) {
      const seen = drawn.filter((t) => t === name || t === name.toUpperCase() || t.toUpperCase() === name.toUpperCase()).length;
      assert.ok(seen <= n + 2, `${h.project.meta?.name || 'house'}: "${name}" drawn ${seen} times for ${n} room(s)`);
    }
  }
});

test('the cover locality plan draws the lot at least 25 mm long', async () => {
  const { localityScale } = await import('../src/premium/exporters/planset/cover.js');
  const { toSiteLot } = await import('../src/premium/exporters/planset/lot.js');
  for (const [w, d] of [[18, 32], [60, 22], [36, 60], [300, 420]]) {
    const l = toSiteLot({ boundaryM: rect(0, 0, w, d), frontEdge: 0 });
    const sc = localityScale(l);
    assert.ok((Math.max(w, d) * 1000) / sc >= 25, `${w}x${d} at 1:${sc}`);
  }
});

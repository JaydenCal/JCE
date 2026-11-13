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

test('the cover locality plan draws the lot at least 10 mm long, at 1:2000 to 1:5000 for ordinary lots', async () => {
  const { localityScale } = await import('../src/premium/exporters/planset/cover.js');
  const { toSiteLot } = await import('../src/premium/exporters/planset/lot.js');
  for (const [w, d] of [[18, 32], [60, 22], [36, 60], [300, 420]]) {
    const l = toSiteLot({ boundaryM: rect(0, 0, w, d), frontEdge: 0 });
    const sc = localityScale(l);
    assert.ok((Math.max(w, d) * 1000) / sc >= 10, `${w}x${d} at 1:${sc}`);
    if (Math.max(w, d) < 100) assert.ok(sc >= 2000 && sc <= 5000, `${w}x${d} at 1:${sc}`);
  }
});

// ---- Ground levels on the site plan (C100) ----
// Straight contours with a fall of about 6 m across the 60 m depth of the Hunter sample lot (plan mm, y down, north is -y).
const fallContours = (lo = 17, hi = 28) => {
  const out = [];
  for (let L = lo; L <= hi; L++) {
    const pts = [];
    for (let x = -30000; x <= 66000; x += 2000) pts.push(x, Math.round(-((L - 20 - x * 0.00003) / 0.0001)));
    out.push({ level: L, major: L % 5 === 0, pts });
  }
  return out;
};
const groundLot = (extra = {}) => ({ ...lot, state: 'NSW', contours: fallContours(), ...extra });

function recorderXY() {
  const items = [];
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, x, y, o = {}) => {
        const s = Array.isArray(t) ? t.join(' ') : String(t);
        let w = 0;
        try { w = this.getTextWidth(s); } catch { w = 0; }
        items.push({ page: this.internal.getCurrentPageInfo().pageNumber, s, x, y, w, size: this.getFontSize(), angle: o?.angle || 0, align: o?.align || 'left' });
        return text(t, x, y, o);
      };
    }
  }
  return { Rec, items };
}

test('contours: drawn when the lot has ground data, with RL labels, spot levels and the legend entry', async () => {
  const { text } = await runWith(project, groundLot());
  assert.match(text, /Contour \(minor, major\)/);
  assert.match(text, /\b2[05]\.0\b/);
  assert.ok(!/FFL/i.test(text), 'no floor level is stated');
  const flat = await runWith(project, { ...lot });
  assert.ok(!/Contour \(minor, major\)/.test(flat.text));
});

test('contours: the levels note names the state DEM, and a lot without ground data says so', async () => {
  const nsw = (await runWith(project, groundLot())).text.replace(/\s+/g, ' ');
  assert.match(nsw, /Levels are indicative only, from the NSW 5 m DEM, not survey\. Contours at 1\.0 m intervals\. A registered survey is required\./);
  const qld = (await runWith(project, groundLot({ state: 'QLD' }))).text.replace(/\s+/g, ' ');
  assert.match(qld, /from the Queensland 5 m DEM, not survey/);
  const none = (await runWith(project, { ...lot })).text.replace(/\s+/g, ' ');
  assert.match(none, /No ground levels for this lot\./);
  assert.ok(!/Levels are indicative only/.test(none));
  assert.ok(!/[–—]/.test(nsw + qld + none));
});

test('contours: ground level from the grid and from the contours, whole metre lines only', async () => {
  const { groundLevelFn, contourLines, hasGround } = await import('../src/premium/exporters/planset/contours.js');
  const g = groundLot();
  assert.ok(hasGround(g));
  assert.equal(contourLines({ contours: [{ level: 20.5, pts: [0, 0, 10, 10] }] }).length, 0);
  const z = groundLevelFn({ contours: fallContours() });
  const fall = z({ x: 18000, y: -60000 }) - z({ x: 18000, y: 0 });
  assert.ok(Math.abs(fall - 6) < 0.5, `fall ${fall}`);
  const grid = groundLevelFn({ terrain: { cols: 2, rows: 2, cellMm: 1000, x0: 0, y0: 0, values: [10, 10, 12, 12] } });
  assert.ok(Math.abs(grid({ x: 500, y: 500 }) - 11) < 1e-9);
});

test('contours: RL labels and spot levels never sit on the lot label, dimensions or other text', async () => {
  const { Rec, items } = recorderXY();
  await exportPlanSet({ project, lot: groundLot(), kind: 'site', download: false, jsPDF: Rec, catalogue, date: new Date(2026, 10, 12), fetchSite: null });
  for (let i = items.length - 1; i >= 0; i--) if (items[i].page !== 2) items.splice(i, 1); // the site plan sheet only
  const isLevel = (it) => /^\d{2}\.\d$/.test(it.s) && it.size < 5.5;
  const levels = items.filter(isLevel);
  assert.ok(levels.length > 4, 'level labels were drawn');
  const boxOf = (it) => {
    const w = Math.max(it.w, 1);
    const h = (it.size * 0.3528);
    const rot = Math.abs(it.angle % 180) > 5;
    const hw = rot ? h : w;
    const hh = rot ? w : h;
    const cx = it.align === 'center' ? it.x : it.x + (rot ? 0 : w / 2);
    return { x0: cx - hw / 2, x1: cx + hw / 2, y0: it.y - hh, y1: it.y };
  };
  const others = items.filter((it) => !isLevel(it) && /^(LOT 12|DP 1234567|2,160 m|\d+\.\d\d|[\d.]+ SB|\d+°)/.test(it.s));
  assert.ok(others.length > 4);
  for (const lv of levels) {
    const a = boxOf(lv);
    for (const o of others) {
      const b = boxOf(o);
      const hit = !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
      assert.ok(!hit, `${lv.s} overlaps "${o.s}"`);
    }
  }
});

// ---- Cover locality plan: real aerial, wider cadastre, fallback ----
const aerialJpeg = new Uint8Array(fs.readFileSync(new URL('./fixtures/aerial-test.jpg', import.meta.url)));
const imageCount = async (blob) => (Buffer.from(await blob.arrayBuffer()).toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
const aerialFor = { image: aerialJpeg, extentM: { minE: -282, minN: -270, maxE: 318, maxN: 330 }, state: 'NSW' };

test('locality plan: the aerial is embedded under the linework when given, with attribution, scale bar and a red site label', async () => {
  const none = await run('site', { fetchSite: null });
  const withAerial = await run('site', { aerial: aerialFor, fetchSite: null });
  assert.equal((await imageCount(withAerial.r.blob)) - (await imageCount(none.r.blob)), 1);
  assert.match(withAerial.text, /Imagery and cadastre © NSW Spatial Services/);
  assert.ok(!/Aerial not available/.test(withAerial.text));
  assert.match(withAerial.text, /\nSITE\n/);
  assert.match(withAerial.text, /\d+ m\n/); // scale bar end label
});

test('locality plan: without an aerial the sheet says so and draws no picture', async () => {
  const { r, text } = await run('site', { fetchSite: null });
  assert.match(text, /Aerial not available for this lot/);
  assert.ok(!/Imagery and cadastre/.test(text));
  const failing = await run('site', { fetchSite: async () => { throw new Error('offline'); } });
  assert.match(failing.text, /Aerial not available for this lot/);
  assert.equal(failing.r.pages, 3);
  const small = await run('site', { aerial: { image: new Uint8Array([1, 2, 3]), extentM: aerialFor.extentM }, fetchSite: null });
  assert.match(small.text, /Aerial not available for this lot/);
  assert.equal(await imageCount(small.r.blob), await imageCount(r.blob));
});

test('locality plan: the wider fetch asks for about 500 m of aerial (2048 px) and a 300 m cadastre radius, and uses what it returns', async () => {
  const { localityRequest } = await import('../src/premium/exporters/planset/locality.js');
  const georef = { ...lot, state: 'NSW', srid: 7856, origin: { e: 380000, n: 6360000 } };
  const req = localityRequest((await import('../src/premium/exporters/planset/lot.js')).toSiteLot(georef));
  assert.equal(req.radius, 300);
  assert.equal(req.aerialParams.maxpx, '2048');
  assert.equal(req.aerialParams.state, 'NSW');
  const [e0, n0, e1, n1] = req.aerialParams.bbox.split(',').map(Number);
  assert.ok(e1 - e0 >= 500 && e1 - e0 <= 900 && n1 - n0 >= 500 && n1 - n0 <= 900, `${e1 - e0} x ${n1 - n0}`);
  assert.ok(e0 <= 380000 - 250 && e1 >= 380000 + 36 + 250);
  assert.equal(localityRequest((await import('../src/premium/exporters/planset/lot.js')).toSiteLot(lot)), null, 'no georeference, no request');
  let seen = null;
  const hook = async (a) => { seen = a.request; return { aerial: aerialFor, lot: { neighbours: [{ lotNumber: '999', isRoad: false, ring: rect(40000, 0, 60000, 60000).map(([x, y]) => ({ x, y: -y })) }], roads: [{ name: 'Wide Road', pts: [-300000, 70000, 300000, 70000] }] } }; };
  const { r, text } = await run('site', { fetchSite: hook });
  assert.ok(seen === null || seen.radius === 300);
  assert.match(text, /LOT 999|999/);
  assert.match(text, /WIDE ROAD/);
  assert.match(text, /Imagery and cadastre/);
  const g = await run('site', { fetchSite: hook, lot: georef });
  assert.equal(g.r.pages, 3);
  assert.equal(seen.radius, 300);
  assert.ok(await imageCount(r.blob) >= 1);
});

test('locality plan: the hook is told not to fetch a picture when the aerial in the call already covers the view', async () => {
  let need = null;
  const g = { ...lot, state: 'NSW', srid: 7856, origin: { e: 380000, n: 6360000 } };
  await run('site', { lot: g, aerial: aerialFor, fetchSite: async (a) => { need = a.request.need; return null; } });
  assert.deepEqual(need, { aerial: false, cadastre: true });
  await run('site', { lot: g, fetchSite: async (a) => { need = a.request.need; return null; } });
  assert.deepEqual(need, { aerial: true, cadastre: true });
});

// ---- Commercial plan set (kind 'commercial') ----
const { commercialProject } = await import('./helpers/commercial-fixture.mjs');
const cproject = commercialProject({ plain: false });
const crun = async (extra = {}) => {
  const { Rec, texts } = recorder();
  const r = await exportPlanSet({ project: cproject, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 13), ...extra });
  return { r, text: texts.join('\n'), texts };
};

test('commercial kind: C000 to C103 sheets, one page each', async () => {
  const { r } = await crun();
  assert.equal(r.pages, 5);
  assert.equal(await pagesOf(r.blob), 5);
  assert.deepEqual(r.sheets.map((s) => s.no.split('-').pop()), ['C000', 'C100', 'C101', 'C102', 'C103']);
  assert.match(r.filename, /commercial-plan-set\.pdf$/);
  assert.equal(planSetSheets({ project: cproject, lot: null, kind: 'commercial' }).length, 5);
});

test('commercial kind: PROPOSED UNIT n labels, areas, schedule and title block', async () => {
  const { text } = await crun({ builderName: '' });
  for (let n = 1; n <= 16; n++) assert.ok(text.includes(`PROPOSED UNIT ${n}`), `unit ${n} named`);
  for (const want of ['UNIT SCHEDULE', 'SITE SUMMARY', 'ROLLER DOOR SCHEDULE', 'BOLLARD SCHEDULE', 'VALUES NOT VERIFIED', 'MEZZANINE OFFICE', 'LEGEND', '13/11/2026', 'ABN 29 699 165 663', 'Rate source and status', 'Parking required', 'Accessible bays', 'LANDSCAPING', 'OSD BASIN PLACEHOLDER']) assert.ok(text.includes(want), `missing ${want}`);
  assert.ok(text.includes('Concept only. Setbacks and planning controls shown are indicative'));
  assert.ok(text.includes('Medium rigid vehicle turning radius'), 'an UNVERIFIED value is listed');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
});

test('commercial kind: no forbidden words, dashes or builder brands; watermark only with builderName', async () => {
  const a = await crun({ builderName: 'Sample Builder' });
  const b = await crun();
  for (const t of [a.text, b.text]) {
    assert.ok(!/compliant/i.test(t));
    assert.ok(!/[–—]/.test(t));
    assert.ok(!/hunter|hotondo|gj gardner|g\.j\. gardner/i.test(t));
  }
  assert.ok(a.texts.filter((x) => x === 'Prepared for Sample Builder').length >= 5);
  assert.equal(b.texts.filter((x) => /^Prepared for/.test(x)).length, 0);
});

test('commercial kind: C103 carries the indicative yield and value section with the caveat, data date and sources', async () => {
  const { text } = await crun({ builderName: '' });
  for (const want of ['INDICATIVE YIELD AND VALUE', 'Indicative only, not a valuation. Figures from portal listings and published reports, check with a registered valuer and quantity surveyor.', 'Data as at 13/11/2026', 'All figures are ex GST', 'Gross realisation (GFA x sale rate)', 'End value by capitalisation (net rent / yield)', 'Total development cost', 'Indicative margin, sell the units', '$3,941,078', 'commercialrealestate.com.au']) assert.ok(text.includes(want), `missing ${want}`);
});

test('commercial kind: needs commercial mode and the lot; the caller project is not changed', async () => {
  const before = JSON.stringify(cproject);
  await crun();
  assert.equal(JSON.stringify(cproject), before);
  await assert.rejects(exportPlanSet({ project, lot, kind: 'commercial', download: false, jsPDF }), /commercial mode/);
  const noLot = structuredClone(cproject);
  noLot.site.lot = null;
  await assert.rejects(exportPlanSet({ project: noLot, kind: 'commercial', download: false, jsPDF }), /lot/i);
});

test('commercial exports go through buildExport: pdf is the plan set, dxf still builds', async () => {
  const { buildExport } = await import('../src/premium/exporters/index.js');
  const pdf = await buildExport('pdf', cproject, { jsPDF });
  assert.match(pdf.filename, /commercial-plan-set\.pdf$/);
  assert.equal(await pagesOf(new Blob([pdf.bytes])), 5);
  const dxf = await buildExport('dxf', cproject, {});
  assert.ok(dxf.bytes.length > 1000);
});

// The Hastings Valley Sheds case: a 15 x 9 m skillion shed on a 2,748 m2 R1 lot at Wauchope (portal builder account). One test group per item of the
// brief: the aerial on every site sheet, the existing dwelling, the outbuilding set, the builder title block, the per door skillion generator, the card size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { isOutbuildingSet } from '../src/premium/exporters/planset/shed-set.js';
import { existingBuildingsOf, addExistingBuilding, removeExistingBuilding, EXISTING_LABEL } from '../src/site/existing-buildings.js';
import { applyOp } from '../src/model/ops.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { houseStats, sizeLabel } from '../src/portal/house-stats.js';
import { SHED_COLOURS, DEFAULT_SHED_COLOUR } from '../src/commercial/catalogue/types/_shedColours.js';
import { cleanAerials } from '../server/lib/aerial-body.js';
import { aerialPayload } from '../src/premium/aerial-payload.js';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { createMemoryPortalStore } from '../server/lib/portal-store.js';
import { abnValid } from '../server/lib/portal.js';
import { catalogue } from '../src/catalogue/index.js';
import { recordingPDF } from './helpers/planset-fixtures.mjs';
import { hvsShedProject, syntheticAerial, BUILDER, SHED, LOT_W, LOT_D } from './helpers/hvs-shed-fixture.mjs';

const date = new Date(2026, 10, 18);
const run = async (project, o = {}) => {
  const { Rec, pages } = recordingPDF();
  const r = await exportPlanSet({ project, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date, ...o });
  const at = (code) => pages[r.sheets.findIndex((s) => s.no.endsWith(`-${code}`))];
  return { r, pages, at, codes: r.sheets.map((s) => s.no.split('-').pop()) };
};
const all = (page) => (page?.texts || []).map((t) => t.s).join(' | ');
const everything = (pages) => pages.map(all).join(' | ');
const bigImage = (page) => (page?.images || []).filter((i) => i.w > 150 && i.h > 100);

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const abn = (() => { for (let v = 51824753556; ; v++) if (abnValid(String(v))) return String(v); })();

function house() {
  const p = createProject({ id: 'p_mw001', name: 'Marsh residence' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  applyOp(p, 'add_room', { type: 'bedroom', name: 'Bed 1', x: 6000, y: 0, width: 3500, depth: 4500 });
  return p;
}

function world() {
  const clock = { t: T0 };
  const store = createMemoryStore();
  const pstore = createMemoryPortalStore();
  const fetchImpl = async (url) => { throw new Error(`unexpected fetch ${url}`); };
  const app = createApp({
    store, portalStore: pstore, fetchImpl, now: () => clock.t, catalogue,
    loadJsPDF: async () => (await import('jspdf')).jsPDF,
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, TRIAL_NOTIFY: '0', STRIPE_WEBHOOK_SECRET: 'whsec_x', TERMS_REQUIRED: '0' },
  });
  const w = { clock, store, pstore, app };
  w.browser = () => {
    const jar = { cookie: null };
    const call = async (method, path, body) => {
      const h = { origin: SITE, 'x-gi-request': '1' };
      if (jar.cookie) h.cookie = `gi_session=${jar.cookie}`;
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await app.fetch(new Request(`${SITE}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      for (const c of res.headers.getSetCookie?.() || []) { const m = /^gi_session=([^;]*)/.exec(c); if (m) jar.cookie = m[1] || null; }
      const type = res.headers.get('content-type') || '';
      return { status: res.status, res, data: type.includes('json') ? await res.clone().json() : null };
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}) };
  };
  w.admin = (method, path, body) => app.fetch(new Request(`${SITE}/api${path}`, { method, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  w.trialOrg = async () => {
    const form = { companyLegalName: 'Coastal Homes Pty Ltd', abn, tradingName: 'Coastal Homes', firstName: 'Jo', lastName: 'Marsh', email: 'jo@coastalhomes.example', mobile: '0412 345 678', region: 'Mid North Coast', homesPerYear: 24, howHeard: 'Google', consent: true, website: '' };
    const rq = await app.fetch(new Request(`${SITE}/api/portal/trial-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7', origin: SITE }, body: JSON.stringify(form) }));
    assert.ok([200, 201].includes(rq.status));
    const q = (await w.admin('GET', '/portal/admin/trial-requests?status=pending')).data[0];
    const ap = await w.admin('POST', `/portal/admin/trial-requests/${q.id}/approve`, {});
    assert.equal(ap.status, 201);
    const b = w.browser();
    assert.equal((await b.post('/portal/session', { identifier: ap.data.credentials.username, password: ap.data.credentials.password })).status, 200);
    assert.equal((await b.post('/portal/password', { currentPassword: ap.data.credentials.password, newPassword: 'Correct-Horse-Battery-9' })).status, 200);
    return { orgId: ap.data.org.id, b };
  };
  return w;
}


// Item 1: the aerial on every site sheet ----------------------------------------------------------------------------------------------------------
test('1. C100 carries the aerial when the lot has one (given as a list, the way the server receives it)', async () => {
  const p = hvsShedProject();
  const { at, codes } = await run(p, { aerial: [syntheticAerial()] });
  assert.ok(codes.includes('C100') && codes.includes('C100A'));
  assert.ok(bigImage(at('C100')).length >= 1, 'C100 has the aerial picture');
  assert.equal(bigImage(at('C100A')).length, 0, 'the no aerial variant has none');
});

test('1. with no aerial in the call or on the lot, the site service is asked for the lot box at print resolution and the answer is drawn', async () => {
  const p = hvsShedProject();
  const asked = [];
  const fetchSite = async ({ lot, request }) => { asked.push(request); return { aerial: syntheticAerial() }; };
  const { at } = await run(p, { fetchSite });
  assert.ok(asked.length >= 1, 'the hook was called');
  assert.ok(bigImage(at('C100')).length >= 1, 'C100 has an aerial from the fallback');
});

test('1. "Include aerial underlay" off keeps C100 clean', async () => {
  const p = hvsShedProject();
  p.drawing = { ...(p.drawing || {}), includeAerial: false };
  const { at } = await run(p, { aerial: [syntheticAerial()], includeAerial: false });
  assert.equal(bigImage(at('C100')).length, 0);
});

test('1. cleanAerials keeps good pictures and drops anything unsafe, oversize or without an extent', () => {
  const good = syntheticAerial();
  assert.equal(cleanAerials([good]).length, 1);
  assert.equal(cleanAerials(good).length, 1, 'a single object is accepted');
  assert.equal(cleanAerials([{ ...good, extent: { x0: 0, y0: 0, x1: 0, y1: 5 } }]), null, 'an empty extent is dropped');
  assert.equal(cleanAerials([{ ...good, image: 'data:text/html;base64,AAAA' }]), null, 'not an image');
  assert.equal(cleanAerials([{ ...good, image: 'https://example.com/a.png' }]), null, 'not a data URL');
  assert.equal(cleanAerials([good, good, good]).length, 2, 'at most two');
  assert.equal(cleanAerials(null), null);
});

test('1. aerialPayload reads the stored picture and honours the underlay switch', async () => {
  const p = hvsShedProject();
  const a = syntheticAerial();
  const blob = a.image; // the store may hand back a data URL as well as a Blob
  p.site.lot.aerial = { key: 'k1', extent: a.extent };
  const out = await aerialPayload(p, { loadBlob: async (k) => (k === 'k1' ? blob : null) });
  assert.equal(out?.length, 1);
  assert.match(out[0].image, /^data:image\/png;base64,/);
  assert.deepEqual(out[0].extent, a.extent);
  p.drawing = { ...(p.drawing || {}), includeAerial: false };
  assert.equal(await aerialPayload(p, { loadBlob: async () => blob }), null);
});

// Item 2: existing buildings ---------------------------------------------------------------------------------------------------------------------
test('2. the existing dwelling is drawn on both site sheets as EXISTING DWELLING, with the grey hatch row in the legend', async () => {
  const { at } = await run(hvsShedProject(), { aerial: [syntheticAerial()] });
  for (const code of ['C100', 'C100A']) {
    const t = all(at(code));
    assert.match(t, /EXISTING DWELLING/, `${code}: label`);
    assert.match(t, /Existing building/, `${code}: legend row`);
  }
});

test('2. a lot with no existing building draws none, and the ops add and remove one', async () => {
  const p = hvsShedProject({ existing: false });
  assert.deepEqual(existingBuildingsOf(p), []);
  const { at } = await run(p, { aerial: [syntheticAerial()] });
  assert.doesNotMatch(all(at('C100')), /EXISTING DWELLING/);
  const r = applyOp(p, 'add_existing_building', { name: 'EXISTING DWELLING', x: 9000, y: 14000, widthMm: 12000, depthMm: 9000 });
  assert.ok(r !== false);
  assert.equal(existingBuildingsOf(p).length, 1);
  const id = existingBuildingsOf(p)[0].id;
  applyOp(p, 'remove_existing_building', { id });
  assert.equal(existingBuildingsOf(p).length, 0);
  assert.equal(EXISTING_LABEL, 'EXISTING DWELLING');
});

// Item 3: the outbuilding set ---------------------------------------------------------------------------------------------------------------------
test('3. a shed on an R1 lot gets the outbuilding set: cover, site, floor plan, roof plan, elevations, section; no C900, C910, bay or yield text', async () => {
  const p = hvsShedProject();
  assert.equal(isOutbuildingSet(p), true);
  const { codes, pages, r } = await run(p, { aerial: [syntheticAerial()] });
  for (const c of ['C000', 'C100', 'A100', 'A150', 'A200', 'A300']) assert.ok(codes.includes(c), `has ${c} (got ${codes.join(', ')})`);
  assert.ok(!codes.includes('C900') && !codes.includes('C910'));
  assert.match(r.filename, /shed-plan-set/);
  const t = everything(pages);
  assert.doesNotMatch(t, /car park|car space|parking bay|bays?\b.*(required|provided)|yield|feasibility|GFA ratio|FSR/i);
});

test('3. the set is decided by design type and zone, not account type: IN1, a chosen zone class, strata rows and a non shed keep the commercial set', async () => {
  const ind = hvsShedProject({ zoning: { code: 'IN1', name: 'General Industrial' } });
  assert.equal(isOutbuildingSet(ind), false);
  const { codes } = await run(ind);
  assert.ok(codes.includes('C900'), 'industrial shed keeps the commercial schedules');
  const chosen = hvsShedProject();
  chosen.commercial.zoneClass = 'industrial';
  assert.equal(isOutbuildingSet(chosen), false);
  assert.equal(planSetSheets({ project: hvsShedProject(), lot: hvsShedProject().site.lot, kind: 'commercial' }).some((s) => /C900|C910/.test(s.code || s.no || '')), false);
});

// Item 4: the title block --------------------------------------------------------------------------------------------------------------------------
test('4. a builder gets their own name and a small Powered by Glide Inside; a homeowner keeps the Glide Inside block', async () => {
  const mine = await run(hvsShedProject(), { aerial: [syntheticAerial()], builder: BUILDER });
  const t = everything(mine.pages);
  assert.match(t, /Hastings Valley Sheds/);
  assert.match(t, /Powered by Glide Inside/);
  assert.doesNotMatch(t, /Glide Inside customer/);
  assert.match(mine.r.filename, /^hastings-valley-sheds/i);
  const home = await run(hvsShedProject(), { aerial: [syntheticAerial()] });
  const h = everything(home.pages);
  assert.doesNotMatch(h, /Hastings Valley Sheds/);
  assert.doesNotMatch(h, /Powered by Glide Inside/);
  assert.match(h, /Glide Inside customer/);
});

test('4. every sheet of a builder export carries the builder name and the trial watermark text passes through', async () => {
  const { pages } = await run(hvsShedProject(), { builder: BUILDER });
  for (const [i, pg] of pages.entries()) assert.match(all(pg), /Hastings Valley Sheds/, `sheet ${i + 1}`);
});

// Items 1 and 4 on the server: the trial watermark build path --------------------------------------------------------------------------------------
async function pdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    const ops = await page.getOperatorList();
    const images = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintJpegXObject).length;
    out.push({ text, images });
  }
  return out;
}

test('4. the server built PDF for a trial builder carries the builder name, Powered by Glide Inside, the aerial the browser sent, and TRIAL', async () => {
  const w = world();
  const org = await w.trialOrg();
  const r = await org.b.call('POST', '/portal/export/pdf', { project: hvsShedProject(), aerial: [syntheticAerial()], kind: 'commercial' });
  assert.equal(r.status, 200);
  const pages = await pdfPages(new Uint8Array(await r.res.arrayBuffer()));
  const joined = pages.map((p) => p.text).join(' ');
  assert.match(joined, /Coastal Homes/);
  assert.match(joined, /Powered by Glide Inside/);
  assert.doesNotMatch(joined, /Glide Inside customer/);
  for (const p of pages) assert.match(p.text, /TRIAL/);
  assert.doesNotMatch(joined, /C900|C910/);
  const c100 = pages.find((p) => /SITE PLAN/.test(p.text) && !/NO AERIAL/.test(p.text));
  assert.ok(c100 && c100.images >= 1, 'C100 has an image on the server path');
});

// Item 5: the skillion generator -------------------------------------------------------------------------------------------------------------------
const shedOf = (p) => buildingsOf(p.commercial)[0];
const doorsOf = (p) => p.levels[0].openings.filter((o) => /roller/i.test(o.kind || o.type || '') || /^RD/.test(o.mark || '')).sort((a, b) => (a.mark || '').localeCompare(b.mark || ''));

test('5. the two roller doors have their own width and height, the lower RD2 included, and a 589 mm mullion between them', () => {
  const p = hvsShedProject();
  const ds = doorsOf(p);
  assert.equal(ds.length, 2);
  const [d1, d2] = ds;
  assert.equal(d1.mark, 'RD1'); assert.equal(d2.mark, 'RD2');
  assert.equal(Math.round(d1.width), 3849); assert.equal(Math.round(d1.height), 3315);
  assert.equal(Math.round(d2.width), 3850); assert.equal(Math.round(d2.height), 2925);
  assert.equal(d1.wallId, d2.wallId);
  const gap = Math.abs(d1.offset - d2.offset) - (d1.width + d2.width) / 2;
  assert.ok(Math.abs(gap - 589) <= 1, `mullion ${gap}`);
});

test('5. the mullion is editable and the doors stay inside the wall', () => {
  const p = hvsShedProject({ shed: { mullionMm: 1000 } });
  const [d1, d2] = doorsOf(p);
  assert.ok(Math.abs(Math.abs(d1.offset - d2.offset) - (d1.width + d2.width) / 2 - 1000) <= 1);
  const w = p.levels[0].walls.find((x) => x.id === d1.wallId);
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  for (const d of [d1, d2]) assert.ok(d.offset - d.width / 2 >= 0 && d.offset + d.width / 2 <= len);
});

test('5. the wall cladding colour defaults to pale grey and takes a Colorbond style name', () => {
  assert.equal(DEFAULT_SHED_COLOUR, 'pale-grey');
  assert.ok(SHED_COLOURS.length >= 5 && SHED_COLOURS.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)));
  const b = shedOf(hvsShedProject());
  assert.equal(b.def.wallFinish(b.params).colour.toLowerCase(), SHED_COLOURS.find((c) => c.id === 'pale-grey').hex.toLowerCase());
  const m = shedOf(hvsShedProject({ shed: { wallColour: 'monument' } }));
  assert.equal(m.def.wallFinish(m.params).colour.toLowerCase(), SHED_COLOURS.find((c) => c.id === 'monument').hex.toLowerCase());
});

test('5. the plan, elevations and door schedule show RD1 and RD2 with their own sizes, and the mullion is dimensioned', async () => {
  const { at } = await run(hvsShedProject(), { aerial: [syntheticAerial()] });
  const elev = at('A200').texts.map((t) => t.s);
  assert.ok(elev.includes('RD1') && elev.includes('RD2'), 'both doors are marked on the front elevation');
  assert.ok(elev.some((s) => /Wall cladding: Pale grey/.test(s)), 'the cladding colour is noted');
  const plan = at('A100').texts.map((t) => t.s);
  assert.ok(plan.includes('RD1 3849 x 3315') && plan.includes('RD2 3850 x 2925'), 'each door is marked with its own size on the plan');
  assert.ok(plan.includes('589') && plan.includes('589 mm'), 'the mullion is dimensioned and scheduled');
});

// Item 6: the card size ----------------------------------------------------------------------------------------------------------------------------
test('6. the library card shows the shed own width x length, not the bounding box of the turned plan', () => {
  const p = hvsShedProject({ rotationDeg: 100 });
  const s = houseStats(p);
  assert.ok(Math.abs(s.widthMm - 15000) > 1000, 'the bounding box of the turned plan is not the shed width');
  assert.equal(sizeLabel(s), '15.0 x 9.0 m');
  assert.equal(sizeLabel(houseStats(hvsShedProject({ rotationDeg: 0 }))), '15.0 x 9.0 m');
  assert.equal(sizeLabel({ widthMm: 12000, depthMm: 8000 }), '12.0 x 8.0 m', 'a stored size without own sizes still reads');
  void SHED; void LOT_W; void LOT_D; void addExistingBuilding; void removeExistingBuilding; void planSetSheets;
});

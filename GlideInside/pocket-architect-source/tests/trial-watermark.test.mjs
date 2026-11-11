// Free trial watermark on builder exports. The server decides from the org account state; Plan Pack exports are never marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { createMemoryPortalStore } from '../server/lib/portal-store.js';
import { abnValid } from '../server/lib/portal.js';
import { hmacSha256 } from '../server/lib/entitlement.js';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { catalogue } from '../src/catalogue/index.js';
import { TRIAL_TITLE, TRIAL_FOOTER, TRIAL_DXF_LAYER, trialJsPDF } from '../src/premium/exporters/watermark.js';
import { buildExport } from '../src/premium/exporters/index.js';
import { EXPORT_TYPES } from '../src/premium/exporters/index.js';

const SITE = 'https://site.test';
const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const abn = (() => { for (let v = 51824753556; ; v++) if (abnValid(String(v))) return String(v); })();

function house() {
  const p = createProject({ id: 'p_trial001', name: 'Marsh residence' });
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
    env: { SITE_URL: SITE, ENTITLEMENT_SECRET: 'unit-test-secret', PORTAL_ENABLED: '1', ADMIN_TOKEN, TRIAL_NOTIFY: '0', STRIPE_WEBHOOK_SECRET: 'whsec_x' },
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

let pdfjs = null;
async function pdfText(bytes) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str).join(' '));
  return pages;
}
const body = () => ({ project: house() });
const bytesOf = async (r) => new Uint8Array(await r.res.arrayBuffer());

test('/portal/me tells the client the server decision: trial orgs are watermarked, active orgs are not', async () => {
  const w = world();
  const org = await w.trialOrg();
  const me = await org.b.get('/portal/me');
  assert.equal(me.data.exportWatermark, true);
  assert.equal(me.data.account.status, 'trial');
  assert.equal((await w.admin('POST', `/portal/admin/orgs/${org.orgId}/convert`, { note: 'paid' })).status, 200);
  assert.equal((await org.b.get('/portal/me')).data.exportWatermark, false);
});

test('trial org PDF export carries TRIAL on every page and the footer line; the client cannot switch it off', async () => {
  const w = world();
  const org = await w.trialOrg();
  const r = await org.b.call('POST', '/portal/export/pdf', { ...body(), watermark: false, trial: false });
  assert.equal(r.status, 200);
  const pages = await pdfText(await bytesOf(r));
  assert.ok(pages.length >= 2);
  for (const t of pages) {
    assert.match(t, /TRIAL/);
    assert.ok(t.includes(TRIAL_FOOTER), 'footer line on every page');
  }
  assert.doesNotMatch(TRIAL_TITLE + TRIAL_FOOTER, /[–—-]/, 'no dashes in the watermark text');
});

test('trial org DXF has the GI-TRIAL-WATERMARK layer and text; GLB, OBJ and HTML are marked', async () => {
  const w = world();
  const org = await w.trialOrg();
  const dxf = new TextDecoder().decode(await bytesOf(await org.b.call('POST', '/portal/export/dxf', body())));
  assert.ok(dxf.includes(TRIAL_DXF_LAYER));
  assert.ok(new RegExp(`TEXT\\n\\s*8\\n${TRIAL_DXF_LAYER}\\n`).test(dxf), 'TEXT entity on the watermark layer');
  assert.match(dxf, /TRIAL NOT FOR CONSTRUCTION OR LODGEMENT/);
  const glb = await bytesOf(await org.b.call('POST', '/portal/export/glb', body()));
  const text = new TextDecoder('latin1').decode(glb);
  assert.ok(text.includes('GI_TRIAL_WATERMARK') && text.includes('Glide Inside trial export'));
  const zip = new TextDecoder('latin1').decode(await bytesOf(await org.b.call('POST', '/portal/export/obj', body())));
  assert.ok(zip.includes('GI_TRIAL_WATERMARK') && zip.includes('GI_TRIAL_watermark_red'));
  const html = new TextDecoder().decode(await bytesOf(await org.b.call('POST', '/portal/export/html', body())));
  assert.match(html, /class="gi-trial-badge"/);
  assert.match(html, /class="gi-trial-overlay"/);
  assert.deepEqual(html.match(/https?:\/\/[^\s"'<>)]*/g) || [], [], 'still fully offline');
});

test('an active org export has no watermark in any format', async () => {
  const w = world();
  const org = await w.trialOrg();
  await w.admin('POST', `/portal/admin/orgs/${org.orgId}/convert`, { note: 'paid' });
  for (const t of await pdfText(await bytesOf(await org.b.call('POST', '/portal/export/pdf', body())))) assert.doesNotMatch(t, /TRIAL/);
  const dxf = new TextDecoder().decode(await bytesOf(await org.b.call('POST', '/portal/export/dxf', body())));
  assert.ok(!dxf.includes('GI-TRIAL-WATERMARK'));
  const html = new TextDecoder().decode(await bytesOf(await org.b.call('POST', '/portal/export/html', body())));
  assert.doesNotMatch(html, /gi-trial/);
  const glb = new TextDecoder('latin1').decode(await bytesOf(await org.b.call('POST', '/portal/export/glb', body())));
  assert.ok(!glb.includes('GI_TRIAL'));
});

test('after the trial ends the account is read only and exports are refused', async () => {
  const w = world();
  const org = await w.trialOrg();
  w.clock.t = T0 + 20 * 86400000;
  const r = await org.b.call('POST', '/portal/export/pdf', body());
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'READ_ONLY');
});

test('Plan Pack (homeowner) exports are never watermarked, whatever the request says', async () => {
  const w = world();
  const sid = 'cs_test_paid1';
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', payment_status: 'paid', client_reference_id: 'p_trial001', metadata: { projectId: 'p_trial001' }, amount_total: 3000, currency: 'aud', customer_details: { email: 'b@example.com' }, payment_intent: 'pi_1' } } });
  const t = Math.floor(w.clock.t / 1000);
  const sig = hex(await hmacSha256('whsec_x', `${t}.${raw}`));
  const hook = await w.app.fetch(new Request('https://api.test/api/stripe/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } }));
  assert.equal(hook.status, 200);
  const got = await (await w.app.fetch(new Request(`https://api.test/api/entitlement?session_id=${sid}&project=p_trial001`))).json();
  const call = (type, extra = {}) => w.app.fetch(new Request(`https://api.test/api/export/${type}`, { method: 'POST', headers: { authorization: `Bearer ${got.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body(), ...extra }) }));
  const pdf = await call('pdf', { watermark: true, trial: true });
  assert.equal(pdf.status, 200);
  for (const p of await pdfText(await pdf.arrayBuffer())) assert.doesNotMatch(p, /TRIAL/);
  const dxf = new TextDecoder().decode(await (await call('dxf', { watermark: true })).arrayBuffer());
  assert.ok(!dxf.includes('GI-TRIAL-WATERMARK'));
});

test('the exporter only marks when watermark is exactly true; the simple PDF sheets are marked too', async () => {
  const jsPDF = (await import('jspdf')).jsPDF;
  const marked = await buildExport('pdf', house(), { jsPDF, catalogue, config: {}, watermark: true, style: 'legacy' });
  for (const t of await pdfText(marked.bytes)) assert.match(t, /TRIAL/);
  const plain = await buildExport('pdf', house(), { jsPDF, catalogue, config: {}, watermark: 'yes', style: 'legacy' });
  for (const t of await pdfText(plain.bytes)) assert.doesNotMatch(t, /TRIAL/);
  assert.equal(typeof trialJsPDF(jsPDF), 'function');
  assert.ok(EXPORT_TYPES.pdf);
});

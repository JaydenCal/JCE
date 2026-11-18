// "Order engineering": the priced menu (config the owner edits), the panel, and the prefill of the existing enquiry form.
// Picking a service sends nothing: the form still needs the consent tick and a press of Send. No new server logic (POST /api/enquiry/jce).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ENGINEERING_SERVICES, SERVICE_BY_ID, priceLabel, enquiryPrefill } from '../src/premium/engineering-services.js';
import { openOrderEngineering, ORDER_TITLE } from '../src/premium/ui/order-engineering.js';
import { openEnquiry, CONSENT_TEXT } from '../src/premium/ui/enquiry.js';

class TextNode { constructor(t) { this.nodeType = 3; this.text = String(t); this.parent = null; } get textContent() { return this.text; } }
class FakeEl {
  constructor(tag) { this.nodeType = 1; this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.className = ''; this.parent = null; this._value = null; this.checked = false; this.disabled = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'checked') this.checked = true; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceWith(n) { const i = this.parent.children.indexOf(this); n.parent = this.parent; this.parent.children[i] = n; }
  get value() { return this._value ?? this.attrs.value ?? ''; }
  set value(v) { this._value = String(v); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children = [new TextNode(t)]; }
  fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, target: this, ...ev }); }
}
globalThis.document = { createElement: (t) => new FakeEl(t), createTextNode: (t) => new TextNode(t) };
const walk = (n, out = []) => { out.push(n); for (const c of n.children || []) walk(c, out); return out; };
const byId = (root, id) => walk(root).find((n) => n.attrs?.id === id);
const textOf = (root) => walk(root).filter((n) => n.nodeType === 3).map((n) => n.text).join(' ');
const flush = () => new Promise((r) => setTimeout(r, 20));

function world(services) {
  const modals = []; const sent = []; const opened = [];
  const layer = { openModal: ({ title, body }) => { const root = new FakeEl('div'); root.append(body(() => {})); const m = { title, root, closed: null, close(r) { m.closed = r; } }; modals.push(m); return m; } };
  const send = async (b) => { sent.push(b); return { ok: true, reference: 'GI-ORD1' }; };
  // The same merge premium.js openEnquiryForm does: the person's own details first, the service's need and notes over them.
  const openForm = (extra = {}) => { opened.push(extra); const { prefill = null } = extra; return openEnquiry({ layer, send, project: { id: 'p1' }, lot: { address: '1 Test St' }, prefill: { name: 'Sam', ...(prefill || {}) } }); };
  const panel = openOrderEngineering({ layer, openEnquiry: openForm, ...(services ? { services } : {}) });
  return { modals, sent, opened, panel };
}
const items = (m) => walk(m.root).filter((n) => n.attrs?.class === 'psp-order-item' || n.className === 'psp-order-item');

test('config: the six services, each with a placeholder price marked price to confirm', () => {
  assert.deepEqual(ENGINEERING_SERVICES.map((s) => s.id), ['site-classification-footings', 'stormwater-concept', 'driveway-long-section', 'retaining-wall-design', 'civil-plans-da', 'flood-bushfire-coordination']);
  for (const s of ENGINEERING_SERVICES) {
    assert.equal(s.priceToConfirm, true, `${s.id} is a placeholder until the owner confirms it`);
    assert.ok(Number.isFinite(s.priceFromAud) && s.priceFromAud > 0);
    assert.ok(['engineering', 'da', 'both'].includes(s.need), 'a need the server accepts');
  }
  assert.ok(/price to confirm/i.test(fs.readFileSync(new URL('../src/premium/engineering-services.js', import.meta.url), 'utf8')), 'the config file says so');
});

test('price label: Request a quote until the owner sets the price', () => {
  const s = SERVICE_BY_ID['stormwater-concept'];
  assert.equal(priceLabel(s), 'Request a quote');
  assert.equal(priceLabel({ ...s, priceToConfirm: false }), `From $${s.priceFromAud.toLocaleString('en-AU')}, GST excluded`);
  assert.equal(priceLabel({ ...s, priceToConfirm: false, priceFromAud: null }), 'Request a quote');
  assert.equal(priceLabel(null), 'Request a quote');
});

test('panel: lists every service with Request a quote and sends nothing by itself', () => {
  const w = world();
  assert.equal(w.modals.length, 1);
  assert.equal(w.modals[0].title, ORDER_TITLE);
  const t = textOf(w.modals[0].root);
  for (const s of ENGINEERING_SERVICES) assert.ok(t.includes(s.label), s.label);
  assert.equal((t.match(/Request a quote/g) || []).length, ENGINEERING_SERVICES.length);
  assert.ok(!/\$\d/.test(t.replace(/Nothing is sent[^.]*\./, '')), 'no price shown while all are to confirm');
  assert.equal(items(w.modals[0]).length, ENGINEERING_SERVICES.length);
  assert.equal(w.sent.length, 0);
  assert.equal(w.opened.length, 0);
});

test('panel: an owner confirmed price shows as From $X', () => {
  const w = world(ENGINEERING_SERVICES.map((s, i) => (i === 0 ? { ...s, priceToConfirm: false, priceFromAud: 1100 } : s)));
  const t = textOf(w.modals[0].root);
  assert.ok(t.includes('From $1,100, GST excluded'));
  assert.equal((t.match(/Request a quote/g) || []).length, ENGINEERING_SERVICES.length - 1);
});

test('prefill: picking a service closes the panel, opens the enquiry form with the service in the notes and the right need, and sends nothing', async () => {
  const w = world();
  const pick = items(w.modals[0]).find((n) => n.dataset.service === 'civil-plans-da');
  pick.fire('click');
  assert.equal(w.modals[0].closed, 'pick');
  assert.equal(w.opened.length, 1);
  assert.equal(w.opened[0].service, 'civil-plans-da');
  assert.deepEqual(w.opened[0].prefill, enquiryPrefill(SERVICE_BY_ID['civil-plans-da']));
  const form = w.modals[1];
  assert.match(byId(form.root, 'jce-notes').value, /Service requested: Civil plans for DA\. Price to be quoted\./);
  const radios = walk(form.root).filter((n) => n.tag === 'input' && n.attrs.name === 'jce-need');
  assert.equal(radios.find((r) => r.checked).attrs.value, 'da');
  assert.equal(byId(form.root, 'jce-name').value, 'Sam', 'the person details stay');
  assert.equal(byId(form.root, 'jce-address').value, '1 Test St');
  await flush();
  assert.equal(w.sent.length, 0, 'nothing sent on opening');
});

test('prefill: Send needs the consent tick; with it, one POST body carries the service need and notes', async () => {
  const w = world();
  items(w.modals[0]).find((n) => n.dataset.service === 'driveway-long-section').fire('click');
  const form = w.modals[1];
  byId(form.root, 'jce-name').value = 'Sam Lee'; byId(form.root, 'jce-phone').value = '0412 345 678'; byId(form.root, 'jce-email').value = 'sam@example.com';
  const f = walk(form.root).find((n) => n.tag === 'form');
  f.fire('submit');
  await flush();
  assert.equal(w.sent.length, 0, 'no consent, no send');
  assert.ok(textOf(form.root).includes(CONSENT_TEXT));
  byId(form.root, 'jce-consent').checked = true;
  f.fire('submit');
  await flush();
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].consent, true);
  assert.equal(w.sent[0].need, 'engineering');
  assert.match(w.sent[0].notes, /Service requested: Driveway long section/);
});

test('every service prefill uses a need the server accepts and a notes line under the server limit', () => {
  for (const s of ENGINEERING_SERVICES) {
    const p = enquiryPrefill(s);
    assert.ok(['engineering', 'da', 'both'].includes(p.need));
    assert.ok(p.notes.length < 400);
    assert.ok(!/[–—]/.test(p.notes) && !/compliant/i.test(p.notes));
  }
  assert.deepEqual(enquiryPrefill(null), {});
});

test('a form opened without a service keeps its old defaults (both, empty notes)', () => {
  const w = world();
  const layer = { openModal: ({ body }) => { const root = new FakeEl('div'); root.append(body(() => {})); return { root, close() {} }; } };
  const m = openEnquiry({ layer, send: async () => ({}), project: {}, lot: {} });
  const radios = walk(m.root).filter((n) => n.tag === 'input' && n.attrs.name === 'jce-need');
  assert.equal(radios.find((r) => r.checked).attrs.value, 'both');
  assert.equal(byId(m.root, 'jce-notes').value, '');
  void w;
});

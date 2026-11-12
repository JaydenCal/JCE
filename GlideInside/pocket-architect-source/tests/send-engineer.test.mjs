// "Send plans to a registered engineer": the lot card button, the prompt after a plan set PDF download, the enquiry form (title, wording,
// consent, lot fields filled in) and the premium gate for client logins. Runs in Node with a small fake DOM, so the real
// src/premium/ui/enquiry.js form code is exercised.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { lotOf } from '../src/model/placement.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { openEnquiry, lotPrefill, CONSENT_TEXT } from '../src/premium/ui/enquiry.js';
import { createSendToEngineer, planSetBase64, SEND_LABEL, AFTER_EXPORT_TEXT, MAX_PDF_BYTES } from '../src/lotcard/send-engineer.js';

// A tiny DOM: enough for el()/h(), the form and its listeners.
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

const project = () => {
  const p = migrate(catalogue.createFromTemplate('house_single'));
  const f = FIXTURES[0];
  p.site.lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
  return p;
};

// The enquiry form opened for real, with a layer that just returns what the modal body builds.
function world({ canSend = true, sendImpl = null } = {}) {
  const proj = project();
  const modals = [];
  const sent = [];
  const layer = { openModal: ({ title, body }) => { const root = new FakeEl('div'); root.append(body(() => {})); const m = { title, root, closed: null, close(r) { m.closed = r; } }; modals.push(m); return m; } };
  const send = sendImpl || (async (b) => { sent.push(b); return { ok: true, reference: 'GI-TEST2', emailed: false }; });
  const exporter = (o) => exportPlanSet({ ...o, jsPDF });
  const app = {
    premium: {
      canSendPlans: () => canSend,
      openEnquiry: (extra = {}) => {
        const { anyone, ...rest } = extra;
        return openEnquiry({ layer, send, project: proj, lot: lotPrefill(proj, {}), source: 'public', ...rest });
      },
    },
  };
  const toasts = [];
  const engineer = createSendToEngineer({
    getApp: () => app, getProject: () => proj, getLot: () => lotOf(proj), getBuilderName: () => '',
    toast: (message, opts) => { toasts.push({ message, ...opts }); return { dismiss() {} }; }, loadExporter: async () => exporter,
  });
  return { proj, modals, sent, toasts, engineer, app };
}
const fill = (root, name = 'Sarah Lee', phone = '0412 345 678', email = 'sarah@example.com') => {
  byId(root, 'jce-name').value = name; byId(root, 'jce-phone').value = phone; byId(root, 'jce-email').value = email;
};
const flush = () => new Promise((r) => setTimeout(r, 25));

test('card button: opens the enquiry modal with the lot (address, lot, DP, LGA, zone) filled in', () => {
  const w = world();
  assert.equal(w.engineer.available(), true);
  w.engineer.open();
  assert.equal(w.modals.length, 1);
  const m = w.modals[0];
  assert.equal(m.title, 'Send your plans to a registered engineer');
  const sl = w.proj.site.lot;
  assert.ok(sl.address && sl.lotNumber, 'the fixture lot has an address and number');
  assert.equal(byId(m.root, 'jce-address').value, sl.address);
  assert.equal(byId(m.root, 'jce-lot').value, String(sl.lotNumber));
  assert.equal(byId(m.root, 'jce-dp').value, String(sl.planLabel || ''));
  assert.equal(byId(m.root, 'jce-lga').value, sl.lga || '');
  const zone = sl.zoning?.code ? `${sl.zoning.code}${sl.zoning.name ? ` ${sl.zoning.name}` : ''}` : '';
  assert.equal(byId(m.root, 'jce-zone').value, zone);
  const intro = textOf(m.root);
  assert.match(intro, /JCE Infrastructure Pty Ltd, civil engineers/);
  assert.match(intro, /quote on engineering and DA plans/);
  assert.ok(intro.includes(CONSENT_TEXT), 'the consent tick box stays');
});

test('card button: Send attaches the plan set PDF (kind site) and the design, and the success message gives the reference', async () => {
  const w = world();
  w.engineer.open();
  const m = w.modals[0];
  fill(m.root);
  byId(m.root, 'jce-consent').checked = true;
  const form = walk(m.root).find((n) => n.tag === 'form') || m.root;
  form.fire('submit');
  await flush();
  assert.equal(w.sent.length, 1);
  const b = w.sent[0];
  assert.equal(b.consent, true);
  assert.equal(b.lot.address, w.proj.site.lot.address);
  assert.ok(b.pdfBase64.startsWith('JVBERi0'), 'a real PDF is attached');
  assert.equal(b.project.id, w.proj.id);
  const done = textOf(m.root);
  assert.match(done, /GI-TEST2/);
  assert.match(done, /JCE will be in touch/);
  assert.ok(!/\d+\s*(minutes|hours|days)|\$|within/i.test(done), 'no promised time, no prices');
});

test('consent is required: nothing is sent until the box is ticked', async () => {
  const w = world();
  w.engineer.open();
  const m = w.modals[0];
  fill(m.root);
  const form = walk(m.root).find((n) => n.tag === 'form') || m.root;
  form.fire('submit');
  await flush();
  assert.equal(w.sent.length, 0);
  assert.match(textOf(m.root), /tick the box/i);
});

test('after a plan set PDF download: a prompt with the same button, which opens the modal', () => {
  const w = world();
  w.engineer.offerAfterExport('site');
  assert.equal(w.toasts.length, 1);
  assert.equal(w.toasts[0].message, 'Need engineering or DA plans? Send these plans to a registered engineer');
  assert.equal(w.toasts[0].action.label, 'Send plans to a registered engineer');
  assert.ok(w.toasts[0].timeout >= 8000, 'stays long enough to read and press');
  assert.equal(w.modals.length, 0, 'the prompt alone sends and opens nothing');
  w.toasts[0].action.onClick();
  assert.equal(w.modals.length, 1);
  assert.equal(w.modals[0].title, 'Send your plans to a registered engineer');
});

test('client logins respect allowClientEnquiries: no button, no prompt, no modal when the builder turned sending off', () => {
  const w = world({ canSend: false });
  assert.equal(w.engineer.available(), false);
  assert.equal(w.engineer.open(), null);
  assert.equal(w.engineer.offerAfterExport('site'), null);
  assert.equal(w.toasts.length, 0);
  assert.equal(w.modals.length, 0);
  const none = createSendToEngineer({ getApp: () => ({}), getProject: () => null, getLot: () => null });
  assert.equal(none.available(), false, 'hidden until the premium layer has loaded');
});

test('the plan set PDF is built with kind site and download false, and a PDF over the server limit is left off rather than refused', async () => {
  const calls = [];
  const fake = async (o) => { calls.push(o); return { blob: new Blob([new Uint8Array(10)]) }; };
  const proj = project();
  const b64 = await planSetBase64({ project: proj, lot: lotOf(proj), builderName: 'Hunter Homes', exportPlanSet: fake });
  assert.equal(calls[0].kind, 'site');
  assert.equal(calls[0].download, false);
  assert.equal(calls[0].builderName, 'Hunter Homes');
  assert.equal(Buffer.from(b64, 'base64').length, 10);
  const big = async () => ({ blob: new Blob([new Uint8Array(MAX_PDF_BYTES + 1)]) });
  assert.equal(await planSetBase64({ project: proj, lot: lotOf(proj), exportPlanSet: big }), null);
});

test('wording: no em or en dashes, no exclamation marks, never "compliant", no prices', () => {
  const files = ['src/lotcard/send-engineer.js', 'src/premium/ui/enquiry.js'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const strings = [SEND_LABEL, AFTER_EXPORT_TEXT, CONSENT_TEXT, 'Send your plans to a registered engineer'].join('\n');
  for (const s of [strings, ...files.map((f) => f.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'))]) {
    assert.ok(!/[–—]/.test(s), 'no dashes');
    assert.ok(!/compliant/i.test(s));
  }
  for (const f of files) {
    const literals = f.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').match(/'(?:[^'\\\n]|\\.){4,}'/g) || [];
    assert.ok(literals.length > 5);
    for (const lit of literals) assert.ok(!lit.includes('!'), `no exclamation marks in text: ${lit}`);
  }
  assert.ok(!/!/.test(strings), 'no exclamation marks in the button and prompt text');
  assert.ok(!/\$\s*\d|A\$/.test(files[1]), 'no prices in the form');
});

test('lot card wiring: the button sits under the PDF links, the menu offers it, and both PDF downloads raise the prompt', () => {
  const src = fs.readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8');
  assert.match(src, /bPdfH\)\), sendRow, fit, zoneNote\)/, 'the send row follows the PDF links in the card body');
  assert.match(src, /dataset: \{ ps: 'lc-send-engineer' \}/);
  assert.match(src, /\[SEND_LABEL, \(\) => engineer\.open\(\)\]/, 'the phone and desktop menu');
  assert.match(src, /downloadBlob\([^\n]*\n\s*engineer\.offerAfterExport\(kind\)/, 'the prompt follows the download, for the site and the house PDF');
  assert.match(src, /bSend\.hidden = !canSend/);
  const css = fs.readFileSync(new URL('../src/lotcard/lot-card-css.js', import.meta.url), 'utf8');
  assert.match(css, /\.lc-root\.is-phone \.lc-sendbtn/, 'a phone layout');
});

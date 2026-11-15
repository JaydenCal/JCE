// The Commercial Developer gate dialog closes when the person goes on to Restore or the trial sign in, and the sign in closes its own dialog on
// success, so nothing stays open over the app. Runs the real billing UI code with a small fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

class TextNode { constructor(t) { this.nodeType = 3; this.text = String(t); } get textContent() { return this.text; } }
class FakeEl {
  constructor(tag) { this.nodeType = 1; this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.className = ''; this._value = ''; this.checked = false; this.disabled = false; this.hidden = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  requestSubmit() { this.fire('submit'); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children = [new TextNode(t)]; }
  get classList() { return { add() {}, remove() {}, toggle() {} }; }
  fire(type) { return Promise.all((this.listeners[type] || []).map((fn) => fn({ preventDefault() {}, target: this }))); }
}
globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t), createTextNode: (t) => new TextNode(t) };
const walk = (n, out = []) => { out.push(n); for (const c of n.children || []) walk(c, out); return out; };

const { createCommercialBilling } = await import('../src/premium/ui/commercial-billing.js');

test('gate: Sign in and Restore close the gate, and a successful trial sign in leaves no dialog open', async () => {
  const modals = [];
  const layer = {
    notify() {},
    openModal({ title, body, footer }) {
      const root = new FakeEl('div');
      root.append(typeof body === 'function' ? body(() => {}) : body);
      const m = { title, root, closed: null, close(r) { m.closed = r ?? 'x'; } };
      if (footer) { const f = typeof footer === 'function' ? footer((r) => m.close(r)) : footer; root.append(...[].concat(f)); }
      modals.push(m);
      return m;
    },
  };
  let csub = null;
  const api = { commercialStatus: async () => ({ subscribable: false }), commercialTrialLogin: async () => ({ token: 't' }), commercialRestore: async () => ({ token: 'r' }) };
  const ui = createCommercialBilling({ layer, api, store: {}, config: {}, getCsub: () => csub, setCsub: (v) => { csub = v; }, clearCsub: () => { csub = null; }, refreshCredits: async () => {}, navigate() {}, sleep: async () => {}, timing: { intervalMs: 1, timeoutMs: 5 } });
  const button = (m, label) => walk(m.root).find((n) => n.tag === 'button' && n.textContent === label);

  ui.openGate({ source: 'test' });
  const gate = modals[0];
  button(gate, 'Sign in').fire('click');
  assert.equal(gate.closed != null, true, 'the gate closes when the sign in form opens');
  const form = modals[1];
  assert.equal(form.title, 'Commercial trial login');
  const inputs = walk(form.root).filter((n) => n.tag === 'input');
  inputs[0].value = 'user'; inputs[1].value = 'pass';
  await walk(form.root).find((n) => n.tag === 'form').fire('submit');
  assert.equal(form.closed, 'done');
  assert.equal(csub.kind, 'trial');
  assert.equal(modals.filter((m) => m.closed == null).length, 0, 'no dialog is left open');

  csub = null;
  ui.openGate({ source: 'test' });
  const gate2 = modals[modals.length - 1];
  button(gate2, 'Restore subscription').fire('click');
  assert.equal(gate2.closed != null, true, 'the gate closes when the restore form opens');
});

// Identical toasts within 2 s are shown once (the Driveway PI tool said "Start the driveway on the street frontage." on every click).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.dataset = {}; this.style = {}; this.attrs = {}; this.text = ''; }
  get nodeType() { return 1; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { return !!this.parent && (this.parent.tag === 'region' || this.parent.isConnected); }
  append(...c) { for (const x of c) { if (x.nodeType === 1) x.parent = this; this.children.push(x); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener() {}
  setAttribute(k, v) { this.attrs[k] = v; }
}
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => ({ nodeType: 3, text: t }) };
const { toast, mountToasts } = await import('../src/ui/toast.js');

test('the same message within 2 s stacks once; a different message, or the same one after it has gone, shows', () => {
  const region = new El('region');
  mountToasts(region);
  for (let i = 0; i < 5; i++) toast('Start the driveway on the street frontage.', { kind: 'info' });
  assert.equal(region.children.length, 1);
  toast('Another message', { kind: 'info' });
  assert.equal(region.children.length, 2);
  region.children[0].remove(); // dismissed
  toast('Start the driveway on the street frontage.', { kind: 'info' });
  assert.equal(region.children.length, 2, 'shown again once the first has gone');
});

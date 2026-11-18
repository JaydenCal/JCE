// Imports the portal page module through a minimal DOM shim so a broken import graph fails a test.
import test from 'node:test';
import assert from 'node:assert/strict';

function el(tag) {
  const e = { tagName: tag, children: [], style: {}, dataset: {}, attributes: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); return n; }, prepend(...n) { this.children.unshift(...n); },
    setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k] ?? null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, remove() {}, replaceChildren() { this.children = []; }, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, closest: () => null, get firstChild() { return this.children[0] || null; }, removeChild() {}, insertBefore() {} };
  return e;
}
const doc = { title: '', body: el('body'), head: el('head'), documentElement: el('html'), activeElement: null,
  createElement: el, createElementNS: (ns, t) => el(t), createTextNode: (t) => ({ nodeType: 3, textContent: t }), createDocumentFragment: () => el('frag'),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {} };
globalThis.document = doc;
globalThis.window = globalThis;
globalThis.location = { search: '', hash: '', href: 'https://example.test/portal/', pathname: '/portal/', origin: 'https://example.test', hostname: 'example.test' };
globalThis.addEventListener ??= () => {};
globalThis.Node ??= class {}; globalThis.HTMLElement ??= class {};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;

test('portal-app.js imports and mounts without throwing', async () => {
  const mod = await import('../src/portal/ui/portal-app.js');
  assert.equal(typeof mod.mountPortal, 'function');
  const root = el('div');
  try { mod.mountPortal(root); } catch (e) { assert.fail('mountPortal threw: ' + e.message); }
});

// The app actions: address search, breach and placement guardrails, share revoke wording, white label, public names, payload gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('address search: unit and lot prefixes and abbreviations are understood', async () => {
  const { parseAddressQuery } = await import('../src/site/address-search.js');
  const a = parseAddressQuery('Unit 3/12 Marius St Tamworth');
  assert.equal(a.number, '12');
  assert.equal(a.unit, '3');
  assert.match(a.clean, /12 marius street/i);
  const b = parseAddressQuery('Lot 5 12 Marius Rd');
  assert.equal(b.lot, '5');
  assert.equal(b.number, '12');
  assert.match(b.clean, /road/i);
  assert.match(parseAddressQuery('7 Smith Ave Dubbo').clean, /avenue/i);
});

test('address search: the exact house number ranks first, then the same street', async () => {
  const { rankResults } = await import('../src/site/address-search.js');
  const res = [
    { label: '112 Marius Street, Tamworth NSW' },
    { label: '12 Other Street, Tamworth NSW' },
    { label: '14 Marius Street, Tamworth NSW' },
    { label: '12 Marius Street, Tamworth NSW' },
  ];
  const r = rankResults('12 marius st', res);
  assert.equal(r[0].label, '12 Marius Street, Tamworth NSW');
  assert.ok(r.findIndex((x) => /^14 Marius/.test(x.label)) < r.findIndex((x) => /^12 Other/.test(x.label)), 'same street above the same number on another street');
});

test('address search: Enter takes the top match, and nothing found says what to do', async () => {
  const { smartSearch, NOT_FOUND_TEXT } = await import('../src/site/address-search.js');
  const seen = [];
  const out = await smartSearch('3/12 marius st', { search: async (t) => { seen.push(t); return [{ label: '14 Marius Street, Tamworth' }, { label: '12 Marius Street, Tamworth' }]; } });
  assert.equal(out[0].label, '12 Marius Street, Tamworth');
  assert.ok(seen.length >= 1);
  assert.match(NOT_FOUND_TEXT, /sample lot/);
  assert.match(NOT_FOUND_TEXT, /boundary/);
  assert.deepEqual(await smartSearch('zzzz nowhere', { search: async () => [] }), []);
});

test('setback breach: the dialog says by how much and asks before keeping the position', async () => {
  const { breachSentence, breachDialog, statusFromMessages } = await import('../src/flow/breach.js');
  const st = { state: 'outside', breaches: [{ kind: 'front', breachM: 1.234 }, { kind: 'side', breachM: 0.4 }] };
  const s = breachSentence(st);
  assert.match(s, /1\.23 m inside the front setback/);
  assert.match(s, /0\.40 m inside the side setback/);
  const d = breachDialog(st);
  assert.match(d.message, /Keep this position anyway\?/);
  assert.equal(d.confirmLabel, 'Keep this position');
  assert.equal(breachSentence({ state: 'inside' }), '');
  assert.equal(statusFromMessages([{ kind: 'envelope', shortByM: 0.5, text: 'Outside the envelope at the rear, 0.5 m short' }]).state, 'outside');
  assert.equal(statusFromMessages([]), null);
});

test('placement choice: replace or add when a house is already there, nothing asked on a clear lot', async () => {
  const { hasBuilding, placeChoiceText, askPlaceChoice } = await import('../src/ui/place-choice.js');
  assert.equal(hasBuilding({ levels: [{ rooms: [], walls: [] }] }), false);
  assert.equal(hasBuilding({ levels: [{ rooms: [{}], walls: [] }] }), true);
  assert.equal(hasBuilding({ placedHouse: { id: 'h' }, levels: [] }), true);
  const t = placeChoiceText('The Banksia');
  assert.equal(t.replace, 'Replace house');
  assert.equal(t.add, 'Add another building');
  assert.equal(await askPlaceChoice({ levels: [{ rooms: [], walls: [] }] }, 'The Banksia'), 'add');
});

test('undo floor: the store can be told where undo stops', () => {
  const s = read('src/model/store.js');
  assert.match(s, /undoFloor/);
});

test('white label: the Glide Inside header and footer are hidden once signed in, and restored on sign out', async () => {
  const { applyWhiteLabel, clearBrandTheme } = await import('../src/portal/theme-css.js');
  const els = new Map();
  const doc = {
    head: { append: (e) => els.set(e.id, e) },
    createElement: () => ({ id: '', textContent: '', remove() { els.delete(this.id); } }),
    getElementById: (id) => els.get(id) || null,
    documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
  };
  applyWhiteLabel(doc);
  assert.equal(doc.documentElement.attrs['data-white-label'], '1');
  assert.match(els.get('gi-white-label').textContent, /\.site-header/);
  assert.match(els.get('gi-white-label').textContent, /\.site-footer/);
  clearBrandTheme(doc);
  assert.equal(doc.documentElement.attrs['data-white-label'], undefined);
  assert.equal(els.has('gi-white-label'), false);
});

test('white label: client mode puts the builder name and logo in the top bar and sets the tab title', () => {
  const s = read('src/portal/client-mode.js');
  assert.match(s, /applyWhiteLabel\(\)/);
  assert.match(s, /document\.title = /);
  assert.match(s, /\.ps-brand \.ps-product/);
});

test('portal pending still holds the paywall and the profile prompt back until the builder check ends', () => {
  const a = read('src/profile/accounts.js');
  assert.match(a, /portalPending/);
  const t = read('src/premium/ui/topbar.js');
  assert.match(t, /st\.portalPending/);
  const app = read('src/app.js');
  assert.match(app, /setPortalPending\?\.\(false\)/);
});

test('share: the owner can revoke, and the viewer offers Make your own', () => {
  const sv = read('server/lib/projects.js');
  assert.match(sv, /revoke/);
  const sh = read('src/ui/share.js');
  assert.match(sh, /Make your own/);
  assert.match(sh, /data-viewonly|viewonly/);
});

test('names: Pocket Architect and Plan Studio do not appear in what people see', () => {
  const skip = new Set(['node_modules', 'vendor', 'fixtures']);
  const hits = [];
  const walk = (d) => {
    for (const f of readdirSync(join(root, d))) {
      if (skip.has(f)) continue;
      const rel = `${d}/${f}`;
      const st = statSync(join(root, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(js|html)$/.test(f) && !/generated/.test(f)) {
        const t = read(rel);
        for (const [i, line] of t.split('\n').entries()) {
          if (!/Pocket Architect|Plan Studio/.test(line)) continue;
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // comments
          hits.push(`${rel}:${i + 1}`);
        }
      }
    }
  };
  walk('src');
  assert.deepEqual(hits.slice(0, 20), [], 'user facing strings carry the product names, not the old ones');
});

test('payload: the 3D code waits behind the start screen, and the first screen preloads its chunks side by side', () => {
  const v = read('src/ui/views.js');
  assert.match(v, /startGate/);
  assert.match(v, /startScreenCovers/);
  const b = read('tools/build-single.mjs');
  assert.match(b, /modulepreload/);
  assert.match(b, /media="print" onload=/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIPS, TIPS_KEY, readTipsPref, writeTipsPref, TIPS_CSS } from '../src/lotcard/tips.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('four one line tips, no dashes, no forbidden word', () => {
  assert.equal(TIPS.length, 4);
  for (const t of TIPS) { assert.ok(!/[–—]/.test(t) && !/compliant/i.test(t) && !t.includes('\n')); }
  assert.equal(TIPS[0], 'Search an address to load your own lot');
});

test('shown on first load; Do not show again is remembered; the ? button resets it; a blocked store never throws', () => {
  const s = mem();
  assert.equal(readTipsPref(s), 'show');
  writeTipsPref('off', s);
  assert.equal(s.getItem(TIPS_KEY), 'off');
  assert.equal(readTipsPref(s), 'off');
  writeTipsPref('show', s);
  assert.equal(readTipsPref(s), 'show');
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readTipsPref(bad), 'show');
  assert.equal(writeTipsPref('off', bad), false);
});

test('the viewer does not mount the How to panel (owner 18/11/2026), the helper style still collapses when compact', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8'), /createTips\(\)/);
  assert.match(TIPS_CSS, /\.lc-embed\.is-compact \.lc-tips/);
});

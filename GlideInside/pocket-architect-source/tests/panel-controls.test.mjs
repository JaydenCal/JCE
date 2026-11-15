// Commercial panel close / collapse / reopen / zone retry, and the side panel hide (AI design assistant): pure logic and source wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { needsZone, ensureZone, lotKey } from '../src/commercial/zone-lookup.js';
import { PANEL_KEY, readPanelHidden, writePanelHidden, setAssistantAllowed, assistantAllowed } from '../src/ui/panel-hide.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const lotOf = (extra = {}) => ({ lotLabel: 'Lot 8 DP 8294', state: 'NSW', srid: 7856, origin: { e: 330000, n: 6250000 }, zoning: null, ...extra });
const fakeStore = (lot) => {
  const store = { project: { site: { lot } }, applied: [], apply(label, fn) { this.applied.push(label); fn(this.project); } };
  return store;
};

test('needsZone: only a georeferenced NSW lot with no zone', () => {
  assert.equal(needsZone(lotOf()), true);
  assert.equal(needsZone(lotOf({ zoning: 'R2' })), false);
  assert.equal(needsZone(lotOf({ state: 'QLD' })), false);
  assert.equal(needsZone(lotOf({ origin: null })), false);
  assert.equal(needsZone(lotOf({ srid: 4326 })), false);
  assert.equal(needsZone(null), false);
});

test('ensureZone writes the zone as one undo step and does nothing when the lot already has one', async () => {
  const store = fakeStore(lotOf());
  let calls = 0;
  const lookup = async () => { calls += 1; return { zoning: 'IN1', lga: 'Sample LGA' }; };
  assert.equal(await ensureZone(store, { lookup }), 'found');
  assert.equal(store.project.site.lot.zoning, 'IN1');
  assert.equal(store.project.site.lot.lga, 'Sample LGA');
  assert.deepEqual(store.applied, ['Look up zone']);
  assert.equal(await ensureZone(store, { lookup }), 'found');
  assert.equal(calls, 1, 'a lot with a zone is not asked again');
});

test('ensureZone reports none and failed, and a later retry can succeed', async () => {
  const store = fakeStore(lotOf());
  assert.equal(await ensureZone(store, { lookup: async () => ({}) }), 'none');
  assert.equal(await ensureZone(store, { lookup: async () => { throw new Error('offline'); } }), 'failed');
  assert.equal(store.project.site.lot.zoning, null);
  assert.equal(await ensureZone(store, { lookup: async () => ({ zoning: 'B4' }) }), 'found');
  assert.equal(store.project.site.lot.zoning, 'B4');
});

test('ensureZone drops the answer when the person moved to another lot meanwhile', async () => {
  const store = fakeStore(lotOf());
  const lookup = async () => { store.project.site.lot = lotOf({ lotLabel: 'Lot 9', origin: { e: 1, n: 2 } }); return { zoning: 'R1' }; };
  assert.equal(await ensureZone(store, { lookup }), 'failed');
  assert.equal(store.project.site.lot.zoning, null);
  assert.notEqual(lotKey(lotOf()), lotKey(lotOf({ lotLabel: 'Lot 9' })));
});

test('commercial panel: close, collapse, Escape, reopen, remembered per browser, never over the plan under 1280 px', () => {
  const src = read('../src/commercial/ui/panel-commercial.js');
  assert.match(src, /class: 'cm-close'[^]*?Close the layout panel/);
  assert.match(src, /class: 'cm-sheet-toggle'/);
  assert.match(src, /e\.key === 'Escape'[^]*?closePanel\(\)/);
  assert.match(src, /class: 'cm-reopen'[^]*?'Commercial layout'/);
  assert.match(src, /try \{ const v = localStorage\.getItem\(PANEL_KEY\)/);
  assert.match(src, /try \{ localStorage\.setItem\(PANEL_KEY/);
  assert.match(src, /1280/);
  assert.match(src, /ensureZone\(store\)/, 'the zone is asked for again when the panel shows');
  assert.match(src, /wasOn[^]*?closed = false/, 'the mode switch brings a closed panel back');
  const css = read('../styles.css');
  assert.match(css, /\.cm-reopen/);
  assert.match(css, /\.cm-dock\[data-sheet="closed"\]/);
});

test('side panel hide: remembered per browser, storage failures are safe', () => {
  const was = globalThis.localStorage;
  try {
    globalThis.localStorage = mem();
    assert.equal(readPanelHidden(), false);
    writePanelHidden(true);
    assert.equal(globalThis.localStorage.getItem(PANEL_KEY), '1');
    assert.equal(readPanelHidden(), true);
    writePanelHidden(false);
    assert.equal(readPanelHidden(), false);
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(readPanelHidden(), false);
    assert.doesNotThrow(() => writePanelHidden(true));
  } finally { globalThis.localStorage = was; }
});

test('assistant allowed flag defaults on and follows the builder setting', () => {
  assert.equal(assistantAllowed(), true);
  setAssistantAllowed(false);
  assert.equal(assistantAllowed(), false);
  setAssistantAllowed(undefined);
  assert.equal(assistantAllowed(), true);
});

test('AI assistant hide wiring: header button, edge tab, shortcut, phones, portal setting end to end', () => {
  const ui = read('../src/ui/panel-hide.js');
  assert.match(ui, /aria-label', 'Hide panel'|setAttribute\('aria-label', 'Hide panel'\)/);
  assert.match(ui, /aria-label': 'Show panel'/);
  assert.match(ui, /Alt\+P/);
  assert.match(ui, /dataset\.panel = 'hidden'/);
  assert.match(read('../src/app.js'), /mountPanelHide\(refs/);
  const css = read('../styles.css');
  assert.match(css, /data-panel="hidden"\] \.ps-main/);
  assert.match(css, /data-ai="off"\] \.ps-tab\[data-tab="ai"\]/);
  assert.match(css, /\.ps-panel-tab[^]*?max-width: 899\.98px|max-width: 899\.98px[^]*?\.ps-panel-tab/);
  // The assistant's own logic is untouched.
  assert.doesNotMatch(read('../src/premium/ui/assistant.js'), /panel-hide|showAiAssistant/);
  // Portal setting end to end.
  assert.match(read('../server/migrations/0016_org_show_ai_assistant.sql'), /ADD COLUMN show_ai_assistant INTEGER NOT NULL DEFAULT 1/);
  assert.match(read('../server/schema.sql'), /show_ai_assistant INTEGER NOT NULL DEFAULT 1/);
  assert.match(read('../server/lib/portal-store.js'), /showAiAssistant: 'show_ai_assistant:b'/);
  assert.match(read('../server/lib/portal.js'), /showAiAssistant: o\.showAiAssistant !== false/);
  assert.match(read('../src/portal/mock-api.js'), /showAiAssistant/);
  assert.match(read('../src/portal/ui/clients-tab.js'), /Show AI design assistant to clients/);
  assert.match(read('../src/portal/client-mode.js'), /setAssistantAllowed\(!\(me\.user\.role === 'client' && me\.org\?\.showAiAssistant === false\)\)/);
});

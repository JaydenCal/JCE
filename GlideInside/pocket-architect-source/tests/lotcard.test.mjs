// Lot card: stats derivation, colour schemes (3D and persistence), setback status line, carousel helpers, room tabs and rooms plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalogue } from '../src/catalogue/index.js';
import { migrate, createProject } from '../src/model/schema.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { cardStats, roofedAreaM2, lotHeading, lotLine, lotSize } from '../src/lotcard/stats.js';
import { SCHEMES, DEFAULT_SCHEME_ID, schemeById, effectiveSchemeId, applySchemeToFinishes, schemeLine } from '../src/model/colour-schemes.js';
import { setbackStatusLine } from '../src/site/lot-checks.js';
import { buildModel } from '../src/viewer3d/build.js';
import { currentIndex, pagerText, stepIndex, builderDesigns, publicDesigns } from '../src/lotcard/designs.js';
import { roomsPlanModel } from '../src/lotcard/rooms-plan.js';
import { listRoomTabs } from '../src/viewer3d/rooms.js';
import { createStore } from '../src/model/store.js';
import { swapHouse } from '../src/lotcard/swap.js';
import { scheduleData } from '../src/premium/exporters/shared.js';
import { indoorTotalM2 } from '../src/ui/schedules.js';
import { mutedLine } from '../src/lotcard/lot-card.js';

const house = () => migrate(catalogue.createFromTemplate('house_single'));
const lotOnHouse = () => {
  const p = house();
  const f = FIXTURES[0];
  p.site.lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
  return p;
};

test('stats: beds, baths, cars and areas come from the model, a missing figure is omitted', () => {
  const p = lotOnHouse();
  const s = Object.fromEntries(cardStats(p).map((c) => [c.key, c.value]));
  assert.ok(s.lot && Number(String(s.lot).replace(/,/g, '')) > 100);
  const beds = p.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom').length;
  assert.equal(s.beds, String(beds));
  assert.ok(Number(s.total.replace(/,/g, '')) >= Number(s.indoor.replace(/,/g, '')), 'total roofed includes the garage and is at least the indoor area');
  const bare = createProject();
  assert.deepEqual(cardStats(bare).map((c) => c.key), [], 'an empty design derives nothing');
  const noGarage = lotOnHouse();
  for (const l of noGarage.levels) l.rooms = l.rooms.filter((r) => r.type !== 'garage' && r.type !== 'carport');
  assert.ok(!cardStats(noGarage).some((c) => c.key === 'cars'));
});

test('stats: roofed area counts the alfresco and garage but not a deck', () => {
  const p = createProject();
  const sq = (x, y, w, d) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
  p.levels[0].rooms.push({ id: 'a', type: 'living', name: 'L', polygon: sq(0, 0, 4000, 5000) }, { id: 'b', type: 'garage', name: 'G', polygon: sq(4000, 0, 3000, 5000) }, { id: 'c', type: 'deck', name: 'D', outdoor: true, polygon: sq(0, 5000, 4000, 2000) }, { id: 'd', type: 'alfresco', name: 'A', outdoor: true, polygon: sq(0, 7000, 4000, 2000) });
  assert.equal(roofedAreaM2(p), 20 + 15 + 8);
  assert.equal(Math.round(indoorTotalM2(p)), 35, 'indoor is the export figure: the garage is included');
});

test('stats: indoor agrees with the exports and the status bar', () => {
  const p = lotOnHouse();
  const exportIndoor = scheduleData(p).totals.reduce((a, t) => a + t.indoor, 0);
  assert.equal(indoorTotalM2(p), exportIndoor);
  const s = Object.fromEntries(cardStats(p).map((c) => [c.key, c.value]));
  assert.equal(s.indoor, Math.round(exportIndoor).toLocaleString('en-AU'));
});

test('lot heading: real Lot x DP y on a real lot, Proposed Lot n for a concept lot, real area and size', () => {
  const lot = lotOnHouse().site.lot;
  assert.match(lotHeading(lot), /^Lot \S+ DP ?\S+/);
  assert.equal(lotHeading({ lotNumber: '3', planLabel: '', proposed: true }), 'Proposed Lot 3');
  assert.equal(lotHeading({ proposed: true }), 'Proposed Lot 1');
  const size = lotSize(lot);
  assert.equal(size.areaM2, lot.areaM2);
  assert.match(lotLine(lot), /m² · \d+\.\d × \d+\.\d m$/);
  assert.equal(lotHeading(null), '');
});

test('colour schemes: eight presets, default has a charcoal roof, applying lays colours over the finishes', () => {
  assert.ok(SCHEMES.length >= 8);
  const std = schemeById(DEFAULT_SCHEME_ID);
  const rgb = std.roof.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  assert.ok(Math.max(...rgb) < 0x60, 'standard roof is dark');
  for (const s of SCHEMES) assert.match(s.roof, /^#[0-9a-f]{6}$/i);
  const fin = { roof: { material: 'corrugated', colour: 'steel-off-white' }, externalWalls: { material: 'brick', colour: 'brick-red' }, fascia: { colour: 'x' } };
  const a = applySchemeToFinishes(fin, 'monument-shale');
  assert.equal(a.roof.colour, '#42474c');
  assert.equal(a.roof.material, 'corrugated');
  assert.equal(a.externalWalls.colour, '#d2cabb');
  assert.equal(applySchemeToFinishes(fin, 'standard').externalWalls.colour, 'brick-red', 'standard keeps the design walls');
  assert.equal(fin.roof.colour, 'steel-off-white', 'input untouched');
  assert.equal(schemeLine(schemeById('monument-shale')), 'Monument roof, Shale walls');
  assert.equal(schemeLine(std), 'Standard colours');
});

test('colour schemes: persisted choice wins, a lot defaults to standard, no lot shows the design as drawn', () => {
  const p = house();
  assert.equal(effectiveSchemeId(p), null);
  const q = lotOnHouse();
  assert.equal(effectiveSchemeId(q), 'standard');
  q.colourScheme = 'woodland-dune';
  assert.equal(effectiveSchemeId(migrate(structuredClone(q))), 'woodland-dune', 'survives migrate (save and share)');
  q.colourScheme = 'nope';
  assert.equal(effectiveSchemeId(q), 'standard');
});

test('colour schemes: the 3D model uses the scheme colours (roof and walls change)', () => {
  const colours = (p) => {
    const g = buildModel(p, {});
    const set = new Set();
    g.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m?.color && set.add(m.color.getHexString())); });
    return set;
  };
  const q = lotOnHouse();
  q.colourScheme = 'ironstone-brick';
  const set = colours(q);
  assert.ok(set.has('9b5a43'), 'brick wall colour present');
  q.colourScheme = 'nightsky-white';
  const set2 = colours(q);
  assert.ok(set2.has('f1efe9') && !set2.has('9b5a43'));
});

test('setback line: amber when no rule is loaded, red names the edges, green inside, amber when flagged', () => {
  const p = lotOnHouse();
  p.site.lot.setbacks = null;
  assert.equal(setbackStatusLine(p).state, 'check');
  assert.match(setbackStatusLine(p).text, /check with council/);
  const none = createProject();
  assert.equal(setbackStatusLine(none).state, 'none');
  const q = lotOnHouse();
  const slot = (m) => ({ minM: m, calc: 'fixed' });
  q.site.lot.setbacks = { front: slot(900), side: slot(900), rear: slot(900), secondaryFront: slot(900) };
  const far = setbackStatusLine(q);
  assert.equal(far.state, 'outside');
  assert.match(far.text, /^Outside the setbacks: /);
  assert.ok(!/complian/i.test(far.text));
  q.site.lot.setbacks = { front: slot(0), side: slot(0), rear: slot(0), secondaryFront: slot(0) };
  const ok = setbackStatusLine(q);
  assert.ok(['inside', 'check'].includes(ok.state));
  if (ok.state === 'inside') assert.equal(ok.text, 'Fits the setbacks');
  if (ok.state === 'inside') {
    q.site.lot.setbacks.flag = 'check';
    assert.equal(setbackStatusLine(q).state, 'check');
    assert.equal(setbackStatusLine(q).text, 'Fits the setbacks, check with council');
  }
});

test('carousel: stepping wraps, text is NAME · i / n, builder library only, ranked', () => {
  assert.equal(stepIndex(4, 3, 1), 0);
  assert.equal(stepIndex(4, 0, -1), 3);
  const ds = [{ name: 'A' }, { name: 'B' }];
  assert.equal(pagerText(ds, 1), 'B · 2 / 2');
  assert.equal(currentIndex(ds, { name: 'B' }), 1);
  assert.equal(currentIndex(ds, { placedHouse: { name: 'B' } }), 1);
  const all = [{ id: '1', name: 'Mine', group: 'builder', project: house() }, { id: '2', name: 'Glide', group: 'glide', project: house() }];
  const p = lotOnHouse();
  assert.deepEqual(builderDesigns(p, all).map((d) => d.name), ['Mine']);
  assert.deepEqual(builderDesigns(p, [all[1]]).map((d) => d.name), ['Glide'], 'falls back to the Glide Inside library only when the builder has none');
  assert.deepEqual(builderDesigns(p, [all[1]], { allowGlide: false }), [], 'a client never sees the Glide library');
  assert.ok(publicDesigns(catalogue, p).length >= 3);
  assert.equal(mutedLine('Hunter Homes'), 'Hunter Homes · Concept only');
  assert.equal(mutedLine(''), 'Concept only');
});

test('room tabs: only rooms the design has, aerial last; rooms plan covers every room', () => {
  const p = house();
  const tabs = listRoomTabs(p);
  assert.equal(tabs.at(-1).id, 'aerial');
  const grouped = listRoomTabs(p, null, { groupBedrooms: true });
  assert.ok(grouped.filter((t) => t.id === 'bedrooms').length <= 1);
  assert.ok(!grouped.some((t) => t.id === 'master' || /^bed\d/.test(t.id)), 'grouped: one Bedrooms tab');
  const types = new Set(p.levels.flatMap((l) => l.rooms).map((r) => r.type));
  assert.equal(tabs.some((t) => t.id === 'garage'), p.levels.flatMap((l) => l.rooms).some((r) => /garage|carport/i.test(`${r.type} ${r.name}`)));
  assert.equal(tabs.some((t) => t.id === 'kitchen'), p.levels.flatMap((l) => l.rooms).some((r) => /kitchen/i.test(`${r.type} ${r.name}`)));
  for (const t of tabs) assert.ok(!/[–—]/.test(t.caption));
  const m = roomsPlanModel(p, 150, 100);
  assert.equal(m.rooms.length, p.levels.flatMap((l) => l.rooms).length);
  for (const t of tabs) for (const id of t.roomIds) assert.ok(m.rooms.some((r) => r.id === id));
});

test('swap: replaces the design on the lot in one undo step, keeps the lot and scheme, records the design', () => {
  const p = lotOnHouse();
  p.colourScheme = 'woodland-dune';
  const store = createStore(p, { autosaveKey: null, opContext: { catalogue } });
  const other = migrate(catalogue.createFromTemplate('granny_flat'));
  const before = store.project.levels.flatMap((l) => l.rooms).length;
  swapHouse(store, other, { id: 'granny_flat', name: 'Granny flat' });
  const rooms = store.project.levels.flatMap((l) => l.rooms);
  assert.equal(rooms.length, other.levels.flatMap((l) => l.rooms).length);
  assert.notEqual(rooms.length, before);
  assert.ok(store.project.site.lot);
  assert.equal(store.project.colourScheme, 'woodland-dune');
  assert.equal(store.project.placedHouse.name, 'Granny flat');
  store.undo();
  assert.equal(store.project.levels.flatMap((l) => l.rooms).length, before);
});

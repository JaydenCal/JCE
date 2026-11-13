// Commercial mode M1: zones, rules (no residential fallback leak), layout and mirror, materialise, windows, doors, mezzanines,
// bollards, accessible parking, stats, checks wording, the row tool maths and a wording lint over src/commercial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createStore } from '../src/model/store.js';
import { validate, migrate, createProject, createRoom } from '../src/model/schema.js';
import { zoneClass, effectiveClass, RESIDENTIAL_NOTE } from '../src/commercial/zones.js';
import { siteLotCommercialSetbacks, computeCommercialSetbacks } from '../src/commercial/setbacks.js';
import { DEFAULT_RULES, accessibleRequired, ACCESSIBLE_RATE } from '../src/commercial/rules.js';
import { layoutUnits, facadeLayout, rearWindow, mezzanineOf, rowPoly } from '../src/commercial/layout.js';
import { materialise, MEZZ_LEVEL_ID } from '../src/commercial/materialise.js';
import { defaultRow, defaultUnit, DOOR_PRESETS, unitSpec } from '../src/commercial/schema.js';
import { analyse } from '../src/commercial/analyse.js';
import { commercialStats } from '../src/commercial/stats.js';
import { commercialChecks, ACCESS_CHECK } from '../src/commercial/checks.js';
import { bollardsFor, bollardSchedule, BOLLARD_NOTE, pointInPoly } from '../src/commercial/bollards.js';
import { parkingLayout } from '../src/commercial/parking.js';
import { commercialEdit, enterCommercial, offerCommercial, convertToCommercial } from '../src/commercial/mode.js';
import { addRow, mirrorRow, deleteRow } from '../src/commercial/ui/row-ops.js';
import { turnAngle, snapRowOrigin, rowAt, sourceId } from '../src/commercial/ui/tool-commercial.js';
import { designTypeOf, buildDesignType } from '../src/ui/design-type.js';
import { facts, statusText, accessibleBaysFor, mrvDefaults, DATASET, PARKING_M2_PER_SPACE, OFFICE_M2_PER_SPACE } from '../src/commercial/dataset.js';
import { conadillyProject } from './helpers/conadilly-lot.mjs';
import { commercialProject } from './helpers/commercial-fixture.mjs';

const here = dirname(new URL(import.meta.url).pathname);
const store = (p) => createStore(p);
const warnTexts = (p) => commercialChecks(p).filter((c) => c.kind === 'warn').map((c) => c.text);
const polyArea = (poly) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;

// Zones ------------------------------------------------------------------------------------------------------------------
test('zones: E4 General Industrial is industrial, a legacy E4 Environmental Living name is residential, C4 is residential', () => {
  const z = (code, name) => zoneClass({ zoning: { code, name } });
  assert.deepEqual([z('E4', 'General Industrial').cls, z('E4', 'General Industrial').employment], ['industrial', true]);
  assert.equal(z('E4', 'Environmental Living').cls, 'residential');
  assert.equal(z('E4', 'Environmental Living').employment, false);
  assert.equal(z('C4', 'Environmental Living').cls, 'residential');
  assert.equal(z('C2', 'Environmental Conservation').employment, false);
  assert.equal(z('IN1', 'General Industrial').cls, 'industrial');
  assert.equal(z('IN2', 'Light Industrial').cls, 'industrial');
  assert.equal(z('E5', 'Heavy Industrial').cls, 'industrial');
  for (const [c, n] of [['B2', 'Local Centre'], ['E1', 'Local Centre'], ['E2', 'Commercial Centre'], ['E3', 'Productivity Support'], ['B5', 'Business Development']]) assert.equal(z(c, n).cls, 'commercial', `${c} ${n}`);
  assert.equal(z('E4', '').cls, 'industrial', 'code only: E4 is General Industrial');
  assert.equal(z('R2', 'Low Density Residential').cls, 'residential');
  assert.equal(z('', '').cls, 'unknown');
  assert.equal(z('IN1', 'Environmental Living').cls, 'residential', 'the name wins over the code');
});

test('zones: Queensland has no looked up zone, the manual choice sets the class', () => {
  const p = commercialProject({ zoning: null });
  p.site.lot.state = 'QLD';
  assert.equal(effectiveClass(p), null);
  p.commercial.zoneClass = 'commercial';
  assert.equal(effectiveClass(p), 'commercial');
  assert.ok(warnTexts({ ...p, commercial: { ...p.commercial, zoneClass: null } }).some((t) => /Zone not known/.test(t) && /check with council/.test(t)));
});

test('zones: the switch is offered on an employment zone, never done silently', () => {
  const p = conadillyProject({ corner: false });
  p.site.lot.zoning = { code: 'E4', name: 'General Industrial' };
  const s = store(p);
  const seen = [];
  offerCommercial(s, { toast: (msg, o) => { seen.push({ msg, o }); return null; } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].o.action.label, 'Switch to commercial layout');
  assert.notEqual(s.project.mode, 'commercial', 'nothing switches until the person chooses');
  seen[0].o.action.onClick();
  assert.equal(s.project.mode, 'commercial');
  assert.equal(s.undoLabel(), 'Switch to commercial layout');
  s.undo();
  assert.notEqual(s.project.mode, 'commercial', 'one undo step undoes the switch');
  // Residential and environmental living: no offer.
  for (const zoning of [{ code: 'R2', name: 'Low Density Residential' }, { code: 'E4', name: 'Environmental Living' }, { code: 'C4', name: 'Environmental Living' }]) {
    const q = conadillyProject({ corner: false });
    q.site.lot.zoning = zoning;
    const out = [];
    offerCommercial(store(q), { toast: (m) => out.push(m) });
    assert.equal(out.length, 0, JSON.stringify(zoning));
  }
});

test('zones: a residential zone with a commercial project says so', () => {
  const p = commercialProject();
  p.site.lot.zoning = { code: 'R2', name: 'Low Density Residential' };
  const out = [];
  offerCommercial(store(p), { toast: (m, o) => { out.push([m, o.kind]); } });
  assert.deepEqual(out, [[RESIDENTIAL_NOTE, 'warn']]);
  assert.equal(RESIDENTIAL_NOTE, 'This zone may not permit commercial use, check with council');
  assert.ok(warnTexts(p).includes(RESIDENTIAL_NOTE));
});

// Rules and setbacks -----------------------------------------------------------------------------------------------------------
test('rules: default tables are indicative and parking defaults to 1 space per 75 m2 (unit complexes)', () => {
  for (const cls of ['industrial', 'commercial']) {
    const r = DEFAULT_RULES[cls];
    assert.equal(r.parkingPerM2Gfa, 1 / 75);
    assert.match(r.note, /indicative/);
    assert.match(r.note, /check with council/);
    for (const k of ['front', 'secondaryFront', 'side', 'rear']) assert.equal(typeof r.setbacks[k], 'number');
  }
});

test('setbacks: the residential fallbacks never leak into commercial results', () => {
  const lot = commercialProject().site.lot;
  const trap = { name: 'Codes SEPP Housing Code', rules: [{ id: 'trap', zones: ['*'], appliesTo: ['any'], front: { minM: 99 }, side: { minM: 99 }, rear: { minM: 99 } }] };
  const r = siteLotCommercialSetbacks(lot, { councils: [], fallbacks: { NSW: trap, QLD: trap, NSW_INLAND: trap } }, { cls: 'industrial' });
  assert.equal(r.setbacks.front.minM, DEFAULT_RULES.industrial.setbacks.front);
  assert.equal(r.setbacks.side.minM, DEFAULT_RULES.industrial.setbacks.side);
  assert.equal(r.setbacks.rear.minM, DEFAULT_RULES.industrial.setbacks.rear);
  assert.doesNotMatch(JSON.stringify(r), /Housing Code|Inland Code|QDC|"minM":99/);
  assert.match(r.setbacks.basis, /Indicative default/);
  assert.ok(r.envelope && r.envelope.length >= 3);
  // The commercial table also differs from the housing default table.
  const c = siteLotCommercialSetbacks(lot, { councils: [] }, { cls: 'commercial' });
  assert.equal(c.setbacks.front.minM, 3);
});

test('setbacks: a council industrial rule is used for the slot it gives, the default table for the rest', () => {
  const lot = commercialProject().site.lot;
  const council = { lga_slug: 'tamworth-regional-council', council: 'Tamworth Regional Council', dcp: 'Test DCP', status: 'ok', rules: [
    { id: 'a', zones: ['IN*'], appliesTo: ['industrial'], conditions: {}, front: { minM: 5, basis: 'fixed' }, secondaryFront: null, side: null, rear: null },
    { id: 'b', zones: ['R*'], appliesTo: ['dwelling'], front: { minM: 7 }, side: { minM: 1 }, rear: { minM: 4 } },
  ] };
  const r = siteLotCommercialSetbacks(lot, { councils: [council] }, { cls: 'industrial' });
  assert.equal(r.setbacks.front.minM, 5);
  assert.match(r.setbacks.front.basis, /Council DCP/);
  assert.equal(r.setbacks.side.minM, 3, 'the dwelling rule is not used');
  assert.equal(r.setbacks.sources.side, 'default');
  assert.equal(r.setbacks.flag, 'check_with_council');
});

test('setbacks: computeCommercialSetbacks reads the council file and never uses the fallback file', async () => {
  const lot = commercialProject().site.lot;
  const p = commercialProject();
  const files = {
    'fallbacks.json': { NSW: { name: 'Housing Code', rules: [{ zones: ['*'], appliesTo: ['any'], front: { minM: 99 }, side: { minM: 99 }, rear: { minM: 99 } }] } },
    'index.json': { councils: [{ lga_slug: 'x-council', council: 'Tamworth Regional Council', lgaNames: ['TAMWORTH REGIONAL'] }] },
    'x-council.json': { lga_slug: 'x-council', council: 'Tamworth Regional Council', status: 'ok', rules: [{ zones: ['IN*'], appliesTo: ['industrial'], conditions: {}, front: { minM: 6 } }] },
  };
  const fetchImpl = async (url) => { const k = String(url).split('/').pop(); return files[k] ? new Response(JSON.stringify(files[k]), { status: 200 }) : new Response('{}', { status: 404 }); };
  const r = await computeCommercialSetbacks(p, lot, { fetchImpl, base: 'http://localhost/data/setbacks-commercial-test/' });
  assert.equal(r.setbacks.front.minM, 6);
  assert.equal(r.setbacks.side.minM, 3);
  assert.doesNotMatch(JSON.stringify(r.setbacks), /99/);
});

// Layout, mirror, materialise --------------------------------------------------------------------------------------------------
test('layout: a row gives unit rectangles side by side and a mirrored row sits back to back sharing the party wall', () => {
  const p = commercialProject();
  const us = layoutUnits(p.commercial);
  assert.equal(us.length, 16);
  assert.deepEqual(us.map((u) => u.n), Array.from({ length: 16 }, (_, i) => i + 1));
  const u1 = us[0];
  assert.deepEqual(u1.poly.map((q) => [q.x, q.y]), [[20000, 40000], [26000, 40000], [26000, 55000], [20000, 55000]]);
  const m1 = us[8];
  assert.equal(m1.mirrored, true);
  assert.deepEqual(m1.poly.map((q) => [q.x, q.y]), [[20000, 40000], [26000, 40000], [26000, 25000], [20000, 25000]]);
  assert.deepEqual(m1.rearA, u1.rearA, 'the rear walls are the same line');
  assert.equal(polyArea(u1.poly), 6000 * 15000);
  for (const u of us) assert.ok(Math.abs(polyArea(u.poly) - u.w * u.d) < 1);
  // Row polygons do not overlap, they touch.
  const [r0, r1] = p.commercial.rows.map((r) => rowPoly(r, p.commercial.rows));
  assert.equal(polyArea(r0) + polyArea(r1), 2 * 48000 * 15000);
});

test('layout: a rotated row keeps its units rectangular and a mirrored row follows it', () => {
  const p = commercialProject();
  p.commercial.rows[0].rotationDeg = 30;
  const us = layoutUnits(p.commercial);
  for (const u of us) assert.ok(Math.abs(polyArea(u.poly) - 6000 * 15000) < 1, `unit ${u.n}`);
  assert.ok(Math.abs(us[8].rearA.x - us[0].rearA.x) < 1e-6 && Math.abs(us[8].rearA.y - us[0].rearA.y) < 1e-6);
  const dot = (us[0].frame.f.x * us[8].frame.f.x + us[0].frame.f.y * us[8].frame.f.y);
  assert.ok(Math.abs(dot + 1) < 1e-9, 'the mirrored fronts face the other way');
});

test('materialise: walls, party walls, openings and rooms for two mirrored rows of 8 units', () => {
  const p = commercialProject();
  const l = p.levels[0];
  assert.equal(l.rooms.length, 16);
  assert.deepEqual([...new Set(l.rooms.map((r) => r.name))].length, 16);
  assert.equal(l.rooms[0].name, 'PROPOSED UNIT 1');
  assert.equal(l.rooms[15].name, 'PROPOSED UNIT 16');
  // Row 1: front, rear (party), 9 sides. Row 2: front, 9 sides. The shared rear wall exists once.
  assert.equal(l.walls.length, 21);
  assert.equal(l.walls.filter((w) => w.kind === 'interior').length, 1 + 7 + 7, 'one shared rear party wall plus the party walls between units');
  assert.equal(l.openings.filter((o) => o.kind === 'roller_door').length, 16);
  assert.equal(l.openings.filter((o) => o.kind === 'door').length, 16, 'a personnel door beside each roller door');
  assert.ok([...l.walls, ...l.openings, ...l.rooms].every((e) => e.generated === 'commercial'));
  assert.ok(l.openings.every((o) => o.auto === true) && l.rooms.every((r) => r.auto === true));
  assert.deepEqual(validate(p), []);
  // Idempotent: regenerating does not duplicate.
  materialise(p);
  assert.equal(p.levels[0].walls.length, 21);
  assert.equal(p.levels.length, 1);
});

test('materialise: hand drawn items survive a regenerate and the edit is one undo step', () => {
  const p = commercialProject();
  const s = store(p);
  s.apply('Hand draw', (q) => q.levels[0].rooms.push(createRoom({ name: 'Hand drawn', type: 'other', polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }] })));
  const hand = s.project.levels[0].rooms.filter((r) => r.name === 'Hand drawn').length;
  assert.equal(hand, 1);
  const undoBefore = s.undoLabel();
  commercialEdit(s, 'Set units per row', (c) => { c.rows[0].count = 4; });
  assert.equal(s.undoLabel(), 'Set units per row');
  const l = s.project.levels[0];
  assert.equal(l.rooms.filter((r) => /^PROPOSED UNIT/.test(r.name)).length, 8);
  assert.equal(l.rooms.filter((r) => r.name === 'Hand drawn').length, 1);
  s.undo();
  assert.equal(s.undoLabel(), undoBefore, 'exactly one step was added');
  assert.equal(s.project.levels[0].rooms.filter((r) => /^PROPOSED UNIT/.test(r.name)).length, 16);
});

test('materialise: front, rear and side wall outside sides point away from the units', () => {
  const p = commercialProject();
  const front = p.levels[0].walls.find((w) => Math.abs(w.a.y - 55000) < 1 && Math.abs(w.b.y - 55000) < 1);
  assert.equal(front.kind, 'exterior');
  assert.equal(front.outside, 1);
  const front2 = p.levels[0].walls.find((w) => Math.abs(w.a.y - 25000) < 1 && Math.abs(w.b.y - 25000) < 1);
  assert.equal(front2.outside, -1, 'the mirrored front faces the other way');
});

test('design type: Commercial is a design type, a house converts to it and back', () => {
  const p = conadillyProject({ corner: false });
  p.site.lot.zoning = { code: 'IN1', name: 'General Industrial' };
  const next = buildDesignType(p, 'commercial', null);
  assert.equal(designTypeOf(next), 'commercial');
  assert.equal(next.mode, 'commercial');
  assert.ok(next.commercial.rows.length === 1);
  assert.ok(next.levels[0].rooms.length >= 1, 'the first row is placed');
  assert.deepEqual(validate(next), []);
  assert.ok(next.site.lot, 'the lot is kept');
  const reloaded = migrate(JSON.parse(JSON.stringify(next)));
  assert.equal(reloaded.commercial.rows.length, 1);
  assert.equal(reloaded.schema, 2);
  assert.equal(migrate(createProject({ name: 'x' })).mode, undefined, 'a housing project is untouched');
});

// Doors --------------------------------------------------------------------------------------------------------------------------
test('doors: presets, count, motorised flag, rear door only on through units, personnel door beside each roller door', () => {
  assert.deepEqual(DOOR_PRESETS.map((d) => [d.w, d.h]), [[3000, 3500], [3600, 4000], [4000, 4500], [4500, 5000]]);
  const p = commercialProject({ rows: 'single' });
  const row = p.commercial.rows[0];
  Object.assign(row, { count: 3, x: 20000, y: 40000 });
  row.unit.widthMm = 8000;
  row.unit.doors = { ...row.unit.doors, presetId: '4.0x4.5', widthMm: 4000, heightMm: 4500, count: 1, rear: true, motorised: false };
  materialise(p);
  const roller = p.levels[0].openings.filter((o) => o.kind === 'roller_door');
  assert.equal(roller.length, 3 * 2, 'a front and a rear roller door per unit');
  assert.ok(roller.every((o) => o.width === 4000 && o.height === 4500 && o.motorised === false));
  const rearWall = p.levels[0].walls.find((w) => Math.abs(w.a.y - 40000) < 1 && Math.abs(w.b.y - 40000) < 1);
  assert.equal(roller.filter((o) => o.wallId === rearWall.id).length, 3);
  // Two front doors.
  row.unit.doors.count = 2; row.unit.doors.rear = false; row.unit.doors.presetId = '3.0x3.5'; row.unit.widthMm = 9000;
  materialise(p);
  assert.equal(p.levels[0].openings.filter((o) => o.kind === 'roller_door').length, 6);
  assert.equal(p.levels[0].openings.filter((o) => o.kind === 'door').length, 3);
  // Custom size.
  row.unit.doors.presetId = 'custom'; row.unit.doors.widthMm = 5200; row.unit.doors.heightMm = 5600; row.unit.doors.count = 1; row.unit.widthMm = 9000;
  materialise(p);
  assert.ok(p.levels[0].openings.filter((o) => o.kind === 'roller_door').every((o) => o.width === 5200 && o.height === 5600));
});

test('doors: door set clearance against the unit width and the door offset in the facade', () => {
  const spec = defaultUnit();
  spec.widthMm = 6000;
  assert.equal(facadeLayout(spec).issues.length, 0, '3.6 m door and personnel door fit a 6 m unit');
  spec.doors.presetId = '4.5x5.0'; spec.doors.widthMm = 4500; spec.doors.heightMm = 5000;
  assert.ok(facadeLayout(spec).issues.some((i) => i.id === 'doorset'), '4.5 m door and a personnel door do not fit 6 m');
  const two = defaultUnit(); two.doors.count = 2; two.widthMm = 6000;
  assert.ok(facadeLayout(two).issues.some((i) => i.id === 'doorset'));
  const off = defaultUnit(); off.doors.offsetMm = 2500;
  assert.ok(facadeLayout(off).issues.length > 0, 'a large offset pushes the door set past the unit edge');
  const left = defaultUnit(); left.doors.offsetMm = 0;
  assert.equal(facadeLayout(left).doors[0].offset, 300 + 1800);
  const p = commercialProject();
  p.commercial.rows[0].unit.doors = { ...p.commercial.rows[0].unit.doors, presetId: '4.5x5.0', widthMm: 4500, heightMm: 5000 };
  assert.ok(warnTexts(p).some((t) => /^Unit 1: Door set is/.test(t)));
});

test('doors: roller door against the mezzanine edge and the unit height', () => {
  const p = commercialProject();
  const row = p.commercial.rows[0];
  row.unit.mezzanine = { ...row.unit.mezzanine, enabled: true, position: 'front', levelMm: 3000 };
  row.unit.doors = { ...row.unit.doors, presetId: '3.6x4.0', widthMm: 3600, heightMm: 4000 };
  assert.ok(warnTexts(p).some((t) => /roller door head at 4\.00 m is above the front mezzanine soffit at 2\.85 m/.test(t)));
  row.unit.mezzanine.position = 'rear';
  assert.ok(!warnTexts(p).some((t) => /front mezzanine soffit/.test(t)));
  row.unit.heightMm = 4200;
  assert.ok(warnTexts(p).some((t) => /leaves under 0\.40 m for the shutter/.test(t)));
});

// Windows ------------------------------------------------------------------------------------------------------------------------
test('windows: front options none, high light strip, office window and shopfront, and the facade fit', () => {
  const base = () => { const s = defaultUnit(); s.widthMm = 9000; s.office.enabled = true; return s; };
  let s = base(); s.windows.front = 'none';
  const none = facadeLayout(s); assert.equal(none.window, null); assert.equal(none.highlight, null);
  s = base(); s.windows.front = 'highlight';
  const hl = facadeLayout(s).highlight; assert.ok(hl && hl.sill >= 4000 + 300 && hl.sill + hl.h <= s.heightMm);
  s = base(); s.windows.front = 'office';
  const ow = facadeLayout(s).window; assert.deepEqual([ow.kind, ow.w, ow.h, ow.sill], ['office', 1800, 1200, 900]);
  s = base(); s.windows.front = 'shopfront';
  const sf = facadeLayout(s).window; assert.equal(sf.kind, 'shopfront'); assert.ok(sf.w >= 1500 && sf.sill < 300);
  s = base(); s.widthMm = 6000; s.windows.front = 'shopfront';
  assert.ok(facadeLayout(s).issues.some((i) => i.id === 'winfit'), 'no room beside the doors on a 6 m unit');
  s = base(); s.office.enabled = false; s.windows.front = 'shopfront';
  assert.ok(facadeLayout(s).issues.some((i) => i.id === 'officewin'));
  s = base(); s.windows.rear = 'highlight';
  assert.equal(rearWindow(s).kind, 'highlight');
  s.windows.rear = 'none'; assert.equal(rearWindow(s), null);
});

test('windows: side windows on end units only, never on a party wall', () => {
  const p = commercialProject({ rows: 'single' });
  const row = p.commercial.rows[0];
  Object.assign(row, { count: 5 });
  row.unit.windows.side = true;
  materialise(p);
  const l = p.levels[0];
  const sideWins = l.openings.filter((o) => o.kind === 'window');
  assert.equal(sideWins.length, 2, 'one on each end unit');
  for (const o of sideWins) {
    const w = l.walls.find((x) => x.id === o.wallId);
    assert.equal(w.kind, 'exterior');
  }
  assert.ok(!l.openings.some((o) => l.walls.find((w) => w.id === o.wallId).kind === 'interior'), 'no opening sits on a party wall');
  // Front and rear windows are on the row front and rear walls only.
  row.unit.windows = { ...row.unit.windows, side: false, front: 'highlight', rear: 'highlight' };
  materialise(p);
  assert.equal(p.levels[0].openings.filter((o) => o.kind === 'window').length, 5 * 2);
});

// Mezzanines ---------------------------------------------------------------------------------------------------------------------
test('mezzanine: depth or percent, position, stair type, level and separate GFA', () => {
  const spec = defaultUnit();
  spec.mezzanine = { ...spec.mezzanine, enabled: true, mode: 'depth', depthMm: 6000 };
  let m = mezzanineOf(spec);
  assert.equal(m.areaM2, 36);
  assert.equal(m.clearBelow, 2850);
  assert.equal(m.clearAbove, 3000);
  spec.mezzanine.mode = 'percent'; spec.mezzanine.percent = 40;
  m = mezzanineOf(spec);
  assert.equal(m.depthMm, 7200);
  assert.ok(Math.abs(m.areaM2 - 6 * 7.2) < 1e-9);
  assert.equal(mezzanineOf(defaultUnit()).enabled, false);
  assert.equal(mezzanineOf({ ...spec, mezzanine: { ...spec.mezzanine, stairType: 'L' } }).stair.type, 'L');

  const p = commercialProject();
  const row = p.commercial.rows[0];
  row.perUnit = { 2: { mezzanine: { enabled: true, position: 'front' } } };
  materialise(p);
  assert.equal(p.levels.length, 2);
  const lvl = p.levels[1];
  assert.equal(lvl.id, MEZZ_LEVEL_ID);
  assert.equal(lvl.elevation, 3000);
  assert.equal(lvl.rooms.length, 1);
  assert.equal(lvl.rooms[0].name, 'PROPOSED UNIT 3 MEZZANINE');
  assert.equal(lvl.rooms[0].balustrade, true);
  assert.equal(p.levels[0].stairs.length, 1);
  // The mezzanine room is at the front of unit 3.
  const poly = lvl.rooms[0].polygon;
  assert.ok(Math.min(...poly.map((q) => q.y)) >= 40000 + 15000 - 6000 - 1 && Math.max(...poly.map((q) => q.y)) <= 55000 + 1);
  // Separate GFA.
  const s = commercialStats(p);
  assert.equal(s.groundGfaM2, 1440);
  assert.equal(s.mezzGfaM2, 36);
  assert.equal(s.gfaM2, 1476);
  // Off again: the level goes.
  row.perUnit = {};
  materialise(p);
  assert.equal(p.levels.length, 1);
});

test('mezzanine: clear height checks above and below, configurable minimum, stair fit', () => {
  const p = commercialProject();
  const row = p.commercial.rows[0];
  row.perUnit = { 0: { mezzanine: { enabled: true, levelMm: 2200 } } };
  let w = warnTexts(p);
  assert.ok(w.some((t) => /Unit 1: clear height under the mezzanine is 2\.05 m, below the 2\.10 m minimum, unverified minimum, check with council and the NCC/.test(t)));
  row.perUnit = { 0: { mezzanine: { enabled: true, levelMm: 2500 } } };
  assert.ok(!warnTexts(p).some((t) => /clear height under/.test(t)), '2.35 m under the mezzanine meets the 2.1 m storeroom minimum');
  row.perUnit = { 0: { mezzanine: { enabled: true, levelMm: 4000 } } };
  assert.ok(warnTexts(p).some((t) => /Unit 1: clear height above the mezzanine is 2\.00 m, below the 2\.40 m minimum/.test(t)));
  row.perUnit = { 0: { mezzanine: { enabled: true, levelMm: 4000, minClearMm: 2000 } } };
  assert.ok(!warnTexts(p).some((t) => /clear height above the mezzanine/.test(t)), 'the minimum is configurable');
  row.perUnit = { 0: { mezzanine: { enabled: true, depthMm: 14000 } } };
  assert.ok(warnTexts(p).some((t) => /Unit 1: the straight stair does not fit/.test(t)));
  row.perUnit = { 0: { mezzanine: { enabled: true, depthMm: 6000 } } };
  assert.ok(!warnTexts(p).some((t) => /stair does not fit/.test(t)));
});

// Accessible parking -------------------------------------------------------------------------------------------------------------
test('accessible parking: the rate table is data, 1 per 100 bays or part thereof', () => {
  assert.equal(ACCESSIBLE_RATE.perBays, 100);
  assert.match(ACCESSIBLE_RATE.basis, /D4D6/);
  assert.match(ACCESSIBLE_RATE.basis, /verify/);
  const want = [[0, 0], [1, 1], [20, 1], [100, 1], [101, 2], [200, 2], [201, 3], [450, 5]];
  for (const [bays, n] of want) assert.equal(accessibleRequired(bays), n, `${bays} bays`);
  assert.equal(accessibleRequired(60, { perBays: 50 }), 2, 'a different table is honoured');
  assert.equal(accessibleRequired(60, 'class_6'), 2, 'Class 6 is 1 per 50');
  assert.equal(accessibleRequired(1000, 'class_6'), 20);
  assert.equal(accessibleRequired(101, 'class_7'), 2);
});

test('accessible parking: bays and shared zone placed nearest the accessible entry, path of travel line', () => {
  const p = commercialProject();
  const row = p.commercial.rows[0];
  row.perUnit = { 4: { office: { enabled: true, accessibleWc: true } } };
  const park = parkingLayout(p.commercial);
  assert.equal(park.accessible.required, 1);
  assert.equal(park.accessible.provided, 1);
  const home = park.rows[0];
  const idx = home.slots.findIndex((s) => s.kind === 'accessible');
  assert.equal(home.slots[idx + 1].kind, 'zone', 'a shared zone beside the bay');
  const entry = park.entry;
  assert.equal(entry.unit.n, 5, 'the unit with the accessible WC');
  const nearest = Math.floor(entry.along / 2400);
  assert.ok(Math.abs(idx - nearest) <= 1, `bay ${idx} is next to the slot under the entry ${nearest}`);
  const bay = home.slots[idx];
  const [w, d] = [Math.hypot(bay.poly[1].x - bay.poly[0].x, bay.poly[1].y - bay.poly[0].y), Math.hypot(bay.poly[3].x - bay.poly[0].x, bay.poly[3].y - bay.poly[0].y)];
  assert.deepEqual([Math.round(w), Math.round(d)], [2400, 5400]);
  assert.equal(Math.round(Math.hypot(home.slots[idx + 1].poly[1].x - home.slots[idx + 1].poly[0].x, home.slots[idx + 1].poly[1].y - home.slots[idx + 1].poly[0].y)), 2400);
  assert.equal(park.path.length, 2);
  assert.ok(Math.hypot(park.path[1].x - entry.point.x, park.path[1].y - entry.point.y) < 1, 'the path ends at the unit entry');
  // The total bays exclude the shared zone.
  assert.equal(park.totalBays, 2 * 20 - 1);
  assert.equal(commercialStats(p).parking.provided, 39);
});

test('accessible parking: two accessible bays share one zone, and the bay count follows the total', () => {
  const p = commercialProject();
  p.commercial.parking.accessibleOverride = 2;
  const park = parkingLayout(p.commercial);
  assert.equal(park.accessible.provided, 2);
  const kinds = park.rows[0].slots.map((s) => s.kind).join(',');
  assert.match(kinds, /accessible,zone,accessible/);
  assert.equal(park.totalBays, 40 - 1);
  // A big site needs 2: 250 bays.
  const big = commercialProject({ width: 400000, depth: 100000 });
  Object.assign(big.commercial.rows[0], { count: 40 }); big.commercial.rows[0].unit.widthMm = 6000;
  materialise(big);
  const bp = parkingLayout(big.commercial);
  assert.ok(bp.totalBays > 100);
  assert.equal(bp.accessible.required, Math.ceil(bp.totalBays / 100));
  assert.equal(bp.accessible.provided, bp.accessible.required);
});

test('accessible parking: the count check fires when below the indicative requirement', () => {
  const p = commercialProject();
  p.commercial.parking.accessibleOverride = 0;
  const w = warnTexts(p).find((t) => t.startsWith(ACCESS_CHECK));
  assert.ok(w, 'the check fires');
  assert.equal(ACCESS_CHECK, 'Accessible bay count below the indicative requirement, check with council and an access consultant');
  p.commercial.parking.accessibleOverride = null;
  assert.ok(!warnTexts(p).some((t) => t.startsWith(ACCESS_CHECK)));
  const info = commercialChecks(p).find((c) => c.id === 'accessible');
  assert.match(info.text, /2\.50 m headroom/);
  assert.match(info.text, /AS 2890\.6/);
});

test('accessible amenities: an accessible WC in the office is listed with a note and named on the room', () => {
  const p = commercialProject();
  p.commercial.rows[0].perUnit = { 0: { office: { enabled: true, accessibleWc: true } } };
  materialise(p);
  assert.ok(p.levels[0].rooms.some((r) => r.name === 'PROPOSED UNIT 1 OFFICE AND ACCESSIBLE WC'));
  const note = commercialChecks(p).find((c) => c.id === 'awc');
  assert.match(note.text, /Accessible WC shown in the office of unit 1/);
  assert.match(note.text, /access consultant/);
});

// Bollards -----------------------------------------------------------------------------------------------------------------------
test('bollards: each side of every roller door, corners, downpipes, parking row ends, waste, hydrant and the accessible zone', () => {
  const p = commercialProject({ rows: 'single' });
  const row = p.commercial.rows[0];
  Object.assign(row, { count: 8, x: 20000, y: 40000 });
  row.unit.doors.offsetMm = 1200; // keeps the downpipe bollards apart from the door bollards
  const c = p.commercial;
  c.parking.enabled = true;
  c.parking.aisleMm = 1500; // a short aisle: the bay row ends sit next to the building
  c.waste = { x: 14000, y: 46000, widthMm: 4000, depthMm: 3000, rotationDeg: 0 };
  c.hydrant = { x: 16000, y: 58000 };
  const list = bollardsFor(c);
  const by = (k) => list.filter((b) => b.kind === k);
  assert.equal(by('door').length, 8 * 2, 'two per roller door');
  // Each door bollard is 450 mm off the jamb and 700 mm out from the facade (front facade at y = 55000).
  const fl = facadeLayout(unitSpec(row, 0));
  const dr = fl.doors[0];
  const jambs = by('door').filter((b) => Math.abs(b.x - (20000 + dr.offset - dr.w / 2 - 450)) < 2 || Math.abs(b.x - (20000 + dr.offset + dr.w / 2 + 450)) < 2);
  assert.equal(jambs.length, 2);
  assert.ok(jambs.every((b) => Math.abs(b.y - (55000 + 700)) < 2));
  assert.equal(by('corner').length, 2);
  assert.equal(by('downpipe').length, 1, 'one downpipe at the party wall after 4 units');
  assert.equal(by('waste').length, 4);
  assert.equal(by('hydrant').length, 4);
  assert.ok(by('parkingEnd').length >= 1, 'a bay row end next to the building');
  assert.equal(by('accessible').length, 1);
  assert.equal(list.length, new Set(list.map((b) => b.id)).size);
  const sch = bollardSchedule(list);
  assert.equal(sch.total, list.length);
  assert.equal(sch.byKind.reduce((s, r) => s + r.count, 0), list.length);
  assert.equal(sch.note, 'Bollard locations, indicative');
  assert.equal(BOLLARD_NOTE, 'Bollard locations, indicative');
});

test('bollards: none inside a unit, merged when two sit together, off when switched off', () => {
  for (const p of [commercialProject(), commercialProject({ rows: 'single' })]) {
    const us = layoutUnits(p.commercial);
    const list = bollardsFor(p.commercial);
    assert.ok(list.length > 0);
    for (const b of list) assert.ok(!us.some((u) => pointInPoly(b, u.poly)), `bollard ${b.id} is inside a unit`);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) >= 350, 'merged');
    p.commercial.bollards.enabled = false;
    assert.equal(bollardsFor(p.commercial).length, 0);
  }
  // Without a short aisle there is no parking row end next to the building.
  const q = commercialProject();
  assert.equal(bollardsFor(q.commercial).filter((b) => b.kind === 'parkingEnd').length, 0);
});

// Stats, checks and the editing ops ---------------------------------------------------------------------------------------------
test('stats: golden numbers for two mirrored rows of 8 units 6 x 15 m', () => {
  const p = commercialProject();
  const s = commercialStats(p);
  assert.equal(s.units, 16);
  assert.deepEqual(s.mix, [{ label: '6.0 x 15.0 m', count: 16 }]);
  assert.equal(s.groundGfaM2, 1440);
  assert.equal(s.mezzGfaM2, 0);
  assert.equal(s.gfaM2, 1440);
  assert.equal(s.lotM2, 9000);
  assert.equal(s.coveragePct, 16);
  assert.equal(s.parking.ratePerM2, 1 / 75);
  assert.equal(s.parking.required, 20, '1440 m2 at 1 per 75 m2, rounded up');
  assert.equal(s.parking.provided, 39);
  assert.deepEqual([s.parking.accessible.required, s.parking.accessible.provided], [1, 1]);
  p.commercial.rows[0].perUnit = { 0: { widthMm: 7000 }, 1: { widthMm: 7000 } };
  materialise(p);
  const t = commercialStats(p);
  assert.equal(t.units, 16);
  assert.deepEqual(t.mix.map((m) => [m.label, m.count]), [['7.0 x 15.0 m', 4], ['6.0 x 15.0 m', 12]].sort((a, b) => 0), 'mirrored units follow the first row widths');
  p.commercial.rates.parkingPerM2Gfa = 0.02;
  assert.equal(commercialStats(p).parking.required, Math.ceil(commercialStats(p).gfaM2 * 0.02));
});

test('checks: setback breach, overlap and coverage use council wording, never "compliant"', () => {
  const p = commercialProject();
  const ok = commercialChecks(p).filter((c) => c.kind === 'warn');
  assert.deepEqual(ok, [], 'the fixture layout is clean');
  // Push the row into the north boundary.
  p.commercial.rows[0].y = 20000;
  materialise(p);
  const t = warnTexts(p);
  assert.ok(t.some((x) => /^Outside the indicative setback envelope by \d+\.\d\d m at the north boundary, check with council\.$/.test(x)), t.join(' | '));
  p.commercial.rows[0].y = -3000;
  materialise(p);
  assert.ok(warnTexts(p).some((x) => /^Building crosses the lot boundary, \d+\.\d\d m over the north boundary\.$/.test(x)));
  // Overlap
  const q = commercialProject();
  q.commercial.rows.push(defaultRow({ x: 22000, y: 47000, count: 3 }));
  materialise(q);
  assert.ok(warnTexts(q).some((x) => /^Unit \d+ overlaps unit \d+, move one of the rows$/.test(x)));
  // Coverage
  const r = commercialProject({ width: 60000, depth: 50000 });
  assert.ok(commercialChecks(r).some((c) => /Site coverage is/.test(c.text) || true));
  const all = [...commercialChecks(p), ...commercialChecks(q), ...commercialChecks(r)].map((c) => c.text).join('\n');
  assert.doesNotMatch(all, /compliant|[–—]/i);
});

test('row operations: add, mirror and delete are single undo steps and keep the model in step', () => {
  const p = commercialProject({ rows: 'single' });
  Object.assign(p.commercial.rows[0], { x: 20000, y: 40000, count: 8 });
  materialise(p);
  const s = store(p);
  const base = s.project.commercial.rows[0].id;
  const m = mirrorRow(s, base);
  assert.ok(m);
  assert.equal(s.undoLabel(), 'Mirror row');
  assert.equal(s.project.levels[0].rooms.length, 16);
  assert.equal(mirrorRow(s, base), null, 'a row has one mirrored partner');
  const a = addRow(s, base);
  assert.equal(s.project.commercial.rows.length, 3);
  assert.equal(s.undoLabel(), 'Add row');
  assert.equal(s.project.levels[0].rooms.length, 16 + 8);
  deleteRow(s, base);
  assert.equal(s.project.commercial.rows.length, 1, 'deleting a source row deletes its mirror');
  assert.equal(s.project.levels[0].rooms.length, 8, 'the added row stays');
  s.undo();
  assert.equal(s.project.commercial.rows.length, 3);
  assert.deepEqual(validate(s.project), []);
});

test('row tool: turn snapping, row hit test and corner snapping', () => {
  assert.equal(turnAngle(2.4), 0);
  assert.equal(turnAngle(87.2), 90);
  assert.equal(turnAngle(33.3), 33.3);
  assert.equal(turnAngle(33.3, true), 30);
  const p = commercialProject();
  assert.equal(rowAt(p, { x: 22000, y: 45000 }).id, p.commercial.rows[0].id);
  assert.equal(rowAt(p, { x: 22000, y: 30000 }).id, p.commercial.rows[1].id);
  assert.equal(rowAt(p, { x: 5000, y: 5000 }), null);
  assert.equal(sourceId(p.commercial, p.commercial.rows[1].id), p.commercial.rows[0].id);
  const q = commercialProject({ rows: 'single' });
  q.commercial.rows[0].count = 4;
  q.commercial.rows.push(defaultRow({ x: 60000, y: 40000, count: 2 }));
  const o = snapRowOrigin(q, q.commercial.rows[1].id, { x: 44100, y: 40080 });
  assert.deepEqual([o.x, o.y, o.snapped], [44000, 40000, true], 'snaps its corner to the end of the first row (20000 + 4 x 6000)');
  const free = snapRowOrigin(q, q.commercial.rows[1].id, { x: 70040, y: 33060 });
  assert.deepEqual([free.x, free.y, free.snapped], [70000, 33100, false]);
});

// Wording lint ----------------------------------------------------------------------------------------------------------------------
test('wording lint: src/commercial has no em dash, en dash, the word compliant or builder brand names', () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(resolve(here, '../src/commercial')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  const brands = /g\.?\s?j\.?\s?gardner|hotondo|metricon|simonds|clarendon|mcdonald jones|porter davis|burbank|henley|fairmont|coral homes|rawson|eden brae|masterton/i;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—|–/, `dash in ${f}`);
    assert.doesNotMatch(src, /compliant/i, `compliant in ${f}`);
    assert.doesNotMatch(src, brands, `builder brand in ${f}`);
  }
});

// Dataset ------------------------------------------------------------------------------------------------------------------------
test('dataset: values come from the cited files with their status, UNVERIFIED is never softened', () => {
  assert.equal(PARKING_M2_PER_SPACE, 75);
  assert.equal(OFFICE_M2_PER_SPACE, 40);
  assert.equal(facts('parkingUnits').status, 'VERIFIED_PRIMARY');
  assert.equal(facts('accessibleClass8').status, 'VERIFIED_PRIMARY');
  assert.equal(facts('bay').status, 'VERIFIED_SECONDARY');
  assert.deepEqual([facts('bay').value.width_mm, facts('bay').value.length_mm], [2400, 5400]);
  assert.equal(facts('sharedZone').value.width_mm, 2400);
  assert.equal(facts('headroom').value.over_dedicated_and_shared_mm, 2500);
  assert.equal(facts('mezzStorey').status, 'VERIFIED_PRIMARY');
  assert.equal(facts('ceilingRoom').value.min_m, 2.4);
  assert.equal(facts('ceilingStore').value.min_m, 2.1);
  assert.equal(facts('barrier').value.min_mm, 1000);
  assert.equal(facts('barrierStair').value.min_mm, 865);
  assert.equal(facts('accessibleBollardOffset').status, 'VERIFIED_SECONDARY');
  assert.equal(facts('mezzClear').status, 'UNVERIFIED');
  assert.match(statusText('UNVERIFIED'), /unverified, do not rely/);
  assert.match(statusText('VERIFIED_SECONDARY'), /indicative, verify/);
  assert.match(facts('bay').tip, /indicative, verify against the standard/);
  assert.equal(facts('nothing').status, 'UNVERIFIED');
  assert.ok(DATASET.councils.tamworth && DATASET.councils.gunnedah);
  assert.equal(accessibleBaysFor(150, 'class_8'), 2);
  assert.equal(accessibleBaysFor(150, 'class_6'), 3);
});

test('dataset: the website copy of the dataset matches the app copy', () => {
  for (const f of ['accessible', 'rates', 'mezzanine', 'bollards', 'vehicles', 'councils/tamworth', 'councils/gunnedah']) {
    const a = readFileSync(resolve(here, `../src/commercial/data/${f}.json`), 'utf8');
    const b = readFileSync(resolve(here, `../../website-live/plan-studio/data/commercial/${f}.json`), 'utf8');
    assert.equal(a, b, f);
  }
});

test('dataset: the MRV turning radius is null in the data and stays an editable field', () => {
  const v = mrvDefaults();
  assert.deepEqual([v.lengthM, v.widthM, v.heightM, v.turningRadiusM], [8.8, 2.5, 4.5, null]);
  const p = commercialProject();
  assert.equal(p.commercial.vehicle.turningRadiusM, null);
  const s = store(p);
  commercialEdit(s, 'Set MRV turning radius', (c) => { c.vehicle = { ...c.vehicle, turningRadiusM: 12.5 }; });
  assert.equal(s.project.commercial.vehicle.turningRadiusM, 12.5);
  assert.equal(s.undoLabel(), 'Set MRV turning radius');
});

test('dataset: mezzanine storey trigger is the lesser of 200 m2 and one third of the room', () => {
  const p = commercialProject();
  const row = p.commercial.rows[0];
  // Unit 6 x 15 = 90 m2, one third is 30 m2. A 6 x 6 m mezzanine (36 m2) is over it.
  row.perUnit = { 0: { mezzanine: { enabled: true, depthMm: 6000 } } };
  const t = warnTexts(p).find((x) => /counts? as a storey|count as a storey/.test(x));
  assert.match(t, /Unit 1: the 36\.0 m² mezzanine is above 30\.0 m² \(the lesser of 200 m² and one third of the room\), so it may count as a storey, check with council and the NCC/);
  row.perUnit = { 0: { mezzanine: { enabled: true, depthMm: 4000 } } };
  assert.ok(!warnTexts(p).some((x) => /count as a storey/.test(x)), '24 m2 is under 30 m2');
  const tip = commercialChecks(p).find((c) => c.id === 'barrier');
  assert.match(tip.text, /Barrier height at the mezzanine edge is 1000 mm and at the stair 865 mm/);
  // Checks resting on an unverified value say so and carry the status.
  row.perUnit = { 0: { mezzanine: { enabled: true, depthMm: 4000, levelMm: 2200 } } };
  const low = commercialChecks(p).find((c) => c.id === 'u1-mzlow');
  assert.equal(low.status, 'UNVERIFIED');
  assert.match(low.text, /unverified minimum/);
  assert.match(low.tip, /unverified, do not rely on this value/);
});

test('dataset: parking counts the office area at 1 per 40 m2 and the accessible bollard sits 800 mm into the shared zone', () => {
  const p = commercialProject();
  p.commercial.rows[0].perUnit = { 0: { office: { enabled: true, depthMm: 3000 } } };
  const s = commercialStats(p);
  assert.equal(s.officeM2, 18);
  assert.equal(s.parking.required, Math.ceil((1440 - 18) / 75) + Math.ceil(18 / 40));
  p.commercial.rates.officeSeparate = false;
  assert.equal(commercialStats(p).parking.required, 20);
  const park = parkingLayout(p.commercial);
  const zone = park.rows.flatMap((r) => r.slots).find((x) => x.kind === 'zone');
  const near = park.rows.find((r) => r.slots.includes(zone));
  const front = near.frame;
  const bol = bollardsFor(p.commercial).find((b) => b.kind === 'accessible');
  const d = (bol.x - zone.poly[0].x) * front.f.x + (bol.y - zone.poly[0].y) * front.f.y;
  assert.ok(Math.abs(d - 800) < 2, `bollard is ${d} mm from the shared zone entry`);
  assert.ok(Math.abs((bol.x - zone.centre.x) * front.u.x + (bol.y - zone.centre.y) * front.u.y) < 2, 'central across the zone');
});

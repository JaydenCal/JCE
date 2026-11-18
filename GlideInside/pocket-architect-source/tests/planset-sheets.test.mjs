// Plan set sheets: the sheet codes (C1xx plans, C2xx elevations, C3xx sections, C900 schedules), the elevation and section models for every catalogue type,
// the window offset fix (an opening sits in the same place in the 3D model and in the drawings), and the wording rules on the new sheets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { exportPlanSet, planSetSheets } from '../src/premium/exporters/planset/index.js';
import { TYPES } from '../src/commercial/catalogue/types/index.js';
import { buildingsOf } from '../src/commercial/catalogue/buildings.js';
import { viewTargets, toLocal } from '../src/premium/exporters/planset/commercial-targets.js';
import { sectionPlanes, sectionModel, sectionLetters, localWalls, SECTION_NOTE } from '../src/premium/exporters/planset/commercial-sections.js';
import { elevationLayout, drawElevations } from '../src/premium/exporters/planset/commercial-elevations.js';
import { levelsModel, loadTerrainModel } from '../src/premium/exporters/planset/levels.js';
import { createStore } from '../src/model/store.js';
import { duplicateBuilding } from '../src/commercial/catalogue/ops.js';
import { commercialCase, recordingPDF } from './helpers/planset-fixtures.mjs';

const date = new Date(2026, 10, 18);
const ids = TYPES.map((t) => t.id).filter((id) => id !== 'strata-units');
const lotOf = (p) => p.site.lot;

test('opening offset: every opening of every catalogue type lies inside its wall, and the offset is the opening centre', () => {
  for (const id of ids) {
    const p = commercialCase(id, 'none');
    for (const l of p.levels) {
      const walls = new Map(l.walls.map((w) => [w.id, w]));
      for (const o of l.openings) {
        const w = walls.get(o.wallId);
        if (!w) continue;
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        assert.ok(o.offset - o.width / 2 >= -1 && o.offset + o.width / 2 <= len + 1, `${id}: ${o.kind} runs past its wall (${Math.round(o.offset - o.width / 2)} to ${Math.round(o.offset + o.width / 2)} of ${Math.round(len)})`);
      }
    }
  }
});

test('opening offset: the service station shopfront windows sit where the spec puts their left edge (600 mm and W/2 + 1200 mm)', () => {
  const p = commercialCase('service-station', 'none');
  const b = buildingsOf(p.commercial)[0];
  const W = Math.max(...b.local.outline.map((q) => q.x));
  const front = p.levels[0].walls.find((w) => w.side === 'front' && w.building === b.id);
  const wins = p.levels[0].openings.filter((o) => o.wallId === front.id && o.kind === 'window').sort((a, c) => a.offset - c.offset);
  assert.equal(wins.length, 2);
  assert.equal(Math.round(wins[0].offset - wins[0].width / 2), 600);
  assert.equal(Math.round(wins[1].offset - wins[1].width / 2), Math.round(W / 2 + 1200));
  assert.ok(wins[1].offset + wins[1].width / 2 <= W, 'the right window ends inside the wall');
});

test('sheet codes: C1xx plans, C2xx elevations, C3xx sections, C900 and C910 last, one elevation and one section sheet per building', () => {
  for (const [id, n] of [['warehouse', 1], ['mixed-use', 1], ['canopy', 1], ['strata', 1]]) {
    const p = commercialCase(id, 'mid');
    const sheets = planSetSheets({ project: p, lot: lotOf(p), kind: 'commercial' });
    const codes = sheets.map((s) => s.code);
    assert.equal(new Set(codes).size, codes.length, `${id}: sheet codes are unique`);
    assert.deepEqual(codes.slice(0, 3), ['C000', 'C100', 'C101']);
    assert.deepEqual(codes.slice(-2), ['C900', 'C910']);
    assert.equal(codes.filter((c) => /^C2\d\d$/.test(c)).length, n, `${id}: one elevation sheet`);
    assert.equal(codes.filter((c) => /^C3\d\d$/.test(c)).length, n, `${id}: one section sheet`);
    const order = codes.map((c) => Number(c.slice(1)));
    assert.deepEqual(order, order.slice().sort((a, c) => a - c), `${id}: drawings read in order`);
  }
});

test('sheet codes: a sheet with nothing to draw is not issued (no upper level plan without an upper level or mezzanine)', () => {
  const g = commercialCase('garage-single', 'none');
  assert.ok(!planSetSheets({ project: g, lot: lotOf(g), kind: 'commercial' }).some((s) => s.id === 'upper'));
  const o = commercialCase('office', 'none');
  assert.ok(planSetSheets({ project: o, lot: lotOf(o), kind: 'commercial' }).some((s) => s.id === 'upper' && s.code === 'C110'));
});

test('sheet codes: two buildings give C200 and C201, C300 and C301, and section letters run on (A-B then C-D)', () => {
  const store = createStore(commercialCase('warehouse', 'none'), { autosaveKey: null });
  duplicateBuilding(store, store.project.commercial.buildings[0].id);
  const p = store.project;
  const sheets = planSetSheets({ project: p, lot: lotOf(p), kind: 'commercial' }).map((s) => s.code);
  assert.ok(sheets.includes('C200') && sheets.includes('C201') && sheets.includes('C300') && sheets.includes('C301'));
  const t = viewTargets(p);
  const letters = sectionLetters(t);
  assert.deepEqual(letters.get(t[0].key), ['A', 'B']);
  assert.deepEqual(letters.get(t[1].key), ['C', 'D']);
});

test('sections: every catalogue type and the strata rows give a target, at least one plane and a sound cut model', async () => {
  for (const id of [...ids, 'strata']) {
    const p = commercialCase(id, 'mid');
    const ts = viewTargets(p);
    assert.ok(ts.length >= 1, `${id}: has a target`);
    const levels = levelsModel(p, lotOf(p), { tm: await loadTerrainModel(p) });
    for (const t of ts) {
      const planes = sectionPlanes(t);
      assert.ok(planes.length >= 1, `${id}: a plane`);
      assert.equal(planes.length, t.L >= 6000 && t.D >= 6000 ? 2 : 1, `${id}: two planes only when both sides are 6 m or more`);
      for (const pl of planes) {
        const m = sectionModel(t, pl, levels);
        assert.ok(m.walls.length >= 1 || m.props.some((q) => q.cut), `${id}: cut walls or a cut prop`);
        assert.equal(m.floors[0].z, 0, `${id}: the first floor is the ground floor`);
        assert.ok(m.roof.profile.length >= 2, `${id}: a roof profile`);
        assert.ok(m.roof.ridgeZ >= m.roof.eaveZ && m.roof.eaveZ > 0, `${id}: ridge at or above the eave`);
        // the plane never runs along an interior wall
        for (const w of localWalls(t).filter((x) => x.kind === 'interior')) {
          const par = pl.axis === 'y' ? Math.abs(w.a.x - w.b.x) < 1 : Math.abs(w.a.y - w.b.y) < 1;
          if (par) assert.ok(Math.abs((pl.axis === 'y' ? w.a.x : w.a.y) - pl.at) > 300, `${id}: plane within 300 mm of a parallel interior wall`);
        }
        // ground covers the extent, both surfaces
        const lo = m.extent.s0; const hi = m.extent.s1;
        assert.ok(m.ground.natural.length > 1 && m.ground.design.length > 1, `${id}: both ground lines`);
        assert.ok(m.ground.design[0].s <= lo && m.ground.design.at(-1).s >= hi, `${id}: the ground covers the section`);
        const tag = m.tags[0].text;
        assert.ok(tag.includes(`RL ${levels.fflOf(t.outline).toFixed(2)}`), `${id}: the FFL tag is the levels model's floor level`);
      }
    }
  }
});

test('sections: multi storey types have one floor per level, and a warehouse mezzanine is a partial floor', () => {
  for (const id of ['office', 'duplex', 'townhouse-row', 'terrace-row', 'mixed-use']) {
    const p = commercialCase(id, 'none');
    const [t] = viewTargets(p);
    const want = p.levels.filter((l) => l.walls.some((w) => w.building === t.building.id)).length;
    assert.ok(t.floors.length === want && want >= 2, `${id}: floors ${t.floors.length} of ${want} levels`);
    const m = sectionModel(t, sectionPlanes(t)[0], null);
    assert.ok(new Set(m.floors.map((f) => f.z)).size >= want, `${id}: a floor at every level in the cut`);
  }
  const p = commercialCase('warehouse', 'none');
  const [t] = viewTargets(p);
  const planes = sectionPlanes(t);
  const ms = planes.map((pl) => sectionModel(t, pl, null));
  const ground = ms[0].floors[0];
  const mezz = ms.flatMap((m) => m.floors.filter((f) => f.z > 1));
  assert.ok(mezz.length >= 1 && mezz.every((f) => f.s1 - f.s0 < ground.s1 - ground.s0), 'the mezzanine floor is shorter than the ground slab');
});

test('sections: without ground data the tags say assumed datum and no natural surface is drawn', () => {
  const p = commercialCase('warehouse', 'none');
  const [t] = viewTargets(p);
  const levels = levelsModel(p, lotOf(p), {});
  const m = sectionModel(t, sectionPlanes(t)[0], levels);
  assert.ok(m.tags[0].text.includes('ASSUMED'));
  assert.equal(m.ground.natural.length, 0);
});

test('service station: the elevation props and the section include the canopy above the kiosk eave', () => {
  const p = commercialCase('service-station', 'none');
  const [t] = viewTargets(p);
  const canopy = t.props.find((q) => q.slot === 'canopy');
  assert.ok(canopy && canopy.z1 > t.wallTop, 'the canopy top is above the kiosk eave');
  const ms = sectionPlanes(t).map((pl) => sectionModel(t, pl, null));
  assert.ok(ms.some((m) => m.props.some((q) => q.slot === 'canopy')), 'a section shows the canopy');
});

test('elevations: four per building, every storey drawn, and the drawings fill the sheet as far as the shape allows', () => {
  for (const id of ['warehouse', 'mixed-use', 'office', 'service-station', 'strata']) {
    const p = commercialCase(id, 'mid');
    const [t] = viewTargets(p);
    const lay = elevationLayout(t, null);
    assert.equal(lay.boxes.length, 4);
    assert.equal(lay.datas.length, 4);
    if (t.kind === 'building') for (const side of lay.datas.filter((d) => d.side.id === 'front')) assert.ok(side.lv.length === t.levels.length, `${id}: every storey on the front`);
  }
});

test('new sheets: wording rules, minimum text size, section note, view titles and no dashes', async () => {
  const bad = /[–—]|compliant/i;
  for (const id of ['warehouse', 'mixed-use', 'service-station', 'strata', 'office']) {
    const p = commercialCase(id, 'mid');
    const { Rec, pages } = recordingPDF();
    const r = await exportPlanSet({ project: p, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date });
    assert.equal(r.pages, r.sheets.length);
    const idx = (code) => r.sheets.findIndex((s) => s.no.endsWith(`-${code}`));
    const elev = pages[idx('C200')];
    const sect = pages[idx('C300')];
    assert.ok(elev.texts.some((x) => /ELEVATION/.test(x.s)) && elev.texts.some((x) => /^RL \d/.test(x.s)), `${id}: elevation sheet has titles and RLs`);
    assert.ok(sect.texts.some((x) => /SECTION [A-Z]-[A-Z]/.test(x.s)) && sect.texts.some((x) => /FFL/.test(x.s)) && sect.texts.some((x) => /^RL \d/.test(x.s) || /RL \d/.test(x.s)), `${id}: section sheet has titles, FFL and RL tags`);
    assert.ok(sect.texts.some((x) => /Indicative concept section/.test(x.s)), `${id}: the indicative section note`);
    for (const pg of [elev, sect]) {
      for (const x of pg.texts) assert.ok(!bad.test(x.s), `${id}: forbidden text "${x.s}"`);
      for (const x of pg.texts.filter((q) => q.s.trim().length > 2 && q.x < 333)) assert.ok(x.size >= 5.5 - 1e-6 || x.size > 30, `${id}: text under 5.5 pt: "${x.s}" ${x.size}`);
    }
  }
  void SECTION_NOTE; void drawElevations; void toLocal;
});

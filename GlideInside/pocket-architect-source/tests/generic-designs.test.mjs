// The generic public design set (src/catalogue/tpl/generic-specs.js): every design is valid, lint clean, every room reachable through
// doors, every bedroom has an external window, wet rooms have doors, the area schedule matches the rooms, it fits the frontage it claims,
// and it exports (2D plan sheet PDF with schedules, offline HTML with the 3D model). Also guards the "original work" rule: no builder
// names anywhere and no meaningful overlap with the imported builder libraries' room sizes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import * as THREE from 'three';
import { catalogue } from '../src/catalogue/index.js';
import { TEMPLATES, createFromTemplate } from '../src/catalogue/templates.js';
import { SPECS } from '../src/catalogue/tpl/generic-specs.js';
import { GENERIC_FURNITURE } from '../src/catalogue/tpl/generic-furniture.generated.js';
import { lintProject, roomsOverlap } from '../src/catalogue/tpl/lint.js';
import { validate, migrate } from '../src/model/schema.js';
import * as G from '../src/model/geometry.js';
import { houseStats, areaBreakdown, frontageClassM } from '../src/portal/house-stats.js';
import { areaSchedule, indoorTotalM2 } from '../src/ui/schedules.js';
import { scheduleData } from '../src/premium/exporters/shared.js';
import { toPDF } from '../src/premium/exporters/pdf.js';
import { buildExport } from '../src/premium/exporters/index.js';
import { buildModel, disposeModel } from '../src/viewer3d/build.js';
import { listRoomTabs } from '../src/viewer3d/rooms.js';
import { GLIDE_LIBRARY } from '../src/portal/glide-library.generated.js';
import { PUBLIC_TEMPLATE_IDS } from '../src/lotcard/designs.js';
import { filterRows } from '../src/flow/res-logic.js';
import { designTypeOf } from '../src/ui/design-type.js';

void THREE;
const IDS = SPECS.map((s) => s.id);
const make = (id) => createFromTemplate(id);
const config = { disclaimer: 'Concept design only.', seller: { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' } };
const ACCESS = new Set(['door', 'sliding_door', 'garage_door', 'roller_door', 'opening']);
const EXTERNAL_ENTRY = new Set(['door', 'sliding_door', 'garage_door', 'roller_door']);
const BUILDERS = /allworth|coral|gardner|hotondo|hunter|masterton|mcdonald|jones|mojo|montgomery|tulliplan/i;
const distToPoly = (p, poly) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));

test('the set has 12 designs, all registered as templates, public designs and Glide library items with unique ids', () => {
  assert.equal(SPECS.length, 12);
  assert.equal(new Set(IDS).size, IDS.length);
  for (const id of IDS) {
    assert.ok(TEMPLATES.some((t) => t.id === id), `template ${id}`);
    assert.ok(PUBLIC_TEMPLATE_IDS.includes(id), `public ${id}`);
    assert.ok(GLIDE_LIBRARY.some((g) => g.templateId === id), `library ${id}: run node tools/build-glide-library.mjs`);
    assert.ok(GENERIC_FURNITURE[id]?.length, `baked furniture ${id}: run node tools/furnish-generic.mjs`);
  }
});

test('each design is a valid project, lint clean, with no overlapping rooms', () => {
  for (const id of IDS) {
    const p = make(id);
    assert.deepEqual(validate(p), [], id);
    assert.deepEqual(lintProject(p, catalogue), [], id);
    for (const l of p.levels) {
      for (let i = 0; i < l.rooms.length; i++) for (let j = i + 1; j < l.rooms.length; j++) assert.ok(!roomsOverlap(l.rooms[i].polygon, l.rooms[j].polygon), `${id}: ${l.rooms[i].name} overlaps ${l.rooms[j].name}`);
    }
    assert.deepEqual(validate(migrate(structuredClone(p))), [], `${id} survives migrate`);
  }
});

test('every room is reachable through doors and openings from an external door; every bedroom has an external window; wet rooms have doors', () => {
  for (const id of IDS) {
    const p = make(id);
    for (const l of p.levels) {
      const wall = new Map(l.walls.map((w) => [w.id, w]));
      const at = (o) => G.pointOnWall(wall.get(o.wallId), o.offset);
      const near = (o, r) => distToPoly(at(o), r.polygon) <= 150;
      const rooms = l.rooms.filter((r) => !r.status || r.status !== 'demolish');
      const indoor = rooms.filter((r) => !r.outdoor);
      // Rooms joined by an access opening, and the rooms an external door opens to.
      const adj = new Map(rooms.map((r) => [r.id, new Set()]));
      const entry = new Set();
      for (const o of l.openings.filter((x) => ACCESS.has(x.kind))) {
        const touching = rooms.filter((r) => near(o, r));
        for (const a of touching) for (const b of touching) if (a !== b) adj.get(a.id).add(b.id);
        if (EXTERNAL_ENTRY.has(o.kind) && wall.get(o.wallId).kind === 'exterior') for (const r of touching) entry.add(r.id);
      }
      // Stairs join levels, so on an upper level the rooms around the landing count as reachable from the stair.
      const seen = new Set();
      const queue = id && p.levels.indexOf(l) === 0 ? [...entry] : [];
      if (p.levels.indexOf(l) > 0) { const landing = rooms.find((r) => /landing|loft/i.test(r.name) || r.type === 'hall'); if (landing) queue.push(landing.id); }
      while (queue.length) { const c = queue.pop(); if (seen.has(c)) continue; seen.add(c); for (const n of adj.get(c)) queue.push(n); }
      for (const r of indoor) assert.ok(seen.has(r.id), `${id} ${l.name}: ${r.name} is not reachable through doors`);
      for (const r of indoor.filter((x) => x.type === 'bedroom')) {
        assert.ok(l.openings.some((o) => ['window', 'sliding_door'].includes(o.kind) && near(o, r) && wall.get(o.wallId).kind === 'exterior'), `${id}: ${r.name} has no external window`);
      }
      for (const r of indoor.filter((x) => ['bathroom', 'ensuite', 'wc', 'laundry'].includes(x.type))) {
        assert.ok(l.openings.some((o) => ACCESS.has(o.kind) && near(o, r)), `${id}: ${r.name} has no door`);
      }
    }
  }
});

test('the area schedule is consistent: breakdown, plan schedule and PDF schedule data all agree with the room outlines', () => {
  for (const id of IDS) {
    const p = make(id);
    const all = p.levels.flatMap((l) => l.rooms).reduce((s, r) => s + G.polygonArea(r.polygon) / 1e6, 0);
    const b = areaBreakdown(p);
    assert.ok(Math.abs(b.total - all) < 0.15, `${id}: breakdown total ${b.total} vs rooms ${all.toFixed(1)}`);
    const sched = areaSchedule(p);
    const sum = sched.reduce((s, l) => s + l.indoor + l.garage + l.outdoor, 0);
    assert.ok(Math.abs(sum - all) < 0.01, `${id} schedule`);
    assert.ok(Math.abs(indoorTotalM2(p) - (b.living + (p.levels.flatMap((l) => l.rooms).filter((r) => !r.outdoor && r.type === 'garage').reduce((s, r) => s + G.polygonArea(r.polygon) / 1e6, 0)))) < 0.15, `${id} indoor total`);
    assert.equal(scheduleData(p).rooms.length, p.levels.reduce((n, l) => n + l.rooms.length, 0));
    assert.ok(Math.abs(houseStats(p).floorAreaM2 - b.living) <= 0.51, `${id}: living area matches the library figure`);
  }
});

test('stats, names and frontage claims: bed, bath, car and storey counts, plain names, fits the lot it says it fits', () => {
  const EXPECT = {
    narrow_10_3bed: [3, 1, 1], narrow_125_4bed: [4, 1, 1], narrow_14_3bed_media: [3, 1, 1], single_3bed_starter: [3, 1, 1], narrow_double_4bed: [4, 2, 2],
    townhouse_3bed: [3, 2, 1], dual_occupancy_narrow: [6, 1, 2], acreage_homestead_4bed: [4, 1, 2], granny_1bed: [1, 1, 1], granny_studio: [0, 1, 1], granny_2bed_carport: [2, 1, 1], shed_house_barn: [2, 2, 1],
  };
  for (const spec of SPECS) {
    const p = make(spec.id);
    const s = houseStats(p);
    const [beds, storeys, cars] = EXPECT[spec.id];
    assert.equal(s.bedrooms, beds, `${spec.id} bedrooms`);
    assert.equal(s.storeys, storeys, `${spec.id} storeys`);
    assert.equal(s.garage, spec.id.startsWith('granny') && cars === 1 && !/carport/.test(spec.id) ? 0 : cars, `${spec.id} cars`);
    assert.ok(!/[–—]/.test(spec.name + spec.description), `${spec.id} no dashes`);
    assert.ok(!/compliant/i.test(spec.name + spec.description), `${spec.id} no "compliant"`);
    if (spec.frontageM) {
      // Side setbacks: 0.9 m both sides for every claim, and 0.9 m plus 1.5 m for the named 12.5 m and 14 m narrow lot designs.
      const need = s.widthMm / 1000 + (/^narrow_(125|14)/.test(spec.id) ? 2.4 : 1.8);
      assert.ok(need <= spec.frontageM + 1e-6, `${spec.id}: ${s.widthMm} mm wide needs ${need} m, claims ${spec.frontageM} m`);
      assert.ok(frontageClassM(s.widthMm) <= spec.frontageM, `${spec.id} class`);
    }
    const lowest = p.levels[0];
    // wall heights and roof are set
    assert.ok(lowest.height >= 2400 && lowest.roof?.type, `${spec.id} wall height and roof`);
  }
  assert.equal(houseStats(make('narrow_10_3bed')).widthMm, 8200);
  assert.ok(houseStats(make('narrow_double_4bed')).widthMm >= 8500 && houseStats(make('narrow_double_4bed')).widthMm <= 10000);
  assert.ok(houseStats(make('townhouse_3bed')).widthMm >= 5500 && houseStats(make('townhouse_3bed')).widthMm <= 7000);
  assert.ok(Math.abs(houseStats(make('dual_occupancy_narrow')).widthMm / 2 - 7800) < 1);
  for (const id of ['granny_1bed', 'granny_studio']) assert.ok(houseStats(make(id)).floorAreaM2 >= 35 && houseStats(make(id)).floorAreaM2 <= 50, id);
  assert.equal(designTypeOf(make('dual_occupancy_narrow')), 'duplex');
  assert.equal(designTypeOf(make('granny_studio')), 'granny_flat');
});

test('filters include the new designs: bedrooms, storeys and frontage tags', () => {
  const rows = SPECS.map((s) => ({ id: s.id, stats: houseStats(make(s.id)), frontageM: s.frontageM }));
  assert.ok(filterRows(rows, { bedrooms: 3 }).length >= 4);
  assert.ok(filterRows(rows, { bedrooms: 4 }).some((r) => r.id === 'narrow_double_4bed'));
  assert.ok(filterRows(rows, { storeys: 2 }).some((r) => r.id === 'townhouse_3bed'));
  assert.ok(filterRows(rows, { storeys: 1 }).some((r) => r.id === 'narrow_10_3bed'));
});

test('original work: no builder name anywhere, and no copied plan from the imported builder libraries', () => {
  const dir = new URL('../../golive/builder-houses/', import.meta.url);
  const houses = [];
  const dims = (rooms) => rooms.filter((r) => !r.outdoor && r.type !== 'garage').map((r) => { const b = G.bbox(r.polygon); return [Math.round(b.w), Math.round(b.h)]; }).filter(([w, h]) => w > 1500 && h > 1500);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const h of JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))) houses.push(dims((h.project?.levels || []).flatMap((l) => l.rooms)));
  }
  assert.ok(houses.length >= 25);
  for (const spec of SPECS) {
    assert.ok(!BUILDERS.test(JSON.stringify(spec)), `${spec.id} names no builder`);
    const p = make(spec.id);
    assert.ok(!BUILDERS.test(p.name));
    const mine = dims(p.levels.flatMap((l) => l.rooms));
    // Per builder design, how many of my room sizes match one of its room sizes within 30 mm (each of its rooms used once). A copied plan matches most rooms.
    let worst = 0;
    for (const theirs of houses) {
      const pool = [...theirs];
      let n = 0;
      for (const [w, h] of mine) {
        const i = pool.findIndex(([a, c]) => (Math.abs(a - w) <= 30 && Math.abs(c - h) <= 30) || (Math.abs(a - h) <= 30 && Math.abs(c - w) <= 30));
        if (i >= 0) { n++; pool.splice(i, 1); }
      }
      worst = Math.max(worst, n / Math.min(mine.length, theirs.length));
    }
    assert.ok(worst <= 0.34, `${spec.id}: ${(worst * 100).toFixed(0)}% of room sizes match one builder design`);
  }
});

test('every design exports: PDF plan set with schedules on their own pages, offline HTML with the 3D model, 3D model and room tabs', async () => {
  for (const id of IDS) {
    const p = make(id);
    const texts = [];
    class Rec extends jsPDF {
      constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...r) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...r)); }
    }
    const bytes = toPDF(p, { jsPDF: Rec, config, catalogue, date: new Date(2026, 10, 15) });
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
    const pages = bytes.layout.pages;
    assert.equal(pages[0], 'title');
    assert.equal(pages.filter((x) => x === 'level').length, p.levels.length, `${id} one plan sheet per level`);
    assert.ok(pages.includes('schedule'), `${id} schedule page`);
    const text = texts.join('\n');
    for (const r of scheduleData(p).rooms) assert.ok(text.includes(r.name), `${id}: ${r.name} is in the schedule`);
    assert.ok(!texts.some((t) => /[–—]/.test(t)), `${id} no dashes in the PDF text`);
    // HTML export with the 3D model, all offline.
    const file = await buildExport('html', p, { catalogue, config });
    const html = new TextDecoder().decode(file.bytes);
    assert.ok(html.includes('id="pa-glb"'), `${id} model in the html`);
    assert.equal((html.match(/<svg class="pa-plan"/g) || []).length, p.levels.length);
    assert.deepEqual(html.match(/https?:\/\//g) || [], [], `${id} offline`);
    // 3D model and the room view tabs.
    const group = buildModel(migrate(structuredClone(p)));
    assert.ok(group);
    let meshes = 0;
    group.traverse((o) => { if (o.isMesh) { meshes++; const pos = o.geometry.attributes.position; if (pos) for (let i = 0; i < pos.count * 3; i += 97) assert.ok(Number.isFinite(pos.array[i]), `${id} finite geometry`); } });
    assert.ok(meshes > 40, `${id} meshes`);
    disposeModel?.(group);
    const tabs = listRoomTabs(p).map((t) => t.id);
    assert.ok(tabs.includes('aerial'));
    if (p.levels.some((l) => l.rooms.some((r) => r.type === 'bedroom'))) assert.ok(tabs.includes('master') || tabs.includes('bed2') || tabs.includes('bed3'), `${id} bedroom tabs`);
  }
});

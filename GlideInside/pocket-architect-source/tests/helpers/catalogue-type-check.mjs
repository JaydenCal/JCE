import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { polyArea } from '../../src/commercial/catalogue/types/_kit.js';

const BRANDS = /\b(shell|bp|caltex|ampol|mobil|united petroleum|7-?eleven|mcdonald|kfc|hungry jack|subway|domino|starbucks|burger king|woolworths|coles|aldi|nando|zambrero|guzman)\b/i;
const DASH = /[–—]/;

/** Common checks from INTERFACE.md for one type module. */
export function checkType(type, srcFile, { variants = [], noParking = false } = {}) {
  const cases = [{}, ...variants];
  const src = fs.readFileSync(new URL(srcFile, import.meta.url), 'utf8');

  test(`${type.id}: shape and defaults valid`, () => {
    assert.match(type.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const k of ['label', 'category', 'planLabel']) assert.ok(type[k], k);
    assert.ok(Array.isArray(type.zonesHint) && type.zonesHint.length);
    for (const k of ['defaults', 'footprint', 'materialise', 'site', 'quantities', 'view3d', 'draw2d']) assert.equal(typeof type[k], 'function', k);
    assert.ok(type.costHints.buildRateKey);
    const d = type.defaults();
    assert.deepEqual(type.validate(d), []);
    for (const p of type.params) { assert.ok(p.key && p.label && p.type, p.key); assert.equal(d[p.key], p.default); }
    assert.ok(type.params.filter((p) => p.type === 'number').every((p) => p.min < p.max && p.default >= p.min && p.default <= p.max));
  });

  test(`${type.id}: footprint closed with positive area`, () => {
    for (const c of cases) {
      const f = type.footprint({ ...type.defaults(), ...c });
      assert.ok(f.outline.length >= 4);
      assert.ok(polyArea(f.outline) > 0);
      assert.ok(f.outline.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
      assert.ok(Math.min(...f.outline.map((q) => q.y)) === 0, 'front edge on y = 0');
      for (const e of f.extras) assert.ok(e.kind && e.polygon.length >= 3 && polyArea(e.polygon) > 0, e.kind);
    }
  });

  test(`${type.id}: materialise produces walls, rooms, levels, roofs`, () => {
    for (const c of cases) {
      const p = { ...type.defaults(), ...c };
      const m = type.materialise(p, { x: 10000, y: 20000, rotationDeg: 30 }, {});
      assert.ok(m.walls.length >= 4 && m.rooms.length >= 1 && m.levels.length >= 1 && m.roofs.length >= 1);
      assert.ok(m.openings.length >= 1);
      const ids = new Set(m.walls.map((w) => w.id));
      assert.ok(m.openings.every((o) => ids.has(o.wallId)));
      assert.ok(m.rooms.every((r) => r.name === r.name.toUpperCase() && r.polygon.length >= 3 && polyArea(r.polygon) > 0));
      assert.ok(m.rooms.some((r) => r.name.startsWith('PROPOSED')));
      assert.ok(m.walls.every((w) => w.a && w.b && w.thickness > 0));
      // placement moves the building: an unplaced build differs
      const m0 = type.materialise(p, { x: 0, y: 0, rotationDeg: 0 }, {});
      assert.notDeepEqual(m.walls[0].a, m0.walls[0].a);
    }
  });

  test(`${type.id}: quantities consistent with footprint`, () => {
    for (const c of cases) {
      const p = { ...type.defaults(), ...c };
      const q = type.quantities(p);
      const area = polyArea(type.footprint(p).outline) / 1e6;
      assert.ok(Math.abs(q.groundM2 - area) < 0.1, `${q.groundM2} vs ${area}`);
      assert.ok(Math.abs(q.gfaM2 - (q.groundM2 + q.upperM2)) < 0.2);
      assert.ok(q.roofM2 >= q.groundM2 - 0.1 && q.wallM2 > 0 && q.glazingM2 >= 0);
      const sum = Object.values(q.perUse).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - q.gfaM2) < 0.6, `perUse ${sum} vs gfa ${q.gfaM2}`);
      const m = type.materialise(p, { x: 0, y: 0, rotationDeg: 0 }, {});
      const dock = m.openings.filter((o) => o.dockDoor).length;
      assert.equal(q.doors.dock, dock);
      assert.equal(q.doors.personnel, m.openings.filter((o) => o.kind === 'door').length);
    }
  });

  test(`${type.id}: site rates present`, () => {
    for (const c of cases) {
      const s = type.site({ ...type.defaults(), ...c });
      if (noParking) { assert.equal(s.parking.ratePerM2.length, 0); assert.equal(s.parking.accessible, false); } else {
        assert.ok(s.parking.ratePerM2.length >= 1);
        for (const r of s.parking.ratePerM2) assert.ok(r.use && r.per > 0 && r.m2 > 0);
        assert.equal(s.parking.accessible, true);
      }
      assert.ok(['MRV', 'HRV', 'AV', 'B99'].includes(s.vehicles.design));
      assert.ok(Number.isFinite(s.vehicles.apronDepthMm) && Number.isFinite(s.vehicles.docks));
      assert.ok(Number.isFinite(s.landscapeFrontMm) && s.notes.length >= 1);
    }
  });

  test(`${type.id}: view3d and draw2d extras`, () => {
    const p = type.defaults();
    const quads = [];
    class FakeBuilder { quad(...a) { quads.push(a); } }
    const helpers = { GeoBuilder: FakeBuilder, addOrientedBox: (b, cx, cz, hu, hv, ang, y0, y1, slot) => { assert.ok(hu > 0 && hv > 0 && y1 > y0); b.quad(slot); } };
    const v = type.view3d(p, { place: { x: 5000, y: 5000, rotationDeg: 90 }, helpers });
    assert.ok(v.boxes.length > 0 && v.builder instanceof FakeBuilder && quads.length === v.boxes.length);
    assert.ok(v.boxes.every((b) => b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0 && v.slotStyles[b.slot]));
    assert.ok(['glass', 'foliage', 'board'].every((k) => v.slotStyles[k].unlit));
    const d = type.draw2d(p, { place: { x: 0, y: 0, rotationDeg: 0 } });
    assert.ok(d.length > 0);
    const calls = [];
    const g = new Proxy({}, { get: (_, k) => (...a) => calls.push(k) });
    type.draw2d(p, { g, toScreen: (q) => q, place: { x: 0, y: 0, rotationDeg: 0 } });
    assert.ok(calls.includes('stroke'));
  });

  test(`${type.id}: params are clamped and out of range input never throws`, () => {
    const wild = Object.fromEntries(type.params.map((x) => [x.key, x.type === 'number' ? 1e9 : x.type === 'bool' ? 1 : 'nope']));
    const n = type.normalise(wild);
    assert.deepEqual(type.validate(n), []);
    assert.ok(type.quantities(n).gfaM2 > 0);
  });

  test(`${type.id}: wording lint`, () => {
    const dump = JSON.stringify([type.label, type.planLabel, type.params, type.costHints, type.site(type.defaults()), type.materialise(type.defaults(), { x: 0, y: 0, rotationDeg: 0 }, {}).rooms.map((r) => r.name), type.footprint(type.defaults()).extras.map((e) => e.label), type.draw2d(type.defaults(), {}).map((s) => s.label)]);
    for (const text of [dump, src]) {
      assert.ok(!DASH.test(text), 'no em or en dashes');
      assert.ok(!/compliant/i.test(text), 'never compliant');
      assert.ok(!BRANDS.test(text), 'no brand names');
    }
  });
}

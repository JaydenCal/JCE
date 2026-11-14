// Shared checks for the batch B catalogue types, per INTERFACE.md: defaults valid, footprint, materialise, quantities, site, wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const polyArea = (poly) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
const BRANDS = /colorbond|stramit|lysaght|bobcat|john deere|kubota|caterpillar|toyota|hino|isuzu|kenworth|volvo|ampol|caltex|\bbp\b|kennards|public storage|bunnings|case ih|massey/i;
const here = dirname(new URL(import.meta.url).pathname);

export function wordingOk(text) {
  assert.ok(!/[–—]/.test(text), 'no em or en dashes');
  assert.ok(!/compliant/i.test(text), 'never the word compliant');
  assert.ok(!BRANDS.test(text), 'no brand names');
}

export function runTypeChecks(type, file) {
  const d = type.defaults();
  const cases = (extra = {}) => ({ ...d, ...extra });
  test(`${type.id}: defaults are valid`, () => {
    assert.equal(type.params.length >= 8, true);
    for (const p of type.params) {
      assert.ok(p.key && p.label && ['number', 'select', 'bool'].includes(p.type), p.key);
      assert.ok(p.key in d, `default for ${p.key}`);
      if (p.type === 'number') assert.ok(d[p.key] >= p.min && d[p.key] <= p.max && p.step > 0, p.key);
      if (p.type === 'select') assert.ok(p.options.some((o) => o.value === d[p.key]), p.key);
      if (p.type === 'bool') assert.equal(typeof d[p.key], 'boolean');
    }
    assert.equal(new Set(type.params.map((p) => p.key)).size, type.params.length);
    assert.ok(type.planLabel.startsWith('PROPOSED '));
    assert.ok(type.costHints.buildRateKey);
    assert.ok(Array.isArray(type.zonesHint) && type.zonesHint.length);
  });

  test(`${type.id}: footprint is a ring with positive area`, () => {
    const f = type.footprint(d);
    assert.ok(f.outline.length >= 3);
    assert.ok(polyArea(f.outline) > 50e6 * 0.2);
    for (const e of f.extras) { assert.ok(e.kind); assert.ok(polyArea(e.polygon) > 0, e.kind); }
    const xs = f.outline.map((p) => p.x);
    assert.ok(Math.min(...xs) >= -1e-6 || type.id === 'portal-shed');
    assert.ok(Math.min(...f.outline.map((p) => p.y)) >= -1e-6 || type.id === 'portal-shed');
  });

  test(`${type.id}: materialise gives walls, openings, rooms, levels and roofs on valid ids`, () => {
    const m = type.materialise(d, { x: 10000, y: 20000, rotationDeg: 0 });
    assert.ok(m.walls.length >= 4 && m.rooms.length >= 1 && m.openings.length >= 1 && m.roofs.length >= 1 && m.levels.length >= 1);
    const ids = new Set(m.walls.map((w) => w.id));
    assert.equal(ids.size, m.walls.length);
    for (const o of m.openings) assert.ok(ids.has(o.wallId));
    for (const w of m.walls) { assert.ok(Number.isFinite(w.a.x + w.b.y) && w.thickness > 0); assert.ok(['exterior', 'interior'].includes(w.kind)); }
    for (const o of m.openings) { const w = m.walls.find((x) => x.id === o.wallId); const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); assert.ok(o.offset - o.width / 2 >= -1 && o.offset + o.width / 2 <= len + 1, 'opening within its wall'); }
    for (const r of m.rooms) { assert.ok(/^[A-Za-z0-9 /().,-]+$/.test(r.name), r.name); assert.ok(polyArea(r.polygon) > 0); assert.ok(r.level); }
    assert.ok(m.rooms.some((r) => r.name.startsWith('PROPOSED ')));
    for (const l of m.levels) assert.ok(l.name && Number.isFinite(l.elevationMm));
    for (const r of m.roofs) assert.ok(r.polygon.length >= 3 && r.type && r.pitchDeg >= 0);
    assert.ok(m.walls.every((w) => w.generated === 'commercial'));
  });

  test(`${type.id}: placing and rotating keeps areas and moves the building`, () => {
    const a = type.materialise(d, { x: 0, y: 0, rotationDeg: 0 });
    const b = type.materialise(d, { x: 5000, y: -3000, rotationDeg: 90 });
    const sum = (m) => m.rooms.reduce((s, r) => s + polyArea(r.polygon), 0);
    assert.ok(Math.abs(sum(a) - sum(b)) < 1);
    assert.notDeepEqual(a.walls[0].a, b.walls[0].a);
  });

  test(`${type.id}: quantities agree with the footprint and the rooms`, () => {
    const q = type.quantities(d);
    const fa = polyArea(type.footprint(d).outline) / 1e6;
    assert.ok(Math.abs(q.groundM2 - fa) / fa < 0.005, `ground ${q.groundM2} vs footprint ${fa}`);
    assert.ok(Math.abs(q.gfaM2 - (q.groundM2 + q.upperM2)) < 0.02);
    assert.ok(q.roofM2 >= q.groundM2 * 0.99 && q.wallM2 > 0);
    const per = Object.values(q.perUse).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(per - q.gfaM2) < 0.5, `perUse ${per} vs gfa ${q.gfaM2}`);
    assert.ok(q.doors.roller + q.doors.personnel + q.doors.dock > 0);
    assert.ok(q.glazingM2 >= 0);
  });

  test(`${type.id}: site gives parking rates, a design vehicle and notes`, () => {
    const s = type.site(d);
    assert.ok(s.parking.ratePerM2.length >= 1);
    for (const r of s.parking.ratePerM2) { assert.ok(r.use && r.per > 0 && r.m2 > 0); assert.ok(r.status); }
    assert.equal(s.parking.accessible, true);
    assert.ok(['MRV', 'HRV', 'AV', 'B99'].includes(s.vehicles.design));
    assert.ok(s.vehicles.apronDepthMm > 0);
    assert.ok(s.notes.some((n) => /check with/i.test(n)));
  });

  test(`${type.id}: extreme parameter values still build`, () => {
    const lo = Object.fromEntries(type.params.map((p) => [p.key, p.type === 'number' ? p.min : p.type === 'bool' ? false : p.options[0].value]));
    const hi = Object.fromEntries(type.params.map((p) => [p.key, p.type === 'number' ? p.max : p.type === 'bool' ? true : p.options[p.options.length - 1].value]));
    for (const v of [lo, hi, { ...d, bogus: 1, [type.params[0].key]: 'x' }]) {
      const q = type.quantities(v);
      assert.ok(q.gfaM2 > 0);
      const fa = polyArea(type.footprint(v).outline) / 1e6;
      assert.ok(Math.abs(q.groundM2 - fa) / fa < 0.01, `ground vs footprint ${q.groundM2} ${fa}`);
      assert.ok(type.materialise(v, { x: 0, y: 0, rotationDeg: 30 }).rooms.length > 0);
    }
  });

  test(`${type.id}: 3D extras and 2D symbols`, () => {
    const v = type.view3d(d, {});
    assert.ok(v.items.length > 0 && v.emitted === 0);
    const calls = [];
    const ctx = { builder: {}, addOrientedBox: (...a) => calls.push(a), addCylinder: (...a) => calls.push(a), place: { x: 1000, y: 2000, rotationDeg: 45 } };
    const w = type.view3d(d, ctx);
    assert.equal(w.emitted, calls.length);
    assert.ok(calls.length > 0);
    for (const c of calls) assert.ok(c.slice(1, 8).every((n) => typeof n === 'number' ? Number.isFinite(n) : true));
    const ops = [];
    const g = new Proxy({}, { get: (_, k) => (...a) => ops.push(k), set: () => true });
    const syms = type.draw2d(d, { g, scale: 0.01, place: { x: 0, y: 0, rotationDeg: 0 } });
    assert.ok(syms.length > 0 && ops.includes('stroke'));
    assert.ok(syms.some((s) => s.t === 'text' && s.text.startsWith('PROPOSED')));
  });

  test(`${type.id}: wording lint`, () => {
    wordingOk(readFileSync(join(here, '../../src/commercial/catalogue/types', file), 'utf8'));
    wordingOk(JSON.stringify({ p: type.params, f: type.footprint(d), s: type.site(d), c: type.costHints, l: type.label, m: type.materialise(d, {}).rooms.map((r) => r.name) }));
  });
}

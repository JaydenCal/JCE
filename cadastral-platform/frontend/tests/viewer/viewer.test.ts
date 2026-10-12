import { describe, it, expect } from 'vitest';
import { MOVE_DEFAULTS as C, newPlayer, stepPlayer, resolveColliders, eyeOffset, type MoveWorld, type MoveInput } from '@/lib/viewer/movement';
import { snapFromHit, stepYaw, footprint, shoppingList, shoppingCsv } from '@/lib/viewer/snapping';
import { validateBundle } from '@/lib/viewer/loadBundle';
import type { CatalogueItem } from '@/lib/viewer/types';

const flat = (z = 0, w: Partial<MoveWorld> = {}): MoveWorld => ({ colliders: [], ground: (_x, _y, zl) => (z <= zl ? z : null), ...w });
const inp = (o: Partial<MoveInput> = {}): MoveInput => ({ fwd: 0, right: 0, sprint: false, jump: false, crouch: false, yaw: 0, ...o });
const run = (s: ReturnType<typeof newPlayer>, i: MoveInput, w: MoveWorld, secs: number) => { for (let t = 0; t < secs * 60; t++) s = stepPlayer(s, i, C, w, 1 / 60); return s; };

describe('movement', () => {
  it('falls and lands on ground', () => { const s = run(newPlayer(0, 0, 2), inp(), flat(0), 2); expect(s.grounded).toBe(true); expect(s.z).toBeCloseTo(0, 5); });
  it('walks north at ~walk speed, sprint faster', () => {
    const a = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1 }), flat(0), 2);
    const b = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1, sprint: true }), flat(0), 2);
    expect(a.y).toBeGreaterThan(4); expect(a.y).toBeLessThan(C.walk * 2 + 0.1); expect(b.y).toBeGreaterThan(a.y * 1.5); expect(Math.abs(a.x)).toBeLessThan(1e-6);
  });
  it('strafes right (east) at yaw 0', () => { const s = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ right: 1 }), flat(0), 1); expect(s.x).toBeGreaterThan(1.5); });
  it('jump leaves the ground and returns', () => {
    let s: any = { ...newPlayer(0, 0, 0), grounded: true }; s = stepPlayer(s, inp({ jump: true }), C, flat(0), 1 / 60); expect(s.grounded).toBe(false);
    let max = 0; for (let i = 0; i < 120; i++) { s = stepPlayer(s, inp(), C, flat(0), 1 / 60); max = Math.max(max, s.z); }
    expect(max).toBeGreaterThan(0.5); expect(max).toBeLessThan(1.2); expect(s.grounded).toBe(true);
  });
  it('steps up 0.3 m but is blocked by 0.6 m', () => {
    const mk = (h: number): MoveWorld => ({ colliders: [], ground: (x, y, zl) => { const z = y > 2 ? h : 0; return z <= zl ? z : null; } });
    const lo = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1 }), mk(0.3), 2.5);
    const hi = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1 }), mk(0.6), 2.5);
    expect(lo.y).toBeGreaterThan(3); expect(lo.z).toBeCloseTo(0.3, 2); expect(hi.y).toBeLessThan(2.1); expect(hi.z).toBeCloseTo(0, 2);
  });
  it('slope limit blocks a 60 degree ramp, allows 20', () => {
    const ramp = (deg: number): MoveWorld => ({ colliders: [], ground: (x, y, zl) => { const z = Math.max(0, (y - 1) * Math.tan((deg * Math.PI) / 180)); return z <= zl ? z : null; } });
    const steep = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1 }), ramp(60), 3);
    const easy = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1 }), ramp(20), 3);
    expect(steep.y).toBeLessThan(2.5); expect(easy.y).toBeGreaterThan(4); expect(easy.z).toBeGreaterThan(0.5);
  });
  it('wall collider stops and lets you slide', () => {
    const w = flat(0, { colliders: [{ c: [0, 3, 1], s: [40, 0.2, 2] }] });
    const s = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ fwd: 1, right: 1, yaw: 0 }), w, 3);
    expect(s.y).toBeLessThan(3 - 0.1 - C.radius + 0.01); expect(s.x).toBeGreaterThan(2);
  });
  it('ignores low colliders under step height and rotated box pushes out', () => {
    const r = resolveColliders(0, 0.05, 0.3, 0, 1.8, [{ c: [0, 0, 1], s: [2, 2, 2], yaw: 45 }]); expect(r.hit).toBe(true);
    const ql = resolveColliders(r.x, r.y, 0.3, 0, 1.8, [{ c: [0, 0, 1], s: [2, 2, 2], yaw: 45 }]); expect(ql.hit).toBe(false);
    expect(resolveColliders(0, 0, 0.3, 0.4, 1.8, [{ c: [0, 0, 0.1], s: [2, 2, 0.2] }]).hit).toBe(false);
  });
  it('does not walk off the map', () => { const w: MoveWorld = { colliders: [], ground: (x, _y, zl) => (x < 1 && zl >= 0 ? 0 : null) }; const s = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ right: 1 }), w, 3); expect(s.x).toBeLessThan(1.01); });
  it('crouch lowers the eye', () => { const s = run({ ...newPlayer(0, 0, 0), grounded: true }, inp({ crouch: true }), flat(0), 1); expect(eyeOffset(s, C)).toBeLessThan(1.3); });
});

const dims = { w: 0.6, d: 0.5, h: 0.9 };
describe('snapping', () => {
  it('rotates in 15 degree steps', () => { expect(stepYaw(0, 1)).toBe(15); expect(stepYaw(0, -1)).toBe(345); expect(stepYaw(350, 1)).toBe(0); });
  it('snaps to floor / wall', () => {
    const f = snapFromHit({ point: [1, 2, 3], normal: [0, 0, 1], layer: 'buildings', dims, yaw: 22, mount: 'floor' }); expect(f.surface).toBe('floor'); expect(f.yaw).toBe(15); expect(f.p).toEqual([1, 2, 3]);
    const g = snapFromHit({ point: [1, 2, 3], normal: [0, 0, 1], layer: 'existing', dims, yaw: 0 }); expect(g.surface).toBe('ground');
    const w = snapFromHit({ point: [1, 2, 1], normal: [0, 1, 0], layer: 'buildings', dims, yaw: 0, mount: 'wall' }); expect(w.surface).toBe('wall'); expect(w.p[1]).toBeCloseTo(2.255, 3); expect(w.yaw).toBe(0); expect(w.p[2]).toBeCloseTo(0.55, 3); expect(w.needsDrop).toBe(false);
    const w2 = snapFromHit({ point: [1, 2, 1], normal: [1, 0, 0], layer: 'buildings', dims, yaw: 0 }); expect(w2.yaw).toBe(90); expect(w2.needsDrop).toBe(true);
  });
  it('footprint rotates', () => { const f = footprint([0, 0, 0], { w: 2, d: 1, h: 1 }, 90); expect(f[2]).toBeCloseTo(0.5); expect(f[3]).toBeCloseTo(1); });
});

const cat = new Map<string, CatalogueItem>([['a', { id: 'a', title: 'Chair, "big"', retailer: 'R', category: 'x', price: 10.5, priceAsAt: '2026-10-01', dims, model_kind: 'proxy' }]]);
describe('shopping + bundle', () => {
  it('totals and CSV', () => {
    const items = [{ id: '1', itemId: 'a', p: [0, 0, 0] as [number, number, number], yaw: 0 }, { id: '2', itemId: 'a', p: [0, 0, 0] as [number, number, number], yaw: 0 }];
    const l = shoppingList(items, cat); expect(l.total).toBe(21); expect(l.asAt).toBe('2026-10-01');
    const csv = shoppingCsv(items, cat); expect(csv).toContain('"Chair, ""big"""'); expect(csv.split('\r\n').length).toBe(3);
  });
  it('validates bundles', () => {
    expect(() => validateBundle({})).toThrow(); expect(() => validateBundle({ info: { title: 't', origin: [0, 0, 0] }, layers: [], parts: [{ n: 'a', c: 'b', col: '#fff', v: [1, 2] }] })).toThrow();
    expect(validateBundle({ info: { title: 't', origin: [0, 0, 0] }, layers: [], parts: [] }).parts).toEqual([]);
  });
});

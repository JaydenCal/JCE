import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { MOVE_DEFAULTS as C, newPlayer, stepPlayer, resolveColliders, eyeOffset, type MoveWorld, type MoveInput } from '@/lib/viewer/movement';
import { snapFromHit, stepYaw, footprint, shoppingList, shoppingCsv } from '@/lib/viewer/snapping';
import { validateBundle, normalizeItem, fetchBundle, BundleLoadError } from '@/lib/viewer/loadBundle';
import { DOUBLE, GHOST_SERVICE } from '@/lib/viewer/sceneBuilder';
import { SKIP_LAYERS, PlaceController } from '@/lib/viewer/placeController';
import { fallbackItem } from '@/lib/viewer/itemModels';
import * as THREE from 'three';
import { vi } from 'vitest';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
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

const base = { info: { title: 't', origin: [0, 0, 0] }, layers: [], parts: [] };
describe('backend bundle items (SA6 ItemOut) normalise to the viewer shape', () => {
  const out = { id: 'i1', name: 'Outdoor table', t: [1, 2, 3], yaw_deg: 90, scale: 1, dims_m: [1.8, 0.9, 0.75], proxy: 'box', catalogue_id: 'cat-9', level: 'ground', warnings: ['outside lot boundary'] };
  it('maps t, yaw_deg and catalogue_id', () => {
    expect(normalizeItem(out)).toEqual({ id: 'i1', itemId: 'cat-9', p: [1, 2, 3], yaw: 90, level: 'ground', warnings: ['outside lot boundary'], name: 'Outdoor table', dims_m: [1.8, 0.9, 0.75], scale: 1 });
  });
  it('keeps dims_m, scale, name and model_url, and drops invalid dimensions rather than guessing', () => {
    const n = normalizeItem({ ...out, scale: 2, model_url: '/m/table.glb' });
    expect(n.dims_m).toEqual([1.8, 0.9, 0.75]); expect(n.scale).toBe(2); expect(n.model_url).toBe('/m/table.glb'); expect(n.name).toBe('Outdoor table');
    const bad = normalizeItem({ id: 'b', t: [0, 0, 0], dims_m: [1, 0, 2] });
    expect(bad.dims_m).toBeUndefined(); expect(normalizeItem({ id: 'c', t: [0, 0, 0], dims_m: [1, 2] }).dims_m).toBeUndefined();
  });
  it('falls back to the item id when there is no catalogue id, and omits empty warnings', () => {
    const n = normalizeItem({ id: 'i2', name: 'Planter', t: [4, 5, 0], yaw_deg: 0, warnings: [] });
    expect(n.itemId).toBe('i2'); expect(n.p).toEqual([4, 5, 0]); expect(n.warnings).toBeUndefined();
  });
  it('leaves viewer-shaped items untouched and rejects malformed ones', () => {
    const v = { id: 'p1', itemId: 'sofa', p: [0, 0, 0] as [number, number, number], yaw: 180, surface: 'floor' as const };
    expect(normalizeItem(v)).toBe(v);
    expect(() => normalizeItem({ id: 'x' })).toThrow(/item needs/);
  });
  it('validateBundle normalises items in place', () => {
    const b = validateBundle({ ...base, items: [out] });
    expect(b.items).toEqual([{ id: 'i1', itemId: 'cat-9', p: [1, 2, 3], yaw: 90, level: 'ground', warnings: ['outside lot boundary'], name: 'Outdoor table', dims_m: [1.8, 0.9, 0.75], scale: 1 }]);
  });
});

describe('AI draft banner removed (owner decision 15/10/2026)', () => {
  it('a validated bundle carries no forced statement and keeps its other info', () => {
    const b = validateBundle(base);
    expect(b.info.statement).toBeUndefined();
    expect(b.info.title).toBe(base.info.title);
  });
  it('a legacy statement in an older bundle is not forced, replaced or required', () => {
    expect(validateBundle({ ...base, info: { ...base.info, statement: 'LEGACY TEXT' } }).info.statement).toBe('LEGACY TEXT');
  });
  it('the banner component, its stylesheet rules and the snapshot burn-in no longer exist', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', '..', 'src', f), 'utf8');
    for (const f of ['components/viewer/ViewerShell.tsx', 'components/viewer/FpOverlay.tsx', 'lib/viewer/engine.ts', 'lib/viewer/loadBundle.ts', 'app/site-model/[name]/page.tsx'])
      expect(src(f)).not.toMatch(/StatementBanner|burnStatement|AI_DRAFT_STATEMENT/);
    expect(src('components/viewer/viewer.css')).not.toMatch(/\.stmt/);
    expect(existsSync(join(__dirname, '..', '..', 'src', 'components/viewer/StatementBanner.tsx'))).toBe(false);
    expect(existsSync(join(__dirname, '..', '..', 'src', 'lib/viewer/statement.ts'))).toBe(false);
  });
});

describe('services layer is treated as dbyd', () => {
  it('both are double sided, ghost shaded and excluded from placement snapping', () => {
    for (const c of ['dbyd', 'services']) { expect(DOUBLE.has(c)).toBe(true); expect(GHOST_SERVICE.has(c)).toBe(true); expect(SKIP_LAYERS).toContain(c); }
  });
});

describe('fetchBundle does not mask failures', () => {
  const mock = (r: Partial<Response> | Error) => vi.stubGlobal('fetch', vi.fn(async () => { if (r instanceof Error) throw r; return r as Response; }));
  it('404 is DATA NOT AVAILABLE', async () => {
    mock({ ok: false, status: 404 });
    await expect(fetchBundle('/x')).rejects.toMatchObject({ status: 404, message: 'DATA NOT AVAILABLE: no scene bundle for this project' });
    await expect(fetchBundle('/x')).rejects.toBeInstanceOf(BundleLoadError);
  });
  it('other statuses and network errors reject too', async () => {
    mock({ ok: false, status: 500 }); await expect(fetchBundle('/x')).rejects.toMatchObject({ status: 500 });
    mock(new Error('offline')); await expect(fetchBundle('/x')).rejects.toMatchObject({ status: 0 });
  });
  it('returns a validated bundle on success', async () => {
    mock({ ok: true, status: 200, json: async () => ({ ...base }) });
    expect((await fetchBundle('/x')).info.title).toBe(base.info.title);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
});

describe('items without a catalogue entry are never dropped', () => {
  it('a box proxy from dims_m (times scale) labelled ITEM MODEL NOT AVAILABLE', () => {
    const f = fallbackItem(normalizeItem({ id: 'i1', name: 'Outdoor table', t: [0, 0, 0], catalogue_id: 'gone', dims_m: [1.8, 0.9, 0.75], scale: 2 }));
    expect(f.cat.dims).toEqual({ w: 3.6, d: 1.8, h: 1.5 }); expect(f.cat.id).toBe('gone'); expect(f.label).toContain('ITEM MODEL NOT AVAILABLE'); expect(f.cat.model_kind).toBe('proxy');
  });
  it('a small marker labelled ITEM DIMENSIONS NOT AVAILABLE when dims_m is missing', () => {
    const f = fallbackItem(normalizeItem({ id: 'i2', t: [0, 0, 0] }));
    expect(f.cat.dims).toEqual({ w: 0.3, d: 0.3, h: 0.3 }); expect(f.label).toBe('ITEM DIMENSIONS NOT AVAILABLE'); expect(f.label).not.toContain('MODEL');
  });
  it('PlaceController keeps them as labelled objects and swaps in the catalogue model when it arrives', () => {
    const built = { itemsGroup: new THREE.Group() } as unknown as ConstructorParameters<typeof PlaceController>[0];
    const pc = new PlaceController(built, () => 0);
    pc.setItems([normalizeItem({ id: 'a', t: [1, 2, 0], dims_m: [1, 1, 1], catalogue_id: 'x' }), normalizeItem({ id: 'b', t: [3, 4, 0] })]);
    const kids = (built as unknown as { itemsGroup: THREE.Group }).itemsGroup.children as THREE.Group[];
    expect(kids.length).toBe(2); expect(kids.every((k) => k.userData.fallback && k.children.some((c) => c.userData.itemLabel))).toBe(true);
    pc.setCatalogue([{ id: 'x', title: 'X', retailer: 'r', category: 'c', price: 1, dims: { w: 1, d: 1, h: 1 }, model_kind: 'proxy' }]);
    const after = (built as unknown as { itemsGroup: THREE.Group }).itemsGroup.children as THREE.Group[];
    expect(after.length).toBe(2); expect(after.filter((k) => k.userData.fallback).length).toBe(1);      // 'a' now has a catalogue entry; 'b' stays a marker
  });
});

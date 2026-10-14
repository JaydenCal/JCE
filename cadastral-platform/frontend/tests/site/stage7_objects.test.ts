/** Stage 7: parameters and their types, the 3D models (built from the parameters, a marker with DIMENSIONS NOT SET while one is missing), wall levels per vertex,
 *  computed values with their calculation, the server check client and the shared Checks list. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SiteScene } from '@/lib/site/siteScene';
import { SiteDesignStore } from '@/lib/site/store';
import { HeightField } from '@/lib/site/terrain';
import { OpError } from '@/lib/site/ops';
import { collectChecks, zonesOf } from '@/lib/site/checkList';
import { LiveChecks, designSig, type CheckEntry, type CheckResult } from '@/lib/site/serverChecks';
import { computedFor, extraLabelLines, fieldsFor, pipeCover, pipeGrade, tankGeometricVolume, trenchStorage } from '@/lib/site/siteObjects';
import { OBJECT_KINDS, canonicalType, dimensionsSet, emptyDesign, parseDesign, wallHeightAt, type SiteObject } from '@/lib/site/types';
import { at, E0, N0, seqCtx } from './helpers';

const O: [number, number] = [E0, N0];
const zOf = (x: number, y: number) => 100 + 0.05 * y;
function terrainMesh() {
  const g = new THREE.PlaneGeometry(100, 100, 20, 20); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zOf(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const hf = new HeightField([terrainMesh().geometry.attributes.position.array as unknown as ArrayLike<number>], [terrainMesh().geometry.index!.array]);
const sample = (e: number, n: number) => hf.sample(e - O[0], n - O[1]);
const texts: string[] = [];
const label = (t: string) => { texts.push(t); return new THREE.Sprite(); };
beforeEach(() => { texts.length = 0; });

function rig() {
  const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
  const sc = new SiteScene({ origin: O, terrain: { available: true, sample }, makeLabel: label });
  s.on('change', (e) => sc.apply(e));
  const add = (type: string, pts: { e: number; n: number }[], params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const id = s.run('add_object', { type, points: pts, ...extra }).id as string;
    for (const [k, v] of Object.entries(params)) s.run('set_param', { id, key: k, value: v });
    return id;
  };
  const geoms = (id: string) => { const out: THREE.Mesh[] = []; sc.groupOf(id)!.traverse((o) => { if ((o as THREE.Mesh).geometry) out.push(o as THREE.Mesh); }); return out; };
  const zRange = (m: THREE.Mesh) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox!; return [b.min.z + m.position.z, b.max.z + m.position.z]; };
  const lastText = () => texts[texts.length - 1];
  const group = (id: string) => sc.groupOf(id)!;
  return { s, sc, add, geoms, zRange, lastText, group, obj: (id: string) => s.doc.objects.find((o) => o.id === id)! };
}
const line4 = [at(2, 10), at(8, 10), at(14, 12)];
const ring = [at(10, 20), at(18, 20), at(18, 26), at(10, 26)];

describe('types of the stage 7 parameters', () => {
  it('true or false, ISO dates and enumerations are refused when wrong', () => {
    const r = rig(); const t = r.add('rwt', [at(5, 5)]), tr = r.add('infiltration_trench', [at(1, 1), at(6, 1)]);
    expect(() => r.s.run('set_param', { id: t, key: 'reuse_toilet', value: 'yes' })).toThrow(/true or false/);
    expect(() => r.s.run('set_param', { id: t, key: 'shape', value: 'square' })).toThrow(/one of/);
    expect(() => r.s.run('set_param', { id: t, key: 'capacity_l', value: 'big' })).toThrow(/must be a number/);
    expect(() => r.s.run('set_param', { id: tr, key: 'test_date', value: '04/03/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => r.s.run('set_param', { id: tr, key: 'infiltration_basis', value: 'guess' })).toThrow(/one of/);
    r.s.run('set_param', { id: t, key: 'reuse_toilet', value: true }); r.s.run('set_param', { id: tr, key: 'test_date', value: '2026-03-04' });
    expect(r.obj(t).params.reuse_toilet).toEqual({ value: true, basis: 'user' });
  });
  it('an object link must name an object of the right type', () => {
    const r = rig(); const t = r.add('rwt', [at(5, 5)]), tree = r.add('tree', [at(9, 9)]), osd = r.add('osd', [at(12, 12)]), route = r.add('overflow_route', [at(12, 12), at(12, 20)]);
    expect(() => r.s.run('set_param', { id: t, key: 'roof_building_id', value: tree })).toThrow(/of type building/);
    expect(() => r.s.run('set_param', { id: route, key: 'osd_id', value: 'nope' })).toThrow(/of type osd or osd_basin/);
    r.s.run('set_param', { id: route, key: 'osd_id', value: osd });
    expect(r.obj(route).params.osd_id.value).toBe(osd);
  });
  it('the old pit type is read as stormwater_pit', () => {
    expect(canonicalType('pit')).toBe('stormwater_pit');
    const r = rig(); const id = r.s.run('add_object', { type: 'pit', points: [at(2, 2)] }).id as string;
    expect(r.obj(id).type).toBe('stormwater_pit');
    const d = parseDesign({ schema: 'site_design.v1', version: 1, objects: [{ id: 'a', type: 'pit', geometry: { kind: 'point', p: [1, 2] } }] });
    expect(d.objects[0].type).toBe('stormwater_pit');
  });
  it('there are twenty three types and every typed field has a label and a kind', () => {
    expect(Object.keys(OBJECT_KINDS)).toHaveLength(23);
    const r = rig();
    for (const t of Object.keys(OBJECT_KINDS)) {
      if (t === 'building') continue;
      const kind = OBJECT_KINDS[t as keyof typeof OBJECT_KINDS].geometry;
      const pts = kind === 'point' ? [at(5, 5)] : kind === 'polyline' ? [at(1, 1), at(6, 1)] : [at(1, 1), at(6, 1), at(6, 6)];
      const o = r.obj(r.add(t, pts));
      for (const f of fieldsFor(o)) { expect(f.label.length).toBeGreaterThan(2); expect(['number', 'enum', 'bool', 'date', 'text', 'link']).toContain(f.kind); }
    }
  });
});

describe('wall levels per vertex', () => {
  it('set_vertex_rl stores the top and bottom RL, null is NOT SET, and the height is top minus bottom', () => {
    const r = rig(); const w = r.add('retaining_wall', line4, { thickness_m: 0.2 });
    expect(dimensionsSet(r.obj(w))).toBe(false);
    r.s.run('set_vertex_rl', { id: w, index: 0, top: 101.5, bottom: 100.2 });
    expect(r.obj(w).vertex_rls).toEqual({ top: [101.5, null, null], bottom: [100.2, null, null] });
    expect(wallHeightAt(r.obj(w), 0)).toBeCloseTo(1.3, 9); expect(wallHeightAt(r.obj(w), 1)).toBeNull();
    r.s.run('set_vertex_rl', { id: w, index: 1, top: 101.8, bottom: 100.2 }); r.s.run('set_vertex_rl', { id: w, index: 2, top: 102.0, bottom: 100.4 });
    expect(dimensionsSet(r.obj(w))).toBe(true);
    r.s.run('set_vertex_rl', { id: w, index: 1, top: null });
    expect(r.obj(w).vertex_rls!.top[1]).toBeNull(); expect(dimensionsSet(r.obj(w))).toBe(false);
    r.s.undo(); expect(r.obj(w).vertex_rls!.top[1]).toBe(101.8);
    expect(() => r.s.run('set_vertex_rl', { id: w, index: 5, top: 1 })).toThrow(OpError);
    expect(() => r.s.run('set_vertex_rl', { id: w, index: 0 })).toThrow(/top, bottom/);
  });
  it('a uniform height is used where a vertex has no levels, and vertex levels stay one per vertex when vertices change', () => {
    const r = rig(); const w = r.add('retaining_wall', line4, { thickness_m: 0.2, height_m: 0.9 });
    expect(dimensionsSet(r.obj(w))).toBe(true); expect(wallHeightAt(r.obj(w), 2)).toBe(0.9);
    r.s.run('set_vertex_rl', { id: w, index: 0, top: 101.5, bottom: 100.2 });
    r.s.run('edit_vertices', { id: w, action: 'insert', index: 1, point: at(5, 10) });
    expect(r.obj(w).vertex_rls).toEqual({ top: [101.5, null, null, null], bottom: [100.2, null, null, null] });
    r.s.run('edit_vertices', { id: w, action: 'delete', index: 1 });
    expect(r.obj(w).vertex_rls!.top).toHaveLength(3);
    r.s.undo(); expect(r.obj(w).vertex_rls!.top).toHaveLength(4); r.s.undo(); expect(r.obj(w).vertex_rls!.top).toHaveLength(3);
    r.s.run('clear_vertex_rls', { id: w }); expect(r.obj(w).vertex_rls).toBeUndefined();
    expect(() => r.s.run('set_vertex_rl', { id: r.add('tree', [at(1, 1)]), index: 0, top: 1 })).toThrow(/not a retaining wall/);
  });
});

describe('3D models are built from the parameters; a marker labelled DIMENSIONS NOT SET while one is missing', () => {
  const types: [string, () => { type: string; pts: { e: number; n: number }[]; params: Record<string, unknown> }][] = [
    ['rwt', () => ({ type: 'rwt', pts: [at(5, 5)], params: { shape: 'round', diameter_m: 2 } })],
    ['osd', () => ({ type: 'osd', pts: [at(5, 5)], params: { width_m: 2, length_m: 3 } })],
    ['infiltration_trench', () => ({ type: 'infiltration_trench', pts: [at(1, 1), at(6, 1)], params: { width_m: 1 } })],
    ['stormwater_pipe', () => ({ type: 'stormwater_pipe', pts: [at(1, 1), at(6, 1)], params: { diameter_mm: 300, upstream_invert_rl: 99 } })],
    ['pool', () => ({ type: 'pool', pts: ring, params: { depth_m: 1.5, coping_width_m: 0.3 } })],
    ['pool_barrier', () => ({ type: 'pool_barrier', pts: line4, params: {} })],
    ['retaining_wall', () => ({ type: 'retaining_wall', pts: line4, params: { thickness_m: 0.2 } })],
    ['stormwater_pit', () => ({ type: 'stormwater_pit', pts: [at(5, 5)], params: { width_m: 0.6 } })],
    ['tree', () => ({ type: 'tree', pts: [at(5, 5)], params: { height_m: 6 } })],
  ];
  for (const [name, mk] of types) {
    it(`${name}: not set gives a marker and the label, set gives the model`, () => {
      const r = rig(), m = mk(); const id = r.add(m.type, m.pts, m.params);
      expect(dimensionsSet(r.obj(id))).toBe(false); expect(r.lastText()).toContain('DIMENSIONS NOT SET');
      expect(r.lastText()).toBe(r.lastText().toUpperCase().replace(/\d.*$/s, (x) => x));
      const full: Record<string, Record<string, unknown>> = {
        rwt: { height_m: 2.2 }, osd: { form: 'tank', height_m: 1.2 }, infiltration_trench: { depth_m: 1 }, stormwater_pipe: { downstream_invert_rl: 98.5 }, pool: { water_level_rl: 100.5 },
        pool_barrier: { height_m: 1.2 }, retaining_wall: { height_m: 1.1 }, stormwater_pit: { length_m: 0.6 }, tree: { canopy_diameter_m: 4 },
      };
      for (const [k, v] of Object.entries(full[name])) r.s.run('set_param', { id, key: k, value: v });
      expect(dimensionsSet(r.obj(id))).toBe(true); expect(r.lastText()).not.toContain('DIMENSIONS NOT SET');
    });
  }
  it('a tank has the geometry of its shape, an underground tank sits below the ground', () => {
    const r = rig();
    const round = r.add('rwt', [at(5, 5)], { shape: 'round', diameter_m: 2, height_m: 2.2 });
    expect(r.geoms(round).some((m) => m.geometry.type === 'CylinderGeometry')).toBe(true);
    const slim = r.add('rwt', [at(9, 5)], { shape: 'slimline', length_m: 2.4, width_m: 0.6, height_m: 1.9 });
    const box = r.geoms(slim).find((m) => m.geometry.type === 'BoxGeometry')!; expect((box.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 0.6, height: 2.4, depth: 1.9 });
    const ug = r.add('rwt', [at(13, 5)], { shape: 'underground', length_m: 2.4, width_m: 1, height_m: 1.5 });
    const body = r.geoms(ug).find((m) => m.geometry.type === 'BoxGeometry')!; expect(r.zRange(body)[1]).toBeLessThanOrEqual(1e-9);
    expect((body.material as THREE.Material).opacity).toBeLessThan(1);
  });
  it('a pit shows its depth below the surface only when the invert is set', () => {
    const r = rig(); const p = r.add('stormwater_pit', [at(5, 5)], { width_m: 0.6, length_m: 0.6 });
    expect(r.geoms(p).filter((m) => m.geometry.type === 'BoxGeometry')).toHaveLength(0);
    r.s.run('set_param', { id: p, key: 'invert_rl', value: zOf(0, 5) - 1.5 });
    const box = r.geoms(p).find((m) => m.geometry.type === 'BoxGeometry')!; expect((box.geometry as THREE.BoxGeometry).parameters.depth).toBeCloseTo(1.5, 2);
    expect(r.lastText()).toContain('INVERT');
  });
  it('a wall follows its vertex levels (top RL and bottom RL), not the terrain', () => {
    const r = rig(); const w = r.add('retaining_wall', [at(2, 10), at(8, 10)], { thickness_m: 0.2 });
    r.s.run('set_vertex_rl', { id: w, index: 0, top: 105, bottom: 103 }); r.s.run('set_vertex_rl', { id: w, index: 1, top: 106, bottom: 103 });
    const ranges = r.geoms(w).map((m) => { const z = Array.from(m.geometry.attributes.position?.array ?? []).filter((_, i) => i % 3 === 2); return z.length ? [Math.min(...z), Math.max(...z)] : null; }).filter((x): x is number[] => !!x);
    expect(ranges.some(([lo, hi]) => Math.abs(lo - 103) < 1e-4 && Math.abs(hi - 106) < 1e-4)).toBe(true);
    expect(r.lastText()).toContain('SCREENING ONLY, NOT STRUCTURAL DESIGN');
  });
  it('a pipe is drawn at its inverts and a pool has its water plane at the water level', () => {
    const r = rig(); const p = r.add('stormwater_pipe', [at(1, 10), at(11, 10)], { diameter_mm: 300, upstream_invert_rl: 99, downstream_invert_rl: 98.5 });
    const ranges = r.geoms(p).map((m) => { const z = Array.from(m.geometry.attributes.position?.array ?? []).filter((_, i) => i % 3 === 2); return z.length ? [Math.min(...z), Math.max(...z)] : null; }).filter((x): x is number[] => !!x);
    expect(ranges.some(([lo, hi]) => Math.abs(lo - 98.5) < 1e-4 && Math.abs(hi - 99.3) < 1e-4)).toBe(true);
    expect(r.lastText()).toContain('GRADE 5.00 %');
    const pool = r.add('pool', ring, { depth_m: 1.5, coping_width_m: 0.3, water_level_rl: 101.4 });
    const planes = r.geoms(pool).filter((m) => m.geometry.type === 'BufferGeometry').map((m) => Array.from(m.geometry.attributes.position.array).filter((_, i) => i % 3 === 2));
    expect(planes.some((zs) => zs.length > 0 && zs.every((v) => Math.abs(v - 101.4) < 1e-4))).toBe(true);
    expect(planes.some((zs) => zs.length > 0 && zs.every((v) => Math.abs(v - 99.9) < 1e-4))).toBe(true);
    expect(r.lastText()).toContain('POOL BARRIER REQUIREMENTS: SEE RULES');
  });
  it('tree protection zones are drawn only from server values (never a built in multiplier)', () => {
    const r = rig(); const t = r.add('tree', [at(5, 5)], { height_m: 8, canopy_diameter_m: 5, trunk_diameter_mm: 500 }, { status: 'existing' });
    const lines = () => r.geoms(t).filter((m) => (m as unknown as THREE.Line).isLine).length;
    const before = lines(); expect(r.lastText()).not.toContain('TREE PROTECTION ZONE');
    r.sc.setZones({ [t]: { tpz: 6, srz: 1.5 } });
    expect(lines()).toBe(before + 2); expect(r.lastText()).toContain('TREE PROTECTION ZONE R 6.00 M'); expect(r.lastText()).toContain('STRUCTURAL ROOT ZONE R 1.50 M');
    r.sc.setZones({}); expect(lines()).toBe(before);
  });
  it('a pool barrier is a fence of its height and an overflow route ends in an arrow head', () => {
    const r = rig(); const b = r.add('pool_barrier', line4, { height_m: 1.2 });
    const fence = r.geoms(b).find((m) => m.geometry.type === 'BufferGeometry' && m.geometry.attributes.position.count >= 6 && (m.material as THREE.Material).opacity < 1)!;
    const z = Array.from(fence.geometry.attributes.position.array).filter((_, i) => i % 3 === 2); expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(1.19);
    const ov = r.add('overflow_route', [at(9, 5), at(9, 12), at(12, 20)]);
    expect(r.geoms(ov).some((m) => m.geometry.type === 'ConeGeometry')).toBe(true);
  });
  it('a landscape area is coloured by its surface kind and labelled with its area', () => {
    const r = rig(); const l = r.add('landscape_area', ring, { surface_kind: 'gravel' });
    expect(r.lastText()).toContain('AREA 48.0 M2');
    const fill = r.geoms(l).find((m) => (m.material as THREE.MeshBasicMaterial).transparent && (m.material as THREE.MeshBasicMaterial).opacity < 0.5)!;
    expect(`#${(fill.material as THREE.MeshBasicMaterial).color.getHexString()}`).toBe('#b7b0a2');
  });
});

describe('computed values with their calculation', () => {
  it('trench storage volume is length x width x depth x void ratio', () => {
    const r = rig(); const t = r.add('infiltration_trench', [at(1, 1), at(6, 1)], { width_m: 1, depth_m: 1.2 });
    expect(trenchStorage(r.obj(t))).toBeNull();                                    // the void ratio is NOT SET
    r.s.run('set_param', { id: t, key: 'void_ratio', value: 0.35 });
    const v = trenchStorage(r.obj(t))!; expect(v.m3).toBeCloseTo(2.1, 9); expect(v.calc).toBe('V = L x W x D x n = 5.00 x 1.00 x 1.20 x 0.35 = 2.100 m3');
    r.s.run('set_param', { id: t, key: 'void_ratio', value: 1.2 }); expect(trenchStorage(r.obj(t))).toBeNull();           // above 1 is not a ratio
    expect(extraLabelLines(r.obj(t))).toEqual([]);
  });
  it('pipe grade from the inverts and cover from the terrain, both with the calculation', () => {
    const r = rig(); const p = r.add('stormwater_pipe', [at(5, 10), at(5, 30)], { diameter_mm: 300, upstream_invert_rl: 99.5, downstream_invert_rl: 99.1 });
    const g = pipeGrade(r.obj(p))!; expect(g.pct).toBeCloseTo(2, 9); expect(g.calc).toContain('= 2.00 %');
    const c = pipeCover(r.obj(p), sample)!; expect(c.min).toBeCloseTo(0.7, 2);                                  // terrain 100.5 - (99.5 + 0.3)
    expect(pipeCover(r.obj(p), () => null)).toBeNull();
    const list = computedFor(r.obj(p), sample); expect(list.map((x) => x.key)).toEqual(['length_m', 'grade_pct', 'min_cover_m']);
  });
  it('tank volume from the dimensions and the pit depth from the terrain', () => {
    const r = rig(); const t = r.add('rwt', [at(5, 5)], { shape: 'round', diameter_m: 2, height_m: 2 });
    expect(tankGeometricVolume(r.obj(t))!.litres).toBeCloseTo(Math.PI * 2000, 3);
    const p = r.add('stormwater_pit', [at(5, 5)], { invert_rl: 98 });
    expect(computedFor(r.obj(p), sample).find((c) => c.key === 'depth_m')!.value).toBe('2.250 m');
  });
});

const entry = (o: Partial<CheckEntry>): CheckEntry => ({ id: 'x', object_id: null, object_type: null, object_label: '', code: 'C', title: 'T', status: 'FAIL', severity: 'blocking', message: 'm', requirements: [], basis: 'MODEL CHECK',
  value: null, limit: null, unit: '', ...o });
const result = (checks: CheckEntry[], values: CheckResult['values'] = {}): CheckResult => ({ schema: 'site_checks.v1', rules_for: 'Testshire (NSW)', jurisdiction: 'NSW', lga: 'Testshire', terrain: { available: true, status: 's' },
  lot_available: true, kerb_available: true, checks, values, summary: { blocking: 0, warning: 0, info: 0, total: checks.length, by_status: {} }, notes: [] });

describe('the shared Checks list', () => {
  it('groups checks by severity, hides passed ones by default, links each row to its object and carries keys and basis', () => {
    const r = rig(); const t = r.add('rwt', [at(5, 5)]), w = r.add('retaining_wall', line4);
    const res = result([
      entry({ id: 'a', object_id: t, title: 'TANK HEIGHT', status: 'FAIL', severity: 'blocking', requirements: [{ key: 'rwt.max_height_m.urban_zones', value: 3.2, unit: 'm', basis: 'LGA RULE', ref: 'DCP' }], basis: 'LGA RULE', value: 3.5, limit: 3.2, unit: 'm' }),
      entry({ id: 'b', object_id: w, title: 'CERTIFICATION', status: 'NOT EVALUATED', severity: 'warning', basis: 'UNRESOLVED' }),
      entry({ id: 'c', object_id: t, title: 'OK', status: 'PASS', severity: 'info' }),
      entry({ id: 'd', object_id: null, title: 'OSD REQUIRED', status: 'FAIL', severity: 'warning' }),
      entry({ id: 'e', object_id: 'gone', title: 'STALE', status: 'FAIL', severity: 'blocking' }),
    ]);
    const l = collectChecks(r.s.doc, res);
    expect(l.groups.map((g) => g.severity)).toEqual(['blocking', 'warning', 'info']);
    const blocking = l.groups[0].rows.filter((x) => x.source === 'server');
    expect(blocking.map((x) => x.id)).toEqual(['a']);                                              // the check of a removed object is dropped
    expect(blocking[0]).toMatchObject({ objectId: t, keys: ['rwt.max_height_m.urban_zones'], basis: 'LGA RULE', value: '3.2 m'.replace('3.2', '3.5'), limit: '3.2 m' });
    expect(l.groups[1].rows.map((x) => x.id)).toContain('d'); expect(l.groups[1].rows.find((x) => x.id === 'd')!.objectId).toBeNull();
    expect(l.hidden).toBe(1); expect(collectChecks(r.s.doc, res, { showPassed: true }).groups[2].rows.map((x) => x.id)).toContain('c');
  });
  it('lists the geometry issues of every object too, with the model check basis, and works without a server answer', () => {
    const r = rig(); r.s.setEnv({ lot: [[O[0], O[1]], [O[0] + 3, O[1]], [O[0] + 3, O[1] + 3], [O[0], O[1] + 3]], terrain: { available: true, sample } });
    r.add('tree', [at(20, 20)]);
    const l = collectChecks(r.s.doc, null);
    const row = l.groups.flatMap((g) => g.rows).find((x) => x.title === 'OUTSIDE LOT')!;
    expect(row).toMatchObject({ source: 'model', basis: 'MODEL CHECK', severity: 'warning', objectId: 'tree_1' });
    expect(l.groups[1].rows).toContain(row);
  });
  it('tree zone radii come from the server values only', () => {
    expect(zonesOf(null)).toEqual({});
    const z = zonesOf(result([], { tr: [{ key: 'tpz_radius_m', label: 'x', value: 6, unit: 'm', basis: 'LGA RULE', ref: '' }, { key: 'srz_radius_m', label: 'x', value: 1.5, unit: 'm', basis: 'LGA RULE', ref: '' }], other: [{ key: 'area_m2', label: 'a', value: 3, unit: 'm2', basis: 'MODEL', ref: '' }] }));
    expect(z).toEqual({ tr: { tpz: 6, srz: 1.5 } });
  });
});

describe('LiveChecks (the server is authoritative)', () => {
  const doc = () => { const r = rig(); r.add('tree', [at(5, 5)]); return r.s.doc; };
  const okFetch = (body: CheckResult, delay = 0) => vi.fn(async (_u: string, init?: RequestInit) => {
    await new Promise((res) => setTimeout(res, delay));
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  it('posts the whole document to /check and keeps the answer with the signature it is for', async () => {
    const f = okFetch(result([entry({ title: 'A' })])), lc = new LiveChecks({ ep: { base: 'http://api', projectId: 'p', fetchImpl: f as unknown as typeof fetch }, debounceMs: 0 });
    const d = doc(); lc.request(d, { debounce: false });
    expect(lc.state.status).toBe('pending'); await vi.waitFor(() => expect(lc.state.status).toBe('ok'));
    expect(f.mock.calls[0][0]).toBe('http://api/projects/p/site-design/check'); expect(JSON.parse(f.mock.calls[0][1]!.body as string).objects).toHaveLength(1);
    expect(lc.fresh(d)).toBe(true); expect(lc.state.resultSig).toBe(designSig(d));
    lc.request(d); expect(f).toHaveBeenCalledTimes(1);                                             // the same document is not asked for twice
  });
  it('an older answer never replaces the newer one, and a failure keeps the earlier answer but says so', async () => {
    const slow = okFetch(result([entry({ title: 'OLD' })]), 40), fast = okFetch(result([entry({ title: 'NEW' })]), 0);
    let n = 0; const fetchImpl = ((u: string, i?: RequestInit) => (n++ === 0 ? slow : fast)(u, i)) as unknown as typeof fetch;
    const lc = new LiveChecks({ ep: { base: 'http://api', projectId: 'p', fetchImpl }, debounceMs: 0 });
    const r = rig(); r.add('tree', [at(5, 5)]); const d1 = r.s.doc; r.add('tree', [at(9, 9)]); const d2 = r.s.doc;
    lc.request(d1, { debounce: false }); lc.request(d2, { debounce: false });
    await vi.waitFor(() => expect(lc.state.status).toBe('ok')); await new Promise((res) => setTimeout(res, 80));
    expect(lc.state.result!.checks[0].title).toBe('NEW'); expect(lc.state.sig).toBe(designSig(d2));
    const bad = new LiveChecks({ ep: { base: 'http://api', projectId: 'p', fetchImpl: (async () => new Response(JSON.stringify({ code: 'X', message: 'boom' }), { status: 500 })) as unknown as typeof fetch }, debounceMs: 0 });
    bad.request(d2, { debounce: false }); await vi.waitFor(() => expect(bad.state.status).toBe('error')); expect(bad.state.error).toBe('boom');
  });
  it('without an endpoint it says NO SERVER and requests nothing', () => {
    const lc = new LiveChecks({ ep: null }); lc.request(doc());
    expect(lc.state.status).toBe('no_server'); expect(lc.state.error).toContain('NO SERVER'); expect(lc.calls).toBe(0);
  });
  it('the signature ignores derived issues', () => {
    const r = rig(); r.add('tree', [at(20, 20)]); const a = r.s.doc;
    r.s.setEnv({ lot: [[O[0], O[1]], [O[0] + 3, O[1]], [O[0] + 3, O[1] + 3], [O[0], O[1] + 3]], terrain: { available: true, sample } });
    expect(r.s.doc).not.toBe(a); expect(designSig(r.s.doc)).toBe(designSig(a));
  });
});

describe('wording', () => {
  it('3D label lines are upper case and no user facing string of the stage 7 modules has an em or en dash', () => {
    const r = rig();
    const ids = [r.add('rwt', [at(5, 5)], { shape: 'round', diameter_m: 2, height_m: 2, capacity_l: 5000, inlet_rl: 100.2 }), r.add('retaining_wall', line4, { wall_type: 'block' }), r.add('footpath', [at(1, 1), at(6, 1)], { impervious: false })];
    for (const id of ids) for (const l of extraLabelLines(r.obj(id))) expect(l).toBe(l.toUpperCase());
    const here = join(__dirname, '../../src');
    for (const f of ['lib/site/siteObjects.ts', 'lib/site/checkList.ts', 'lib/site/serverChecks.ts', 'components/viewer/ObjectSections.tsx']) {
      const t = readFileSync(join(here, f), 'utf8'); expect(t, f).not.toMatch(/[–—]/);
    }
  });
  it('the object is a plain JSON document the server accepts: vertex levels keep their nulls', () => {
    const r = rig(); const w = r.add('retaining_wall', line4); r.s.run('set_vertex_rl', { id: w, index: 0, top: 1, bottom: 0 });
    const round = parseDesign(JSON.parse(JSON.stringify(r.s.doc)));
    expect((round.objects[0] as SiteObject).vertex_rls).toEqual({ top: [1, null, null], bottom: [0, null, null] });
  });
});

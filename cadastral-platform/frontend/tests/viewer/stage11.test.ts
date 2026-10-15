/** Stage 11: grouped layers, measurement maths, minimap projection, shortcut rules, first person limits and colliders, scene visibility and walk surfaces, the derived rule. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { groupLayers, groupState, hiddenFromState, isOn, objectLayerKey, OVERLAND_KEY } from '@/lib/viewer/layerGroups';
import { MeasureState, horizontalDistance, levelDifference, measureResult, niceScaleBar, pathLength, polygonArea, slopeDistance } from '@/lib/viewer/measure';
import { minimapBounds, minimapProjection, miniShapes } from '@/lib/viewer/minimap';
import { toolShortcut, SHORTCUT_GROUPS } from '@/lib/viewer/shortcuts';
import { FP_SLOPE_LIMIT_DEG, FP_STEP_UP_M } from '@/lib/viewer/fpLimits';
import { MOVE_DEFAULTS } from '@/lib/viewer/movement';
import { DEFAULT_SETTINGS } from '@/lib/viewer/types';
import { designColliders, edgeBoxes } from '@/lib/viewer/fpDesign';
import { resolveColliders } from '@/lib/viewer/movement';
import { SiteScene } from '@/lib/site/siteScene';
import { SiteDesignStore } from '@/lib/site/store';
import { ENGINE_REF_PREFIX, emptyDesign, type SiteDesign, type SiteObject } from '@/lib/site/types';
import { OPS } from '@/lib/site/ops';
import { seqCtx } from '../site/helpers';

const E0 = 496000, N0 = 6650000;
const P = (v: unknown, basis = 'user') => ({ value: v, basis });
function obj(id: string, type: string, geometry: unknown, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SiteObject {
  return { id, type, status: 'proposed', origin: 'user', verified: false, geometry, params, issues: [], ...extra } as unknown as SiteObject;
}
const pt = (x: number, y: number, yaw?: number) => ({ kind: 'point', p: [E0 + x, N0 + y], ...(yaw !== undefined ? { yaw_deg: yaw } : {}) });
const line = (...p: [number, number][]) => ({ kind: 'polyline', pts: p.map(([x, y]) => [E0 + x, N0 + y]) });
const ring = (...p: [number, number][]) => ({ kind: 'polygon', ring: p.map(([x, y]) => [E0 + x, N0 + y]) });
const doc = (...objects: SiteObject[]): SiteDesign => ({ ...emptyDesign('p1'), objects });

describe('grouped layer toggles', () => {
  const layers = [
    { c: 'surface', n: 'Design surface', on: true }, { c: 'existing', n: 'Existing ground', on: false }, { c: 'aerial', n: 'Aerial imagery', on: true }, { c: 'context', n: 'Surrounds', on: true },
    { c: 'road', n: 'Road', on: true }, { c: 'boundary', n: 'Boundary', on: true }, { c: 'services', n: 'Underground services', on: true }, { c: 'drainage', n: 'Pits and pipes', on: true },
    { c: 'lab_gen', n: 'Labels', on: true }, { c: 'design', n: 'Site design objects', on: true }, { c: 'mystery', n: 'A class this list does not know', on: true },
  ];
  const d = doc(obj('t1', 'tree', pt(1, 1)), obj('t2', 'tree', pt(2, 2)), obj('w1', 'retaining_wall', line([0, 0], [4, 0])), obj('s1', 'service_existing', line([0, 3], [9, 3]), { service_kind: P('gas') }),
    obj('s2', 'service_existing', line([0, 4], [9, 4])), obj('dr', 'sewer_drain', line([1, 1], [3, 3])), obj('ws', 'water_service', line([1, 2], [3, 5])));
  const groups = groupLayers(layers, d);
  const entries = (id: string) => groups.find((g) => g.id === id)?.entries ?? [];

  it('puts every bundle layer in exactly one of the six groups', () => {
    expect(groups.map((g) => g.id)).toEqual(['terrain', 'aerial', 'context', 'design', 'services', 'stormwater']);
    const keys = groups.flatMap((g) => g.entries.map((e) => e.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of layers) expect(keys.filter((k) => k === l.c)).toHaveLength(1);
    expect(entries('terrain').map((e) => e.key)).toEqual(['surface', 'existing']);
    expect(entries('aerial').map((e) => e.key)).toEqual(['aerial']);
    expect(entries('context').map((e) => e.key)).toEqual(expect.arrayContaining(['context', 'road', 'boundary', 'lab_gen', 'mystery']));
  });
  it('lists the design objects by type and the services by kind, with counts', () => {
    expect(entries('design').filter((e) => e.key.startsWith('type:')).map((e) => [e.key, e.count])).toEqual([['type:retaining_wall', 1], ['type:tree', 2]]);
    expect(entries('services').filter((e) => e.key.startsWith('service:')).map((e) => [e.key, e.count])).toEqual([['service:water', 1], ['service:sewer', 1], ['service:gas', 1], ['service:other', 1]]);
    expect(entries('stormwater').map((e) => e.key)).toEqual([OVERLAND_KEY]);
  });
  it('maps an object to one layer key (a drain is a sewer, a water service is water, a service without a kind is other)', () => {
    expect(d.objects.map(objectLayerKey)).toEqual(['type:tree', 'type:tree', 'type:retaining_wall', 'service:gas', 'service:other', 'service:sewer', 'service:water']);
  });
  it('a key without an entry in the state is on; a group state is on, off or mixed', () => {
    expect(isOn({}, 'type:tree')).toBe(true); expect(isOn({ 'type:tree': false }, 'type:tree')).toBe(false);
    const g = groups.find((x) => x.id === 'aerial')!, t = groups.find((x) => x.id === 'terrain')!;
    expect(groupState(g, {})).toBe(true); expect(groupState(g, { aerial: false })).toBe(false); expect(groupState(t, { surface: false })).toBeNull();
  });
  it('reads the hidden types, services and the overland layer from a state', () => {
    expect(hiddenFromState({ 'type:tree': false, 'type:retaining_wall': true, 'service:gas': false, [OVERLAND_KEY]: false, surface: false })).toEqual({ types: ['tree'], services: ['gas'], overland: true });
  });
});

describe('the measurement maths', () => {
  const A = { e: 0, n: 0, rl: 100 }, B = { e: 3, n: 4, rl: 101 }, C = { e: 3, n: 0, rl: null };
  it('distance in plan and in space', () => {
    expect(horizontalDistance(A, B)).toBe(5);
    expect(slopeDistance(A, B)).toBeCloseTo(Math.sqrt(26), 9); expect(slopeDistance(A, C)).toBeNull();
    expect(pathLength([A, B, { e: 3, n: 10, rl: 0 }])).toBe(11); expect(pathLength([A, B, { e: 3, n: 10, rl: 0 }], true)).toBeCloseTo(11 + Math.hypot(3, 10), 9);
  });
  it('area by the shoelace formula, whatever the winding', () => {
    const sq = [{ e: 0, n: 0, rl: 0 }, { e: 4, n: 0, rl: 0 }, { e: 4, n: 3, rl: 0 }, { e: 0, n: 3, rl: 0 }];
    expect(polygonArea(sq)).toBe(12); expect(polygonArea([...sq].reverse())).toBe(12); expect(polygonArea(sq.slice(0, 2))).toBe(0);
    expect(polygonArea(sq.map((p) => ({ ...p, e: p.e + 496000, n: p.n + 6650000 })))).toBeCloseTo(12, 6);       // MGA magnitudes
  });
  it('level difference: rise, fall, level, grade, and no value where a level is missing', () => {
    expect(levelDifference(A, B)).toMatchObject({ dz: 1, horizontal: 5, direction: 'rise' }); expect(levelDifference(A, B)!.gradePct).toBeCloseTo(20, 9);
    expect(levelDifference(B, A)).toMatchObject({ dz: -1, direction: 'fall' });
    expect(levelDifference(A, { e: 5, n: 5, rl: 100 })).toMatchObject({ dz: 0, direction: 'level' });
    expect(levelDifference(A, { e: 0, n: 0, rl: 102 })!.gradePct).toBeNull(); expect(levelDifference(A, C)).toBeNull();
  });
  it('the readout carries the terrain status and says DATA NOT AVAILABLE where a level is missing', () => {
    const r = measureResult('level', [A, B], 'INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY');
    expect(r.headline).toBe('1.00 m rise'); expect(r.lines.join('|')).toContain('LEVELS: INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY'); expect(r.lines.join('|')).toContain('NOT A SURVEY');
    expect(measureResult('level', [A, C], 'X').headline).toMatch(/DATA NOT AVAILABLE/);
    expect(measureResult('distance', [A, B], null).lines.join('|')).toContain('TERRAIN STATUS DATA NOT AVAILABLE');
    expect(measureResult('area', [A, B], 'X').headline).toMatch(/CLICK 1 MORE POINT/);
    expect(measureResult('distance', [], 'X').headline).toMatch(/FIRST POINT/);
  });
  it('the state: level keeps two points, undo and clear, mode change resets', () => {
    const s = new MeasureState(); s.setMode('level');
    s.add(A); s.add(B); s.add(C); expect(s.pts).toEqual([C]);
    s.undo(); expect(s.pts).toEqual([]); s.add(A); s.setMode('area'); expect(s.pts).toEqual([]);
    s.setMode('distance'); for (let i = 0; i < 100; i++) s.add({ e: i, n: 0, rl: 0 }); expect(s.pts.length).toBe(60); s.clear(); expect(s.pts).toEqual([]);
  });
  it('a round scale bar length', () => {
    expect(niceScaleBar(0.1, 110)).toMatchObject({ metres: 10, label: '10 m' }); expect(niceScaleBar(0.1, 110)!.px).toBeCloseTo(100, 6);
    expect(niceScaleBar(0.25, 110)).toMatchObject({ metres: 20 }); expect(niceScaleBar(0.5, 110)).toMatchObject({ metres: 50 }); expect(niceScaleBar(0.001, 110)!.label).toBe('10 cm');
    expect(niceScaleBar(0, 110)).toBeNull(); expect(niceScaleBar(Number.NaN)).toBeNull();
  });
});

describe('the minimap projection', () => {
  it('is north up, centred and keeps the aspect', () => {
    const p = minimapProjection([0, 0, 20, 10], 200, 200, 0);
    expect(p.k).toBe(10); expect(p.sx(10)).toBe(100); expect(p.sy(5)).toBe(100);
    expect(p.sy(10)).toBeLessThan(p.sy(0));                                          // north (larger y) is higher on the canvas
    expect(p.sx(0)).toBe(0); expect(p.sx(20)).toBe(200);
  });
  it('inverts', () => {
    const p = minimapProjection([-5, 2, 15, 12], 280, 280, 4);
    for (const [x, y] of [[0, 3], [10, 11], [-5, 2]]) { const [bx, by] = p.inv(p.sx(x), p.sy(y)); expect(bx).toBeCloseTo(x, 9); expect(by).toBeCloseTo(y, 9); }
  });
  it('the bounds hold the lot ring and the scene, and the shapes are in local metres without rejected proposals', () => {
    expect(minimapBounds([0, 0, 10, 10], [[-4, 3], [12, 20]], 2)).toEqual([-6, -2, 14, 22]);
    expect(minimapBounds([0, 0, 10, 10], null, 0)).toEqual([0, 0, 10, 10]);
    const d = doc(obj('a', 'tree', pt(3, 4)), obj('b', 'footpath', line([0, 0], [5, 0])), obj('c', 'tree', pt(1, 1), {}, { accepted: 'rejected' }));
    const s = miniShapes(d, [E0, N0]);
    expect(s.map((x) => x.id)).toEqual(['a', 'b']); expect(s[0].pts).toEqual([[3, 4]]); expect(s[1].pts).toEqual([[0, 0], [5, 0]]);
    expect(miniShapes(null, [0, 0])).toEqual([]);
  });
});

describe('shortcut rules', () => {
  const walk = { fpActive: true, placeActive: false }, place = { fpActive: false, placeActive: true }, idle = { fpActive: false, placeActive: false };
  it('T plan, M measure and H or ? help; none in a field, with Ctrl, on repeat; plan and measure not while walking; measure not while placing', () => {
    expect(toolShortcut({ code: 'KeyT' }, idle)).toBe('plan'); expect(toolShortcut({ code: 'KeyM' }, idle)).toBe('measure'); expect(toolShortcut({ code: 'KeyH' }, idle)).toBe('help'); expect(toolShortcut({ code: 'Slash', key: '?' }, idle)).toBe('help');
    expect(toolShortcut({ code: 'KeyT', ctrlKey: true }, idle)).toBeNull(); expect(toolShortcut({ code: 'KeyT', repeat: true }, idle)).toBeNull(); expect(toolShortcut({ code: 'KeyT', target: { tagName: 'INPUT' } }, idle)).toBeNull();
    expect(toolShortcut({ code: 'KeyT' }, walk)).toBeNull(); expect(toolShortcut({ code: 'KeyM' }, walk)).toBeNull(); expect(toolShortcut({ code: 'KeyH' }, walk)).toBe('help');
    expect(toolShortcut({ code: 'KeyM' }, place)).toBeNull(); expect(toolShortcut({ code: 'KeyT' }, place)).toBe('plan'); expect(toolShortcut({ code: 'KeyT' }, null)).toBeNull();
  });
  it('the help lists every tool key and uses no dash characters', () => {
    const text = JSON.stringify(SHORTCUT_GROUPS);
    for (const k of ['"F"', '"P"', '"D"', '"M"', '"T"', 'H or ?']) expect(text).toContain(k);
    expect(text).not.toMatch(/[‒-―−]/);
  });
});

describe('first person limits and collision volumes', () => {
  it('the step up and slope limits are named display constants used by the defaults', () => {
    expect(MOVE_DEFAULTS.stepUp).toBe(FP_STEP_UP_M); expect(MOVE_DEFAULTS.slopeDeg).toBe(FP_SLOPE_LIMIT_DEG);
    expect(DEFAULT_SETTINGS.stepUp).toBe(FP_STEP_UP_M); expect(DEFAULT_SETTINGS.slopeDeg).toBe(FP_SLOPE_LIMIT_DEG);
    const src = readFileSync(join(__dirname, '../../src/lib/viewer/fpLimits.ts'), 'utf8');
    expect(src).toMatch(/NOT design requirements/); expect(src).toMatch(/not a requirement/);
  });
  const base = () => 100;
  const O: [number, number] = [E0, N0];
  it('a building blocks the walker on its edges; a rejected proposal blocks nothing', () => {
    const b = obj('house', 'building', ring([5, 5], [15, 5], [15, 12], [5, 12]), { ffl_rl: P(100.5) }, { building: {} });
    const cols = designColliders(doc(b), O, base);
    expect(cols).toHaveLength(4); expect(cols.every((c) => c.kind === 'building')).toBe(true);
    const r = resolveColliders(5, 8, 0.3, 100.5 + 0.4, 100.5 + 1.8, cols);                       // walking into the west wall from the inside edge
    expect(r.hit).toBe(true);
    expect(designColliders(doc({ ...b, accepted: 'rejected' } as SiteObject), O, base)).toEqual([]);
    expect(designColliders(doc(b), O, () => null).length).toBe(4);                              // an FFL stated: the base level is not needed
  });
  it('a retaining wall, a pool edge, an above ground tank and a pool barrier block; an underground tank does not; the pool water is not a collider', () => {
    const wall = obj('w', 'retaining_wall', line([0, 0], [10, 0]), { height_m: P(1.5), thickness_m: P(0.4) });
    const pool = obj('p', 'pool', ring([0, 5], [4, 5], [4, 9], [0, 9]), { water_level_rl: P(100), depth_m: P(1.5) });
    const tank = obj('t', 'rwt', pt(8, 8), { shape: P('round'), diameter_m: P(2), height_m: P(2.2) });
    const under = obj('u', 'rwt', pt(8, 12), { shape: P('underground'), width_m: P(2), length_m: P(2), height_m: P(2) });
    const barrier = obj('b', 'pool_barrier', line([-1, 4], [5, 4]), { height_m: P(1.2) });
    const cols = designColliders(doc(wall, pool, tank, under, barrier), O, base);
    expect(cols.filter((c) => c.kind === 'wall')).toHaveLength(1); expect(cols.filter((c) => c.kind === 'pool')).toHaveLength(4); expect(cols.filter((c) => c.kind === 'tank')).toHaveLength(2); expect(cols.filter((c) => c.kind === 'barrier')).toHaveLength(1);
    const w = cols.find((c) => c.kind === 'wall')!; expect(w.s[1]).toBeCloseTo(0.4); expect(w.c[2] + w.s[2] / 2).toBeCloseTo(101.5);     // top of the wall: base plus its height
    const t = cols.filter((c) => c.kind === 'tank'); expect(t[0].s[0]).toBeGreaterThan(1.8); expect(t[0].s[0]).toBeLessThanOrEqual(2);
    // walking at ground level toward the tank from the west is stopped before its centre
    const r = resolveColliders(7.3, 8, 0.3, 100.4, 101.8, t); expect(r.hit).toBe(true); expect(r.x).toBeLessThan(7.3);
  });
  it('edge boxes close the corners of a ring and follow the edge direction', () => {
    const e = edgeBoxes([[E0, N0], [E0 + 10, N0], [E0 + 10, N0 + 10]], false, O, 0, 2, 0.2, 'wall');
    expect(e).toHaveLength(2); expect(e[0].s[0]).toBeCloseTo(10.2); expect(e[0].yaw).toBeCloseTo(0); expect(e[1].yaw).toBeCloseTo(90);
    expect(edgeBoxes([[E0, N0], [E0 + 10, N0], [E0 + 10, N0 + 10]], true, O, 0, 2, 0.2, 'wall')).toHaveLength(3);
  });
});

describe('the design scene: layer visibility and walkable surfaces', () => {
  const makeLabel = () => new THREE.Sprite();
  const terrain = { available: true, sample: () => 100 };
  const scene = () => new SiteScene({ origin: [E0, N0], terrain, makeLabel: makeLabel as never });
  it('hides objects by layer key and keeps them hidden when they are rebuilt', () => {
    const s = scene(), d = doc(obj('t1', 'tree', pt(1, 1)), obj('g1', 'service_existing', line([0, 3], [9, 3]), { service_kind: P('gas') }));
    s.syncAll(d);
    s.setHiddenKeys(['type:tree', 'service:gas']);
    expect(s.groupOf('t1')!.visible).toBe(false); expect(s.groupOf('g1')!.visible).toBe(false);
    s.syncAll(d);                                                                              // rebuilt: still hidden
    expect(s.groupOf('t1')!.visible).toBe(false);
    s.setHiddenKeys([]); expect(s.groupOf('t1')!.visible).toBe(true); expect(s.groupOf('g1')!.visible).toBe(true);
    s.setHiddenKeys(['type:tree']); expect(s.pickables().some((o) => THREE.Object3D.prototype && SiteScene.idOf(o) === 't1')).toBe(false);
  });
  it('a footpath is a walkable surface; a pool water surface and a pool floor are not; a hidden object has none', () => {
    const s = scene();
    const fp = obj('f', 'footpath', line([0, 0], [8, 0]), { width_m: P(1.2) });
    const pool = obj('p', 'pool', ring([0, 5], [4, 5], [4, 9], [0, 9]), { water_level_rl: P(99.8), depth_m: P(1.5), coping_width_m: P(0.3) });
    s.syncAll(doc(fp, pool));
    const walk = s.walkMeshes();
    expect(walk.some((m) => SiteScene.idOf(m) === 'f')).toBe(true);
    expect(walk.some((m) => SiteScene.idOf(m) === 'p')).toBe(true);                             // the coping
    const water: THREE.Object3D[] = []; s.groupOf('p')!.traverse((o) => { if (o.userData.water) water.push(o); });
    expect(water).toHaveLength(1); expect(walk.includes(water[0] as THREE.Mesh)).toBe(false);
    for (const m of walk) expect(m.userData.water).toBeUndefined();
    s.setHiddenKeys(['type:footpath']); expect(s.walkMeshes().some((m) => SiteScene.idOf(m) === 'f')).toBe(false);
  });
});

describe('the derived rule (stage 10 loophole)', () => {
  const eng = (id: string) => ({ op: 'add_object', args: { type: 'rwt', origin: 'ai_proposal', status: 'proposed', id, points: [{ e: E0 + 1, n: N0 + 1 }], params: { roof_building_id: { value: 'house', basis: 'derived', ref: `${ENGINE_REF_PREFIX}: TANK GENERATOR FROM THE BUILDING` } } } });
  const base = () => { const s = new SiteDesignStore(doc(obj('house', 'building', ring([5, 5], [9, 5], [9, 9], [5, 9]), {}, { building: { levels: [], datum_index: 0, exits: { sewer: [], water: [], downpipes: [] }, frame: { origin: [E0, N0], yaw_deg: 0 } } })), seqCtx()); return s; };
  const setp = (id: string) => ({ id, key: 'roof_building_id', value: 'house', basis: 'derived', ref: `${ENGINE_REF_PREFIX}: TANK GENERATOR FROM THE BUILDING` });

  it('set_param refuses basis derived with an engine ref from a hand edit or the assistant, and accepts it only inside an engine batch', () => {
    const s = base(); s.run('add_object', { type: 'rwt', points: [{ e: E0 + 1, n: N0 + 1 }], id: 'tank1' });
    expect(() => s.run('set_param', setp('tank1'))).toThrow(/cannot be chosen by hand/);
    expect(s.doc.objects.find((o) => o.id === 'tank1')!.params.roof_building_id).toBeUndefined();
    const r = s.runBatch('hand', [{ op: 'set_param', args: setp('tank1') }], { atomic: true });                      // a batch that is not the engine batch
    expect(r.some((x) => !x.ok)).toBe(true);
    const ok = s.runBatch('AI FIRST DESIGN', [{ op: 'set_param', args: setp('tank1') }], { atomic: true, engine: true });
    expect(ok.every((x) => x.ok)).toBe(true);
    expect(s.doc.objects.find((o) => o.id === 'tank1')!.params.roof_building_id).toEqual({ value: 'house', basis: 'derived', ref: `${ENGINE_REF_PREFIX}: TANK GENERATOR FROM THE BUILDING` });
  });
  it('add_object refuses an engine derived parameter outside the engine batch', () => {
    const s = base();
    expect(() => s.run(eng('t1').op, eng('t1').args)).toThrow(/ENGINE DERIVED value/);
    expect(s.doc.objects.some((o) => o.id === 't1')).toBe(false);
    const ok = s.runBatch('AI FIRST DESIGN', [eng('t2')], { atomic: true, engine: true });
    expect(ok.every((x) => x.ok)).toBe(true); expect(s.doc.objects.some((o) => o.id === 't2')).toBe(true);
  });
  it('the single operation path never carries the engine flag, even when the context asks for it', () => {
    const s = new SiteDesignStore(base().doc, { ...seqCtx(), engineBatch: true });
    expect(() => s.run('add_object', eng('t3').args)).toThrow(/ENGINE DERIVED value/);
    expect(OPS.set_param.description).toMatch(/platform default cannot be set/);
  });
  it('a derived value that a requirement produced (a sewer invert) is still accepted by the system path', () => {
    const s = base();
    expect(() => s.run('add_object', { type: 'sewer_drain', points: [{ e: E0 + 1, n: N0 + 1 }, { e: E0 + 5, n: N0 + 1 }], id: 'sd', params: { diameter_mm: P(100), upstream_invert_rl: P(98), downstream_invert_rl: { value: 97.9, basis: 'derived', ref: 'sewer.min_grade_pct' } } })).not.toThrow();
  });
});

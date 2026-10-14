import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import {
  chainageOnKerb, chartModel, CHART_BOX, crossingChainage, drivewayGaps, effectiveDriveway, kerbFromBundle, makeKerb, parseWkt, pointOnKerb, previewProfile, projectToKerb,
  type DrivewayProfile, type GradingResult, type RuleInfo,
} from '@/lib/site/driveway';
import { applyOp, runBatch, type OpCtx } from '@/lib/site/ops';
import { SiteScene } from '@/lib/site/siteScene';
import { SiteDesignStore } from '@/lib/site/store';
import { gradingParts, levelAtChainage, planeFromPatch } from '@/lib/site/earthworksScene';
import { emptyDesign, OBJECT_KINDS, type SiteDesign, type SiteObject } from '@/lib/site/types';
import { at, doc0, E0, N0, seqCtx } from './helpers';

// the same sample lot as the backend tests: origin at the south west corner, front boundary on y = 0, kerb line 4 m towards the road, x from -30 to +48
const LOT: [number, number][] = [[E0, N0], [E0 + 18, N0], [E0 + 18, N0 + 34], [E0, N0 + 34]];
const KERB = makeKerb([E0 - 30, N0 - 4], [E0 + 48, N0 - 4], LOT)!;
const PLANAR = (x: number, y: number) => 100 + 0.06 * y + 0.01 * x;                          // the backend test terrain: 6 percent rising to the back, 1 percent to the east
const existing = (e: number, n: number) => PLANAR(e - E0, n - N0);
const RULES = (grade: number | null, change: number | null): Record<string, RuleInfo> => ({
  'driveway.max_grade_pct': { key: 'driveway.max_grade_pct', value: grade, unit: '%', basis: grade === null ? 'UNRESOLVED' : 'LGA RULE', ref: grade === null ? 'NO REQUIREMENT FOUND' : 'Testshire 4.2' },
  'driveway.max_grade_change_pct': { key: 'driveway.max_grade_change_pct', value: change, unit: '%', basis: change === null ? 'UNRESOLVED' : 'LGA RULE', ref: change === null ? 'NO REQUIREMENT FOUND' : 'Testshire 4.3' },
});
const base = (over: Partial<Parameters<typeof previewProfile>[0]> = {}) => ({
  pts: [[E0 + 9, N0 - 4], [E0 + 9, N0 + 8], [E0 + 9, N0 + 14]], width: 3 as number | null, endLevel: PLANAR(9, 14) as number | null, endLevelBasis: 'USER', existing, lot: LOT, kerb: KERB,
  rules: RULES(null, null) as Record<string, RuleInfo> | null, terrainStatus: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY', objectId: 'd1', ...over,
});

describe('chainage along the assumed kerb line', () => {
  it('chainage and offset of a point, the point at a chainage, and projection with clamping', () => {
    expect(KERB.length).toBe(78); expect(KERB.n).toEqual([-0, 1]);                          // normal points into the lot (towards +y)
    expect(chainageOnKerb(KERB, [E0 + 9, N0 - 4])).toEqual({ chainage: 39, offset: 0 });
    expect(chainageOnKerb(KERB, [E0 + 9, N0 + 6]).offset).toBe(10);                          // 10 m into the lot
    expect(pointOnKerb(KERB, 39)).toEqual([E0 + 9, N0 - 4]);
    const p = projectToKerb(KERB, [E0 + 20, N0 + 30]); expect(p).toEqual({ p: [E0 + 20, N0 - 4], chainage: 50, clamped: false });
    const far = projectToKerb(KERB, [E0 + 100, N0]); expect(far).toMatchObject({ chainage: 78, clamped: true, p: [E0 + 48, N0 - 4] });
    expect(projectToKerb(KERB, [E0 - 99, N0]).chainage).toBe(0);
  });
  it('works along an angled kerb line (chainage is distance along the line, not along x)', () => {
    const k = makeKerb([0, 0], [30, 40], [[10, -5], [10, -10], [20, -10]])!;                    // 50 m long, 3-4-5 direction
    expect(k.length).toBe(50); expect(chainageOnKerb(k, [15, 20]).chainage).toBeCloseTo(25, 9); expect(pointOnKerb(k, 25)[0]).toBeCloseTo(15, 9);
    expect(chainageOnKerb(k, [15, 20]).offset).toBeCloseTo(0, 9);
    expect(makeKerb([1, 1], [1, 1], null)).toBeNull();
  });
  it('is read from the bundle line part the same way the server reads it (first segment start to last segment end, plus the origin)', () => {
    const bundle = { info: { origin: [E0, N0, 0] }, parts: [{ n: 'Kerb_line_assumed', c: 'road', col: '#f00', lines: [-30, -4, 0.2, 0, -4, 0.2, 0, -4, 0.2, 48, -4, 0.2] }, { n: 'other', c: 'road', col: '#000', lines: [0, 0, 0, 1, 1, 1] }] } as never;
    const k = kerbFromBundle(bundle, LOT)!;
    expect(k.a).toEqual([E0 - 30, N0 - 4]); expect(k.b).toEqual([E0 + 48, N0 - 4]); expect(chainageOnKerb(k, [E0 + 9, N0 - 4]).chainage).toBe(39);
    expect(kerbFromBundle({ info: { origin: [0, 0, 0] }, parts: [] } as never, null)).toBeNull();
  });
});

describe('effective driveway: the end level follows a linked building', () => {
  const building = (ffl: number | null): SiteObject => ({ id: 'b1', type: 'building', status: 'proposed', origin: 'user', verified: false, label: 'House', geometry: { kind: 'polygon', ring: [[0, 0], [1, 0], [1, 1]] }, params: { ffl_rl: ffl === null ? { value: null, basis: 'unresolved' } : { value: ffl, basis: 'user' } }, issues: [] });
  const drive = (extra: Record<string, unknown> = {}): SiteObject => ({ id: 'd1', type: 'driveway', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'polyline', pts: [[0, 0], [0, 5]] }, issues: [],
    params: { width_m: { value: 3, basis: 'user' }, end_level_rl: { value: 101, basis: 'user' }, ...extra } as SiteObject['params'] });
  const docOf = (...o: SiteObject[]): SiteDesign => ({ ...emptyDesign('p'), objects: o });
  it('with a link the end level is the building FFL; without one the object is untouched', () => {
    const d = drive({ end_building_id: { value: 'b1', basis: 'user' } });
    expect(effectiveDriveway(docOf(d, building(103.2)), d).params.end_level_rl).toEqual({ value: 103.2, basis: 'user', ref: 'FFL OF HOUSE' });
    const plain = drive(); expect(effectiveDriveway(docOf(plain, building(103.2)), plain)).toBe(plain);
  });
  it('a linked building with no FFL, or a deleted building, never invents a level', () => {
    const d = drive({ end_building_id: { value: 'b1', basis: 'user' } });
    expect(effectiveDriveway(docOf(d, building(null)), d).params.end_level_rl).toEqual({ value: null, basis: 'unresolved' });
    expect(drivewayGaps(docOf(d, building(null)), d)).toEqual(['LINKED BUILDING HAS NO FFL, END LEVEL NOT SET']);
    expect(effectiveDriveway(docOf(d), d).params.end_level_rl).toEqual({ value: null, basis: 'unresolved' });          // the building is gone: the link still wins, so the typed 101 is NOT used (it could be stale)
    expect(drivewayGaps(docOf(d), d)).toEqual(['LINKED BUILDING NOT FOUND, END LEVEL NOT SET']);
    expect(drivewayGaps(docOf(drive({ width_m: { value: null, basis: 'unresolved' }, end_level_rl: { value: null, basis: 'unresolved' } })), drive())).toEqual([]);
    const bare = drive({ width_m: { value: null, basis: 'unresolved' }, end_level_rl: { value: null, basis: 'unresolved' } });
    expect(drivewayGaps(docOf(bare), bare)).toEqual(['WIDTH NOT SET', 'END LEVEL NOT SET']);
  });
});

describe('browser preview long section (same stations and numbers as the server engine)', () => {
  it('matches the backend hand values on the planar terrain: stations, 6 percent grade, band, boundary', () => {
    const p = previewProfile(base())!;
    expect(p.preview).toBe(true); expect(p.length_m).toBe(18); expect(p.geometry!.boundary_chainage_m).toBe(4); expect(p.geometry!.verge_m).toBe(4); expect(p.geometry!.gutter_band_m).toBe(0.5);
    expect(p.stations.map((s) => s.name)).toEqual(['KERB LINE', 'GUTTER BAND', 'PROPERTY BOUNDARY', 'DRIVEWAY END']);
    for (const [s, y] of p.stations.map((s, i) => [s, [-4, -3.5, 0, 14][i]] as const)) { expect(s.design_rl).toBeCloseTo(PLANAR(9, y), 3); expect(s.existing_rl).toBeCloseTo(PLANAR(9, y), 3); }
    expect(p.segments.map((s) => s.grade_pct)).toEqual([6, 6, 6]); expect(p.crossover).toMatchObject({ chainage_m: 39, offset_from_kerb_m: 0, kerb_length_m: 78 });
    expect(p.samples.chainage.at(-1)).toBe(18); expect(p.samples.design).toHaveLength(p.samples.chainage.length);
    p.samples.chainage.forEach((t, i) => expect(p.samples.existing[i]).toBeCloseTo(PLANAR(9, -4 + t), 3));
  });
  it('with no resolved requirement every limit is UNRESOLVED and nothing fails or passes', () => {
    for (const rules of [null, RULES(null, null)]) {
      const p = previewProfile(base({ rules, endLevel: 110 }))!;
      for (const id of ['max_grade', 'change_of_grade@PROPERTY BOUNDARY']) expect(p.checks.find((c) => c.id === id)).toMatchObject({ status: 'NOT EVALUATED', limit: null });
      expect(p.checks.find((c) => c.id === 'max_grade')!.basis).toBe('UNRESOLVED'); expect(p.failing).toEqual([]); expect(p.segments.every((s) => !s.failing)).toBe(true);
      expect(p.stations.find((s) => s.name === 'PROPERTY BOUNDARY')!.transition).toBe('UNRESOLVED');
    }
  });
  it('a resolved grade limit fails the segments above it, with the failing chainages and the hover text', () => {
    const p = previewProfile(base({ rules: RULES(8, 5), endLevel: PLANAR(9, 14) + 1.5 }))!;       // the last 14 m climb 1.5 m more than the ground: 6 + 10.7 = 16.7 percent
    const mg = p.checks.find((c) => c.id === 'max_grade')!;
    expect(mg.status).toBe('FAIL'); expect(mg.value).toBeCloseTo(6 + (100 * 1.5) / 14, 1); expect(mg.chainage_from_m).toBe(4); expect(mg.chainage_to_m).toBe(18);
    expect(p.segments.map((s) => s.failing)).toEqual([false, false, true]);
    expect(p.failing).toHaveLength(2);                                                            // the steepest grade and the change of grade at the boundary
    expect(p.failing[0].message).toBe(`driveway.max_grade_pct 8 % (LGA RULE): ${mg.value} %`);
    const cg = p.checks.find((c) => c.id === 'change_of_grade@PROPERTY BOUNDARY')!; expect(cg).toMatchObject({ status: 'FAIL', limit: 5, chainage_from_m: 4, chainage_to_m: 4 });
    expect(p.stations.find((s) => s.name === 'PROPERTY BOUNDARY')).toMatchObject({ transition: 'TRANSITION REQUIRED', kind: 'SAG' });
  });
  it('no end level: no design line, no checks, and the preview says so; the B85 check is server only', () => {
    const p = previewProfile(base({ endLevel: null }))!;
    expect(p.status).toBe('END LEVEL NOT SET'); expect(p.samples.design).toBeNull(); expect(p.stations.every((s) => s.design_rl === null)).toBe(true);
    expect(p.checks.find((c) => c.id === 'profile')).toMatchObject({ status: 'NOT EVALUATED', note: 'END LEVEL NOT SET' });
    const full = previewProfile(base())!; expect(full.checks.find((c) => c.id === 'b85_scraping_clearance')).toMatchObject({ status: 'NOT EVALUATED', note: expect.stringContaining('SERVER ONLY') });
  });
  it('width limits come from the rules; a width that is NOT SET is not evaluated', () => {
    const rules = { ...RULES(null, null), 'driveway.min_width_m': { key: 'driveway.min_width_m', value: 3, unit: 'm', basis: 'LGA RULE', ref: 'x' } };
    expect(previewProfile(base({ rules, width: 2.6 }))!.checks.find((c) => c.id === 'width_min')).toMatchObject({ status: 'FAIL', value: 2.6, limit: 3 });
    expect(previewProfile(base({ rules, width: null }))!.checks.find((c) => c.id === 'width_min')!.status).toBe('NOT EVALUATED');
    expect(previewProfile(base({ rules }))!.checks.find((c) => c.id === 'width_max')).toMatchObject({ status: 'NOT EVALUATED', limit: null });
  });
  it('terrain missing under the driveway is DATA NOT AVAILABLE, never a guessed level', () => {
    const p = previewProfile(base({ existing: () => null }))!;
    expect(p.status).toMatch(/^TERRAIN DATA NOT AVAILABLE/); expect(p.stations).toEqual([]); expect(chartModel(p).empty).toBe('TERRAIN DATA NOT AVAILABLE ALONG THE DRIVEWAY');
  });
  it('crossing chainage of the centreline with the lot', () => {
    expect(crossingChainage(base().pts, LOT)).toBeCloseTo(4, 9); expect(crossingChainage([[E0 + 40, N0 - 4], [E0 + 40, N0 + 3]], LOT)).toBeNull();
  });
});

describe('long section chart data', () => {
  const profile = (): DrivewayProfile => ({ ...(previewProfile(base({ rules: RULES(8, null), endLevel: PLANAR(9, 14) + 1.5 }))!), schema: 'driveway_profile.v1', detail: 'full', earthworks: null } as unknown as DrivewayProfile);
  it('maps chainage and levels to SVG coordinates inside the plot box', () => {
    const m = chartModel(profile()), b = CHART_BOX;
    expect(m.empty).toBeNull(); expect(m.range.t0).toBe(0); expect(m.range.t1).toBe(18);
    expect(m.existing.startsWith(`M${b.padLeft.toFixed(1)} `)).toBe(true); expect(m.existing).toContain(`L${(b.width - b.padRight).toFixed(1)} `);
    const nums = (d: string) => [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    for (const [x, y] of [...nums(m.existing), ...nums(m.design!)]) { expect(x).toBeGreaterThanOrEqual(b.padLeft - 1e-6); expect(x).toBeLessThanOrEqual(b.width - b.padRight + 1e-6); expect(y).toBeGreaterThanOrEqual(b.padTop); expect(y).toBeLessThanOrEqual(b.height - b.padBottom); }
    const e = nums(m.existing), d = nums(m.design!);
    expect(e[e.length - 1][1]).toBeGreaterThan(d[d.length - 1][1]);                                // y grows downward: the design end (1.5 m above the ground) is drawn higher on screen
  });
  it('labels each segment with its grade, and marks the failing one with the requirement text', () => {
    const m = chartModel(profile());
    expect(m.segments.map((s) => s.label)).toEqual(['+6.0%', '+6.0%', '+16.7%']); expect(m.segments.map((s) => s.failing)).toEqual([false, false, true]);
    expect(m.segments[2].title).toMatch(/^driveway\.max_grade_pct 8 % \(LGA RULE\): 16\.7/);
    expect(m.segments[0].x1).toBeCloseTo(m.segments[1].x0, 6); expect(m.segments[0].x0).toBe(CHART_BOX.padLeft);
    expect(m.failing.length).toBe(1); expect(m.failing[0].d.startsWith('M')).toBe(true); expect(m.failing[0].title).toContain('driveway.max_grade_pct');
    expect(m.stations.map((s) => s.name)).toEqual(['KERB LINE', 'GUTTER BAND', 'PROPERTY BOUNDARY', 'DRIVEWAY END']);
  });
  it('without a design line only the existing ground is drawn; a flat profile still gets a readable axis; too few levels is an empty chart', () => {
    const noEnd = chartModel(previewProfile(base({ endLevel: null }))!);
    expect(noEnd.design).toBeNull(); expect(noEnd.segments.map((s) => s.label)).toEqual(['GRADE NOT SET', 'GRADE NOT SET']);
    const flat = chartModel(previewProfile(base({ existing: () => 100, endLevel: 100 }))!); expect(flat.range.z1 - flat.range.z0).toBeGreaterThanOrEqual(0.5); expect(flat.yTicks.length).toBeGreaterThan(0);
    expect(chartModel({ samples: { chainage: [0], existing: [100], design: null, grade_pct: null, transition: null }, stations: [], segments: [], failing: [], status: 'x' }).empty).toBe('NO PROFILE');
  });
  it('flags a PREVIEW chart', () => { expect(chartModel(previewProfile(base())!).preview).toBe(true); expect(chartModel({ ...profile(), preview: false }).preview).toBe(false); });
});

describe('WKT of server polygons', () => {
  it('reads POLYGON, POLYGON with a hole, MULTIPOLYGON and EMPTY', () => {
    expect(parseWkt('POLYGON ((0 0, 4 0, 4 3, 0 3, 0 0))')).toEqual([[[[0, 0], [4, 0], [4, 3], [0, 3]]]]);
    const holed = parseWkt('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 4 2, 4 4, 2 4, 2 2))'); expect(holed).toHaveLength(1); expect(holed[0]).toHaveLength(2); expect(holed[0][1][0]).toEqual([2, 2]);
    const multi = parseWkt('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))'); expect(multi).toHaveLength(2); expect(multi[1][0][0]).toEqual([5, 5]);
    expect(parseWkt('POLYGON EMPTY')).toEqual([]); expect(parseWkt(null)).toEqual([]); expect(parseWkt('LINESTRING (0 0, 1 1)')).toEqual([]);
  });
});

describe('driveway and grading operations', () => {
  it('a driveway is a polyline object that starts with NO width, end level, surface or batter slope', () => {
    expect(OBJECT_KINDS.driveway.geometry).toBe('polyline');
    const r = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 10)] }, seqCtx());
    const o = r.doc.objects[0];
    expect(Object.keys(o.params).sort()).toEqual(['batter_cut_h_per_v', 'batter_fill_h_per_v', 'end_level_rl', 'surface_kind', 'width_m']);
    expect(Object.values(o.params).every((p) => p.basis === 'unresolved' && p.value === null)).toBe(true);
  });
  it('a grading area starts with no parameters (stage 4 contract); its stage 6 parameters are typed', () => {
    const ctx = seqCtx(); let d = applyOp(doc0(), 'add_object', { type: 'grading_area', points: [at(0, 0), at(5, 0), at(5, 5)] }, ctx).doc;
    expect(d.objects[0].params).toEqual({});
    d = applyOp(d, 'set_param', { id: 'grading_area_1', key: 'target_level_m', value: 101.5 }, ctx).doc; expect(d.objects[0].params.target_level_m.value).toBe(101.5);
    expect(() => applyOp(d, 'set_param', { id: 'grading_area_1', key: 'target_level_m', value: 'high' }, ctx)).toThrow(/must be a number/);
    expect(() => applyOp(d, 'set_param', { id: 'grading_area_1', key: 'batter_cut_h_per_v', value: 'steep' }, ctx)).toThrow(/must be a number/);
  });
  it('driveway surface is limited to the list; width and levels must be numbers', () => {
    const ctx = seqCtx(); const d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(0, 0), at(0, 9)] }, ctx).doc;
    expect(() => applyOp(d, 'set_param', { id: 'driveway_1', key: 'surface_kind', value: 'lava' }, ctx)).toThrow(/must be one of/);
    expect(applyOp(d, 'set_param', { id: 'driveway_1', key: 'surface_kind', value: 'asphalt' }, ctx).doc.objects[0].params.surface_kind.value).toBe('asphalt');
    expect(() => applyOp(d, 'set_param', { id: 'driveway_1', key: 'width_m', value: 'wide' }, ctx)).toThrow(/must be a number/);
  });
  it('set_driveway_crossover moves only the first point, or the whole centreline with translate; inverse restores it', () => {
    const ctx = seqCtx(); const d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 4), at(12, 10)] }, ctx).doc;
    const one = applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -4) }, ctx);
    expect((one.doc.objects[0].geometry as { pts: number[][] }).pts).toEqual([[E0 + 11, N0 - 4], [E0 + 9, N0 + 4], [E0 + 12, N0 + 10]]);
    const all = applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -4), translate: true }, ctx);
    expect((all.doc.objects[0].geometry as { pts: number[][] }).pts).toEqual([[E0 + 11, N0 - 4], [E0 + 11, N0 + 4], [E0 + 14, N0 + 10]]);
    expect(applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(9, -4) }, ctx).patch).toEqual([]);
    expect(() => applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: { e: 'x', n: 1 } }, ctx)).toThrow();
    const t = applyOp(d, 'add_object', { type: 'tree', points: [at(1, 1)] }, ctx).doc; expect(() => applyOp(t, 'set_driveway_crossover', { id: 'tree_2', point: at(1, 1) }, ctx)).toThrow(/not a driveway/);
  });
  it('link_driveway_end links to a building only, unlinks with null, and undoes with the move as one batch', () => {
    const ctx = seqCtx(); let d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 8)] }, ctx).doc;
    d = { ...d, objects: [...d.objects, { id: 'bld', type: 'building', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'polygon', ring: [[0, 0], [1, 0], [1, 1]] }, params: {}, issues: [] }] };
    expect(() => applyOp(d, 'link_driveway_end', { id: 'driveway_1', building_id: 'nope' }, ctx)).toThrow(/not a building/);
    const b = runBatch(d, [{ op: 'edit_vertices', args: { id: 'driveway_1', action: 'move', index: 1, point: at(9, 12) } }, { op: 'link_driveway_end', args: { id: 'driveway_1', building_id: 'bld' } }], ctx);
    expect(b.results.every((x) => x.ok)).toBe(true); expect(b.doc.objects[0].params.end_building_id).toMatchObject({ value: 'bld', basis: 'user' });
    expect(applyOp(b.doc, 'link_driveway_end', { id: 'driveway_1', building_id: 'bld' }, ctx).patch).toEqual([]);              // already linked: no change
    expect(applyOp(b.doc, 'link_driveway_end', { id: 'driveway_1', building_id: null }, ctx).doc.objects[0].params.end_building_id).toBeUndefined();
    expect(applyOp(d, 'link_driveway_end', { id: 'driveway_1', building_id: null }, ctx).patch).toEqual([]);
  });
});

describe('earthworks drawing from engine results', () => {
  const O: [number, number] = [E0, N0];
  it('levelAtChainage interpolates the design samples and clamps at the ends', () => {
    expect(levelAtChainage([0, 2, 4], [10, 12, 11], 1)).toBe(11); expect(levelAtChainage([0, 2, 4], [10, 12, 11], 3)).toBe(11.5); expect(levelAtChainage([0, 2, 4], [10, 12, 11], -1)).toBe(10); expect(levelAtChainage([0, 2, 4], [10, 12, 11], 9)).toBe(11);
  });
  it('planeFromPatch: a constant level, or the inclined plane through the corner levels', () => {
    expect(planeFromPatch([[0, 0, 5], [1, 0, 5], [1, 1, 5]])!(7, 7)).toBe(5);
    const pl = planeFromPatch([[0, 0, 100], [10, 0, 101], [10, 10, 101], [0, 10, 100]])!;      // 10 percent rising to +x
    expect(pl(5, 3)).toBeCloseTo(100.5, 9); expect(pl(20, 9)).toBeCloseTo(102, 9); expect(planeFromPatch([[0, 0, 1]])).toBeNull();
  });
  const result = (patch: [number, number, number][], extra: Partial<GradingResult> = {}): GradingResult => ({
    schema: 'grading.v1', object_id: 'g1', status: 'OK', label: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY', terrain: { status: 'x', source: 'y' }, design: { mode: 'level', target_level_m: patch[0][2], pivot_level_m: null, pivot_basis: null },
    design_patch: patch, checks: [], notes: [], rules: {},
    earthworks: { label: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY', terrain_status: 'x', grid_m: 0.5, cut_m3: 12.5, fill_m3: 12.5, net_m3: 0, cut_area_m2: 50, fill_area_m2: 50, uncertainty_m3: null, uncertainty_note: 'x', batters_computed: false,
      batters: { cut: { h_per_v: null, basis: 'UNRESOLVED', ref: null, requirement_key: 'k' }, fill: { h_per_v: null, basis: 'UNRESOLVED', ref: null, requirement_key: 'k' }, cut_wkt: null, fill_wkt: null }, platform_wkt: '', zones: [], notes: [] }, ...extra,
  });
  const grading = (): SiteObject => ({ id: 'g1', type: 'grading_area', status: 'proposed', origin: 'user', verified: false, issues: [], geometry: { kind: 'polygon', ring: [[E0 + 4, N0 + 10], [E0 + 14, N0 + 10], [E0 + 14, N0 + 20], [E0 + 4, N0 + 20]] }, params: { target_level_m: { value: 100.9, basis: 'user' } } });
  const slope = (e: number) => 100 + 0.1 * (e - E0);
  it('a grading area is drawn at the design plane and coloured by cut and fill against the existing ground; a batter is drawn to the ground', () => {
    const o = grading();
    const parts = gradingParts(o, result([[E0 + 4, N0 + 10, 100.9], [E0 + 14, N0 + 10, 100.9], [E0 + 14, N0 + 20, 100.9], [E0 + 4, N0 + 20, 100.9]]), { O, existing: (e) => slope(e) });
    expect(parts).toHaveLength(1);
    const m = parts[0] as THREE.Mesh, p = m.geometry.attributes.position, c = m.geometry.attributes.color;
    for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeCloseTo(100.9 + 0.02, 4);                      // the surface IS the design level
    // colour: fill (blue) where the ground is lower (west, x = 4: ground 100.4, design 100.9), cut (red) in the east (ground 101.4)
    let west = -1, east = -1; for (let i = 0; i < p.count; i++) { if (Math.abs(p.getX(i) - 4) < 1e-6 && west < 0) west = i; if (Math.abs(p.getX(i) - 14) < 1e-6 && east < 0) east = i; }
    expect(c.getZ(west)).toBeGreaterThan(c.getX(west)); expect(c.getX(east)).toBeGreaterThan(c.getZ(east));
    // with a fill batter of 3 H per V along the west side: a surface from the platform edge down to the ground
    const withB = result([[E0 + 4, N0 + 10, 100.9], [E0 + 14, N0 + 10, 100.9], [E0 + 14, N0 + 20, 100.9], [E0 + 4, N0 + 20, 100.9]]);
    withB.earthworks!.batters_computed = true; withB.earthworks!.batters.fill = { h_per_v: 3, basis: 'USER', ref: null, requirement_key: 'k' };
    withB.earthworks!.batters.fill_wkt = `POLYGON ((${E0 + 1.5} ${N0 + 10}, ${E0 + 4} ${N0 + 10}, ${E0 + 4} ${N0 + 20}, ${E0 + 1.5} ${N0 + 20}, ${E0 + 1.5} ${N0 + 10}))`;
    const b = gradingParts(o, withB, { O, existing: (e) => slope(e) }).find((x) => x.userData.batter === 'fill') as THREE.Mesh;
    const bp = b.geometry.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const d = 4 - (bp.getX(i)), ground = slope(E0 + bp.getX(i));
      expect(bp.getZ(i)).toBeCloseTo(Math.max(100.9 - d / 3, ground) + 0.015, 4);                      // 1 in 3 down from the platform edge, never below the ground
    }
  });
  it('no result, or a result that is not OK, draws nothing for the grading area itself', () => {
    expect(gradingParts(grading(), null, { O, existing: () => null })).toEqual([]);
    expect(gradingParts(grading(), result([[0, 0, 1], [1, 0, 1], [1, 1, 1]], { status: 'TARGET LEVEL NOT SET' }), { O, existing: () => null })).toEqual([]);
  });
  it('without existing ground the surface is grey, not coloured', () => {
    const parts = gradingParts(grading(), result([[E0 + 4, N0 + 10, 100.9], [E0 + 14, N0 + 10, 100.9], [E0 + 14, N0 + 20, 100.9]]), { O, existing: () => null });
    const c = (parts[0] as THREE.Mesh).geometry.attributes.color; const g = new THREE.Color('#9aa0a6');
    expect(c.getX(0)).toBeCloseTo(g.r, 4); expect(c.getY(0)).toBeCloseTo(g.g, 4);
  });
  it('the scene labels a grading area TARGET NOT SET, and INDICATIVE volumes with the terrain status once computed', () => {
    const texts: string[] = [];
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: () => 100 }, existing: (e) => slope(e), makeLabel: (t) => { texts.push(t); return new THREE.Sprite(); } });
    const store = new SiteDesignStore(emptyDesign('p'), seqCtx()); store.on('change', (e) => sc.apply(e));
    store.run('add_object', { type: 'grading_area', points: [at(4, 10), at(14, 10), at(14, 20), at(4, 20)] });
    expect(texts.at(-1)).toContain('TARGET NOT SET'); expect(texts.at(-1)).not.toContain('DIMENSIONS NOT SET');
    store.run('set_param', { id: 'grading_area_1', key: 'target_level_m', value: 100.9 });
    sc.setGradingResult('grading_area_1', result([[E0 + 4, N0 + 10, 100.9], [E0 + 14, N0 + 10, 100.9], [E0 + 14, N0 + 20, 100.9], [E0 + 4, N0 + 20, 100.9]]));
    expect(texts.at(-1)).toContain('CUT 12.5 M3, FILL 12.5 M3'); expect(texts.at(-1)).toContain('INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY'); expect(texts.at(-1)).toContain('BATTER SLOPE UNRESOLVED');
    sc.setGradingResult('grading_area_1', null); expect(texts.at(-1)).not.toContain('CUT 12.5');
  });
  it('the scene labels a driveway WIDTH NOT SET and END LEVEL NOT SET until they are entered', () => {
    const texts: string[] = [];
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: () => 100 }, makeLabel: (t) => { texts.push(t); return new THREE.Sprite(); } });
    const store = new SiteDesignStore(emptyDesign('p'), seqCtx()); store.on('change', (e) => sc.apply(e));
    store.run('add_object', { type: 'driveway', points: [at(9, -4), at(9, 10)] });
    expect(texts.at(-1)).toContain('WIDTH NOT SET'); expect(texts.at(-1)).toContain('END LEVEL NOT SET'); expect(texts.at(-1)).toContain('SURFACE NOT SET');
    store.run('set_param', { id: 'driveway_1', key: 'width_m', value: 3 }); store.run('set_param', { id: 'driveway_1', key: 'end_level_rl', value: 101.25 });
    expect(texts.at(-1)).toContain('WIDTH 3.00 M'); expect(texts.at(-1)).toContain('END LEVEL 101.25 RL'); expect(texts.at(-1)).not.toContain('NOT SET\nEND');
  });
});

describe('stage 6 review fixes: gutter band, station merge, crossover chainage, atomic batch', () => {
  it('with no verge the gutter band station is UNRESOLVED (no default verge), its change of grade check is NOT EVALUATED, as on the server', () => {
    for (const over of [{ lot: null }, { lot: LOT, pts: [[E0 + 9, N0 - 4], [E0 + 9, N0 - 2], [E0 + 9, N0 - 1]], endLevel: PLANAR(9, -1) + 0.2 }]) {
      const p = previewProfile(base({ rules: RULES(8, 5), ...over }))!;
      expect(p.geometry!.gutter_band_m).toBeNull(); expect(p.geometry!.gutter_band_status).toBe('UNRESOLVED'); expect(p.geometry!.verge_m).toBeNull();
      expect(p.stations.map((s) => s.name)).not.toContain('GUTTER BAND'); expect(p.unresolved_stations![0]).toMatchObject({ name: 'GUTTER BAND', status: 'UNRESOLVED' });
      expect(p.checks.find((c) => c.id === 'change_of_grade@GUTTER BAND')).toMatchObject({ status: 'NOT EVALUATED', value: null, limit: null, requirement_key: 'driveway.max_grade_change_pct' });
      expect(p.notes.some((n) => n.startsWith('GUTTER BAND UNRESOLVED'))).toBe(true);
      expect(p.status).toBe('OK'); expect(p.samples.design).not.toBeNull();
    }
    const known = previewProfile(base())!;
    expect(known.unresolved_stations).toEqual([]); expect(known.geometry!.gutter_band_m).toBe(0.5); expect(known.checks.find((c) => c.id === 'change_of_grade@GUTTER BAND')!.value).not.toBeNull();            // a known verge: the band check is a real check
  });
  it('the end level survives a station merge near the boundary (the boundary station is the one dropped)', () => {
    const end = PLANAR(9, 0.02) + 0.3;
    const p = previewProfile(base({ pts: [[E0 + 9, N0 - 4], [E0 + 9, N0 + 0.02]], endLevel: end }))!;
    expect(p.stations.map((s) => s.name)).toEqual(['KERB LINE', 'GUTTER BAND', 'DRIVEWAY END']);
    expect(p.stations.at(-1)!.design_rl).toBeCloseTo(end, 3); expect(p.samples.design!.at(-1)).toBeCloseTo(end, 3);
    expect(p.notes.some((n) => n.includes('PROPERTY BOUNDARY STATION IS WITHIN') && n.includes('END LEVEL IS KEPT'))).toBe(true);
    expect(previewProfile(base({ pts: [[E0 + 9, N0 - 4], [E0 + 9, N0 + 0.5]], endLevel: end }))!.stations.map((s) => s.name)).toEqual(['KERB LINE', 'GUTTER BAND', 'PROPERTY BOUNDARY', 'DRIVEWAY END']);
  });

  const kerbCtx = (): OpCtx => ({ ...seqCtx(), kerb: () => ({ a: [E0 - 30, N0 - 4], u: [1, 0], length: 78 }) });
  const pts3 = (d: SiteDesign) => (d.objects[0].geometry as { pts: number[][] }).pts;
  it('set_driveway_crossover stores the chainage along the kerb line and refuses a point that is not on it (0.05 m)', () => {
    const ctx = kerbCtx(); const d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 4), at(12, 10)] }, ctx).doc;
    const ok = applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -4) }, ctx);
    expect(ok.doc.objects[0].params.crossover_chainage_m).toMatchObject({ value: 41, basis: 'user' }); expect(pts3(ok.doc)[0]).toEqual([E0 + 11, N0 - 4]);
    expect(applyOp(ok.doc, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -4) }, ctx).patch).toEqual([]);          // nothing changed: no patch
    const all = applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(15.5, -4), translate: true }, ctx);
    expect(all.doc.objects[0].params.crossover_chainage_m.value).toBe(45.5); expect(pts3(all.doc)[1]).toEqual([E0 + 15.5, N0 + 4]);
    expect(applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: { e: E0 + 11, n: N0 - 4 + 0.04 } }, ctx).doc.objects[0].params.crossover_chainage_m.value).toBe(41);   // 4 cm off: inside the tolerance
    expect(() => applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: { e: E0 + 11, n: N0 - 4 + 0.06 } }, ctx)).toThrow(/off the assumed kerb line/);
    expect(() => applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -3) }, ctx)).toThrow(/off the assumed kerb line/);
    expect(() => applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(-31, -4) }, ctx)).toThrow(/beyond the ends/);
    expect(() => applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(49, -4) }, ctx)).toThrow(/beyond the ends/);
    const store = new SiteDesignStore(d, ctx); store.run('set_driveway_crossover', { id: 'driveway_1', point: at(11, -4) });
    store.undo(); expect(store.doc.objects[0].params.crossover_chainage_m).toBeUndefined(); expect(pts3(store.doc)[0]).toEqual([E0 + 9, N0 - 4]);
  });
  it('without a kerb line in the model the crossover is not constrained, no chainage is stored and a stale one is removed', () => {
    const ctx = seqCtx(); const d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 4)] }, ctx).doc;
    expect(applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -2) }, ctx).doc.objects[0].params.crossover_chainage_m).toBeUndefined();
    const withCh = applyOp(d, 'set_driveway_crossover', { id: 'driveway_1', point: at(10, -4) }, kerbCtx()).doc;
    expect(withCh.objects[0].params.crossover_chainage_m.value).toBe(40);
    expect(applyOp(withCh, 'set_driveway_crossover', { id: 'driveway_1', point: at(11, -2) }, ctx).doc.objects[0].params.crossover_chainage_m).toBeUndefined();
  });

  it('an atomic batch applies all of its steps or none of them', () => {
    const ctx = seqCtx(); let d = applyOp(doc0(), 'add_object', { type: 'driveway', points: [at(9, -4), at(9, 8)] }, ctx).doc;
    const steps = [{ op: 'edit_vertices', args: { id: 'driveway_1', action: 'move', index: 1, point: at(9, 12) } }, { op: 'link_driveway_end', args: { id: 'driveway_1', building_id: 'nope' } }];
    const loose = runBatch(d, steps, ctx);
    expect(loose.results.map((r) => r.ok)).toEqual([true, false]); expect(pts3(loose.doc)[1]).toEqual([E0 + 9, N0 + 12]);                  // the AI's batch: the good step stays
    const atomic = runBatch(d, steps, ctx, { atomic: true });
    expect(atomic.rolledBack).toBe(true); expect(atomic.doc).toBe(d); expect(atomic.patch).toEqual([]); expect(atomic.inverse).toEqual([]);
    expect(atomic.results.at(-1)).toMatchObject({ ok: false, error: expect.stringContaining('not a building') });
    const store = new SiteDesignStore(d, ctx), n = store.history().undoCount;
    const res = store.runBatch('Move driveway end', steps, { atomic: true });
    expect(res.some((r) => !r.ok)).toBe(true); expect(store.history().undoCount).toBe(n); expect(store.doc).toBe(d);
    d = { ...d, objects: [...d.objects, { id: 'bld', type: 'building', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'polygon', ring: [[0, 0], [1, 0], [1, 1]] }, params: {}, issues: [] }] };
    const good = runBatch(d, [steps[0], { op: 'link_driveway_end', args: { id: 'driveway_1', building_id: 'bld' } }], ctx, { atomic: true });
    expect(good.rolledBack).toBeUndefined(); expect(good.results.every((r) => r.ok)).toBe(true); expect(good.patch.length).toBeGreaterThan(0);
  });
});

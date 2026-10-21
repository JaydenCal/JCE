import { describe, it, expect } from 'vitest';
import { checkObject, degenerateReason, worstSeverity, type CheckEnv } from '@/lib/site/checks';
import { HeightField } from '@/lib/site/terrain';
import { applyOp } from '@/lib/site/ops';
import { OBJECT_KINDS, dimensionsSet, emptyDesign, type SiteObject } from '@/lib/site/types';
import { at, rect, seqCtx, E0, N0 } from './helpers';

const mkObj = (type: string, points: { e: number; n: number }[], extra: Record<string, unknown> = {}): SiteObject =>
  applyOp(emptyDesign(), 'add_object', { type, points, ...extra }, seqCtx()).doc.objects[0];
const lot: [number, number][] = [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 20], [E0, N0 + 20]];
const env = (over: Partial<CheckEnv> = {}): CheckEnv => ({ lot, terrain: { available: true, sample: () => 100 }, ...over });

describe('geometry checks', () => {
  it('a sound object inside the lot on available terrain has no issues', () => {
    for (const o of [mkObj('tree', [at(5, 5)]), mkObj('retaining_wall', [at(1, 1), at(10, 1)]), mkObj('landscape_area', rect(2, 2, 8, 8))]) expect(checkObject(o, env())).toEqual([]);
  });
  it('outside the lot is a warning, counting the vertices outside', () => {
    const i = checkObject(mkObj('retaining_wall', [at(5, 5), at(25, 5), at(30, 5)]), env());
    expect(i).toHaveLength(1); expect(i[0]).toMatchObject({ code: 'OUTSIDE_LOT', severity: 'warning' }); expect(i[0].message).toContain('2 OF 3');
    expect(checkObject(mkObj('tree', [at(-1, 5)]), env())[0].message).toContain('POINT LIES');
  });
  it('a vertex exactly on the boundary is inside; an edge crossing the boundary is flagged', () => {
    expect(checkObject(mkObj('tree', [at(0, 0)]), env())).toEqual([]);
    expect(checkObject(mkObj('tree', [at(20, 10)]), env())).toEqual([]);
    const notch: [number, number][] = [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 20], [E0 + 10, N0 + 5], [E0, N0 + 20]];     // a V shaped notch cut into the top edge
    const cross = mkObj('service_trace', [at(1, 18), at(19.5, 18)]);                                                          // both ends inside, the line passes through the notch
    expect(checkObject(cross, env({ lot: notch })).map((x) => x.message)).toEqual(['OUTSIDE LOT: AN EDGE CROSSES THE LOT BOUNDARY']);
  });
  it('no lot boundary means the lot check is skipped, not failed', () => {
    expect(checkObject(mkObj('tree', [at(500, 5)]), env({ lot: null }))).toEqual([]);
  });
  it('no terrain at all, or none under part of the object, is a TERRAIN DATA NOT AVAILABLE warning', () => {
    expect(checkObject(mkObj('tree', [at(5, 5)]), env({ terrain: null }))).toEqual([{ code: 'TERRAIN_UNAVAILABLE', severity: 'warning', message: 'TERRAIN DATA NOT AVAILABLE' }]);
    expect(checkObject(mkObj('tree', [at(5, 5)]), env({ terrain: { available: false, sample: () => 0 } }))[0].message).toBe('TERRAIN DATA NOT AVAILABLE');
    const part = checkObject(mkObj('retaining_wall', [at(5, 5), at(15, 5)]), env({ terrain: { available: true, sample: (e) => (e < E0 + 10 ? 100 : null) } }));
    expect(part[0]).toMatchObject({ code: 'TERRAIN_UNAVAILABLE', severity: 'warning' }); expect(part[0].message).toBe('TERRAIN DATA NOT AVAILABLE: NO TERRAIN UNDER 1 OF 2 VERTICES');
  });
  it('degenerate geometry is blocking and suppresses the other checks', () => {
    const cases: [SiteObject, string][] = [
      [mkObj('retaining_wall', [at(1, 1), at(1, 1)]), 'repeated'], [mkObj('retaining_wall', [at(1, 1), at(5, 5), at(1, 5), at(5, 1)]), 'crosses itself'],
      [mkObj('landscape_area', [at(0, 0), at(5, 0), at(10, 0)]), 'zero area'], [mkObj('landscape_area', [at(0, 0), at(4, 4), at(4, 0), at(0, 4)]), 'crosses itself'],
      [{ ...mkObj('landscape_area', rect(0, 0, 5, 5)), geometry: { kind: 'polygon', ring: [[0, 0], [0, 0], [5, 5], [5, 0]] } } as SiteObject, 'repeated'],
      [{ ...mkObj('tree', [at(1, 1)]), geometry: { kind: 'point', p: [NaN, 1] } } as SiteObject, 'non finite'],
    ];
    for (const [o, why] of cases) {
      const i = checkObject(o, env({ terrain: null }));
      expect(i, why).toHaveLength(1); expect(i[0]).toMatchObject({ code: 'DEGENERATE_GEOMETRY', severity: 'blocking' }); expect(i[0].message).toContain(why);
    }
    expect(degenerateReason(mkObj('tree', [at(1, 1)]))).toBeNull();
  });
  it('severity ranking and the dimension helper', () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([{ code: 'a', severity: 'warning', message: 'm' }, { code: 'b', severity: 'blocking', message: 'm' }])).toBe('blocking');
    const t = mkObj('tree', [at(1, 1)]); expect(dimensionsSet(t)).toBe(false);
    expect(OBJECT_KINDS.tree.dims).toEqual(['height_m', 'canopy_diameter_m']);
    const t2 = applyOp(applyOp(emptyDesign(), 'add_object', { type: 'tree', points: [at(1, 1)] }, seqCtx()).doc, 'set_param', { id: 'tree_1', key: 'height_m', value: 5 }, seqCtx()).doc.objects[0];
    expect(dimensionsSet(t2)).toBe(false);                                           // canopy still missing
    expect(dimensionsSet(mkObj('service_trace', [at(0, 0), at(1, 1)]))).toBe(true);      // no dimension parameters required
  });
});

describe('height field (terrain mesh sampling)', () => {
  // two triangles forming the plane z = 100 + 0.1 x + 0.2 y over a 10 x 10 square
  const pos = [0, 0, 100, 10, 0, 101, 10, 10, 103, 0, 10, 102], idx = [0, 1, 2, 0, 2, 3];
  const hf = new HeightField([pos], [idx]);
  it('interpolates the plane exactly, including on the shared diagonal and edges', () => {
    for (const [x, y] of [[0, 0], [5, 5], [2.5, 7.5], [10, 10], [10, 0], [9.9, 0.1], [0, 10]]) expect(hf.sample(x, y)!, `${x},${y}`).toBeCloseTo(100 + 0.1 * x + 0.2 * y, 9);
  });
  it('returns null outside the mesh', () => {
    for (const [x, y] of [[-0.1, 5], [10.1, 5], [5, -0.1], [5, 10.1], [100, 100]]) expect(hf.sample(x, y)).toBeNull();
    expect(new HeightField([], []).sample(0, 0)).toBeNull();
  });
  it('the highest surface wins where meshes overlap, as a ray from above would', () => {
    const lower = [0, 0, 90, 10, 0, 90, 0, 10, 90], two = new HeightField([pos, lower], [idx, null]);
    expect(two.sample(1, 1)).toBeCloseTo(100.3, 9);
  });
  it('handles a large irregular mesh quickly', () => {
    const n = 120, p: number[] = [], i: number[] = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) p.push(x, y, Math.sin(x / 9) + Math.cos(y / 7));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x; i.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
    const big = new HeightField([p], [i]); const t0 = Date.now();
    for (let k = 0; k < 20000; k++) big.sample((k * 7.31) % n, (k * 3.17) % n);
    expect(Date.now() - t0).toBeLessThan(1500); expect(big.triangleCount).toBe(n * n * 2);
  });
});

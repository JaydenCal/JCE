/** Stage 11 review: first person colliders use the building's own height_m and say so when they fall back to the display constant; a rectangular tank box spans its real height. */
import { describe, it, expect } from 'vitest';
import { DISPLAY_HEIGHT_NOTE, designColliders, tankCentreZ } from '@/lib/viewer/fpDesign';
import { FP_COLLIDER_BELOW_M, FP_COLLIDER_DEFAULT_HEIGHT_M } from '@/lib/viewer/fpLimits';
import { emptyDesign, type SiteDesign, type SiteObject } from '@/lib/site/types';

const E0 = 496000, N0 = 6650000;
const P = (v: unknown, basis = 'user') => ({ value: v, basis });
function obj(id: string, type: string, geometry: unknown, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SiteObject {
  return { id, type, status: 'proposed', origin: 'user', verified: false, geometry, params, issues: [], ...extra } as unknown as SiteObject;
}
const pt = (x: number, y: number) => ({ kind: 'point', p: [E0 + x, N0 + y] });
const ring = (...p: [number, number][]) => ({ kind: 'polygon', ring: p.map(([x, y]) => [E0 + x, N0 + y]) });
const doc = (...objects: SiteObject[]): SiteDesign => ({ ...emptyDesign('p1'), objects });
const O: [number, number] = [E0, N0];
const top = (c: { c: number[]; s: number[] }) => c.c[2] + c.s[2] / 2;
const bottom = (c: { c: number[]; s: number[] }) => c.c[2] - c.s[2] / 2;

describe('building colliders use the building height', () => {
  const sq = ring([5, 5], [15, 5], [15, 12], [5, 12]);
  it('height_m set: the box reaches FFL plus height_m and carries no note', () => {
    const cols = designColliders(doc(obj('h', 'building', sq, { ffl_rl: P(100.5), height_m: P(7.2) }, { building: {} })), O, () => 100);
    expect(cols).toHaveLength(4);
    for (const c of cols) { expect(top(c)).toBeCloseTo(107.7); expect(bottom(c)).toBeCloseTo(100.5 - FP_COLLIDER_BELOW_M); expect(c.note).toBeUndefined(); }
  });
  it('height_m NOT SET: the display constant is used and the box says so', () => {
    for (const params of [{ ffl_rl: P(100.5) }, { ffl_rl: P(100.5), height_m: { value: null, basis: 'unresolved' } }]) {
      const cols = designColliders(doc(obj('h', 'building', sq, params, { building: {} })), O, () => 100);
      expect(cols).toHaveLength(4);
      for (const c of cols) { expect(top(c)).toBeCloseTo(100.5 + FP_COLLIDER_DEFAULT_HEIGHT_M); expect(c.note).toBe(DISPLAY_HEIGHT_NOTE); }
    }
    expect(DISPLAY_HEIGHT_NOTE).toMatch(/NOT SET/); expect(DISPLAY_HEIGHT_NOTE).toMatch(/DISPLAY/);
  });
});

describe('a rectangular tank box spans from under the base to the top of the tank', () => {
  it('slimline rwt and tank form osd: bottom is the base minus FP_COLLIDER_BELOW_M, top is the base plus the height', () => {
    const z0 = 100, h = 2.2;
    const rwt = obj('t', 'rwt', pt(8, 8), { shape: P('slimline'), width_m: P(0.6), length_m: P(2), height_m: P(h) });
    const osd = obj('o', 'osd', pt(12, 8), { form: P('tank'), width_m: P(1), length_m: P(2), height_m: P(1.5) });
    const cols = designColliders(doc(rwt, osd), O, () => z0);
    expect(cols).toHaveLength(2);
    const a = cols[0], b = cols[1];
    expect(bottom(a)).toBeCloseTo(z0 - FP_COLLIDER_BELOW_M); expect(top(a)).toBeCloseTo(z0 + h);
    expect(bottom(b)).toBeCloseTo(z0 - FP_COLLIDER_BELOW_M); expect(top(b)).toBeCloseTo(z0 + 1.5);
    expect(tankCentreZ(z0, h)).toBeCloseTo(a.c[2]);
  });
});

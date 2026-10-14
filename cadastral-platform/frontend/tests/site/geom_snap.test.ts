import { describe, it, expect } from 'vitest';
import {
  polylineLength, polylineLength3, polygonArea, signedArea, ringPerimeter, ringCentroid, rotateClockwise, pointInRing, selfIntersects,
  crossesRing, dedupe, removeCollinear, drapePolyline, pointOnSegmentDist,
} from '@/lib/site/geom';
import { snapPoint, snapGrid, buildTargets, stepYaw15, normDeg, metresPerPixelPerspective, metresPerPixelOrtho, type SnapTargets } from '@/lib/site/snap';
import { lotRingFromBundle, terrainAvailable } from '@/lib/site/lot';
import { readoutFor } from '@/lib/site/designController';
import type { Pt2 } from '@/lib/site/geom';

describe('length and area', () => {
  it('polyline length (plan) and surface length', () => {
    expect(polylineLength([[0, 0], [3, 4]])).toBe(5);
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(polylineLength([[1, 1]])).toBe(0);
    expect(polylineLength3([[0, 0, 0], [3, 4, 12]])).toBe(13);
  });
  it('polygon area by the shoelace formula, either winding, and perimeter', () => {
    const sq: Pt2[] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    expect(polygonArea(sq)).toBe(12); expect(signedArea(sq)).toBe(12); expect(signedArea([...sq].reverse())).toBe(-12);
    expect(polygonArea([[0, 0], [4, 0], [0, 3]])).toBe(6);
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0);
    expect(ringPerimeter(sq)).toBe(14);
    // large MGA coordinates do not lose the area to rounding
    expect(polygonArea(sq.map(([x, y]) => [x + 496000, y + 6650000] as Pt2))).toBeCloseTo(12, 6);
  });
  it('L shaped area and centroid', () => {
    const L: Pt2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(polygonArea(L)).toBe(12);
    const c = ringCentroid(L); expect(c[0]).toBeCloseTo(1.6667, 3); expect(c[1]).toBeCloseTo(1.6667, 3);
  });
  it('rotates clockwise as seen from above (east goes to south)', () => {
    const r = rotateClockwise([1, 0], 0, 0, 90); expect(r[0]).toBeCloseTo(0); expect(r[1]).toBeCloseTo(-1);
    expect(rotateClockwise([1, 2, 7], 1, 2, 45)).toEqual([1, 2, 7]);
  });
});

describe('containment and intersection', () => {
  const sq: Pt2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it('point in ring: inside, outside, on an edge, on a vertex', () => {
    expect(pointInRing([5, 5], sq)).toBe(true); expect(pointInRing([11, 5], sq)).toBe(false); expect(pointInRing([10, 5], sq)).toBe(true); expect(pointInRing([0, 0], sq)).toBe(true); expect(pointInRing([-1e-3, 5], sq)).toBe(false);
  });
  it('detects self intersection of lines and rings', () => {
    expect(selfIntersects([[0, 0], [2, 2], [2, 0], [0, 2]], false)).toBe(true);
    expect(selfIntersects([[0, 0], [2, 0], [2, 2]], false)).toBe(false);
    expect(selfIntersects([[0, 0], [2, 2], [2, 0], [0, 2]], true)).toBe(true);       // bow tie
    expect(selfIntersects(sq, true)).toBe(false);
  });
  it('a line crossing the ring boundary is detected, one inside is not', () => {
    expect(crossesRing([[5, 5], [15, 5]], false, sq)).toBe(true); expect(crossesRing([[2, 2], [8, 8]], false, sq)).toBe(false);
  });
  it('dedupe and collinear removal', () => {
    expect(dedupe([[0, 0], [0, 0], [1, 1], [0, 0]], true)).toEqual([[0, 0], [1, 1]]);
    expect(removeCollinear([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(pointOnSegmentDist([5, 3], [0, 0], [10, 0]).d).toBe(3);
  });
});

describe('draping a polyline on a surface', () => {
  const slope = (e: number) => 100 + 0.1 * e;
  it('adds samples so no gap exceeds the step and takes z from the surface', () => {
    const d = drapePolyline([[0, 0], [10, 0]], (e) => slope(e), 2);
    expect(d.map((x) => x.p[0])).toEqual([0, 2, 4, 6, 8, 10]);
    expect(d[3].p[2]).toBeCloseTo(100.6, 9);
    expect(d.filter((x) => x.vertex !== null).map((x) => x.vertex)).toEqual([0, 1]);
  });
  it('an explicit vertex z wins; null where the surface is missing; closed rings return to the start', () => {
    const d = drapePolyline([[0, 0, 50], [4, 0]], () => null, 10);
    expect(d[0].p[2]).toBe(50); expect(d[1].p[2]).toBeNull();
    expect(drapePolyline([[0, 0], [2, 0], [2, 2]], () => 1, 1, true).length).toBe(7);
  });
});

describe('snapping math', () => {
  const lot: Pt2[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const t = (): SnapTargets => buildTargets(lot, [{ id: 'o1', closed: false, pts: [[5, 5], [8, 5]] }]);
  it('snaps to a boundary vertex first, then reports its kind and source', () => {
    const r = snapPoint([0.4, 0.3], t(), { tol: 1 });
    expect(r).toMatchObject({ kind: 'vertex', source: 'boundary', p: [0, 0], label: 'BOUNDARY VERTEX' });
  });
  it('snaps to an object vertex and to the nearest of two vertices', () => {
    expect(snapPoint([5.3, 5.2], t(), { tol: 1 })).toMatchObject({ kind: 'vertex', source: 'object', p: [5, 5], ref: 'o1' });
    expect(snapPoint([7.2, 5.1], buildTargets(null, [{ id: 'a', closed: false, pts: [[6, 5], [8, 5]] }]), { tol: 2 }).p).toEqual([8, 5]);
  });
  it('vertex beats edge even when the edge is closer', () => {
    const r = snapPoint([0.8, 0.05], t(), { tol: 1 });     // 0.05 from the bottom edge, 0.8 from the corner
    expect(r.kind).toBe('vertex');
  });
  it('snaps to an edge when no vertex is in range, at the foot of the perpendicular', () => {
    const r = snapPoint([10, 0.4], t(), { tol: 1 });
    expect(r).toMatchObject({ kind: 'edge', source: 'boundary', p: [10, 0], label: 'BOUNDARY EDGE' });
    expect(snapPoint([6.5, 5.3], t(), { tol: 0.5 })).toMatchObject({ kind: 'edge', source: 'object' });
  });
  it('grid is off by default and snaps to multiples when set; targets win over the grid', () => {
    expect(snapPoint([12.3, 9.7], t(), { tol: 0.5 })).toMatchObject({ kind: 'none', p: [12.3, 9.7] });
    expect(snapPoint([12.3, 9.7], t(), { tol: 0.5, grid: 0.5 })).toMatchObject({ kind: 'grid', p: [12.5, 9.5], label: 'GRID 0.5 M' });
    expect(snapPoint([0.2, 0.1], t(), { tol: 1, grid: 5 }).kind).toBe('vertex');
    expect(snapGrid([7.4, 7.6], 0)).toEqual([7.4, 7.6]);
    expect(snapGrid([496012.26, 6650100.74], 0.5)).toEqual([496012.5, 6650100.5]);
  });
  it('nothing in range returns the input untouched', () => {
    expect(snapPoint([50, 50], t(), { tol: 1 })).toEqual({ p: [50, 50], kind: 'none', label: '' });
  });
  it('a polygon target includes its closing edge, an open line does not', () => {
    const closed = buildTargets(null, [{ id: 'c', closed: true, pts: [[0, 0], [4, 0], [4, 4]] }]), open = buildTargets(null, [{ id: 'c', closed: false, pts: [[0, 0], [4, 0], [4, 4]] }]);
    expect(closed.edges).toHaveLength(3); expect(open.edges).toHaveLength(2);
  });
  it('pixel radius to metres', () => {
    expect(metresPerPixelPerspective(100, 90, 1000)).toBeCloseTo(0.2, 9);
    expect(metresPerPixelOrtho(50, 2, 500)).toBeCloseTo(0.05, 9);
  });
  it('rotates in 15 degree steps', () => {
    expect(stepYaw15(0, 1)).toBe(15); expect(stepYaw15(0, -1)).toBe(345); expect(stepYaw15(350, 1)).toBe(0); expect(stepYaw15(7, 1)).toBe(15); expect(normDeg(-30)).toBe(330);
  });
});

describe('lot ring and terrain availability from a bundle', () => {
  const info = { title: 't', origin: [1000, 2000, 0] as [number, number, number] };
  it('chains draped boundary segments into a ring of true corners in MGA', () => {
    // a 10 x 10 square cut into 5 m pieces, as a draped line would be
    const pts: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5], [0, 0]];
    const lines: number[] = []; for (let i = 0; i + 1 < pts.length; i++) lines.push(pts[i][0], pts[i][1], 100, pts[i + 1][0], pts[i + 1][1], 100);
    const ring = lotRingFromBundle({ info, parts: [{ n: 'Property_boundary', c: 'boundary', col: '#f00', lines }] })!;
    expect(ring).toHaveLength(4); expect(polygonArea(ring)).toBeCloseTo(100, 6); expect(ring.some((p) => p[0] === 1000 && p[1] === 2000)).toBe(true);
  });
  it('returns null when the boundary is missing or not closed', () => {
    expect(lotRingFromBundle({ info, parts: [] })).toBeNull();
    expect(lotRingFromBundle({ info, parts: [{ n: 'b', c: 'boundary', col: '#f00', lines: [0, 0, 0, 5, 0, 0, 5, 0, 0, 5, 5, 0] }] })).toBeNull();
  });
  it('terrainAvailable is false for the flat placeholder', () => {
    expect(terrainAvailable({ info, labels: [{ t: 'TERRAIN DATA NOT AVAILABLE (ground drawn flat at RL 0.00, placeholder only)', p: [0, 0, 0], c: 'lab_lots' }] })).toBe(false);
    expect(terrainAvailable({ info, summary: [['Terrain', 'DATA NOT AVAILABLE (flat)']] })).toBe(false);
    expect(terrainAvailable({ info: { ...info, terrain: { status: 'TERRAIN NOT AVAILABLE', source: 's' } } })).toBe(false);
    expect(terrainAvailable({ info, labels: [], summary: [['Terrain', 'LiDAR 1 m']] })).toBe(true);
  });
});

describe('live readout', () => {
  const flat = () => 10;
  it('polyline: plan length, surface length and no area', () => {
    const r = readoutFor('polyline', [[0, 0], [3, 4]], (e) => e * 0 + 10 + 0 * e, true)!;
    expect(r).toMatchObject({ kind: 'polyline', vertices: 2, planLength: 5, area: null, live: true }); expect(r.surfaceLength).toBeCloseTo(5, 9);
    const slope = readoutFor('polyline', [[0, 0], [10, 0]], (e) => e, false)!;
    expect(slope.planLength).toBe(10); expect(slope.surfaceLength).toBeCloseTo(Math.hypot(10, 10), 6);
  });
  it('polygon: area and perimeter; surface length is null where the terrain is missing', () => {
    const r = readoutFor('polygon', [[0, 0], [4, 0], [4, 3], [0, 3]], flat, true)!;
    expect(r.area).toBe(12); expect(r.perimeter).toBe(14); expect(r.planLength).toBe(14); expect(r.surfaceLength).toBeCloseTo(14, 9);
    expect(readoutFor('polygon', [[0, 0], [4, 0], [4, 3]], () => null, true)!.surfaceLength).toBeNull();
    expect(readoutFor('polygon', [[0, 0], [4, 0]], flat, true)!.area).toBeNull();            // two points: no area yet
    expect(readoutFor('polyline', [], flat, true)).toBeNull();
  });
});

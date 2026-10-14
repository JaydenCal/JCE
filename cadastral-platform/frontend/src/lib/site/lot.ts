/** Lot boundary and terrain availability read from a scene bundle (kept outside the undoable document). */
import type { SceneBundle } from '@/lib/viewer/types';
import { dist2, polygonArea, removeCollinear, type Pt2 } from './geom';

/**
 * Lot ring in MGA from the bundle's `boundary` line parts. Lines are segment pairs (x1 y1 z1 x2 y2 z2, local metres) and may be draped,
 * i.e. cut into many collinear pieces; collinear vertices are removed so only true corners remain. Returns null when no closed
 * boundary is present (the lot checks are then not run and the panel says LOT BOUNDARY NOT AVAILABLE).
 */
export function lotRingFromBundle(b: Pick<SceneBundle, 'parts' | 'info'>): Pt2[] | null {
  const O = b.info.origin;
  const segs: [Pt2, Pt2][] = [];
  for (const p of b.parts) {
    if (p.c !== 'boundary' || !p.lines) continue;
    for (let i = 0; i + 5 < p.lines.length; i += 6) segs.push([[p.lines[i], p.lines[i + 1]], [p.lines[i + 3], p.lines[i + 4]]]);
  }
  if (!segs.length) return null;
  const TOL = 1e-3;
  const chains: Pt2[][] = [];
  let cur: Pt2[] = [];
  for (const [a, c] of segs) {
    if (!cur.length) cur = [a, c];
    else if (dist2(cur[cur.length - 1], a) <= TOL) cur.push(c);
    else { chains.push(cur); cur = [a, c]; }
  }
  if (cur.length) chains.push(cur);
  let best: Pt2[] | null = null, ba = 0;
  for (const ch of chains) {
    if (ch.length < 4 || dist2(ch[0], ch[ch.length - 1]) > TOL) continue;         // not closed
    const ring = removeCollinear(ch.slice(0, -1));
    const a = polygonArea(ring);
    if (ring.length >= 3 && a > ba) { ba = a; best = ring; }
  }
  return best ? best.map((p): Pt2 => [p[0] + O[0], p[1] + O[1]]) : null;
}

/** False when the bundle's ground is the flat placeholder or the terrain is stated as not available. */
export function terrainAvailable(b: Pick<SceneBundle, 'labels' | 'summary' | 'info'>): boolean {
  if ((b.labels ?? []).some((l) => /^TERRAIN DATA NOT AVAILABLE/i.test(l.t))) return false;
  if ((b.summary ?? []).some(([k, v]) => /^terrain$/i.test(k) && /^DATA NOT AVAILABLE/i.test(String(v)))) return false;
  if (/NOT AVAILABLE/i.test(b.info.terrain?.status ?? '')) return false;
  return true;
}

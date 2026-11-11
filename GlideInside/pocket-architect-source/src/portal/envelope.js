// The lot's buildable envelope (the lot boundary pulled in by the setbacks). The real implementation is buildEnvelope in
// src/site/setbacks.js (branch claude/glide-setbacks). Until that is merged this file uses a stub with the same signature
// that handles convex lots, so the design picker can rank designs against a lot today.
//
//   const polygon = await lotEnvelope(lotPolygonMm, frontEdgeIndices, picked)
//   picked = { front: { minM }, secondaryFront: { minM }, side: { minM }, rear: { minM } } as returned by pickRules.

/** Same signature as src/site/setbacks.js buildEnvelope. Convex lots only; returns null when the setbacks consume the lot. */
export function stubBuildEnvelope(lotPolygonMm, frontEdgeIndices, picked) {
  if (!picked || !Array.isArray(lotPolygonMm) || lotPolygonMm.length < 3) return null;
  const pts = lotPolygonMm.map((p) => ({ x: Array.isArray(p) ? p[0] : p.x, y: Array.isArray(p) ? p[1] : p.y }));
  const n = pts.length;
  const area = pts.reduce((s, p, i) => s + (p.x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * p.y), 0) / 2;
  const sgn = area > 0 ? 1 : -1;
  const fronts = [...new Set(frontEdgeIndices)];
  const front = fronts[0];
  const oppositeOf = (i) => {
    // The rear edge is the one most nearly parallel to the front and furthest from it.
    let best = null;
    const a = pts[front];
    const b = pts[(front + 1) % n];
    const fl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    for (let k = 0; k < n; k += 1) {
      if (k === front) continue;
      const c = pts[k];
      const d = pts[(k + 1) % n];
      const l = Math.hypot(d.x - c.x, d.y - c.y) || 1;
      const par = Math.abs(((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y)) / (fl * l));
      const dist = Math.abs(((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / fl);
      if (par > 0.9 && (!best || dist > best.dist)) best = { k, dist };
    }
    return best ? best.k : -1;
  };
  const rear = oppositeOf(front);
  const dist = pts.map((_, i) => {
    const kind = fronts.includes(i) ? (i === front ? 'front' : 'secondaryFront') : i === rear ? 'rear' : 'side';
    const s = picked[kind];
    return s && Number.isFinite(s.minM) ? s.minM * 1000 : null;
  });
  if (dist.some((d) => d == null)) return null;
  // Clip the lot by one inset half plane per edge (exact for convex lots).
  let poly = pts;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / L) * sgn;
    const ny = ((b.x - a.x) / L) * sgn;
    const inside = (p) => (p.x - a.x) * nx + (p.y - a.y) * ny - dist[i] >= -1e-6;
    const out = [];
    for (let k = 0; k < poly.length; k += 1) {
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      const fp = (p.x - a.x) * nx + (p.y - a.y) * ny - dist[i];
      const fq = (q.x - a.x) * nx + (q.y - a.y) * ny - dist[i];
      if (inside(p)) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    poly = out;
    if (poly.length < 3) return null;
  }
  return poly.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

let real;
/** buildEnvelope from src/site/setbacks.js when it exists in this build, otherwise the stub. */
export async function lotEnvelope(lotPolygonMm, frontEdgeIndices, picked) {
  if (real === undefined) {
    try {
      const spec = '../site/setbacks.js';
      real = (await import(/* @vite-ignore */ spec)).buildEnvelope || null;
    } catch {
      real = null;
    }
  }
  return (real || stubBuildEnvelope)(lotPolygonMm, frontEdgeIndices, picked);
}

/** A sample lot for review builds (and the "Use a sample lot" button): 14 m x 36 m, street at the bottom (south). */
export const SAMPLE_LOT = Object.freeze({
  name: 'Sample lot, 14 m x 36 m',
  polygonMm: [{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 36000 }, { x: 0, y: 36000 }],
  frontEdgeIndices: [2],
  picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } },
});

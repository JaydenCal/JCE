// Small plan geometry helpers for the pavement module (plan mm, y down). Pure.

export const EPS = 1e-6;

export const polyArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};
export const absArea = (poly) => Math.abs(polyArea(poly));

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const bbox = (poly) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of poly) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  return { minX, minY, maxX, maxY };
};
export const bboxOverlap = (a, b, pad = 0) => a.minX <= b.maxX + pad && a.maxX >= b.minX - pad && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad;

/** Parameter t on segment a-b where it crosses segment c-d, or null. */
export function segCross(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return t;
}

/** Sutherland-Hodgman: clip `subject` to the convex polygon `clip`. */
export function clipConvex(subject, clip) {
  const ccw = polyArea(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const inside = (p) => (ccw ? side(p) >= -EPS : side(p) <= EPS);
    const next = [];
    for (let j = 0; j < out.length; j++) {
      const p = out[j];
      const q = out[(j + 1) % out.length];
      const ip = inside(p);
      const iq = inside(q);
      if (ip !== iq) {
        const sp = side(p);
        const sq = side(q);
        const t = sp / (sp - sq);
        next.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
      if (iq) next.push(q);
    }
    out = next;
  }
  return out;
}

/** Diagonal stripes (polygons) clipped to a convex polygon: stripe width and gap in mm, angle of the stripe direction in degrees. */
export function stripePolys(poly, angleDeg, widthMm, gapMm) {
  const a = (angleDeg * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const n = { x: -d.y, y: d.x };
  const proj = poly.map((p) => p.x * n.x + p.y * n.y);
  const along = poly.map((p) => p.x * d.x + p.y * d.y);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const l0 = Math.min(...along) - 10;
  const l1 = Math.max(...along) + 10;
  const out = [];
  for (let s = lo + gapMm / 2; s < hi; s += widthMm + gapMm) {
    const q = [
      { x: d.x * l0 + n.x * s, y: d.y * l0 + n.y * s },
      { x: d.x * l1 + n.x * s, y: d.y * l1 + n.y * s },
      { x: d.x * l1 + n.x * (s + widthMm), y: d.y * l1 + n.y * (s + widthMm) },
      { x: d.x * l0 + n.x * (s + widthMm), y: d.y * l0 + n.y * (s + widthMm) },
    ];
    const c = clipConvex(q, poly);
    if (c.length >= 3 && absArea(c) > 100) out.push(c);
  }
  return out;
}

export const rotPt = (p, deg) => { const a = (deg * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };

/** Local (u, v) of an item at (x, y) rotated by deg to plan coordinates. */
export const toPlan = (item, lx, ly) => { const r = rotPt({ x: lx, y: ly }, item.rotationDeg || 0); return { x: item.x + r.x, y: item.y + r.y }; };

/** A stroke of width w along a polyline as one quad per segment. */
export function strokePolys(points, w) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < EPS) continue;
    const nx = (-dy / l) * (w / 2); const ny = (dx / l) * (w / 2);
    out.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]);
  }
  return out;
}

/** True if two convex polygons overlap with positive area (touching edges do not count). Separating axis test. */
export function convexOverlap(a, b, tol = 1) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y; const ny = p.x - q.x;
      const l = Math.hypot(nx, ny) || 1;
      let aMin = Infinity; let aMax = -Infinity; let bMin = Infinity; let bMax = -Infinity;
      for (const r of a) { const v = (r.x * nx + r.y * ny) / l; if (v < aMin) aMin = v; if (v > aMax) aMax = v; }
      for (const r of b) { const v = (r.x * nx + r.y * ny) / l; if (v < bMin) bMin = v; if (v > bMax) bMax = v; }
      if (aMax <= bMin + tol || bMax <= aMin + tol) return false;
    }
  }
  return true;
}

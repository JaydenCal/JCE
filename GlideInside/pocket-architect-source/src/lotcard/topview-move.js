// Moving buildings in the enlarged top view: snapping, live setback and overlap warnings, and the geometry the move and turn use.
// Pure functions on plain rings ({ x, y } in plan mm, y down), so they are unit tested in node.

const rad = (d) => (d * Math.PI) / 180;
export const rotPoint = (p, c, deg) => { const a = rad(deg); const co = Math.cos(a); const si = Math.sin(a); const x = p.x - c.x; const y = p.y - c.y; return { x: c.x + x * co - y * si, y: c.y + x * si + y * co }; };
export const shiftRing = (ring, dx, dy) => ring.map((q) => ({ x: q.x + dx, y: q.y + dy }));
export const turnRing = (ring, c, deg) => ring.map((q) => rotPoint(q, c, deg));
export const ringBox = (ring) => { const xs = ring.map((q) => q.x); const ys = ring.map((q) => q.y); return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }; };
export const boxCentre = (rings) => { const b = ringBox(rings.flat()); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };

/** Point in polygon (even-odd). */
export function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segsCross(a, b, c, d) {
  const d1 = cross(a, b, c); const d2 = cross(a, b, d); const d3 = cross(c, d, a); const d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** True when two polygons overlap (edges cross, or one lies inside the other). Touching edges do not count. */
export function overlaps(a, b) {
  if (a.length < 3 || b.length < 3) return false;
  const ba = ringBox(a); const bb = ringBox(b);
  if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY) return false;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  const mid = (r) => ({ x: r.reduce((s, q) => s + q.x, 0) / r.length, y: r.reduce((s, q) => s + q.y, 0) / r.length });
  return inside(mid(a), b) || inside(mid(b), a);
}

function nearestOnSeg(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Snap a move of `rings` by (dx, dy): a corner of the moving shape within `tol` of a target edge (a setback line, the lot boundary or another
 * building) is pulled onto it, and a target corner within `tol` of a moving edge is pulled onto it. Along each axis the nearest pull wins.
 * Without a pull the move rounds to a 50 mm grid. Returns { dx, dy, snapped: boolean }.
 */
export function snapMove(rings, dx, dy, targets, tol) {
  const moving = rings.map((r) => shiftRing(r, dx, dy));
  let best = null;
  const consider = (from, to) => {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d <= tol && (!best || d < best.d)) best = { d, x: to.x - from.x, y: to.y - from.y };
  };
  for (const mr of moving) {
    for (const q of mr) for (const t of targets) for (let i = 0; i < t.length; i++) consider(q, nearestOnSeg(q, t[i], t[(i + 1) % t.length]));
    for (const t of targets) for (const q of t) for (let i = 0; i < mr.length; i++) consider(nearestOnSeg(q, mr[i], mr[(i + 1) % mr.length]), q);
  }
  if (best) return { dx: Math.round(dx + best.x), dy: Math.round(dy + best.y), snapped: true };
  const g = (v) => Math.round(v / 50) * 50;
  return { dx: g(dx), dy: g(dy), snapped: false };
}

/**
 * Live warnings for `rings` (one moved item): outside the setback line (or the lot when there is no setback line) and overlapping another item.
 * Returns an array of short sentences; empty when all is clear.
 */
export function moveWarnings(rings, { envelope = null, boundary = null, others = [] } = {}) {
  const out = [];
  const area = envelope && envelope.length >= 3 ? envelope : boundary && boundary.length >= 3 ? boundary : null;
  if (area && rings.some((r) => r.some((q) => !inside(q, area)))) out.push(envelope && envelope.length >= 3 ? 'Outside the setback line' : 'Outside the lot boundary');
  if (others.some((o) => rings.some((r) => overlaps(r, o)))) out.push('Overlaps another building');
  return out;
}

/** Snap a turn to 15 degrees unless `free`. */
export const turnSnap = (deg, free = false) => (free ? Math.round(deg) : Math.round(deg / 15) * 15);

/** Orientation (degrees, plan axes, 0 to 180) of a ring's longest edge. */
export function ringAngle(ring) {
  let best = 0;
  let ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) { best = len; ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; }
  }
  return ((ang % 180) + 180) % 180;
}

const edgeAngles = (ring) => ring.map((a, i) => { const b = ring[(i + 1) % ring.length]; return ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90) + 90) % 90; });

/**
 * The turn applied while dragging the gold handle: whole degrees (1 degree steps), 15 degree steps with Shift, and, within 2 degrees of a
 * lot boundary edge direction (or its right angle), the turn that lines the building up with that edge. `base` is the building's own angle.
 */
export function turnStep(deg, { shift = false, base = null, boundary = null } = {}) {
  if (shift) return Math.round(deg / 15) * 15;
  let d = Math.round(deg);
  if (base != null && boundary && boundary.length > 2) {
    const mod90 = (x) => ((x % 90) + 90) % 90;
    const cur = mod90(base + d);
    for (const e of edgeAngles(boundary)) {
      let diff = e - cur;
      diff = ((diff + 135) % 90) - 45;
      if (Math.abs(diff) <= 2 && Math.abs(diff) > 1e-9) { d = Math.round((d + diff) * 100) / 100; break; }
    }
  }
  return d;
}

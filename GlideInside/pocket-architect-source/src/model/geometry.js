// 2D geometry helpers for plan coordinates (mm, x right, y down the screen).

export const TOL = 2; // coincidence tolerance, mm

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const v = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const samePoint = (a, b, tol = TOL) => dist(a, b) <= tol;
export const roundPt = (p, step = 1) => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });

export const snap = (val, step) => (step > 0 ? Math.round(val / step) * step : val);
export const snapPoint = (p, step) => ({ x: snap(p.x, step), y: snap(p.y, step) });

// Walls ---------------------------------------------------------------------
export const wallLength = (w) => dist(w.a, w.b);
export const wallDir = (w) => norm(sub(w.b, w.a));
// Normal n = (-d.y, d.x). wall.outside = 1 means outdoors is on the +n side.
export const wallNormal = (w) => {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
};
export const wallMid = (w) => lerp(w.a, w.b, 0.5);
export const wallAngle = (w) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
export const pointOnWall = (w, offset) => add(w.a, mul(wallDir(w), offset));

// Opening extent along its wall, measured from wall end a.
export const openingSpan = (o) => ({ start: o.offset - o.width / 2, end: o.offset + o.width / 2 });

// Segments -------------------------------------------------------------------
export function projectToSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const tRaw = L2 > 0 ? dot(sub(p, a), ab) / L2 : 0;
  const t = clamp(tRaw, 0, 1);
  const point = add(a, mul(ab, t));
  return { t, tRaw, point, d: dist(p, point), along: t * Math.sqrt(L2) };
}

export function distToLine(p, a, b) {
  const ab = sub(b, a);
  const L = len(ab);
  return L ? Math.abs(cross(ab, sub(p, a))) / L : dist(p, a);
}

export const pointOnSegment = (p, a, b, tol = TOL) => projectToSegment(p, a, b).d <= tol;

// True when segment (a2, b2) lies on the infinite line through (a1, b1).
export const collinear = (a1, b1, a2, b2, tol = TOL) => distToLine(a2, a1, b1) <= tol && distToLine(b2, a1, b1) <= tol;

// For collinear segments: the overlap as [start, end] in mm along segment 1 from a1, or null.
export function overlapOnSegment(a1, b1, a2, b2) {
  const L = dist(a1, b1);
  if (!L) return null;
  const d = norm(sub(b1, a1));
  const s2a = dot(sub(a2, a1), d);
  const s2b = dot(sub(b2, a1), d);
  const lo = Math.max(0, Math.min(s2a, s2b));
  const hi = Math.min(L, Math.max(s2a, s2b));
  return hi - lo > 0 ? [lo, hi] : null;
}

// Polygons -------------------------------------------------------------------
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}
export const polygonArea = (poly) => Math.abs(signedArea(poly));

export function polygonCentroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < 1) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const polygonEdges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

export function rectPolygon(x, y, w, h) {
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function bbox(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function rotatePoint(p, c, deg) {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

// Levels and projects -------------------------------------------------------
export function levelPoints(level) {
  const pts = [];
  for (const w of level.walls) pts.push(w.a, w.b);
  for (const r of level.rooms) pts.push(...r.polygon);
  for (const f of level.furniture) pts.push({ x: f.x, y: f.y });
  for (const s of level.stairs) pts.push({ x: s.x, y: s.y });
  return pts;
}
export const levelBounds = (level) => bbox(levelPoints(level));

export function projectBounds(project, { includeTanks = true } = {}) {
  const pts = project.levels.flatMap(levelPoints);
  if (includeTanks) for (const t of project.site?.tanks || []) pts.push({ x: t.x - t.diameter / 2, y: t.y - t.diameter / 2 }, { x: t.x + t.diameter / 2, y: t.y + t.diameter / 2 });
  return bbox(pts);
}

export function nearestWall(level, p, maxDist = Infinity) {
  let best = null;
  for (const w of level.walls) {
    const r = projectToSegment(p, w.a, w.b);
    if (r.d <= maxDist && (!best || r.d < best.d)) best = { wall: w, d: r.d, offset: r.along, point: r.point, t: r.t };
  }
  return best;
}

export function roomAt(level, p, { indoorOnly = false } = {}) {
  return level.rooms.find((r) => (!indoorOnly || !r.outdoor) && pointInPolygon(p, r.polygon)) || null;
}

export const roomAreaM2 = (room) => polygonArea(room.polygon) / 1e6;
export const formatArea = (m2) => `${m2.toFixed(2)} m²`;
export const formatLength = (mm) => (mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`);

// Rotated rectangle corners (plan units, rotation clockwise in degrees).
export function rectCorners(cx, cy, w, d, rotDeg = 0) {
  const c = { x: cx, y: cy };
  return [
    { x: cx - w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy + d / 2 },
    { x: cx - w / 2, y: cy + d / 2 },
  ].map((p) => rotatePoint(p, c, rotDeg));
}

// Wall body as a polygon (centreline offset by half thickness each side).
export function wallPolygon(w) {
  const n = wallNormal(w);
  const h = (w.thickness || 100) / 2;
  return [add(w.a, mul(n, h)), add(w.b, mul(n, h)), add(w.b, mul(n, -h)), add(w.a, mul(n, -h))];
}

// Separating axis test for two convex polygons. `inset` shrinks the overlap needed (mm).
export function convexOverlap(P, Q, inset = 0) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ax = norm({ x: -(b.y - a.y), y: b.x - a.x });
      let minP = Infinity, maxP = -Infinity, minQ = Infinity, maxQ = -Infinity;
      for (const p of P) { const s = dot(p, ax); minP = Math.min(minP, s); maxP = Math.max(maxP, s); }
      for (const q of Q) { const s = dot(q, ax); minQ = Math.min(minQ, s); maxQ = Math.max(maxQ, s); }
      if (maxP - inset <= minQ || maxQ - inset <= minP) return false;
    }
  }
  return true;
}

// Placement maths for catalogue buildings. Local frame (see FRAMEWORK.md): origin at the front left corner, x along the frontage,
// the front edge on y = 0 and the body in y >= 0 (depth runs to the rear); the street side is -y. place = { x, y, rotationDeg };
// world = place + x*u + y*v with u = (cos, sin) and v = (-sin, cos). At 0 degrees the front faces up the screen.

const rad = (d) => ((Number(d) || 0) * Math.PI) / 180;

export function frameOf(place) {
  const a = rad(place?.rotationDeg);
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  return { o: { x: Number(place?.x) || 0, y: Number(place?.y) || 0 }, u, v };
}

/** Local point to world point (mm). */
export function toWorld(place, p) {
  const f = frameOf(place);
  return { x: f.o.x + f.u.x * p.x + f.v.x * p.y, y: f.o.y + f.u.y * p.x + f.v.y * p.y };
}
/** Local vector to world vector (rotation only). */
export function dirToWorld(place, p) {
  const f = frameOf(place);
  return { x: f.u.x * p.x + f.v.x * p.y, y: f.u.y * p.x + f.v.y * p.y };
}
export const polyToWorld = (place, poly) => poly.map((q) => toWorld(place, q));

/** World point to local point (mm). */
export function toLocal(place, p) {
  const f = frameOf(place);
  const dx = p.x - f.o.x;
  const dy = p.y - f.o.y;
  return { x: dx * f.u.x + dy * f.u.y, y: dx * f.v.x + dy * f.v.y };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]; const q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
export const polyAreaM2 = (poly) => polyArea(poly) / 1e6;

export function bboxOf(pts) {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** True when a polygon is a simple closed ring: 3 or more distinct points and a positive area. */
export const isClosedPositive = (poly) => Array.isArray(poly) && poly.length >= 3 && polyArea(poly) > 1;

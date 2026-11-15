// Drawing in the house's own axes. A room, deck or building drawn near a turned house is square to that house, not to the screen.
// Order: the wall of the house nearest the cursor, else the lot frontage, else north (square to the screen). Plan units are mm, y down.
import * as G from '../model/geometry.js';

const wrap90 = (deg) => ((((deg + 45) % 90) + 90) % 90) - 45; // -45 up to 45: a rectangle looks the same every quarter turn

/** { deg, source: 'house' | 'frontage' | 'north' | 'screen' } for a drawing started at point p. Alt (opts.alt) forces square to the screen. */
export function localAxis(project, level, p, opts = {}) {
  if (opts.alt) return { deg: 0, source: 'screen' };
  const near = opts.nearMm ?? 4000;
  let best = null;
  for (const w of level?.walls || []) {
    if (!w?.a || !w?.b || G.dist(w.a, w.b) < 300) continue;
    const d = G.projectToSegment(p, w.a, w.b).d;
    if (d <= near && (!best || d < best.d)) best = { d, w };
  }
  if (best) {
    const deg = wrap90((Math.atan2(best.w.b.y - best.w.a.y, best.w.b.x - best.w.a.x) * 180) / Math.PI);
    return { deg: Math.abs(deg) < 0.05 ? 0 : Math.round(deg * 10) / 10, source: 'house' };
  }
  const lot = project?.site?.lot;
  const fe = (lot?.frontEdges || []).find((i) => Number.isInteger(i) && i >= 0 && i < (lot.boundary?.length || 0));
  if (lot?.boundary?.length && fe != null) {
    const a = lot.boundary[fe];
    const b = lot.boundary[(fe + 1) % lot.boundary.length];
    const deg = wrap90((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    return { deg: Math.abs(deg) < 0.05 ? 0 : Math.round(deg * 10) / 10, source: 'frontage' };
  }
  return { deg: 0, source: 'north' };
}

const rot = (v, deg) => { const r = (deg * Math.PI) / 180; return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) }; };

/** Corner b snapped onto the grid that runs along the angle from origin a (step mm). Returns the world point. */
export function snapToRotatedGrid(a, b, deg, step = 50) {
  const l = rot({ x: b.x - a.x, y: b.y - a.y }, -deg);
  const s = { x: Math.round(l.x / step) * step, y: Math.round(l.y / step) * step };
  const w = rot(s, deg);
  return { x: Math.round(a.x + w.x), y: Math.round(a.y + w.y) };
}

/** The four corners (world, in order) of the rectangle drawn from a to b in axes turned by deg, plus its local width and depth. */
export function rotatedRect(a, b, deg) {
  const l = rot({ x: b.x - a.x, y: b.y - a.y }, -deg);
  const c = (x, y) => { const w = rot({ x, y }, deg); return { x: Math.round(a.x + w.x), y: Math.round(a.y + w.y) }; };
  return { points: [c(0, 0), c(l.x, 0), c(l.x, l.y), c(0, l.y)], w: Math.abs(l.x), h: Math.abs(l.y), deg };
}

// Rank house designs against a lot's setback envelope: fits, fits rotated or mirrored, or does not fit (with the reason).
// Guidance only. The footprint is the outline of the ground floor walls and rooms; a design that does not fit can still be placed.
//
//   const ranked = rankDesigns(designs, envelopePolygonMm)   // designs: [{ id, name, footprint: [{x,y}] , widthMm, depthMm }]
//   ranked[0] = { ...design, fit: { status, rotationDeg, mirrored, badge, reason, rank } }

import { lowestLevel } from './house-stats.js';

const hull = (pts) => {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

/** Convex outline of the house at ground level (walls and indoor rooms, garage included, decks and alfresco excluded). */
export function footprintOf(project) {
  const g = lowestLevel(project);
  const pts = [];
  for (const w of g.walls) if (w.status !== 'demolish') pts.push({ x: w.a.x, y: w.a.y }, { x: w.b.x, y: w.b.y });
  for (const r of g.rooms) if (!r.outdoor || r.type === 'carport') pts.push(...r.polygon.map((q) => ({ x: q.x, y: q.y })));
  return hull(pts);
}

const inPoly = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const bboxOf = (pts) => ({ minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) });

function candidateAngles(env) {
  const set = new Set([0, 90, 180, 270]);
  for (let i = 0; i < env.length; i += 1) {
    const a = env[i];
    const b = env[(i + 1) % env.length];
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    for (const k of [0, 90, 180, 270]) set.add(Math.round((((deg + k) % 360) + 360) % 360));
  }
  return [...set].sort((a, b) => a - b);
}

function placeable(outline, env, angle, mirrored, step = 400) {
  const th = (angle * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const cx = outline.reduce((t, p) => t + p.x, 0) / outline.length;
  const cy = outline.reduce((t, p) => t + p.y, 0) / outline.length;
  const rel = outline.map((p) => {
    const dx = (mirrored ? -(p.x - cx) : p.x - cx);
    const dy = p.y - cy;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  });
  const rb = bboxOf(rel);
  const eb = bboxOf(env);
  for (let y = eb.minY - rb.minY; y <= eb.maxY - rb.maxY; y += step) {
    for (let x = eb.minX - rb.minX; x <= eb.maxX - rb.maxX; x += step) {
      if (rel.every((p) => inPoly({ x: x + p.x, y: y + p.y }, env))) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
}

/** Fit of one outline in an envelope polygon: { status: 'fits'|'rotated'|'mirrored'|'rotated-mirrored'|'too-big', rotationDeg, mirrored, pose, reason }. */
export function fitOne(outline, envelope) {
  if (!outline?.length || !envelope?.length) return { status: 'unknown', rotationDeg: 0, mirrored: false, reason: '' };
  const angles = candidateAngles(envelope);
  const tries = [];
  for (const mirrored of [false, true]) for (const a of angles) tries.push({ a, mirrored });
  tries.sort((p, q) => (p.mirrored - q.mirrored) || ((p.a % 180 === 0 ? 0 : 1) - (q.a % 180 === 0 ? 0 : 1)) || (p.a - q.a));
  for (const t of tries) {
    const pos = placeable(outline, envelope, t.a, t.mirrored);
    if (pos) {
      const turned = t.a !== 0;
      const status = t.mirrored ? (turned ? 'rotated-mirrored' : 'mirrored') : turned ? 'rotated' : 'fits';
      return { status, rotationDeg: t.a > 180 ? t.a - 360 : t.a, mirrored: t.mirrored, pose: pos, reason: '' };
    }
  }
  // Does not fit: how far over, in the better of the two square orientations.
  const hb = bboxOf(outline);
  const eb = bboxOf(envelope);
  const hw = hb.maxX - hb.minX;
  const hd = hb.maxY - hb.minY;
  const ew = eb.maxX - eb.minX;
  const ed = eb.maxY - eb.minY;
  const opts = [{ w: hw - ew, d: hd - ed, turned: false }, { w: hd - ew, d: hw - ed, turned: true }];
  const worst = (o) => Math.max(o.w, o.d);
  const best = opts.sort((a, b) => worst(a) - worst(b))[0];
  const over = Math.max(best.w, best.d, 0) || 0;
  const dir = best.w >= best.d ? 'wide' : 'deep';
  // Over by less than a step on a non square lot: report the smallest overlap we can say something about.
  const m = (Math.max(over, 100) / 1000).toFixed(1);
  return { status: 'too-big', rotationDeg: 0, mirrored: false, pose: null, reason: `${m} m too ${dir}` };
}

const BADGES = { fits: 'Fits', rotated: 'Fits rotated', mirrored: 'Fits mirrored', 'rotated-mirrored': 'Fits rotated and mirrored', 'too-big': 'Does not fit', unknown: '' };
const RANK = { fits: 0, rotated: 1, mirrored: 2, 'rotated-mirrored': 3, 'too-big': 4, unknown: 5 };

/** Adds `fit` to each design and sorts: fits first, then rotated or mirrored, then those that do not fit. Name breaks ties. */
export function rankDesigns(designs, envelope) {
  const out = designs.map((d) => {
    const outline = d.footprint || (d.project ? footprintOf(d.project) : null);
    const f = fitOne(outline, envelope);
    const reason = f.status === 'rotated' ? `Turn it ${Math.abs(f.rotationDeg)} degrees` : f.status === 'mirrored' ? 'Mirror it left to right' : f.status === 'rotated-mirrored' ? `Mirror it and turn it ${Math.abs(f.rotationDeg)} degrees` : f.reason;
    return { ...d, fit: { ...f, reason, badge: BADGES[f.status], rank: RANK[f.status] } };
  });
  return out.sort((a, b) => a.fit.rank - b.fit.rank || a.name.localeCompare(b.name));
}

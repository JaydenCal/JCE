// The finished design surface (FDS): one analytic height function for the whole site, independent of the terrain mesh.
//   levelAt(x, y) -> { y, id, kind }   plan mm in, metres out; id is the design element the point belongs to (null on open ground)
// Built from ordered design elements, highest priority first (existing road and crossover, then building pads, then paving and driveways):
//   * inside an element the level is the element's own analytic level, so every surface that reads it (asphalt, concrete, kerbs, paths, beds,
//     paint, cars) agrees with every other one;
//   * near a higher priority element the level is BLENDED to it, not stepped: Shepard weights (T - d)^2 / (T d)^2 over a transition width T
//     (2 m by default), which is exactly the neighbour's level at the shared edge, exactly the element's own level at T, and smooth between;
//   * beyond an element's edge the plane is carried outward for a short flat band, then a 1 in 3 batter runs to the natural ground
//     (batters stop at the lot boundary; skirts.js closes any gap under an exact surface edge).
// Pure functions, no DOM, no three.js. Elements: { id, kind, polys: [ring plan mm], level(x, y) -> metres, T?, band? }.
import * as G from '../model/geometry.js';
import * as S from './site-geom.js';
import { TRANSITION_M } from './levels.js';

export const REACH_M = 36; // an element only affects ground within this distance (a batter of up to 12 m of cut or fill)

const bboxOf = (poly) => G.bbox(poly);

/** Distance (m) from a plan point to a polygon (0 inside), with the nearest boundary point. bb is the polygon's bbox. */
export function polyDistM(p, poly, bb) {
  const dx = Math.max(bb.minX - p.x, 0, p.x - bb.maxX);
  const dy = Math.max(bb.minY - p.y, 0, p.y - bb.maxY);
  const dBox = Math.hypot(dx, dy) / 1000;
  if (dBox > REACH_M) return { d: dBox, q: p };
  if (G.pointInPolygon(p, poly)) return { d: 0, q: p };
  let best = Infinity;
  let bq = p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x; const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
    const h = Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey);
    if (h < best) { best = h; bq = { x: a.x + t * ex, y: a.y + t * ey }; }
  }
  return { d: best / 1000, q: bq };
}

// Allocation free distance used on the hot path: returns metres, the nearest boundary point left in _qx, _qy.
let _qx = 0; let _qy = 0;
function distInto(x, y, poly, bb) {
  const dx = Math.max(bb.minX - x, 0, x - bb.maxX);
  const dy = Math.max(bb.minY - y, 0, y - bb.maxY);
  _qx = x; _qy = y;
  const dBox = Math.sqrt(dx * dx + dy * dy) / 1000;
  if (dBox > REACH_M) return dBox;
  let inside = false;
  const n = poly.length;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i]; const pj = poly[j];
    if ((pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  if (inside) return 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]; const b = poly[i + 1 === n ? 0 : i + 1];
    const ex = b.x - a.x; const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0;
    const hx = x - a.x - t * ex; const hy = y - a.y - t * ey;
    const h = hx * hx + hy * hy;
    if (h < best) { best = h; _qx = a.x + t * ex; _qy = a.y + t * ey; }
  }
  return Math.sqrt(best) / 1000;
}

/** A uniform bucket index over expanded boxes: query(x, y) -> the items whose box covers the point. */
function buildIndex(items, cellMm = 12000) {
  const map = new Map();
  const key = (i, j) => i * 73856093 + j * 19349663;
  for (const it of items) {
    const i0 = Math.floor(it.box.minX / cellMm); const i1 = Math.floor(it.box.maxX / cellMm);
    const j0 = Math.floor(it.box.minY / cellMm); const j1 = Math.floor(it.box.maxY / cellMm);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); const a = map.get(k); if (a) a.push(it); else map.set(k, [it]); }
  }
  return (x, y) => map.get(key(Math.floor(x / cellMm), Math.floor(y / cellMm))) || EMPTY;
}
const EMPTY = [];

/**
 * createFDS({ rawAt, elements, cellM }) -> { elements, levelAt(x, y, raw?), heightAt(x, y, raw?), band, reach }
 * rawAt(x, y) is the natural ground in metres (the same Y scale as the element levels). Elements are in priority order, highest first.
 */
export function createFDS({ rawAt, elements, cellM = 0.75, padBand = null, lot = null, batterRun = S.BATTER_RUN }) {
  const band = Math.max(1.2, 1.5 * cellM); // flat band beyond an element: wider than a terrain cell so the mesh is on the plane under it
  const bandPad = padBand ?? Math.max(S.PAD_MARGIN_M, 1.5 * cellM);
  elements.forEach((z, k) => { z.rank = k; z.band = z.band ?? (z.kind === 'pad' ? bandPad : band); z.T = z.T ?? TRANSITION_M; z.boxes = z.polys.map(bboxOf); });
  const items = [];
  elements.forEach((z) => z.polys.forEach((poly, pi) => {
    const b = z.boxes[pi]; const r = (REACH_M + z.band) * 1000;
    items.push({ z, poly, bb: b, box: { minX: b.minX - r, maxX: b.maxX + r, minY: b.minY - r, maxY: b.maxY + r } });
  }));
  const query = buildIndex(items);

  // The element's own level, blended to every higher priority element within its transition width (continuous: exactly the neighbour's level
  // at the shared edge, exactly its own level at T).
  const blended = (E, x, y, cands) => {
    const own = E.level(x, y);
    if (E.rank === 0) return own;
    let sw = 0; let sv = 0;
    for (let c = 0; c < cands.length; c++) {
      const it = cands[c];
      const N = it.z;
      if (N.rank >= E.rank) continue;
      const T = N.T;
      const lx = Math.max(it.bb.minX - x, 0, x - it.bb.maxX); const ly = Math.max(it.bb.minY - y, 0, y - it.bb.maxY);
      if ((lx * lx + ly * ly) >= T * T * 1e6) continue;
      const d = distInto(x, y, it.poly, it.bb);
      if (d >= T) continue;
      if (d < 1e-4) return N.level(x, y);
      const w = ((T - d) / (T * d)) ** 2;
      sw += w; sv += w * N.level(x, y);
    }
    return sw ? (own + sv) / (1 + sw) : own;
  };

  // The core: sets out.* (no allocation per call); levelAt copies it into a fresh object.
  const out = { y: 0, id: null, kind: null, near: null, batter: false };
  const core = (x, y, rawIn) => {
    const cands = query(x, y);
    let bz = null; let bd = Infinity; let bqx = x; let bqy = y; let bk = Infinity; // winning element: a containing one by rank, else the nearest
    for (let c = 0; c < cands.length; c++) {
      const it = cands[c];
      const lx = Math.max(it.bb.minX - x, 0, x - it.bb.maxX); const ly = Math.max(it.bb.minY - y, 0, y - it.bb.maxY);
      const lb = Math.sqrt(lx * lx + ly * ly) / 1000;
      if (lb > REACH_M + it.z.band || (bk < 0 ? lb > 0 : lb >= bk)) continue;
      const d = distInto(x, y, it.poly, it.bb);
      if (d > REACH_M + it.z.band) continue;
      const key = d === 0 ? -1 + it.z.rank * 1e-6 : d + it.z.rank * 1e-9;
      if (key < bk) { bk = key; bz = it.z; bd = d; bqx = _qx; bqy = _qy; }
    }
    out.id = null; out.kind = null; out.near = null; out.batter = false;
    if (!bz) { out.y = rawIn ?? rawAt(x, y); return out; }
    const bnd = bz.band;
    out.near = bz.id;
    // Shoulders and batters stop at the lot boundary: beyond it the ground is the natural ground (the step at the boundary is a retaining edge,
    // see retainingEdges). The road and its crossovers are the only design that continues past the boundary.
    if (bd > 0 && lot && bz.kind !== 'road' && bz.kind !== 'crossover' && !G.pointInPolygon({ x, y }, lot)) { out.y = rawIn ?? rawAt(x, y); out.near = null; return out; }
    if (bd <= bnd) { out.y = blended(bz, x, y, cands); if (bd === 0) { out.id = bz.id; out.kind = bz.kind; } return out; }
    const raw = rawIn ?? rawAt(x, y);
    if (bd > REACH_M + bnd) { out.y = raw; out.near = null; return out; }
    const k = bnd / bd; // the batter starts from the level at the band edge, so it is a clean 1 in 3 band
    const lvl = blended(bz, bqx + (x - bqx) * k, bqy + (y - bqy) * k, cands);
    out.y = S.padHeight(raw, lvl, bd - bnd + S.PAD_MARGIN_M, batterRun); out.batter = true;
    return out;
  };
  const levelAt = (x, y, rawIn) => { const r = core(x, y, rawIn); return { y: r.y, id: r.id, kind: r.kind, near: r.near, batter: r.batter }; };
  const heightAt = (x, y, raw) => core(x, y, raw).y;
  // How far inside its element a point is (metres, 0 outside every element): the distance to the element's nearest edge.
  const depthAt = (x, y) => {
    const p = { x, y };
    for (const it of query(x, y)) {
      if (!G.pointInPolygon(p, it.poly)) continue;
      let best = Infinity;
      const poly = it.poly;
      for (let i = 0; i < poly.length; i++) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; const d = G.projectToSegment(p, a, b).d; if (d < best) best = d; }
      return best / 1000;
    }
    return 0;
  };
  return { elements, levelAt, heightAt, depthAt, band, reach: REACH_M };
}

/** The FDS level in metres at a plan point (mm). */
export const levelOf = (fds, x, y) => fds.levelAt(x, y).y;

// Edge skirts: a vertical strip down from the edge of every exact design surface (road, crossover, paving, driveway) to the terrain mesh under
// it. The surfaces are drawn at the exact design level and the terrain mesh is a coarse grid a little under them, so on a slope a surface edge
// can stand over the mesh with air beneath. Seen from a low oblique camera that reads as a floating strip with ground missing; the skirt
// closes it (nothing is added where the surface already meets the mesh within SKIRT_MIN_M). Pure geometry: returns plain arrays.
import * as G from '../model/geometry.js';

export const SKIRT_MIN_M = 0.015; // a gap smaller than this needs no skirt
export const SKIRT_BELOW_M = 0.05; // the skirt reaches this far under the mesh, so no sliver shows at its foot
const STEP_MM = 400;

const SKIRTED = new Set(['road', 'crossover', 'paving', 'drive']);

/**
 * skirtGeometry({ elements, levelAt(x, y) -> exact surface level, meshAt(x, y) -> terrain mesh level, inExtent(x, y) }) ->
 *   { positions: number[], indices: number[], quads, maxM } : the skirt quads (plan mm in, metres out: x / 1000, y, z / 1000).
 */
export function skirtGeometry({ elements, levelAt, meshAt, inExtent = () => true, coveredAt = null }) {
  const positions = []; const indices = [];
  let quads = 0; let maxM = 0;
  for (const el of elements) {
    if (!SKIRTED.has(el.kind)) continue;
    for (const poly of el.polys) {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i]; const b = poly[(i + 1) % n];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 50) continue;
        const ux = (b.x - a.x) / L; const uy = (b.y - a.y) / L;
        // the inward side, so the surface level is read just inside the edge (the element's own level) and the mesh just outside it
        let nx = uy; let ny = -ux;
        if (!G.pointInPolygon({ x: (a.x + b.x) / 2 - nx * 60, y: (a.y + b.y) / 2 - ny * 60 }, poly)) { nx = -nx; ny = -ny; } // n points out of the element
        const segs = Math.max(1, Math.ceil(L / STEP_MM));
        const col = [];
        for (let s = 0; s <= segs; s++) {
          const q = { x: a.x + ((b.x - a.x) * s) / segs, y: a.y + ((b.y - a.y) * s) / segs };
          if (!inExtent(q.x, q.y)) { col.push(null); continue; }
          const top = levelAt(q.x - nx * 20, q.y - ny * 20);
          // an edge shared with another exact surface of the same network (equal levels) has nothing under it to close: no skirt
          if (coveredAt && coveredAt(q.x + nx * 40, q.y + ny * 40, top)) { col.push(null); continue; }
          const lowMesh = Math.min(meshAt(q.x, q.y), meshAt(q.x + nx * 300, q.y + ny * 300), meshAt(q.x - nx * 120, q.y - ny * 120));
          col.push({ x: q.x / 1000, z: q.y / 1000, top, bot: Math.min(top, lowMesh - SKIRT_BELOW_M) });
        }
        for (let s = 0; s < segs; s++) {
          const p0 = col[s]; const p1 = col[s + 1];
          if (!p0 || !p1) continue;
          if (p0.top - p0.bot < SKIRT_MIN_M + SKIRT_BELOW_M && p1.top - p1.bot < SKIRT_MIN_M + SKIRT_BELOW_M) continue;
          const k = positions.length / 3;
          positions.push(p0.x, p0.top, p0.z, p0.x, p0.bot, p0.z, p1.x, p1.top, p1.z, p1.x, p1.bot, p1.z);
          indices.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
          quads++; maxM = Math.max(maxM, p0.top - p0.bot, p1.top - p1.bot);
        }
      }
    }
  }
  return { positions, indices, quads, maxM };
}

/**
 * retainingWallGeometry(samples) -> { face, cap } : a retaining wall along the lot boundary where a batter cannot fit inside the lot (the step
 * between the design and the neighbouring ground). samples are retainingEdges samples { x, y (plan mm), nx, ny (unit, out of the lot), a (level
 * inside), b (level outside) }, one per metre. The face stands on the boundary line from the higher level down to 0.3 m under the lower, with a
 * 0.3 m wide capping on top. Each is { positions, indices } in metres.
 */
export function retainingWallGeometry(samples, { capM = 0.3, footM = 0.3, maxJoinMm = 1600 } = {}) {
  const face = { positions: [], indices: [] }; const cap = { positions: [], indices: [] };
  for (let i = 0; i + 1 < samples.length; i++) {
    const p = samples[i]; const q = samples[i + 1];
    if (Math.hypot(q.x - p.x, q.y - p.y) > maxJoinMm || Math.abs(p.nx * q.nx + p.ny * q.ny) < 0.95) continue;
    const top = (s) => Math.max(s.a, s.b) + 0.1;
    const bot = (s) => Math.min(s.a, s.b) - footM;
    const f = face.positions; const k = f.length / 3;
    f.push(p.x / 1000, top(p), p.y / 1000, p.x / 1000, bot(p), p.y / 1000, q.x / 1000, top(q), q.y / 1000, q.x / 1000, bot(q), q.y / 1000);
    face.indices.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    const c = cap.positions; const m = c.length / 3;
    const o = (s, side) => [s.x / 1000 + (s.nx * capM * side) / 2, top(s), s.y / 1000 + (s.ny * capM * side) / 2];
    c.push(...o(p, -1), ...o(p, 1), ...o(q, -1), ...o(q, 1));
    cap.indices.push(m, m + 1, m + 2, m + 2, m + 1, m + 3);
  }
  return { face, cap };
}

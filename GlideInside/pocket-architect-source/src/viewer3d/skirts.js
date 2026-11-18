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
export function skirtGeometry({ elements, levelAt, meshAt, inExtent = () => true }) {
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

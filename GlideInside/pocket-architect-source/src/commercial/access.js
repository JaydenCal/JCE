// The site access: a driveway from the front boundary to the nearest paved area, and the crossover pad across the verge. Always drawn for a
// commercial layout with a looked up or uploaded lot, so the roller door aprons and bays connect to the street. Indicative only: width,
// position and the council crossover rules are checked with council. Pure geometry in plan millimetres, no DOM.

import { parkingLayout, doorStrips } from './parking.js';
import { layoutUnits } from './layout.js';
import { CROSSOVER_MM } from './catalogue/pavements/logic.js';
import { buildingsOf, siteWorksOf } from './catalogue/buildings.js';

const CROSSOVER_PAD_MM = 3000; // verge depth drawn beyond the boundary

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a) => Math.hypot(a.x, a.y);

function nearestOnSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** Points sampled around a polygon (vertices and edge points about every 1 m), used to find the paved point nearest the street. */
function sample(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(len(sub(b, a)) / 1000));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * siteAccess(commercial, lot) -> { from, to, widthMm, lengthMm, driveway: [pt x4], crossover: [pt x4], auto } | null.
 * `commercial.crossovers[0]` ({ x, y, widthMm }) moves the access; without it the nearest paved point to the front boundary is used.
 */
export function siteAccess(commercial, lot) {
  const b = lot?.boundary;
  const fe = lot?.frontEdges;
  if (!commercial || !Array.isArray(b) || b.length < 3 || !Array.isArray(fe) || !fe.length) return null;
  const swx = siteWorksOf(commercial)?.crossovers?.[0] || null;
  if (swx && !(Array.isArray(commercial.crossovers) && commercial.crossovers.length)) {
    const w = swx.widthMm || CROSSOVER_MM;
    const d = swx.dir || { x: 0, y: -1 };
    const n = { x: -d.y * (w / 2), y: d.x * (w / 2) };
    const q = { x: swx.x, y: swx.y };
    const out0 = { x: q.x + d.x * CROSSOVER_PAD_MM, y: q.y + d.y * CROSSOVER_PAD_MM };
    const quad = (a, c2) => [{ x: a.x + n.x, y: a.y + n.y }, { x: c2.x + n.x, y: c2.y + n.y }, { x: c2.x - n.x, y: c2.y - n.y }, { x: a.x - n.x, y: a.y - n.y }];
    return { from: q, to: q, widthMm: w, lengthMm: 0, driveway: null, crossover: quad(q, out0), auto: true, siteWorks: true };
  }
  const park = parkingLayout(commercial);
  const polys = [];
  for (const r of park.rows) {
    if (!r.slots.length) continue;
    const far = r.depth + (r.off ?? 0);
    void far;
    for (const s of r.slots) polys.push(s.poly);
  }
  for (const s of doorStrips(commercial, park)) polys.push(s.poly);
  for (const u of layoutUnits(commercial)) polys.push(u.poly);
  for (const bl of buildingsOf(commercial)) polys.push(bl.outline);
  const pts = polys.flatMap(sample);
  if (!pts.length) return null;
  let best = null;
  for (const p of pts) {
    for (const ei of fe) {
      const s0 = b[ei];
      const s1 = b[(ei + 1) % b.length];
      if (!s0 || !s1) continue;
      const q = nearestOnSeg(p, s0, s1);
      const d = len(sub(p, q));
      if (!best || d < best.d) best = { d, p, q };
    }
  }
  if (!best) return null;
  const given = Array.isArray(commercial.crossovers) ? commercial.crossovers.find((x) => Number.isFinite(x?.x) && Number.isFinite(x?.y)) : null;
  const widthMm = given?.widthMm > 0 ? given.widthMm : CROSSOVER_MM;
  let { p, q } = best;
  if (given) {
    let bq = null;
    for (const ei of fe) {
      const cand = nearestOnSeg(given, b[ei], b[(ei + 1) % b.length]);
      if (!bq || len(sub(given, cand)) < len(sub(given, bq))) bq = cand;
    }
    p = { x: given.x, y: given.y };
    q = bq;
  }
  let dir = sub(q, p);
  let L = len(dir);
  if (L < 1) {
    // The paving touches the boundary: run the pad straight out from the boundary along its outward normal (away from the lot centre).
    const cx = b.reduce((s, v) => s + v.x, 0) / b.length;
    const cy = b.reduce((s, v) => s + v.y, 0) / b.length;
    dir = sub(q, { x: cx, y: cy });
    L = len(dir) || 1;
    dir = { x: dir.x / L, y: dir.y / L };
    L = 0;
  } else dir = { x: dir.x / L, y: dir.y / L };
  const n = { x: -dir.y * (widthMm / 2), y: dir.x * (widthMm / 2) };
  const quad = (a, c) => [{ x: a.x + n.x, y: a.y + n.y }, { x: c.x + n.x, y: c.y + n.y }, { x: c.x - n.x, y: c.y - n.y }, { x: a.x - n.x, y: a.y - n.y }];
  const out = { x: q.x + dir.x * CROSSOVER_PAD_MM, y: q.y + dir.y * CROSSOVER_PAD_MM };
  const noDrive = Array.isArray(commercial.siteRemoved?.kinds) && commercial.siteRemoved.kinds.includes('driveway');
  return { from: p, to: q, widthMm, lengthMm: L, driveway: L > 1 && !noDrive ? quad(p, q) : null, crossover: quad(q, out), auto: !given };
}

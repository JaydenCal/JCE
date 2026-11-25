// Summary figures for a house design (project JSON, docs/SCOPE.md 9): beds, baths, garage, floor area, size, storeys.
// Pure. Used for library cards, filters and the placement size check.

const area = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};
const bbox = (pts) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/**
 * The building's own width and depth (mm) from its points and walls: the smallest rectangle around the points that is turned to the walls. A design
 * placed on a lot at an angle (a shed turned 100 degrees) keeps its true size, where the plain bounding box of the turned plan would be bigger.
 * An upright plan returns the plain bounding box width and depth as before; a turned one returns the longer side first.
 */
export function ownSize(pts, walls = []) {
  const b0 = bbox(pts);
  const plain = { widthMm: Math.round(b0.maxX - b0.minX), depthMm: Math.round(b0.maxY - b0.minY), turned: false };
  if (pts.length < 3) return plain;
  const angles = new Set([0]);
  for (const w of walls) {
    const a = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
    if (Number.isFinite(a) && Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 300) angles.add(Math.round((((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) * 1e4) / 1e4);
  }
  let best = null;
  for (const t of angles) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const q = pts.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
    const bb = bbox(q);
    const w = bb.maxX - bb.minX;
    const d = bb.maxY - bb.minY;
    const area = w * d;
    if (!best || area < best.area - 1) best = { area, w, d, t };
  }
  const deg = (best.t * 180) / Math.PI;
  if (deg < 0.5 || deg > 89.5) return plain;
  return { widthMm: Math.round(Math.max(best.w, best.d)), depthMm: Math.round(Math.min(best.w, best.d)), turned: true };
}

export function lowestLevel(project) {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
}

/** { bedrooms, bathrooms, garage (cars), floorAreaM2 (living, excl. garage and outdoor), widthMm, depthMm, storeys } */
export function houseStats(project) {
  let bedrooms = 0;
  let bathrooms = 0;
  let garage = 0;
  let areaMm2 = 0;
  for (const l of project.levels) {
    for (const r of l.rooms) {
      if (r.type === 'bedroom') bedrooms += 1;
      if (r.type === 'bathroom' || r.type === 'ensuite') bathrooms += 1;
      if (r.type === 'garage' || r.type === 'carport') {
        const b = bbox(r.polygon);
        const shortSide = Math.min(b.maxX - b.minX, b.maxY - b.minY);
        garage += shortSide >= 5400 ? 2 : 1;
      }
      if (!r.outdoor && r.type !== 'garage') areaMm2 += area(r.polygon);
    }
  }
  // Footprint: ground level walls and indoor or garage rooms, without decks, patios and alfresco areas.
  const g = lowestLevel(project);
  const pts = [];
  for (const w of g.walls) if (w.status !== 'demolish') pts.push(w.a, w.b);
  for (const r of g.rooms) if (!r.outdoor || r.type === 'carport') pts.push(...r.polygon);
  const b = pts.length ? bbox(pts) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const own = pts.length ? ownSize(pts, g.walls.filter((w) => w.status !== 'demolish')) : null;
  return {
    bedrooms,
    bathrooms,
    garage,
    floorAreaM2: Math.round(areaMm2 / 1e6),
    widthMm: Math.round(b.maxX - b.minX),
    depthMm: Math.round(b.maxY - b.minY),
    ownWidthMm: own ? own.widthMm : 0,
    ownDepthMm: own ? own.depthMm : 0,
    storeys: project.levels.length,
  };
}

/** "15.0 x 9.0 m": the building's own size (turned designs are not measured by their bounding box). */
export const sizeLabel = (s) => `${((s.ownWidthMm || s.widthMm) / 1000).toFixed(1)} x ${((s.ownDepthMm || s.depthMm) / 1000).toFixed(1)} m`;

/** Standard lot frontage classes in metres, used to tag designs ("Fits a 12.5 m lot"). */
export const FRONTAGE_CLASSES_M = [7.5, 8.5, 10, 12.5, 14, 15, 16, 18, 20, 25, 30];

/** The smallest standard lot frontage the footprint fits with 0.9 m side setbacks on both sides (a nominal class, guidance only). */
export function frontageClassM(widthMm) {
  const need = widthMm / 1000 + 1.8;
  return FRONTAGE_CLASSES_M.find((c) => c >= need - 1e-6) ?? Math.ceil(need);
}

/**
 * Area schedule of a design in m2, from the room outlines (wall centre lines, the same basis as the plan set schedules):
 * living (indoor rooms except the garage), garage (carport included), alfresco, porch, other roofed outdoor (verandah) and
 * unroofed outdoor (deck, patio, courtyard), with the total of all of them.
 */
export function areaBreakdown(project) {
  const t = { living: 0, garage: 0, alfresco: 0, porch: 0, otherRoofed: 0, unroofed: 0 };
  for (const l of project.levels) {
    for (const r of l.rooms) {
      if (r.status === 'demolish') continue;
      const a = area(r.polygon) / 1e6;
      if (!r.outdoor) { if (r.type === 'garage') t.garage += a; else t.living += a; }
      else if (r.type === 'carport') t.garage += a;
      else if (!r.roofed) t.unroofed += a;
      else if (r.type === 'alfresco') t.alfresco += a;
      else if (/porch/i.test(r.name || '')) t.porch += a;
      else t.otherRoofed += a;
    }
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const out = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r1(v)]));
  out.total = r1(Object.values(t).reduce((s, v) => s + v, 0));
  return out;
}

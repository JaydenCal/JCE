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
  return {
    bedrooms,
    bathrooms,
    garage,
    floorAreaM2: Math.round(areaMm2 / 1e6),
    widthMm: Math.round(b.maxX - b.minX),
    depthMm: Math.round(b.maxY - b.minY),
    storeys: project.levels.length,
  };
}

export const sizeLabel = (s) => `${(s.widthMm / 1000).toFixed(1)} x ${(s.depthMm / 1000).toFixed(1)} m`;

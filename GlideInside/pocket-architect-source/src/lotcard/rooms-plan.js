// Geometry for the little floor plan on the lot card: the placed design's rooms (ground level first, then upper levels drawn
// over it only where nothing is below), scaled to fit w x h with the plan's own orientation. Pure: no DOM.

export function roomsPlanModel(project, w = 150, h = 100, pad = 4) {
  const levels = [...(project?.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const rooms = [];
  for (const l of levels) for (const r of l.rooms || []) if (r.status !== 'demolish' && Array.isArray(r.polygon) && r.polygon.length >= 3) rooms.push(r);
  if (!rooms.length) return { w, h, rooms: [] };
  const pts = rooms.flatMap((r) => r.polygon);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const k = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2 - minX * k;
  const oy = (h - (maxY - minY) * k) / 2 - minY * k;
  return {
    w, h,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name || r.type, type: r.type, points: r.polygon.map((p) => `${(p.x * k + ox).toFixed(1)},${(p.y * k + oy).toFixed(1)}`).join(' ') })),
  };
}

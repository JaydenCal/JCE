// A small plan thumbnail (SVG text) drawn from a project: rooms, walls and openings of the lowest level.
// Pure string building, so it runs in the browser, in Node tests and on a Worker.

import { lowestLevel } from './house-stats.js';

const ROOM_FILL = {
  bedroom: '#dfe7dc', bathroom: '#d3e3e8', ensuite: '#d3e3e8', wc: '#d3e3e8', laundry: '#d3e3e8', kitchen: '#efe3d0',
  living: '#f0e8d8', family: '#f0e8d8', dining: '#f0e8d8', garage: '#e3e5e1', carport: '#e3e5e1', alfresco: '#e9efe2',
  deck: '#e9efe2', patio: '#e9efe2', verandah: '#e9efe2', workshop: '#e3e5e1', store: '#e3e5e1',
};
const num = (n) => Math.round(n * 10) / 10;

export function projectToSvg(project, { width = 320, height = 200, ink = '#232a28', paper = '#f3f4ef' } = {}) {
  const lvl = lowestLevel(project);
  const pts = [];
  for (const w of lvl.walls) pts.push(w.a, w.b);
  for (const r of lvl.rooms) pts.push(...r.polygon);
  if (!pts.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${paper}"/></svg>`;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const pad = 14;
  const k = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * k) / 2 - minX * k;
  const oy = (height - (maxY - minY) * k) / 2 - minY * k;
  const X = (x) => num(x * k + ox);
  const Y = (y) => num(y * k + oy);
  let body = '';
  for (const r of lvl.rooms) {
    body += `<polygon points="${r.polygon.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}" fill="${ROOM_FILL[r.type] || '#ecece6'}" stroke="none"/>`;
  }
  for (const w of lvl.walls) {
    if (w.status === 'demolish') continue;
    const sw = Math.max(1.4, num(w.thickness * k));
    body += `<line x1="${X(w.a.x)}" y1="${Y(w.a.y)}" x2="${X(w.b.x)}" y2="${Y(w.b.y)}" stroke="${ink}" stroke-width="${sw}" stroke-linecap="square"/>`;
  }
  for (const o of lvl.openings) {
    const w = lvl.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const a = o.offset - o.width / 2;
    const b = o.offset + o.width / 2;
    const col = o.kind === 'window' ? '#7fa6b5' : paper;
    body += `<line x1="${X(w.a.x + ux * a)}" y1="${Y(w.a.y + uy * a)}" x2="${X(w.a.x + ux * b)}" y2="${Y(w.a.y + uy * b)}" stroke="${col}" stroke-width="${Math.max(1.6, num(w.thickness * k * 0.7))}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${paper}"/>${body}</svg>`;
}

export const svgDataUri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

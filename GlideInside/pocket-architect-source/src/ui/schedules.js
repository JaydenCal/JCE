// Area schedules, door and window schedule, soft warnings and roof area. Pure functions of a project.

import * as G from '../model/geometry.js';
import { ROOM_LABELS } from '../model/schema.js';
import { wallsOfRoom } from '../editor2d/edit.js';
import { clashList } from '../editor2d/clash.js';

const DOOR_KINDS = ['door', 'sliding_door', 'garage_door', 'roller_door', 'opening'];
export const OPENING_LABELS = {
  window: 'Window',
  door: 'Door',
  sliding_door: 'Sliding door',
  garage_door: 'Garage door',
  roller_door: 'Roller door',
  opening: 'Opening',
};
export const STYLE_LABELS = { sliding: 'Sliding', awning: 'Awning', fixed: 'Fixed', double_hung: 'Double hung', louvre: 'Louvre', hinged: 'Hinged', panel: 'Panel', roller: 'Roller', none: 'Plain' };

export const roomAreaM2 = (r) => G.polygonArea(r.polygon) / 1e6;
const isGarage = (r) => r.type === 'garage';
export const roomClass = (r) => (r.outdoor ? 'outdoor' : isGarage(r) ? 'garage' : 'indoor');

// Rooms per level with area totals.
export function areaSchedule(project) {
  return project.levels.map((level) => {
    const rooms = level.rooms
      .filter((r) => r.status !== 'demolish')
      .map((r) => ({ id: r.id, name: r.name || ROOM_LABELS[r.type] || 'Room', type: r.type, cls: roomClass(r), area: roomAreaM2(r), status: r.status || 'new' }));
    const sum = (cls) => rooms.filter((r) => r.cls === cls).reduce((s, r) => s + r.area, 0);
    return { levelId: level.id, name: level.name, rooms, indoor: sum('indoor'), garage: sum('garage'), outdoor: sum('outdoor') };
  });
}

export function indoorTotalM2(project) {
  return areaSchedule(project).reduce((s, l) => s + l.indoor, 0);
}

// Enclosed floor area (indoor plus garage) by extension status.
export function extensionTotals(project) {
  const t = { existing: 0, new: 0, demolish: 0 };
  for (const l of project.levels) for (const r of l.rooms) if (!r.outdoor) t[r.status || 'new'] += roomAreaM2(r);
  return t;
}

// Door and window schedule grouped by kind and size. Demolished openings are left out.
export function openingSchedule(project) {
  const groups = new Map();
  for (const l of project.levels) {
    for (const o of l.openings) {
      if (o.status === 'demolish') continue;
      const key = [o.kind, o.width, o.height, o.sill, o.style].join('|');
      const g = groups.get(key) || { kind: o.kind, width: o.width, height: o.height, sill: o.sill, style: o.style, count: 0 };
      g.count++;
      groups.set(key, g);
    }
  }
  const rows = [...groups.values()].sort((a, b) => (a.kind === 'window') - (b.kind === 'window') || a.kind.localeCompare(b.kind) || b.width - a.width);
  let d = 0;
  let w = 0;
  for (const r of rows) r.mark = r.kind === 'window' ? `W${++w}` : `D${++d}`;
  return rows;
}

// Roof plan area ---------------------------------------------------------------------------
const CELL = 100;
function rasterise(polys) {
  const pts = polys.flat();
  const bb = G.bbox(pts);
  if (!bb) return null;
  const x0 = Math.floor(bb.minX / CELL) - 12;
  const y0 = Math.floor(bb.minY / CELL) - 12;
  const nx = Math.ceil(bb.w / CELL) + 25;
  const ny = Math.ceil(bb.h / CELL) + 25;
  if (nx * ny > 4e6) return null;
  return { x0, y0, nx, ny, data: new Uint8Array(nx * ny) };
}
function fillPolys(grid, polys) {
  for (const poly of polys) {
    const bb = G.bbox(poly);
    const ix0 = Math.max(0, Math.floor(bb.minX / CELL) - grid.x0);
    const ix1 = Math.min(grid.nx - 1, Math.ceil(bb.maxX / CELL) - grid.x0);
    const iy0 = Math.max(0, Math.floor(bb.minY / CELL) - grid.y0);
    const iy1 = Math.min(grid.ny - 1, Math.ceil(bb.maxY / CELL) - grid.y0);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (G.pointInPolygon({ x: (grid.x0 + ix + 0.5) * CELL, y: (grid.y0 + iy + 0.5) * CELL }, poly)) grid.data[iy * grid.nx + ix] = 1;
      }
    }
  }
}
function dilate(grid, r) {
  if (r <= 0) return grid;
  const { nx, ny, data } = grid;
  const tmp = new Uint8Array(data.length);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!data[iy * nx + ix]) continue;
      for (let k = Math.max(0, ix - r); k <= Math.min(nx - 1, ix + r); k++) tmp[iy * nx + k] = 1;
    }
  }
  const out = new Uint8Array(data.length);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!tmp[iy * nx + ix]) continue;
      for (let k = Math.max(0, iy - r); k <= Math.min(ny - 1, iy + r); k++) out[k * nx + ix] = 1;
    }
  }
  return { ...grid, data: out };
}

// Plan projection of all roofs (rooms under the main roof plus eave overhang), m². Approximate.
export function roofPlanAreaM2(project) {
  let total = null;
  for (const level of project.levels) {
    if (level.roof?.enabled === false) continue;
    const polys = level.rooms.filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed)).map((r) => r.polygon);
    if (!polys.length) continue;
    const grid = rasterise(polys);
    if (!grid) continue;
    fillPolys(grid, polys);
    const out = dilate(grid, Math.round((level.roof?.overhang ?? 0) / CELL));
    if (!total) total = { cells: new Set() };
    for (let i = 0; i < out.data.length; i++) if (out.data[i]) total.cells.add(`${out.x0 + (i % out.nx)},${out.y0 + Math.floor(i / out.nx)}`);
  }
  return total ? total.cells.size * (CELL * CELL) / 1e6 : 0;
}

// Soft warnings (SCOPE 5.7) -----------------------------------------------------------------------
function overlapM2(a, b) {
  const ba = G.bbox(a);
  const bb = G.bbox(b);
  const x0 = Math.max(ba.minX, bb.minX);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const y0 = Math.max(ba.minY, bb.minY);
  const y1 = Math.min(ba.maxY, bb.maxY);
  if (x1 - x0 < CELL / 2 || y1 - y0 < CELL / 2) return 0;
  let n = 0;
  for (let ix = Math.floor(x0 / CELL); ix * CELL < x1; ix++) {
    const x = (ix + 0.5) * CELL;
    if (x < x0 || x > x1) continue;
    for (let iy = Math.floor(y0 / CELL); iy * CELL < y1; iy++) {
      const y = (iy + 0.5) * CELL;
      if (y < y0 || y > y1) continue;
      const p = { x, y };
      if (G.pointInPolygon(p, a) && G.pointInPolygon(p, b)) n++;
    }
  }
  return (n * CELL * CELL) / 1e6;
}

// `catalogue` (optional) supplies furniture sizes so items that clip a wall are listed too.
export function computeWarnings(project, { catalogue } = {}) {
  const out = [];
  for (const level of project.levels) {
    const rooms = level.rooms.filter((r) => r.status !== 'demolish');
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const m2 = overlapM2(rooms[i].polygon, rooms[j].polygon);
        if (m2 >= 0.05) {
          out.push({ kind: 'overlap', levelId: level.id, target: rooms[i].id, message: `${rooms[i].name} overlaps ${rooms[j].name} by ${m2.toFixed(2)} m² (${level.name})` });
        }
      }
    }
    const walls = new Map(level.walls.map((w) => [w.id, w]));
    for (const o of level.openings) {
      const w = walls.get(o.wallId);
      const label = OPENING_LABELS[o.kind] || 'Opening';
      if (!w) {
        out.push({ kind: 'opening', levelId: level.id, target: o.id, message: `${label} is not on a wall (${level.name})` });
        continue;
      }
      const L = G.wallLength(w);
      const sp = G.openingSpan(o);
      if (sp.start < -1 || sp.end > L + 1) out.push({ kind: 'opening', levelId: level.id, target: o.id, message: `${label} runs past the end of its wall (${level.name})` });
      else if (level.openings.some((q) => q.id !== o.id && q.wallId === o.wallId && q.id > o.id && G.openingSpan(q).start < sp.end - 1 && G.openingSpan(q).end > sp.start + 1)) {
        out.push({ kind: 'opening', levelId: level.id, target: o.id, message: `${label} overlaps another opening (${level.name})` });
      }
    }
    for (const r of rooms) {
      if (r.outdoor || roomAreaM2(r) < 1) continue;
      const bounds = wallsOfRoom(level, r);
      if (bounds.length < 3) continue;
      const ids = new Set(bounds.map((w) => w.id));
      if (!level.openings.some((o) => ids.has(o.wallId) && DOOR_KINDS.includes(o.kind))) {
        out.push({ kind: 'nodoor', levelId: level.id, target: r.id, message: `${r.name} is enclosed with no door (${level.name})` });
      }
    }
  }
  for (const c of clashList(project, catalogue)) {
    out.push({ kind: 'clash', levelId: c.levelId, target: c.furnitureId, message: `${c.name} clips a wall${project.levels.length > 1 ? ` (${c.levelName})` : ''}` });
  }
  return out;
}

// Unique room name suggestion: "Bedroom", then "Bedroom 2", "Bedroom 3"...
export function suggestRoomName(level, type) {
  const base = ROOM_LABELS[type] || 'Room';
  const names = new Set(level.rooms.map((r) => r.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}

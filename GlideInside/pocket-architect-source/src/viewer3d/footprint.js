// Level footprints on a 100 mm raster: rooms, walls and the area enclosed by walls (flood fill
// from outside), plus rectangle decompositions used for roofs, slabs and default floors.
// Pure logic, no DOM. All plan coordinates are millimetres.

import * as G from '../model/geometry.js';

export const CELL = 100;

export function makeGrid(project, cell = CELL, margin = 1500) {
  const pts = [];
  for (const l of project.levels) {
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
    for (const s of l.stairs) pts.push({ x: s.x, y: s.y });
  }
  const bb = G.bbox(pts) || { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const x0 = Math.floor((bb.minX - margin) / cell) * cell;
  const y0 = Math.floor((bb.minY - margin) / cell) * cell;
  const nx = Math.ceil((bb.maxX + margin - x0) / cell) + 1;
  const ny = Math.ceil((bb.maxY + margin - y0) / cell) + 1;
  return { x0, y0, nx, ny, cell };
}

const cellCentre = (g, i, j) => ({ x: g.x0 + (i + 0.5) * g.cell, y: g.y0 + (j + 0.5) * g.cell });
export const cellIndexOf = (g, x, y) => {
  const i = Math.floor((x - g.x0) / g.cell);
  const j = Math.floor((y - g.y0) / g.cell);
  return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i;
};
export const sampleMask = (g, mask, x, y) => {
  const k = cellIndexOf(g, x, y);
  return k < 0 ? 0 : mask[k];
};

// Corners of a wall rectangle (mm), ends extended by `ext` mm.
export function wallQuad(w, ext = 0, grow = 0) {
  const d = G.wallDir(w);
  const n = { x: -d.y, y: d.x };
  const t = (w.thickness || 100) / 2 + grow;
  const a = { x: w.a.x - d.x * ext, y: w.a.y - d.y * ext };
  const b = { x: w.b.x + d.x * ext, y: w.b.y + d.y * ext };
  return [
    { x: a.x + n.x * t, y: a.y + n.y * t },
    { x: b.x + n.x * t, y: b.y + n.y * t },
    { x: b.x - n.x * t, y: b.y - n.y * t },
    { x: a.x - n.x * t, y: a.y - n.y * t },
  ];
}

function pointInConvex(p, q) {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-6) continue;
    const s = c > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

// Separating axis test between a convex quad and an axis-aligned cell.
function quadOverlapsCell(q, x0, y0, x1, y1) {
  for (const axis of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of q) {
      const s = p.x * axis.x + p.y * axis.y;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    const cl = axis.x ? x0 : y0;
    const ch = axis.x ? x1 : y1;
    if (hi < cl || lo > ch) return false;
  }
  for (let i = 0; i < 2; i++) {
    const a = q[i];
    const b = q[i + 1];
    const ax = { x: -(b.y - a.y), y: b.x - a.x };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of q) {
      const s = p.x * ax.x + p.y * ax.y;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    let clo = Infinity;
    let chi = -Infinity;
    for (const c of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
      const s = c[0] * ax.x + c[1] * ax.y;
      clo = Math.min(clo, s);
      chi = Math.max(chi, s);
    }
    if (hi < clo || lo > chi) return false;
  }
  return true;
}

function eachCellInBox(g, minX, minY, maxX, maxY, fn) {
  const i0 = Math.max(0, Math.floor((minX - g.x0) / g.cell));
  const i1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((minY - g.y0) / g.cell));
  const j1 = Math.min(g.ny - 1, Math.floor((maxY - g.y0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j);
}

export function rasterPolygon(g, mask, poly) {
  const bb = G.bbox(poly);
  if (!bb) return;
  eachCellInBox(g, bb.minX, bb.minY, bb.maxX, bb.maxY, (i, j) => {
    const c = cellCentre(g, i, j);
    // a tiny offset avoids ambiguity when polygon edges pass exactly through cell centres
    if (G.pointInPolygon({ x: c.x + 0.013, y: c.y + 0.021 }, poly)) mask[j * g.nx + i] = 1;
  });
}

// visible(status) decides which elements count (extension status views).
export function rasteriseLevel(g, level, visible = () => true) {
  const size = g.nx * g.ny;
  const rooms = new Uint8Array(size);
  const walls = new Uint8Array(size);
  const blocked = new Uint8Array(size);
  for (const r of level.rooms) {
    if (!visible(r.status)) continue;
    if (r.outdoor && !r.roofed) continue;
    rasterPolygon(g, rooms, r.polygon);
  }
  for (const w of level.walls) {
    if (!visible(w.status) || G.wallLength(w) < 10) continue;
    const q = wallQuad(w, (w.thickness || 100) / 2);
    const bb = G.bbox(q);
    const qc = wallQuad(w, (w.thickness || 100) / 2, 4);
    eachCellInBox(g, bb.minX - 5, bb.minY - 5, bb.maxX + 5, bb.maxY + 5, (i, j) => {
      const k = j * g.nx + i;
      const cx = g.x0 + i * g.cell;
      const cy = g.y0 + j * g.cell;
      if (!blocked[k] && quadOverlapsCell(qc, cx, cy, cx + g.cell, cy + g.cell)) blocked[k] = 1;
      if (!walls[k]) {
        const c = cellCentre(g, i, j);
        if (pointInConvex(c, q)) walls[k] = 1;
      }
    });
  }
  // flood fill from the border through cells that are not blocked by walls
  const outside = new Uint8Array(size);
  const stack = [];
  const push = (i, j) => {
    const k = j * g.nx + i;
    if (!blocked[k] && !outside[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < g.nx; i++) {
    push(i, 0);
    push(i, g.ny - 1);
  }
  for (let j = 0; j < g.ny; j++) {
    push(0, j);
    push(g.nx - 1, j);
  }
  while (stack.length) {
    const k = stack.pop();
    const i = k % g.nx;
    const j = (k / g.nx) | 0;
    if (i > 0) push(i - 1, j);
    if (i < g.nx - 1) push(i + 1, j);
    if (j > 0) push(i, j - 1);
    if (j < g.ny - 1) push(i, j + 1);
  }
  const enclosed = new Uint8Array(size);
  const footprint = new Uint8Array(size);
  let any = false;
  for (let k = 0; k < size; k++) {
    if (!blocked[k] && !outside[k]) enclosed[k] = 1;
    if (rooms[k] || walls[k] || enclosed[k]) {
      footprint[k] = 1;
      any = true;
    }
  }
  return { rooms, walls, blocked, enclosed, footprint, any };
}

export const maskCount = (m) => {
  let n = 0;
  for (let k = 0; k < m.length; k++) if (m[k]) n++;
  return n;
};

export const maskMinus = (a, b) => {
  const o = new Uint8Array(a.length);
  for (let k = 0; k < a.length; k++) o[k] = a[k] && !b[k] ? 1 : 0;
  return o;
};

export const maskUnion = (a, b) => {
  const o = new Uint8Array(a.length);
  for (let k = 0; k < a.length; k++) o[k] = a[k] || b[k] ? 1 : 0;
  return o;
};

const toRect = (g, i0, j0, i1, j1) => ({
  i0, j0, i1, j1,
  x0: g.x0 + i0 * g.cell,
  y0: g.y0 + j0 * g.cell,
  x1: g.x0 + (i1 + 1) * g.cell,
  y1: g.y0 + (j1 + 1) * g.cell,
});

// Greedy non-overlapping rectangles (rows merged vertically).
export function disjointRects(g, mask) {
  const used = new Uint8Array(mask.length);
  const out = [];
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (!mask[k] || used[k]) continue;
      let w = 1;
      while (i + w < g.nx && mask[k + w] && !used[k + w]) w++;
      let h = 1;
      outer: while (j + h < g.ny) {
        for (let x = 0; x < w; x++) {
          const kk = (j + h) * g.nx + i + x;
          if (!mask[kk] || used[kk]) break outer;
        }
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used[(j + y) * g.nx + i + x] = 1;
      out.push(toRect(g, i, j, i + w - 1, j + h - 1));
    }
  }
  return out;
}

// Rectangles that may overlap: repeatedly take the first uncovered cell and grow the largest
// all-inside rectangle containing it. Slivers are dropped.
export function coverRects(g, mask, { minArea = 0.5e6, minSide = 300, maxRects = 48 } = {}) {
  const { nx, ny } = g;
  const L = new Int32Array(nx * ny).fill(-1);
  const R = new Int32Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (mask[k]) L[k] = i > 0 && mask[k - 1] ? L[k - 1] : i;
    }
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (mask[k]) R[k] = i < nx - 1 && mask[k + 1] ? R[k + 1] : i;
    }
  }
  const covered = new Uint8Array(nx * ny);
  const rects = [];
  for (let j = 0; j < ny && rects.length < maxRects; j++) {
    for (let i = 0; i < nx && rects.length < maxRects; i++) {
      const k = j * nx + i;
      if (!mask[k] || covered[k]) continue;
      // rows above (including j) and below (including j) in which column i is inside
      const upL = [];
      const upR = [];
      let curL = -1;
      let curR = nx;
      for (let y = j; y >= 0; y--) {
        const kk = y * nx + i;
        if (!mask[kk]) break;
        curL = Math.max(curL, L[kk]);
        curR = Math.min(curR, R[kk]);
        upL.push(curL);
        upR.push(curR);
      }
      const dnL = [];
      const dnR = [];
      curL = -1;
      curR = nx;
      for (let y = j; y < ny; y++) {
        const kk = y * nx + i;
        if (!mask[kk]) break;
        curL = Math.max(curL, L[kk]);
        curR = Math.min(curR, R[kk]);
        dnL.push(curL);
        dnR.push(curR);
      }
      let best = null;
      for (let a = 0; a < upL.length; a++) {
        for (let b = 0; b < dnL.length; b++) {
          const l = Math.max(upL[a], dnL[b]);
          const r = Math.min(upR[a], dnR[b]);
          if (r < l) continue;
          const w = r - l + 1;
          const h = a + b + 1;
          const area = w * h;
          if (!best || area > best.area || (area === best.area && Math.min(w, h) > Math.min(best.w, best.h))) {
            best = { area, w, h, l, r, j0: j - a, j1: j + b };
          }
        }
      }
      if (!best) continue;
      for (let y = best.j0; y <= best.j1; y++) for (let x = best.l; x <= best.r; x++) covered[y * nx + x] = 1;
      rects.push(toRect(g, best.l, best.j0, best.r, best.j1));
    }
  }
  return rects.filter((r) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    return w * h >= minArea && Math.min(w, h) >= minSide;
  });
}

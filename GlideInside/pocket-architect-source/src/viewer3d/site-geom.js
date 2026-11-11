// Pure site geometry for the 3D view: terrain extent and grid, building pad and batter, boundary draping, ribbons, dashes, the
// fade ring and label placement. No three.js and no DOM, so every function here is unit tested. Plan mm in, metres out where noted
// (plan x / 1000 = world X, plan y / 1000 = world Z).

import { terrainAt } from '../site/model.js';

export const PAD_MARGIN_M = 1.0; // level pad beyond the footprint
export const BATTER_RUN = 3; // batter slope 1 vertical to 3 horizontal
export const BATTER_MIN_M = 0.3;
export const MAX_GRID_CELLS = 260; // per side
export const MIN_CELL_MM = 750;
export const RING_OFFSETS_M = [0, 90, 320, 1100];
export const RING_FADE = [0, 0.3, 0.78, 1];

const finite = (v) => Number.isFinite(v);

// A site is drawable whenever the lot has a boundary. The elevation grid and the aerial are optional extras.
export function siteReady(project) {
  const b = project?.site?.lot?.boundary;
  return Array.isArray(b) && b.length >= 3;
}

function boxOf(points, box = null) {
  let b = box;
  for (const p of points) {
    if (!p || !finite(p.x) || !finite(p.y)) continue;
    if (!b) b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    else {
      b.x0 = Math.min(b.x0, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x);
      b.y1 = Math.max(b.y1, p.y);
    }
  }
  return b;
}

/**
 * The rectangle (plan mm) the terrain mesh covers: exactly the aerial extent when there is one, so the picture and the ground end
 * on the same clean edge. Otherwise the elevation grid, the lot and its neighbours with a margin. Always contains the lot boundary.
 */
export function terrainExtent(lot, marginM = 30) {
  if (!lot) return null;
  const margin = marginM * 1000;
  const a = lot.aerial?.extent;
  const boundary = boxOf(lot.boundary || []);
  let ext = null;
  if (a && [a.x0, a.y0, a.x1, a.y1].every(finite) && a.x1 > a.x0 && a.y1 > a.y0) {
    ext = { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 };
  } else {
    let b = boundary ? { ...boundary } : null;
    for (const n of lot.neighbours || []) if (!n.isRoad) b = boxOf(n.ring || [], b);
    if (b) ext = { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin };
    const t = lot.terrain;
    if (t && ext) {
      const g = { x0: t.x0, y0: t.y0, x1: t.x0 + (t.cols - 1) * t.cellMm, y1: t.y0 + (t.rows - 1) * t.cellMm };
      // Use the elevation grid when it already covers the lot with the margin, so no height is invented outside it.
      if (g.x0 <= ext.x0 && g.y0 <= ext.y0 && g.x1 >= ext.x1 && g.y1 >= ext.y1) ext = g;
    }
  }
  if (!ext) return null;
  if (boundary) {
    ext.x0 = Math.min(ext.x0, boundary.x0);
    ext.y0 = Math.min(ext.y0, boundary.y0);
    ext.x1 = Math.max(ext.x1, boundary.x1);
    ext.y1 = Math.max(ext.y1, boundary.y1);
  }
  return ext;
}

/** Grid nodes for an extent: whole cells, the last node lands exactly on the far edge (no ragged or diagonal edge). */
export function gridDims(ext, targetCellMm = MIN_CELL_MM, maxCells = MAX_GRID_CELLS) {
  const w = ext.x1 - ext.x0;
  const h = ext.y1 - ext.y0;
  const cell = Math.max(targetCellMm, Math.max(w, h) / maxCells);
  const nx = Math.max(1, Math.ceil(w / cell));
  const ny = Math.max(1, Math.ceil(h / cell));
  return { cols: nx + 1, rows: ny + 1, dx: w / nx, dy: h / ny, x0: ext.x0, y0: ext.y0 };
}

/** Elevation grid height (metres RL) with the position clamped into the grid, so there is never a hole beyond its edge. */
export function terrainAtClamped(terrain, x, y) {
  if (!terrain) return null;
  const cx = Math.min(Math.max(x, terrain.x0), terrain.x0 + (terrain.cols - 1) * terrain.cellMm);
  const cy = Math.min(Math.max(y, terrain.y0), terrain.y0 + (terrain.rows - 1) * terrain.cellMm);
  return terrainAt(terrain, cx, cy);
}

/** Distance (m) from a plan point to a plan mm bounding box (0 inside). */
export function distToBox(fp, x, y) {
  const dx = Math.max(fp.minX - x, 0, x - fp.maxX) / 1000;
  const dy = Math.max(fp.minY - y, 0, y - fp.maxY) / 1000;
  return Math.hypot(dx, dy);
}

/**
 * Ground height with a level building pad: padY within PAD_MARGIN_M of the footprint, then a constant 1:BATTER_RUN batter up or
 * down to the natural surface `raw`. d is the distance from the footprint in metres.
 */
export function padHeight(raw, padY, d) {
  const out = d - PAD_MARGIN_M;
  if (out <= 0) return padY;
  const delta = raw - padY;
  const run = Math.max(BATTER_MIN_M, Math.abs(delta) * BATTER_RUN);
  if (out >= run) return raw;
  return padY + delta * (out / run);
}

/** Alternate the quad diagonal in a checkerboard so slopes do not show a one directional zig-zag. */
export const diagFlip = (i, j) => ((i + j) & 1) === 1;

/** Triangle indices for a cols x rows grid, counter clockwise seen from above (+Y). */
export function gridIndices(cols, rows) {
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (diagFlip(i, j)) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    }
  }
  return idx;
}

/**
 * Height of the mesh surface itself at a plan point (mm), interpolating the same triangles gridIndices makes. The boundary and
 * the other lines are draped with this, so they sit on the drawn surface and not on the ideal one between its vertices.
 * grid = { cols, rows, x0, y0, dx, dy, heights: ArrayLike<number> } in plan mm and metres.
 */
export function surfaceAt(grid, x, y) {
  const fi = Math.min(Math.max((x - grid.x0) / grid.dx, 0), grid.cols - 1);
  const fj = Math.min(Math.max((y - grid.y0) / grid.dy, 0), grid.rows - 1);
  const i = Math.min(grid.cols - 2, Math.floor(fi));
  const j = Math.min(grid.rows - 2, Math.floor(fj));
  const u = fi - i;
  const v = fj - j;
  const H = (a, b) => grid.heights[b * grid.cols + a];
  const h00 = H(i, j);
  const h10 = H(i + 1, j);
  const h01 = H(i, j + 1);
  const h11 = H(i + 1, j + 1);
  if (diagFlip(i, j)) {
    // triangles (00, 01, 11) and (00, 11, 10), split along the 00 to 11 diagonal
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  // triangles (00, 01, 10) and (10, 01, 11), split along the 10 to 01 diagonal
  return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/**
 * Lay a plan polyline on the ground: resampled every `step` metres, each point [X, Y, Z] metres at surface + lift.
 * `pts` are {x, y} plan mm. closed: the ring also runs from the last point back to the first.
 */
export function drapePolyline(pts, heightAt, { step = 0.5, lift = 0.06, closed = false } = {}) {
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000;
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) {
      const x = a.x + ((b.x - a.x) * s) / k;
      const y = a.y + ((b.y - a.y) * s) / k;
      out.push([x / 1000, heightAt(x, y) + lift, y / 1000]);
    }
  }
  if (!closed && n) {
    const l = pts[n - 1];
    out.push([l.x / 1000, heightAt(l.x, l.y) + lift, l.y / 1000]);
  }
  return out;
}

/**
 * A flat ribbon (positions and indices) along 3D points, `half` metres either side in plan. Faces up from above. The sides are
 * pushed out along the averaged normal of the two neighbouring segments, so corners stay joined.
 */
export function ribbonGeometry(pts, half, closed = false) {
  const n = pts.length;
  const positions = [];
  const indices = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[2] - prev[2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    positions.push(p[0] - dz * half, p[1], p[2] + dx * half, p[0] + dz * half, p[1], p[2] - dx * half);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { positions, indices };
}

/** Split a 3D polyline into dashes (dash and gap lengths in metres). Returns an array of point arrays, each with at least two points. */
export function dashPolyline(pts, dash = 1.6, gap = 1.0, closed = false) {
  const list = closed && pts.length ? [...pts, pts[0]] : pts;
  const out = [];
  let cur = [];
  let on = true;
  let left = dash;
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let t = 0;
    if (on && !cur.length) cur.push(a);
    while (len - t > 1e-9) {
      const take = Math.min(left, len - t);
      t += take;
      left -= take;
      const f = len ? t / len : 1;
      const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      if (on) cur.push(q);
      if (left <= 1e-9) {
        if (on) {
          if (cur.length >= 2) out.push(cur);
          cur = [];
        } else cur = [q];
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
  if (on && cur.length >= 2) out.push(cur);
  return out;
}

/** Edges (pairs of plan points) of the lot's confirmed or suggested street frontage. */
export function frontagePolylines(lot) {
  const ring = lot?.boundary || [];
  const n = ring.length;
  if (n < 2) return [];
  return (lot.frontEdges || []).filter((i) => Number.isInteger(i) && i >= 0 && i < n).map((i) => [ring[i], ring[(i + 1) % n]]);
}

/**
 * The rings around the terrain that fade to the horizon. Each loop is the extent pushed out by an offset (metres); per loop the
 * perimeter nodes of the grid keep their own height at the inner loop so the ring joins the terrain with no crack.
 * Returns { positions, colourT, indices } where colourT is 0 at the terrain edge and 1 at the horizon.
 * `edge` is the perimeter of the terrain grid as [{ x, y, z }] in metres, in order round the rectangle, with `dir` [sx, sz] the outward
 * direction of each node (corners point diagonally).
 */
export function fadeRing(edge, baseY, offsets = RING_OFFSETS_M, fade = RING_FADE) {
  const m = edge.length;
  const positions = [];
  const colourT = [];
  offsets.forEach((off, k) => {
    for (const e of edge) {
      positions.push(e.x + e.dir[0] * off, k === 0 ? e.y : baseY, e.z + e.dir[1] * off);
      colourT.push(fade[k]);
    }
  });
  const indices = [];
  for (let k = 0; k + 1 < offsets.length; k++) {
    for (let i = 0; i < m; i++) {
      const a = k * m + i;
      const b = k * m + ((i + 1) % m);
      const c = (k + 1) * m + i;
      const d = (k + 1) * m + ((i + 1) % m);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, colourT, indices };
}

/** Perimeter nodes of a cols x rows grid, clockwise from the top left corner, with their outward directions. */
export function perimeterNodes(cols, rows) {
  const out = [];
  const add = (i, j, sx, sz) => out.push({ i, j, dir: [sx, sz] });
  for (let i = 0; i < cols - 1; i++) add(i, 0, i === 0 ? -1 : 0, -1);
  for (let j = 0; j < rows - 1; j++) add(cols - 1, j, 1, j === 0 ? -1 : 0);
  for (let i = cols - 1; i > 0; i--) add(i, rows - 1, i === cols - 1 ? 1 : 0, 1);
  for (let j = rows - 1; j > 0; j--) add(0, j, -1, j === rows - 1 ? 1 : 0);
  return out;
}

const centroidOf = (ring) => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = ring.length || 1;
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
};

/**
 * Labels for the 3D view: the lot (lot number, DP, area) and each neighbouring lot with a number (lot number and DP, on separate
 * lines). Plan mm positions. Road parcels get no label.
 */
export function siteLabels(lot) {
  if (!lot?.boundary?.length) return [];
  const out = [];
  const c = centroidOf(lot.boundary);
  const lines = [];
  if (lot.lotNumber) lines.push(`Lot ${lot.lotNumber}`);
  if (lot.planLabel) lines.push(lot.planLabel);
  if (Number.isFinite(lot.areaM2)) lines.push(`${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`);
  if (lines.length) out.push({ kind: 'lot', lines, x: c.x, y: c.y });
  for (const n of lot.neighbours || []) {
    if (n.isRoad || !n.ring?.length || !n.lotNumber) continue;
    const nl = [`Lot ${n.lotNumber}`];
    if (n.planLabel) nl.push(n.planLabel);
    const p = centroidOf(n.ring);
    out.push({ kind: 'neighbour', lines: nl, x: p.x, y: p.y });
  }
  return out;
}

/** Whether a site layer is on (a missing flag means on). */
export const layerOn = (lot, id) => lot?.layers?.[id] !== false;

// Contours from an elevation grid by marching squares. Pure functions, shared by the Worker and the browser.
//
// Grid: { cols, rows, cell, x0, y0, values } with values row major, row 0 at the NORTH edge.
//   Node (i, j) sits at x = x0 + i * cell (east) and y = y0 - j * cell (north), in metres relative to the site origin.

export function gridAt(grid, i, j) {
  return grid.values[j * grid.cols + i];
}

export function gridRange(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// Bilinear height at site coordinates (x east, y north). Returns null outside the grid.
export function sampleGrid(grid, x, y) {
  const fi = (x - grid.x0) / grid.cell;
  const fj = (grid.y0 - y) / grid.cell;
  if (fi < 0 || fj < 0 || fi > grid.cols - 1 || fj > grid.rows - 1) return null;
  const i = Math.min(grid.cols - 2, Math.floor(fi));
  const j = Math.min(grid.rows - 2, Math.floor(fj));
  const tx = fi - i;
  const ty = fj - j;
  const a = gridAt(grid, i, j);
  const b = gridAt(grid, i + 1, j);
  const c = gridAt(grid, i, j + 1);
  const d = gridAt(grid, i + 1, j + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// Contour levels between min and max at a multiple of `interval`.
export function levelsBetween(min, max, interval) {
  const out = [];
  if (!(interval > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return out;
  const first = Math.ceil(min / interval - 1e-9);
  const last = Math.floor(max / interval + 1e-9);
  for (let k = first; k <= last; k++) out.push(Math.round(k * interval * 1000) / 1000 + 0);
  return out;
}

// Points carry the id of the grid edge they lie on, so two cells always agree on a shared point exactly.
const key = (p) => p[2];

// Line segments of one level in one cell, with linear interpolation along the cell edges.
function cellSegments(grid, i, j, level, out) {
  const v00 = gridAt(grid, i, j); // top left (north west)
  const v10 = gridAt(grid, i + 1, j); // top right
  const v11 = gridAt(grid, i + 1, j + 1); // bottom right
  const v01 = gridAt(grid, i, j + 1); // bottom left
  if (![v00, v10, v11, v01].every(Number.isFinite)) return;
  let idx = 0;
  if (v00 >= level) idx |= 1;
  if (v10 >= level) idx |= 2;
  if (v11 >= level) idx |= 4;
  if (v01 >= level) idx |= 8;
  if (idx === 0 || idx === 15) return;
  const x = grid.x0 + i * grid.cell;
  const yT = grid.y0 - j * grid.cell;
  const c = grid.cell;
  const t = (a, b) => (b === a ? 0.5 : (level - a) / (b - a));
  const top = () => [x + t(v00, v10) * c, yT, `h${i},${j}`];
  const right = () => [x + c, yT - t(v10, v11) * c, `v${i + 1},${j}`];
  const bottom = () => [x + t(v01, v11) * c, yT - c, `h${i},${j + 1}`];
  const left = () => [x, yT - t(v00, v01) * c, `v${i},${j}`];
  const seg = (a, b) => out.push([a, b]);
  switch (idx) {
    case 1: case 14: seg(left(), top()); break;
    case 2: case 13: seg(top(), right()); break;
    case 3: case 12: seg(left(), right()); break;
    case 4: case 11: seg(right(), bottom()); break;
    case 6: case 9: seg(top(), bottom()); break;
    case 7: case 8: seg(left(), bottom()); break;
    case 5:
    case 10: {
      // Saddle: decide by the centre value so the lines do not cross.
      const centreHigh = (v00 + v10 + v11 + v01) / 4 >= level;
      if ((idx === 5) === centreHigh) {
        seg(left(), bottom());
        seg(top(), right());
      } else {
        seg(left(), top());
        seg(right(), bottom());
      }
      break;
    }
    default:
  }
}

// Join segments into polylines. Returns [{ points, closed }].
export function chainSegments(segments) {
  const ends = new Map();
  segments.forEach((s, n) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(n);
    }
  });
  const used = new Array(segments.length).fill(false);
  const lines = [];
  const next = (p, from) => {
    for (const n of ends.get(key(p)) || []) if (!used[n] && n !== from) return n;
    return -1;
  };
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let pts = [segments[s][0], segments[s][1]];
    // extend forwards then backwards
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const tail = pts[pts.length - 1];
        const n = next(tail, -1);
        if (n < 0) break;
        used[n] = true;
        const [a, b] = segments[n];
        pts.push(key(a) === key(tail) ? b : a);
      }
      pts = pts.reverse();
    }
    const closed = pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1]);
    lines.push({ points: pts, closed });
  }
  return lines;
}

/**
 * contourLines(grid, { minor = 0.5, major = 2.5 }) -> [{ level, major, closed, points: [[x, y], ...] }]
 * `major` should be a multiple of `minor`; a level is major when it is a multiple of `major`.
 * Contours are generated for every multiple of `minor` (major levels included).
 */
export function contourLines(grid, { minor = 0.5, major = 2.5 } = {}) {
  const { min, max } = gridRange(grid);
  const out = [];
  for (const level of levelsBetween(min, max, minor)) {
    const segs = [];
    // A node exactly on the level would make several segments share one point and split the chains, so nudge the level a hair.
    const probe = level + 1e-7;
    for (let j = 0; j < grid.rows - 1; j++) for (let i = 0; i < grid.cols - 1; i++) cellSegments(grid, i, j, probe, segs);
    const isMajor = major > 0 && Math.abs(level / major - Math.round(level / major)) < 1e-6;
    for (const l of chainSegments(segs)) {
      out.push({ level, major: isMajor, closed: l.closed, points: l.points.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]) });
    }
  }
  return out;
}

// Cell with no data (null or NaN) filled from the nearest valid neighbour, so contours and meshes stay whole.
export function fillGaps(grid) {
  const v = grid.values;
  const bad = (x) => x == null || !Number.isFinite(x);
  if (!v.some(bad)) return grid;
  if (v.every(bad)) throw new Error('The elevation grid has no data');
  const { cols, rows } = grid;
  for (let pass = 0; pass < Math.max(cols, rows); pass++) {
    let any = false;
    const copy = v.slice();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!bad(copy[j * cols + i])) continue;
        const nb = [];
        if (i > 0) nb.push(copy[j * cols + i - 1]);
        if (i < cols - 1) nb.push(copy[j * cols + i + 1]);
        if (j > 0) nb.push(copy[(j - 1) * cols + i]);
        if (j < rows - 1) nb.push(copy[(j + 1) * cols + i]);
        const ok = nb.filter((x) => !bad(x));
        if (ok.length) v[j * cols + i] = ok.reduce((a, b) => a + b, 0) / ok.length;
        else any = true;
      }
    }
    if (!any) break;
  }
  return grid;
}

// ---- Terrace removal -------------------------------------------------------------------------------------------------------------
// Elevation sources are sometimes stored on a step (whole metres, half metres), so a gently falling paddock arrives as flat plateaus
// with a full step between them, which a mesh draws as stair-step terraces. quantStep finds that step, and smoothTerraces rebuilds the
// ground between the step edges: each cell sits between the contour below it and the contour above it, in proportion to its distance
// from each (the same idea as drawing a surface through contour lines), and the result is eased with a small blur so the seams between
// plateaus leave no crease. A grid that is not stepped is returned untouched.

const STEP_CANDIDATES = [5, 2, 1, 0.5, 0.25, 0.2, 0.1];

/** The largest candidate step that nearly all values sit on, or 0 when the grid is not stepped (or has too little relief to tell). */
export function quantStep(values) {
  const vals = [];
  let min = Infinity; let max = -Infinity;
  const stride = Math.max(1, Math.floor(values.length / 20000));
  for (let n = 0; n < values.length; n += stride) {
    const v = values[n];
    if (v == null || !Number.isFinite(v)) continue;
    vals.push(v);
    if (v < min) min = v; if (v > max) max = v;
  }
  if (vals.length < 50) return 0;
  for (const q of STEP_CANDIDATES) {
    if (max - min < 2 * q) continue;
    const tol = Math.min(0.03, q * 0.12);
    let hit = 0;
    for (const v of vals) { const r = v / q; if (Math.abs(r - Math.round(r)) * q <= tol) hit++; }
    if (hit / vals.length >= 0.7) return q;
  }
  return 0;
}

// Distance (in cells) from every cell to the nearest cell of a lower step (dir -1) or a higher step (dir +1), travelling over cells of its
// own step, so every step is done in one sweep whatever the number of steps. Infinity where its plateau touches no such cell.
function stepDistance(idx, cols, rows, dir, out) {
  const D = 1.4142;
  out.fill(Infinity);
  const nb = (n, m, w) => { const a = idx[n]; const c = idx[m]; if (dir < 0 ? c < a : c > a) return w; return c === a ? out[m] + w : Infinity; };
  for (let sweep = 0; sweep < 3; sweep++) {
    let changed = false;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i; let d = out[n];
        if (i > 0) d = Math.min(d, nb(n, n - 1, 1));
        if (j > 0) {
          d = Math.min(d, nb(n, n - cols, 1));
          if (i > 0) d = Math.min(d, nb(n, n - cols - 1, D));
          if (i < cols - 1) d = Math.min(d, nb(n, n - cols + 1, D));
        }
        if (d < out[n]) { out[n] = d; changed = true; }
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = cols - 1; i >= 0; i--) {
        const n = j * cols + i; let d = out[n];
        if (i < cols - 1) d = Math.min(d, nb(n, n + 1, 1));
        if (j < rows - 1) {
          d = Math.min(d, nb(n, n + cols, 1));
          if (i < cols - 1) d = Math.min(d, nb(n, n + cols + 1, D));
          if (i > 0) d = Math.min(d, nb(n, n + cols - 1, D));
        }
        if (d < out[n]) { out[n] = d; changed = true; }
      }
    }
    if (!changed) break;
  }
}

function boxBlur(a, cols, rows, r, tmp) {
  const w = 2 * r + 1;
  for (let j = 0; j < rows; j++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[j * cols + Math.min(cols - 1, Math.max(0, k))];
    for (let i = 0; i < cols; i++) {
      tmp[j * cols + i] = s / w;
      s += a[j * cols + Math.min(cols - 1, i + r + 1)] - a[j * cols + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < cols; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(rows - 1, Math.max(0, k)) * cols + i];
    for (let j = 0; j < rows; j++) {
      a[j * cols + i] = s / w;
      s += tmp[Math.min(rows - 1, j + r + 1) * cols + i] - tmp[Math.max(0, j - r) * cols + i];
    }
  }
}

/** Values (same layout as grid.values) with the terraces removed; the input array is returned unchanged when it is not stepped. */
export function smoothTerraces(grid) {
  const { cols, rows, values } = grid;
  const q = quantStep(values);
  if (!q || cols < 4 || rows < 4) return values;
  const N = cols * rows;
  const idx = new Int32Array(N);
  let kmin = Infinity; let kmax = -Infinity;
  for (let n = 0; n < N; n++) { const k = Math.round(values[n] / q); idx[n] = k; if (k < kmin) kmin = k; if (k > kmax) kmax = k; }
  if (kmax - kmin > 400) return values;
  const out = new Float64Array(N);
  const dLo = new Float64Array(N); const dHi = new Float64Array(N);
  stepDistance(idx, cols, rows, -1, dLo);
  stepDistance(idx, cols, rows, 1, dHi);
  const widths = [];
  for (let n = 0; n < N; n++) {
    let a = dLo[n]; let b = dHi[n];
    if (a === Infinity && b === Infinity) { out[n] = idx[n] * q; continue; }
    // a missing side is taken as far off, so the plateau meets its one neighbour without a jump and tends to its own level inland
    if (a === Infinity) a = b + 20; else if (b === Infinity) b = a + 20;
    out[n] = (idx[n] - 0.5 + a / (a + b)) * q;
    if (a < 60 && b < 60 && widths.length < 20000) widths.push(a + b);
  }
  widths.sort((x, y) => x - y);
  const med = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
  const r = Math.max(1, Math.min(10, Math.round(med * 0.3)));
  const tmp = new Float64Array(N);
  for (let p = 0; p < 3; p++) boxBlur(out, cols, rows, r, tmp);
  return Array.from(out, (v) => Math.round(v * 1000) / 1000);
}

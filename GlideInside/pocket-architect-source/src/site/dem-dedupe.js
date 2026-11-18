// Collapse duplicated raster rows and columns. The NSW 5 m DEM is served in web mercator at 5 web unit pixels, which at the latitude of NSW
// is narrower than the 5 m ground cell, so nearest neighbour repeats one source row or column every few pixels. Left alone, those repeats are
// flat strips across a slope (terraces). Each run of identical rows or columns becomes one sample at the centre of the run.

const EPS = 1e-4;
const MAX_DUP_FRACTION = 0.4; // periodic repeats are roughly one in six; a raster that is mostly "duplicates" is genuinely flat, so leave it alone

function isValid(v, nodata) {
  return Number.isFinite(v) && v > -500 && (nodata == null || v !== nodata);
}

// Which lines (rows when byRow, otherwise columns) repeat the previous line: at least 90 percent of the valid cells equal.
function duplicateFlags(r, nodata, byRow) {
  const { width, height, data } = r;
  const n = byRow ? height : width;
  const m = byRow ? width : height;
  const dup = new Array(n).fill(false);
  for (let k = 1; k < n; k++) {
    let valid = 0;
    let same = 0;
    for (let t = 0; t < m; t++) {
      const a = byRow ? data[k * width + t] : data[t * width + k];
      const b = byRow ? data[(k - 1) * width + t] : data[t * width + k - 1];
      if (isValid(a, nodata) && isValid(b, nodata)) {
        valid++;
        if (Math.abs(a - b) < EPS) same++;
      }
    }
    dup[k] = valid > 0 && same >= 0.9 * valid;
  }
  return dup;
}

// Runs of identical lines -> centre positions (mean original index of each run).
function runsFrom(dup) {
  const centres = [];
  const starts = [];
  let s = 0;
  for (let k = 1; k <= dup.length; k++) {
    if (k === dup.length || !dup[k]) {
      centres.push((s + k - 1) / 2);
      starts.push(s);
      s = k;
    }
  }
  return { centres, starts };
}

// Returns { width, height, data, xs, ys, changed }. xs[i] / ys[j] are the original pixel positions of reduced column i / row j.
export function dedupeRaster(r, nodata = null) {
  const { width, height, data } = r;
  const identity = (n) => Array.from({ length: n }, (_, i) => i);
  let rowDup = duplicateFlags(r, nodata, true);
  let colDup = duplicateFlags(r, nodata, false);
  if (rowDup.filter(Boolean).length > MAX_DUP_FRACTION * height) rowDup = new Array(height).fill(false);
  if (colDup.filter(Boolean).length > MAX_DUP_FRACTION * width) colDup = new Array(width).fill(false);
  if (!rowDup.includes(true) && !colDup.includes(true)) return { width, height, data, xs: identity(width), ys: identity(height), changed: false };
  const rr = runsFrom(rowDup);
  const cc = runsFrom(colDup);
  const w = cc.starts.length;
  const h = rr.starts.length;
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // the run's first line carries the values (the lines in a run are equal to within tolerance)
      out[j * w + i] = data[rr.starts[j] * width + cc.starts[i]];
    }
  }
  return { width: w, height: h, data: out, xs: cc.centres, ys: rr.centres, changed: true };
}

// Fractional original pixel position f -> fractional index in the reduced raster, piecewise linear between run centres.
export function reducedIndex(centres, f) {
  const n = centres.length;
  if (n === 1) return 0;
  if (f <= centres[0]) return f - centres[0];
  if (f >= centres[n - 1]) return n - 1 + (f - centres[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (centres[mid] <= f) lo = mid;
    else hi = mid;
  }
  return lo + (f - centres[lo]) / (centres[hi] - centres[lo]);
}

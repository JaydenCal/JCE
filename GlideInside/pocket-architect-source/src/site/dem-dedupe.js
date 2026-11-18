// Repair the periodic duplicate cells in the NSW 5 m DEM. The service is read in web mercator at 5 web units per pixel, which at the latitude of NSW
// is narrower than the 5 m ground cell, so nearest neighbour repeats one source cell about every 5/(5-g) pixels (g = 5 cos(lat) metres per pixel).
// The source grid is also rotated against web mercator (grid convergence), so the repeats follow slanted lines and whole rows or columns are never equal.
// Left alone, each repeat is a flat pair across a slope (terraces in 3D).
//
// Per pixel run detection along each axis, with no whole line voting:
//   - a run of 2 or 3 equal consecutive pixels is one source cell, so it becomes one sample at the run centre;
//   - a run longer than MAX_RUN pixels is genuinely flat ground (or a water body) and is left as it is;
//   - each line is rebuilt as a piecewise linear function through those samples, evaluated back at the pixel centres.
// The x pass runs on the raster, then the y pass runs on the x corrected raster using the runs detected on the original raster (the x pass moves
// values on slanted repeats, so the vertical equality is only reliable in the original). The result has the same size and layout as the input.

const EPS = 1e-4;
const MAX_RUN = 3; // runs longer than this are real flat ground
const MAX_SHORT_FRACTION = 0.5; // if most pixels sit in short runs the axis is not a periodic repeat; leave it

function isValid(v, nodata) {
  return Number.isFinite(v) && v > -500 && (nodata == null || v !== nodata);
}

// One line. det = values used to find the runs, vals = values carried (the same array for a first pass). Invalid cells are null / non finite
// and stay as they are. Returns { out, changed, short } where short counts the pixels that sat in runs of 2..MAX_RUN.
export function reconstructLine(det, vals = det, nodata = null) {
  const n = det.length;
  const out = Array.from(vals);
  let changed = false;
  let short = 0;
  let valid = 0;
  let k = 0;
  while (k < n) {
    if (!isValid(det[k], nodata) || !isValid(vals[k], nodata)) { k++; continue; }
    let e = k;
    while (e + 1 < n && isValid(det[e + 1], nodata) && isValid(vals[e + 1], nodata)) e++;
    // valid segment k..e: samples (position, value)
    const px = [];
    const pv = [];
    let s = k;
    while (s <= e) {
      let t = s;
      while (t + 1 <= e && Math.abs(det[t + 1] - det[s]) < EPS) t++;
      const len = t - s + 1;
      if (len >= 2 && len <= MAX_RUN) {
        let sum = 0;
        for (let q = s; q <= t; q++) sum += vals[q];
        px.push((s + t) / 2);
        pv.push(sum / len);
        short += len;
      } else {
        for (let q = s; q <= t; q++) { px.push(q); pv.push(vals[q]); }
      }
      s = t + 1;
    }
    valid += e - k + 1;
    let m = 0;
    for (let q = k; q <= e; q++) {
      while (m + 1 < px.length && px[m + 1] <= q) m++;
      let z;
      if (q <= px[0]) z = pv[0];
      else if (m >= px.length - 1) z = pv[px.length - 1];
      else z = pv[m] + (pv[m + 1] - pv[m]) * ((q - px[m]) / (px[m + 1] - px[m]));
      if (Math.abs(z - out[q]) > 1e-9) changed = true;
      out[q] = z;
    }
    k = e + 1;
  }
  return { out, changed, short, valid };
}

// Whole raster. Returns { width, height, data, changed }; data is the input array itself when nothing changed.
export function dedupeRaster(r, nodata = null) {
  const { width, height, data } = r;
  const a = new Float32Array(data);
  // x pass (rows)
  let shortX = 0; let validX = 0;
  const rowsOut = [];
  for (let j = 0; j < height; j++) {
    const row = Array.from(data.subarray(j * width, (j + 1) * width));
    const res = reconstructLine(row, row, nodata);
    shortX += res.short; validX += res.valid;
    rowsOut.push(res);
  }
  const doX = validX > 0 && shortX > 0 && shortX <= MAX_SHORT_FRACTION * validX;
  if (doX) rowsOut.forEach((res, j) => { for (let i = 0; i < width; i++) a[j * width + i] = res.out[i]; });
  // y pass (columns): runs from the original raster, values from the x corrected one
  let shortY = 0; let validY = 0;
  const colsOut = [];
  for (let i = 0; i < width; i++) {
    const det = new Array(height);
    const vals = new Array(height);
    for (let j = 0; j < height; j++) { det[j] = data[j * width + i]; vals[j] = a[j * width + i]; }
    const res = reconstructLine(det, vals, nodata);
    shortY += res.short; validY += res.valid;
    colsOut.push(res);
  }
  const doY = validY > 0 && shortY > 0 && shortY <= MAX_SHORT_FRACTION * validY;
  if (doY) colsOut.forEach((res, i) => { for (let j = 0; j < height; j++) a[j * width + i] = res.out[j]; });
  if (!doX && !doY) return { width, height, data, changed: false };
  return { width, height, data: a, changed: true };
}

// Builds a tiny polygon shapefile (.shp, .dbf, .prj) in memory for the reader tests. Rings are arrays of [x, y]; outer rings must run clockwise.
export function buildShp(records) {
  const parts = records.map((rec) => {
    const rings = rec.rings;
    const nPts = rings.reduce((s, r) => s + r.length, 0);
    const contentLen = 44 + 4 * rings.length + 16 * nPts;
    const buf = new ArrayBuffer(8 + contentLen);
    const dv = new DataView(buf);
    dv.setInt32(0, rec.n, false);
    dv.setInt32(4, contentLen / 2, false);
    dv.setInt32(8, 5, true);
    const all = rings.flat();
    dv.setFloat64(12, Math.min(...all.map((p) => p[0])), true); dv.setFloat64(20, Math.min(...all.map((p) => p[1])), true);
    dv.setFloat64(28, Math.max(...all.map((p) => p[0])), true); dv.setFloat64(36, Math.max(...all.map((p) => p[1])), true);
    dv.setInt32(44, rings.length, true);
    dv.setInt32(48, nPts, true);
    let k = 0;
    rings.forEach((r, i) => { dv.setInt32(52 + 4 * i, k, true); k += r.length; });
    let o = 52 + 4 * rings.length;
    for (const p of all) { dv.setFloat64(o, p[0], true); dv.setFloat64(o + 8, p[1], true); o += 16; }
    return new Uint8Array(buf);
  });
  const total = 100 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, total / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, 5, true);
  let o = 100;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function buildDbf(rows, field = 'NAME', len = 20) {
  const hdr = 32 + 32 + 1;
  const recLen = 1 + len;
  const out = new Uint8Array(hdr + rows.length * recLen + 1);
  const dv = new DataView(out.buffer);
  out[0] = 3;
  dv.setUint32(4, rows.length, true);
  dv.setUint16(8, hdr, true);
  dv.setUint16(10, recLen, true);
  [...field].forEach((c, i) => { out[32 + i] = c.charCodeAt(0); });
  out[32 + 11] = 'C'.charCodeAt(0);
  out[32 + 16] = len;
  out[64] = 0x0d;
  rows.forEach((r, i) => { const b = hdr + i * recLen; out[b] = 0x20; [...String(r).padEnd(len)].forEach((c, k) => { out[b + 1 + k] = c.charCodeAt(0); }); });
  return out;
}

export const MGA56_WKT = 'PROJCS["GDA2020 / MGA zone 56",GEOGCS["GDA2020",DATUM["GDA2020",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",153],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]';
export const WGS84_WKT = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';

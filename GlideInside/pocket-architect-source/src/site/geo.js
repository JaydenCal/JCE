// Site geometry helpers shared by the browser and the Worker. Pure functions, no DOM access, no dependencies.
//
// Conventions
//   - MGA2020 (GDA2020 / MGA zone 54, 55, 56; EPSG 7854, 7855, 7856) is a transverse Mercator grid in metres.
//     Easting grows to the east, northing grows to the north.
//   - "Site coordinates" are [east, north] in metres relative to a site origin (an MGA point, normally the lot centroid).
//   - Plan coordinates (Plan Studio) are millimetres with y growing DOWN the screen, so MGA northing maps to -y.
//     Grid north is up the screen, so site.northDeg is 0.

export const MGA_ZONES = [54, 55, 56];

// Longitude of the central meridian of an MGA zone (degrees east).
export const centralMeridian = (zone) => 6 * zone - 183;

// MGA zone for a longitude. Zone 54 covers 138 to 144 E, 55 covers 144 to 150 E and 56 covers 150 to 156 E.
export function mgaZoneForLon(lon) {
  if (!Number.isFinite(lon) || lon < 138 || lon >= 156) throw new RangeError(`Longitude ${lon} is outside MGA zones 54 to 56`);
  return lon < 144 ? 54 : lon < 150 ? 55 : 56;
}

// EPSG code for GDA2020 / MGA zone N.
export const mgaSrid = (zone) => 7800 + zone;
export const zoneForSrid = (srid) => (srid >= 7854 && srid <= 7856 ? srid - 7800 : srid >= 28354 && srid <= 28356 ? srid - 28300 : null);

// GRS80 transverse Mercator (Kruger series, accurate to well under a millimetre inside a zone).
const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const FE = 500000;
const FN = 10000000;
const N3 = F / (2 - F);
const AA = (A / (1 + N3)) * (1 + (N3 * N3) / 4 + (N3 ** 4) / 64);
const ALPHA = [
  N3 / 2 - (2 / 3) * N3 ** 2 + (5 / 16) * N3 ** 3,
  (13 / 48) * N3 ** 2 - (3 / 5) * N3 ** 3,
  (61 / 240) * N3 ** 3,
];
const BETA = [
  N3 / 2 - (2 / 3) * N3 ** 2 + (37 / 96) * N3 ** 3,
  (1 / 48) * N3 ** 2 + (1 / 15) * N3 ** 3,
  (17 / 480) * N3 ** 3,
];
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

export function lonLatToMga(lon, lat, zone = mgaZoneForLon(lon)) {
  const phi = lat * RAD;
  const lam = (lon - centralMeridian(zone)) * RAD;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - E * Math.atanh(E * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  for (let j = 1; j <= 3; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { e: FE + K0 * AA * x, n: FN + K0 * AA * y, zone };
}

export function mgaToLonLat(e, n, zone) {
  const xi = (n - FN) / (K0 * AA);
  const eta = (e - FE) / (K0 * AA);
  let xi0 = xi;
  let eta0 = eta;
  for (let j = 1; j <= 3; j++) {
    xi0 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta0 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  // Conformal latitude to geodetic latitude by fixed point iteration.
  let phi = chi;
  for (let k = 0; k < 8; k++) {
    phi = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + E * Math.atanh(E * Math.sin(phi))));
  }
  const lam = Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return { lon: centralMeridian(zone) + lam / RAD, lat: phi / RAD };
}

// Spherical web mercator (EPSG 3857 / 102100), used only to talk to services whose native grid it is.
const R_WEB = 6378137;
export const lonLatToWeb = (lon, lat) => ({ x: R_WEB * lon * RAD, y: R_WEB * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) });
export const webToLonLat = (x, y) => ({ lon: (x / R_WEB) / RAD, lat: (2 * Math.atan(Math.exp(y / R_WEB)) - Math.PI / 2) / RAD });
export const mgaToWeb = (e, n, zone) => {
  const g = mgaToLonLat(e, n, zone);
  return lonLatToWeb(g.lon, g.lat);
};
export const webToMga = (x, y, zone) => {
  const g = webToLonLat(x, y);
  return lonLatToMga(g.lon, g.lat, zone);
};

// Axis aligned box of an MGA rectangle expressed in web mercator (covers the rotated shape).
export function mgaBoxToWebBox(box, zone) {
  const pts = [
    mgaToWeb(box.minE, box.minN, zone), mgaToWeb(box.maxE, box.minN, zone),
    mgaToWeb(box.minE, box.maxN, zone), mgaToWeb(box.maxE, box.maxN, zone),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  };
}

// Plan mapping ---------------------------------------------------------------------------------------------------------
// Site coordinates [dx east, dn north] in metres to plan millimetres. Northing maps to -y (y grows down the screen).
export const siteToPlan = (p) => ({ x: Math.round(p[0] * 1000 * 10) / 10, y: Math.round(-p[1] * 1000 * 10) / 10 });
export const planToSite = (p) => [p.x / 1000, -p.y / 1000];
export const mgaToPlan = (origin, e, n) => siteToPlan([e - origin.e, n - origin.n]);
export const planToMga = (origin, p) => ({ e: origin.e + p.x / 1000, n: origin.n - p.y / 1000 });

// Polygon helpers (rings are arrays of [x, y]; a closing duplicate point is tolerated) -----------------------------------
export function openRing(ring) {
  const r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

// Signed area, positive for counter clockwise (y up). Esri outer rings are clockwise, so they come out negative.
export function signedArea(ring) {
  const r = openRing(ring);
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const ringArea = (ring) => Math.abs(signedArea(ring));

export function ringCentroid(ring) {
  const r = openRing(ring);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const bb = bboxOf(r);
    return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bboxOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function pointInRing(pt, ring) {
  const r = openRing(ring);
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0];
    const yi = r[i][1];
    const xj = r[j][0];
    const yj = r[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToRing(p, ring) {
  const r = openRing(ring);
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, distToSegment(p, r[i], r[(i + 1) % r.length]));
  return d;
}

// A point well inside a polygon (approximate pole of inaccessibility). Holes are respected when given.
export function interiorPoint(outer, holes = []) {
  const inside = (p) => pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
  const dist = (p) => Math.min(distToRing(p, outer), ...holes.map((h) => distToRing(p, h)));
  const bb = bboxOf(outer);
  let best = null;
  let bestD = -1;
  const cen = ringCentroid(outer);
  if (inside(cen)) {
    best = cen;
    bestD = dist(cen);
  }
  let w = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  let cx = (bb.minX + bb.maxX) / 2;
  let cy = (bb.minY + bb.maxY) / 2;
  for (let pass = 0; pass < 3; pass++) {
    const n = 16;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = [cx - w / 2 + (w * i) / n, cy - w / 2 + (w * j) / n];
        if (!inside(p)) continue;
        const d = dist(p);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    if (!best) break;
    cx = best[0];
    cy = best[1];
    w /= 4;
  }
  return best || cen;
}

// Esri ring list to polygons. Clockwise rings are outer rings, counter clockwise rings are holes of the outer ring containing them.
export function ringsToPolygons(rings = []) {
  const polys = [];
  const holes = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    (signedArea(ring) <= 0 ? polys : holes).push(ring.length && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);
  }
  const out = polys.map((outer) => ({ outer, holes: [] }));
  for (const h of holes) {
    const pt = h[0];
    const host = out.find((p) => pointInRing(pt, p.outer));
    if (host) host.holes.push(h);
  }
  if (!out.length && holes.length) out.push({ outer: holes[0], holes: [] });
  return out;
}

export const polygonArea = (poly) => ringArea(poly.outer) - poly.holes.reduce((s, h) => s + ringArea(h), 0);

// Edge lengths of a ring in metres (the closing edge included), with midpoints for labels.
export function ringEdges(ring) {
  const r = openRing(ring);
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length];
    return { a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  });
}

// Bearing in degrees clockwise from grid north.
export const bearingDeg = (a, b) => (((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI) + 360) % 360;

// Plan labels such as "DP1234", "DP 1234" or "RP12345" to "DP 1234".
export function formatPlan(label) {
  const s = String(label ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z]+)\s?(\d+[A-Z]?)$/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s;
}

export const round = (v, dp = 3) => {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
};

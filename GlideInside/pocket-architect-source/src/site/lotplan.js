// Lot planning geometry: the mechanics a builder uses to sit a house on a lot. Pure functions, no DOM, Node compatible.
//
//   boundaryDims(lot)            bearing and length of every boundary edge (survey style 123°45'30" and metres)
//   roadReserve(lot)             footpath, kerb, gutter, carriageway and the road centreline in front of the street edges
//   garageDoor(project)          where the garage door is and which way it faces
//   deriveDriveway(project)      constant width driveway from the garage door to the kerb (curves when it has to) and its crossover
//   clearances(project)          distance from the house to every boundary against the setback required, with the source
//   faceGarageAngle(project)     degrees to turn the house so the garage door faces the street frontage
//
// Everything is derived from the project as it stands, so the driveway and the clearances follow the house when it is
// moved, rotated or mirrored. Mirroring the house never touches the lot: the lot is not part of the design geometry.
// Units: plan millimetres (x right, y down, plan up is MGA grid north). Distances reported in metres. Nothing here invents
// a setback: with no setbacks loaded the clearances are measured and their status is 'unknown'.

import * as G from '../model/geometry.js';
import { classifyEdges, requiredFor, setbackNotes, lotOf } from '../model/placement.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const TOL_M = 0.005;

// Bearings -----------------------------------------------------------------------------------------------------------
/** Grid bearing in degrees (0 to 360, clockwise from grid north) of a to b. Plan up is grid north, so north is -y. */
export function bearingDeg(a, b) {
  return (((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI) + 360) % 360;
}

/** 91.5 becomes 91°30'00". Seconds are rounded and carried, so 359.99999 reads 0°00'00". */
export function formatBearing(deg) {
  let total = Math.round((((deg % 360) + 360) % 360) * 3600);
  if (total >= 1296000) total -= 1296000;
  const d = Math.floor(total / 3600);
  const mi = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}°${String(mi).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}

/** Distance label in metres to two decimals. */
export const formatLength = (mm) => (mm / 1000).toFixed(2);

/** [{ index, a, b, bearingDeg, bearing, lengthMm, lengthM, length, label }] for every boundary edge, travelling a to b. */
export function boundaryDims(lot) {
  const b = lot?.boundary;
  if (!Array.isArray(b) || b.length < 2) return [];
  return b.map((p, i) => {
    const q = b[(i + 1) % b.length];
    const lengthMm = G.dist(p, q);
    const deg = bearingDeg(p, q);
    return {
      index: i, a: p, b: q, mid: G.lerp(p, q, 0.5), bearingDeg: deg, bearing: formatBearing(deg),
      lengthMm, lengthM: lengthMm / 1000, length: formatLength(lengthMm), label: `${formatBearing(deg)}  ${formatLength(lengthMm)}`,
    };
  });
}

// Lot geometry helpers -------------------------------------------------------------------------------------------------
/** Inward unit normal of boundary edge i (y down). */
export function inwardNormalOf(lot, i) {
  const b = lot.boundary;
  const a = b[i];
  const c = b[(i + 1) % b.length];
  const d = G.norm(G.sub(c, a));
  const n = { x: -d.y, y: d.x };
  return G.signedArea(b) > 0 ? n : { x: -n.x, y: -n.y };
}

const pointsOf = (arr) => {
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) out.push({ x: arr[i], y: arr[i + 1] });
  return out;
};

function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, G.projectToSegment(p, pts[i], pts[i + 1]).d);
  return best;
}

// Road reserve ---------------------------------------------------------------------------------------------------------
/** Typical metres from the property line. Indicative: the council's standard for the street governs. */
export const ROAD_DEFAULTS = Object.freeze({ vergeM: 4.0, footpathNearM: 0.85, footpathFarM: 2.35, gutterM: 0.45, carriagewayM: 9.0, extendM: 30 });

/**
 * The road in front of each street edge of the lot, as straight lines parallel to that edge:
 * [{ edge, kind, vergeM, source: 'roads'|'default', outward, lines: { property, footpathNear, footpathFar, kerb, gutter, farGutter, farKerb, centreline } }].
 * Each line is [a, b] in plan mm, extended past the edge ends. The kerb is `vergeM` from the property line. When the lot carries road
 * centrelines (NSW) and one runs within 30 m of the edge, the verge is adjusted so the drawn centreline matches that distance.
 */
export function roadReserve(lot, opts = {}) {
  if (!lot?.boundary || lot.boundary.length < 3) return [];
  const o = { ...ROAD_DEFAULTS, ...opts };
  const out = [];
  for (const e of classifyEdges(lot)) {
    if (e.kind !== 'front' && e.kind !== 'secondaryFront') continue;
    const u = G.norm(G.sub(e.b, e.a));
    const inward = inwardNormalOf(lot, e.index);
    const outward = { x: -inward.x, y: -inward.y };
    let vergeM = o.vergeM;
    let source = 'default';
    const mid = G.lerp(e.a, e.b, 0.5);
    const half = o.carriagewayM / 2;
    for (const r of lot.roads || []) {
      const pts = pointsOf(r.pts || []);
      if (pts.length < 2) continue;
      const d = distToPolyline(mid, pts) / 1000;
      // The centreline sits on the road side of the front edge, so it must be on the outward side and not too far.
      const nearest = pts.reduce((best, p) => (G.dist(p, mid) < G.dist(best, mid) ? p : best), pts[0]);
      if (G.dot(G.sub(nearest, mid), outward) <= 0) continue;
      if (d >= o.gutterM + half + 2.5 && d <= 25) {
        vergeM = Math.min(8, Math.max(2.5, d - o.gutterM - half));
        source = 'roads';
        break;
      }
    }
    const ext = o.extendM * 1000;
    const line = (offsetM, extend = ext) => {
      const t = offsetM * 1000;
      const a = G.add(G.sub(e.a, G.mul(u, extend)), G.mul(outward, t));
      const b = G.add(G.add(e.b, G.mul(u, extend)), G.mul(outward, t));
      return [a, b];
    };
    out.push({
      edge: e.index, kind: e.kind, vergeM, source, outward, u,
      lines: {
        property: [e.a, e.b],
        footpathNear: line(o.footpathNearM),
        footpathFar: line(o.footpathNearM + (o.footpathFarM - o.footpathNearM)),
        kerb: line(vergeM),
        gutter: line(vergeM + o.gutterM),
        farGutter: line(vergeM + o.gutterM + o.carriagewayM),
        farKerb: line(vergeM + 2 * o.gutterM + o.carriagewayM),
        centreline: line(vergeM + o.gutterM + half),
      },
      carriagewayM: o.carriagewayM, gutterM: o.gutterM,
    });
  }
  return out;
}

// The house ------------------------------------------------------------------------------------------------------------
const groundLevel = (project) => [...(project?.levels || [])].sort((a, b) => a.elevation - b.elevation)[0] || null;

/** Closed rings (plan mm) of the building: indoor and roofed rooms and exterior wall bodies, every level, demolished parts excluded. */
export function buildingRings(project) {
  const rings = [];
  for (const level of project?.levels || []) {
    for (const r of level.rooms || []) {
      if (r.status === 'demolish' || (r.outdoor && !r.roofed) || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      rings.push(r.polygon.map((p) => ({ x: p.x, y: p.y })));
    }
    for (const w of level.walls || []) {
      if (w.kind !== 'exterior' || w.status === 'demolish') continue;
      rings.push(G.wallPolygon(w));
    }
  }
  return rings;
}

/** Convex hull (plan mm) of the building, or [] when nothing is built. */
export function buildingHull(project) {
  const pts = buildingRings(project).flat();
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smallest rectangle (any rotation) round a convex hull: { corners[4], centre, w, d, angleDeg }. */
export function orientedBox(hull) {
  if (!hull || hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const u = G.norm(G.sub(b, a));
    const v = { x: -u.y, y: u.x };
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const p of hull) {
      const du = G.dot(G.sub(p, a), u);
      const dv = G.dot(G.sub(p, a), v);
      u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) {
      const at = (du, dv) => G.add(a, G.add(G.mul(u, du), G.mul(v, dv)));
      best = { area, u, v, w: u1 - u0, d: v1 - v0, corners: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], centre: at((u0 + u1) / 2, (v0 + v1) / 2), angleDeg: (Math.atan2(u.y, u.x) * 180) / Math.PI };
    }
  }
  return best;
}

/**
 * The garage door of the ground level: { mid, normal (unit, pointing out of the house), widthMm, wallId, openingId, kind }.
 * garage_door openings come first, then roller_door (sheds). Needs the door on an exterior wall. Null when there is none.
 */
export function garageDoor(project) {
  const lvl = groundLevel(project);
  if (!lvl) return null;
  const rank = { garage_door: 0, roller_door: 1 };
  const doors = (lvl.openings || []).filter((o) => o.kind in rank).sort((a, b) => rank[a.kind] - rank[b.kind]);
  const hull = buildingHull(project);
  const centroid = hull.length ? G.polygonCentroid(hull) : { x: 0, y: 0 };
  for (const o of doors) {
    const w = (lvl.walls || []).find((x) => x.id === o.wallId);
    if (!w || G.wallLength(w) < 1) continue;
    const mid = G.pointOnWall(w, o.offset);
    const n = G.wallNormal(w);
    let out;
    if (w.outside === 1) out = n;
    else if (w.outside === -1) out = { x: -n.x, y: -n.y };
    else out = G.dot(n, G.sub(mid, centroid)) >= 0 ? n : { x: -n.x, y: -n.y };
    return { mid, normal: G.norm(out), widthMm: o.width, wallId: w.id, openingId: o.id, kind: o.kind };
  }
  return null;
}

// Driveway ---------------------------------------------------------------------------------------------------------------
const bez = (P, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x,
    y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y,
  };
};
const bezTan = (P, t) => {
  const u = 1 - t;
  const d = {
    x: 3 * u * u * (P[1].x - P[0].x) + 6 * u * t * (P[2].x - P[1].x) + 3 * t * t * (P[3].x - P[2].x),
    y: 3 * u * u * (P[1].y - P[0].y) + 6 * u * t * (P[2].y - P[1].y) + 3 * t * t * (P[3].y - P[2].y),
  };
  return G.norm(d);
};

/** Radius of the circle through three points (mm), Infinity when they are collinear. */
export function circumradius(a, b, c) {
  const ab = G.dist(a, b);
  const bc = G.dist(b, c);
  const ca = G.dist(c, a);
  const area = Math.abs(G.cross(G.sub(b, a), G.sub(c, a))) / 2;
  return area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
}

/**
 * The driveway from the garage door to the kerb. Constant width (the door width within 3.0 and 6.5 m), leaves the door square, follows
 * a smooth curve when the house is turned or offset from the street, and meets the kerb square. Also returns the crossover (the part
 * between the property line and the kerb). Returns null with no lot or no garage door; { ok: false, reason } when the door cannot face a street.
 *   { ok, widthMm, centre[], left[], right[], polygon[], lengthMm, minRadiusM, doorMid, kerbPoint, edge, crossover: { polygon, from, to, widthMm, flareMm } }
 */
export function deriveDriveway(project, opts = {}) {
  const lot = lotOf(project);
  if (!lot) return null;
  const door = garageDoor(project);
  if (!door) return null;
  const reserves = roadReserve(lot);
  if (!reserves.length) return { ok: false, reason: 'no_street', door };
  // The street edge the door faces best; primary frontage wins a tie.
  let best = null;
  for (const r of reserves) {
    const score = G.dot(door.normal, r.outward) + (r.kind === 'front' ? 0.001 : 0);
    if (!best || score > best.score) best = { r, score };
  }
  if (best.score < 0.2) return { ok: false, reason: 'door_faces_away', door };
  const r = best.r;
  const wd = Math.min(6500, Math.max(3000, opts.widthMm || door.widthMm || 3000));
  const edgeA = lot.boundary[r.edge];
  const edgeB = lot.boundary[(r.edge + 1) % lot.boundary.length];
  const edgeLen = G.dist(edgeA, edgeB);
  const u = r.u;
  // Where it meets the kerb: straight out from the door along the street normal, kept clear of the corners of the frontage.
  const along = G.dot(G.sub(door.mid, edgeA), u);
  const lo = Math.min(wd / 2 + 500, edgeLen / 2);
  const hi = Math.max(edgeLen - wd / 2 - 500, edgeLen / 2);
  const t = G.clamp(along, lo, hi);
  const onKerb = (s) => G.add(G.add(edgeA, G.mul(r.outward, r.vergeM * 1000)), G.mul(u, s));
  const P3 = onKerb(t);
  const P0 = door.mid;
  const D = G.dist(P0, P3);
  const L1 = Math.max(wd * 0.9, D * 0.42);
  const P1 = G.add(P0, G.mul(door.normal, L1));
  const P2 = G.add(P3, G.mul(r.outward, -Math.max(wd * 0.9, D * 0.42)));
  const P = [P0, P1, P2, P3];
  const N = 48;
  const centre = [];
  const left = [];
  const right = [];
  let length = 0;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const c = bez(P, s);
    const tan = bezTan(P, s);
    const nl = { x: -tan.y, y: tan.x };
    if (i) length += G.dist(c, centre[i - 1]);
    centre.push(c);
    left.push(G.add(c, G.mul(nl, wd / 2)));
    right.push(G.add(c, G.mul(nl, -wd / 2)));
  }
  let rmin = Infinity;
  for (let i = 1; i < centre.length - 1; i++) rmin = Math.min(rmin, circumradius(centre[i - 1], centre[i], centre[i + 1]));
  const polygon = [...left, ...right.slice().reverse()];

  // Crossover: from where the centreline passes the property line to the kerb, with a 0.5 m splay at the kerb.
  const prop = r.lines.property;
  const side = (p) => G.dot(G.sub(p, prop[0]), r.outward);
  let k0 = centre.findIndex((p) => side(p) >= 0);
  if (k0 < 0) k0 = centre.length - 1;
  if (k0 > 0) k0 -= 1;
  const flare = 500;
  const lc = left.slice(k0);
  const rc = right.slice(k0);
  const lEnd = G.add(lc.at(-1), G.mul(u, G.dot(G.sub(lc.at(-1), rc.at(-1)), u) >= 0 ? flare : -flare));
  const rEnd = G.add(rc.at(-1), G.mul(u, G.dot(G.sub(rc.at(-1), lc.at(-1)), u) >= 0 ? flare : -flare));
  const crossover = { polygon: [...lc, lEnd, rEnd, ...rc.slice().reverse()], from: centre[k0], to: centre.at(-1), widthMm: wd, flareMm: flare };
  return {
    ok: true, widthMm: wd, centre, left, right, polygon, lengthMm: length, minRadiusM: Number.isFinite(rmin) ? rmin / 1000 : null,
    doorMid: P0, kerbPoint: P3, edge: r.edge, crossover, door, straight: Math.abs(G.dist(P0, P3) - length) < 5,
  };
}

// Clearances ---------------------------------------------------------------------------------------------------------------
function segSegDist(a, b, c, d) {
  // Minimum distance between segments ab and cd (zero when they cross).
  const o = (p, q, r) => G.cross(G.sub(q, p), G.sub(r, p));
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(G.projectToSegment(a, c, d).d, G.projectToSegment(b, c, d).d, G.projectToSegment(c, a, b).d, G.projectToSegment(d, a, b).d);
}

/**
 * Signed clearance (mm) from the building to boundary edge i and the nearest pair of points.
 * Positive is room to spare; negative is how far the building sits over the boundary line.
 */
export function clearanceToEdge(rings, lot, i) {
  const b = lot.boundary;
  const a = b[i];
  const c = b[(i + 1) % b.length];
  const n = inwardNormalOf(lot, i);
  let best = { d: Infinity, house: null, edge: null };
  const consider = (d, house, edge) => {
    if (d < best.d) best = { d, house, edge };
  };
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k];
      const pr = G.projectToSegment(p, a, c);
      const across = G.dot(G.sub(p, a), n); // signed distance from the line, positive inside the lot
      if (pr.tRaw >= 0 && pr.tRaw <= 1) consider(across, p, pr.point);
      else consider(across >= 0 ? pr.d : -pr.d, p, pr.point);
      const q = ring[(k + 1) % ring.length];
      const sd = segSegDist(p, q, a, c);
      if (sd > 0 && sd < best.d && Math.abs(sd) < Math.abs(best.d)) {
        // The edge of the building and the end of the boundary edge: take the nearer end point pair.
        const e1 = G.projectToSegment(a, p, q);
        const e2 = G.projectToSegment(c, p, q);
        const e = e1.d <= e2.d ? { p: e1.point, v: a } : { p: e2.point, v: c };
        consider(Math.min(e1.d, e2.d), e.p, e.v);
      }
    }
  }
  return best;
}

/**
 * How the building sits against each boundary. Returns
 * { status: 'ok'|'breach'|'unknown'|'no_lot'|'no_building', hasSetbacks, rows, byKind, allInside }.
 * rows: [{ edge, kind, label, clearanceM, requiredM, shortByM, status: 'inside'|'outside'|'unknown', flagged, source, from, to }]
 * byKind: { front, secondaryFront, rear, side } each the tightest row of that kind (for the live readout).
 */
export function clearances(project) {
  const lot = lotOf(project);
  if (!lot) return { status: 'no_lot', hasSetbacks: false, rows: [], byKind: {}, allInside: false };
  const rings = buildingRings(project);
  if (!rings.length) return { status: 'no_building', hasSetbacks: !!lot.setbacks, rows: [], byKind: {}, allInside: false };
  const notes = setbackNotes(lot);
  const edges = classifyEdges(lot);
  const rows = edges.map((e) => {
    const best = clearanceToEdge(rings, lot, e.index);
    const clearanceM = Math.round(best.d) / 1000;
    const requiredM = requiredFor(e.kind, lot.setbacks);
    const note = notes.find((x) => x.rule === e.kind);
    let status = 'unknown';
    if (requiredM != null) status = clearanceM >= requiredM - TOL_M ? 'inside' : 'outside';
    return {
      edge: e.index, kind: e.kind, label: e.label, clearanceM, requiredM,
      shortByM: requiredM != null && status === 'outside' ? Math.round((requiredM - clearanceM) * 1000) / 1000 : 0,
      status, flagged: !!note?.flagged, source: note?.source || null, from: best.house, to: best.edge,
    };
  });
  const byKind = {};
  for (const r of rows) {
    const cur = byKind[r.kind];
    if (!cur || r.clearanceM < cur.clearanceM) byKind[r.kind] = r;
  }
  const known = rows.filter((r) => r.status !== 'unknown');
  const outside = rows.some((r) => r.status === 'outside');
  const status = !lot.setbacks ? 'unknown' : outside ? 'breach' : known.length ? 'ok' : 'unknown';
  return { status, hasSetbacks: !!lot.setbacks, rows, byKind, allInside: !!lot.setbacks && !outside && known.length > 0 };
}

/** Plain readout text for a row, e.g. "Front 6.4 m (6.0 m required)". */
export function clearanceText(row) {
  if (!row) return '';
  const name = { front: 'Front', secondaryFront: 'Secondary front', rear: 'Rear', side: 'Side', unknown: 'Edge' }[row.kind] || 'Edge';
  const req = row.requiredM != null ? ` (${row.requiredM.toFixed(1)} m required)` : '';
  return `${name} ${row.clearanceM.toFixed(2)} m${req}`;
}

// Garage to the street ---------------------------------------------------------------------------------------------------
/**
 * Degrees clockwise (about the house centre) that make the garage door face the primary street frontage square on.
 * Returns null when the house has no garage door or the lot has no street edge. A house whose garage already faces the street
 * returns 0. Rounded to 0.1 degree.
 */
export function faceGarageAngle(project, { edge = null } = {}) {
  const lot = lotOf(project);
  const door = garageDoor(project);
  if (!lot || !door) return null;
  const roads = roadReserve(lot);
  if (!roads.length) return null;
  const r = (edge != null ? roads.find((x) => x.edge === edge) : null) || roads.find((x) => x.kind === 'front') || roads[0];
  const from = (Math.atan2(door.normal.y, door.normal.x) * 180) / Math.PI;
  const to = (Math.atan2(r.outward.y, r.outward.x) * 180) / Math.PI;
  let d = to - from;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.round(d * 10) / 10 || 0;
}

/** Which street edge the garage door faces (edge index) or null. */
export function garageStreetEdge(project) {
  const dw = deriveDriveway(project);
  return dw?.ok ? dw.edge : null;
}

// Labels ------------------------------------------------------------------------------------------------------------------
/** "PROPOSED LOT 3" for a lot that is not yet registered (lot.proposed), "LOT 24" and "DP 1234567" lines otherwise. */
export function lotLabelLines(lot) {
  const num = lot?.lotNumber ? String(lot.lotNumber) : '';
  if (lot?.proposed) return { first: `PROPOSED LOT${num ? ` ${num}` : ''}`, second: lot.planLabel || '', proposed: true };
  return { first: num ? `LOT ${num}` : '', second: lot?.planLabel || '', proposed: false };
}

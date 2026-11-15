// Drawn driveways and roads (project.site.paved): the data behind the Driveway and road tool in the editor, residential and commercial.
// Pure geometry and project edits, no DOM. Plan mm, y down.
//
// A way is a polyline with a width, a material and an optional corner radius:
//   { id, kind: 'driveway' | 'road', material: 'concrete' | 'asphalt' | 'gravel' | 'pavers', widthMm, radiusMm, pts: [{x,y}],
//     kerbEdge: lot edge index | null, heads: [{ end: 'start' | 'end', type: 'bulb' | 'tee' }] }
// When kerbEdge is set the first point is on the kerb of that street frontage and the part between the property line and the kerb is the
// crossover, with a 0.5 m layback each side. Everything else is kept inside the lot: nothing is drawn outside it except the crossover.
//
// The automatic driveway (deriveDriveway in lotplan.js) stands aside when a drawn driveway exists, and reports the drawn one in the same
// shape, so the plan, 3D view, plan set and feasibility read one driveway either way. The auto router can ask for its own with
// { ignoreManual: true } and can see what is drawn through getWays() and drivewayIsDrawn(): a drawn driveway is the person's decision.

import * as G from '../model/geometry.js';
import { lotOf } from '../model/placement.js';
import { roadReserve, garageDoor, buildingRings, filletPath, circumradius } from './lotplan.js';
import { boolean, holeFree, clipTo, cleanRing } from '../commercial/catalogue/pavements/polybool.js';
import { polyArea } from '../commercial/catalogue/pavements/geom.js';

export const KINDS = Object.freeze({
  driveway: Object.freeze({ id: 'driveway', label: 'Driveway', minMm: 3000, maxMm: 6000, defMm: 3500 }),
  road: Object.freeze({ id: 'road', label: 'Road', minMm: 4000, maxMm: 8000, defMm: 5000 }),
});

/** Materials: the pavement type whose crisp plan hatch and 3D texture each one uses (the commercial catalogue, so both tools match). */
export const MATERIALS = Object.freeze({
  concrete: Object.freeze({ id: 'concrete', label: 'Concrete', type: 'concrete-light', colour: '#c4c0b6', swatch: '#cfcbc0' }),
  asphalt: Object.freeze({ id: 'asphalt', label: 'Asphalt', type: 'asphalt-ac10-car', colour: '#45484b', swatch: '#5a5e62' }),
  gravel: Object.freeze({ id: 'gravel', label: 'Gravel', type: 'gravel-yard', colour: '#a89c84', swatch: '#b7a98c' }),
  pavers: Object.freeze({ id: 'pavers', label: 'Pavers', type: 'unit-pavers-ped', colour: '#b4a28d', swatch: '#c2ac90' }),
});
export const MATERIAL_IDS = Object.freeze(Object.keys(MATERIALS));

export const HEADS = Object.freeze({
  bulb: Object.freeze({ id: 'bulb', label: 'Turning circle', radiusMm: 6000 }),
  tee: Object.freeze({ id: 'tee', label: 'Hammerhead', armMm: 6000 }),
});

export const FLARE_MM = 500; // layback each side of the crossover at the kerb
export const MIN_RADIUS_MM = 0; // 0 means sharp corners
export const MAX_RADIUS_MM = 30000;
export const MAX_WAYS = 40;
export const MAX_POINTS = 120;

const finite = (v) => Number.isFinite(v);
const r1 = (v) => Math.round(v);
const rp = (p) => ({ x: r1(p.x), y: r1(p.y) });
const dist = G.dist;

export const kindOf = (id) => KINDS[id] || KINDS.driveway;
export const materialOf = (id) => MATERIALS[id] || MATERIALS.concrete;
export const clampWidth = (kind, mm) => G.clamp(Math.round((finite(mm) ? mm : kindOf(kind).defMm) / 50) * 50, kindOf(kind).minMm, kindOf(kind).maxMm);
export const clampRadius = (mm) => (finite(mm) ? G.clamp(Math.round(mm / 100) * 100, MIN_RADIUS_MM, MAX_RADIUS_MM) : 0);

/** A sensible default material: rural lots (4000 m2 and up) get gravel, everything else concrete for a driveway and asphalt for a road. */
export function defaultMaterial(project, kind) {
  const lot = lotOf(project);
  const rural = lot ? G.polygonArea(lot.boundary) / 1e6 >= 4000 : false;
  if (rural) return 'gravel';
  return kind === 'road' ? 'asphalt' : 'concrete';
}

// Reading ------------------------------------------------------------------------------------------------------------------------

function clean(w) {
  if (!w || typeof w !== 'object' || !w.id || !Array.isArray(w.pts)) return null;
  const pts = w.pts.filter((p) => finite(p?.x) && finite(p?.y)).map((p) => ({ x: p.x, y: p.y }));
  if (pts.length < 2) return null;
  const kind = KINDS[w.kind] ? w.kind : 'driveway';
  return {
    id: String(w.id), kind, material: MATERIALS[w.material] ? w.material : 'concrete', widthMm: clampWidth(kind, w.widthMm), radiusMm: clampRadius(w.radiusMm),
    pts, kerbEdge: Number.isInteger(w.kerbEdge) ? w.kerbEdge : null,
    heads: (Array.isArray(w.heads) ? w.heads : []).filter((h) => (h?.end === 'start' || h?.end === 'end') && HEADS[h?.type]).map((h) => ({ end: h.end, type: h.type })),
  };
}

/** The drawn ways on the project, cleaned. */
export function getWays(project) {
  const list = project?.site?.paved;
  return Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
}
export const getWay = (project, id) => getWays(project).find((w) => w.id === id) || null;

const hasWayRaw = (project, id) => (project?.site?.paved || []).find((w) => w?.id === id) || null;

/** True when a drawn driveway stands in for the automatic one. */
export function drivewayIsDrawn(project) {
  return getWays(project).some((w) => w.kind === 'driveway' && w.kerbEdge != null);
}

// Geometry -----------------------------------------------------------------------------------------------------------------------

/** The centreline with each interior corner rounded by an arc of the way's radius (never tighter than the half width plus 0.2 m). */
export function centreline(way) {
  const pts = way.pts;
  if (!(way.radiusMm > 0) || pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  return filletPath(pts, Math.max(way.radiusMm, way.widthMm / 2 + 200));
}

/** Left and right edges of a constant width strip along a polyline, mitred at sharp corners (mitre limited to twice the half width). */
export function offsetEdges(cl, widthMm) {
  const half = widthMm / 2;
  const n = cl.length;
  const left = [];
  const right = [];
  const dirs = [];
  for (let i = 0; i < n - 1; i++) { const d = G.norm(G.sub(cl[i + 1], cl[i])); dirs.push(d); }
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(dirs.length - 1, i)];
    const t = i === 0 ? b : i === n - 1 ? a : G.norm(G.add(a, b));
    const nl = { x: -t.y, y: t.x };
    const seg = i === 0 ? b : a;
    const sn = { x: -seg.y, y: seg.x };
    const k = 1 / Math.max(0.5, G.dot(nl, sn));
    left.push(G.add(cl[i], G.mul(nl, half * k)));
    right.push(G.add(cl[i], G.mul(nl, -half * k)));
  }
  return { left, right };
}

export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);

const circlePoly = (c, r, n = 28) => Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * Math.PI * 2) * r, y: c.y + Math.sin((i / n) * Math.PI * 2) * r }));

/** The polygon of a turning head at an end of the way. */
export function headPolygon(way, head) {
  const pts = way.pts;
  const atEnd = head.end === 'end';
  const p = atEnd ? pts.at(-1) : pts[0];
  const q = atEnd ? pts.at(-2) : pts[1];
  const dir = G.norm(G.sub(p, q)); // pointing out of the way
  const w = way.widthMm;
  if (head.type === 'bulb') {
    const R = Math.max(HEADS.bulb.radiusMm, w * 0.75);
    return circlePoly(G.add(p, G.mul(dir, R * 0.4)), R);
  }
  const arm = Math.max(HEADS.tee.armMm, w);
  const n = { x: -dir.y, y: dir.x };
  const a = G.add(p, G.mul(n, arm));
  const b = G.add(p, G.mul(n, -arm));
  return [a, b, G.add(b, G.mul(dir, w)), G.add(a, G.mul(dir, w))];
}

const reserveFor = (project, edge) => {
  const lot = lotOf(project);
  return lot ? roadReserve(lot).find((r) => r.edge === edge) || null : null;
};

/** The verge between the property line and the kerb of a frontage (a quad, a little wider each side for the layback). */
export function vergeQuad(reserve) {
  const [a, b] = reserve.lines.property;
  const o = G.mul(reserve.outward, reserve.vergeM * 1000);
  const ext = G.mul(reserve.u, FLARE_MM * 1.2);
  return [G.sub(a, ext), G.add(b, ext), G.add(G.add(b, ext), o), G.add(G.sub(a, ext), o)];
}

const ringArea = (ring) => Math.abs(polyArea(ring)) / 1e6;
const largestFirst = (rings) => rings.slice().sort((p, q) => Math.abs(polyArea(q)) - Math.abs(polyArea(p)));

/**
 * Everything the plan, 3D view, plan set and feasibility need from one way:
 *   { way, centre, left, right, outline, body: [ring], heads: [ring], crossover: [ring], pieces: [{ role, ring, areaM2 }],
 *     lengthMm, areaM2, bodyM2, crossoverM2, headM2, minRadiusM, kerbPoint, outsideLot }
 * body, heads and crossover do not overlap, so their areas add up to the paved area. Without a lot nothing is clipped.
 */
export function wayGeometry(project, wayIn) {
  const way = clean(wayIn) || wayIn;
  const lot = lotOf(project);
  const lotRing = lot ? lot.boundary.map((p) => ({ x: p.x, y: p.y })) : null;
  const centre = centreline(way);
  const { left, right } = offsetEdges(centre, way.widthMm);
  const outline = [...left, ...right.slice().reverse()];
  const reserve = way.kerbEdge != null ? reserveFor(project, way.kerbEdge) : null;
  let body = [];
  let crossover = [];
  const ring = cleanRing(outline);
  if (ring.length >= 3) {
    if (!lotRing) body = [ring];
    else {
      // Inside the lot, and for a kerbed way the crossover over the verge as its own piece.
      body = holeFree(boolean([ring], [lotRing], 'inter'));
      if (reserve) {
        const piece = holeFree(boolean([ring], [vergeQuad(reserve)], 'inter'));
        crossover = largestFirst(piece).slice(0, 1).map((rg) => flare(rg, reserve));
        // Anything over the verge is the crossover; the verge is outside the lot so the body never overlaps it.
      }
    }
  }
  const heads = [];
  for (const h of way.heads || []) {
    if (h.end === 'start' && way.kerbEdge != null) continue;
    let hp = cleanRing(headPolygon(way, h));
    if (hp.length < 3) continue;
    let pieces = boolean([hp], [ring], 'diff');
    if (lotRing) pieces = boolean(pieces, [lotRing], 'inter');
    for (const rg of holeFree(pieces)) heads.push(rg);
  }
  const pieces = [
    ...largestFirst(body).map((rg) => ({ role: 'body', ring: rg, areaM2: ringArea(rg) })),
    ...heads.map((rg) => ({ role: 'head', ring: rg, areaM2: ringArea(rg) })),
    ...crossover.map((rg) => ({ role: 'crossover', ring: rg, areaM2: ringArea(rg) })),
  ];
  let rmin = Infinity;
  for (let i = 1; i < centre.length - 1; i++) rmin = Math.min(rmin, circumradius(centre[i - 1], centre[i], centre[i + 1]));
  const outsideLot = lotRing ? centre.some((p, i) => !(G.pointInPolygon(p, lotRing)) && !(i === 0 && way.kerbEdge != null) && !onVerge(p, reserve)) : false;
  const sum = (role) => pieces.filter((p) => p.role === role).reduce((s, p) => s + p.areaM2, 0);
  return {
    way, centre, left, right, outline, body, heads, crossover, pieces,
    lengthMm: pathLength(centre), areaM2: pieces.reduce((s, p) => s + p.areaM2, 0), bodyM2: sum('body'), crossoverM2: sum('crossover'), headM2: sum('head'),
    minRadiusM: Number.isFinite(rmin) ? rmin / 1000 : null, kerbPoint: way.kerbEdge != null ? way.pts[0] : null, outsideLot,
  };
}

function onVerge(p, reserve) {
  if (!reserve) return false;
  return G.pointInPolygon(p, vergeQuad(reserve));
}

/** Splay the kerb end of a crossover piece by the layback each side (its points on the kerb line move along the street). */
function flare(ring, reserve) {
  const k = reserve.lines.kerb;
  const u = reserve.u;
  const onKerb = (p) => Math.abs(G.dot(G.sub(p, k[0]), reserve.outward)) < 3;
  const idx = ring.map((p, i) => (onKerb(p) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return ring;
  const along = (i) => G.dot(G.sub(ring[i], k[0]), u);
  const lo = idx.reduce((a, b) => (along(a) <= along(b) ? a : b));
  const hi = idx.reduce((a, b) => (along(a) >= along(b) ? a : b));
  const out = ring.map((p) => ({ x: p.x, y: p.y }));
  out[lo] = G.add(out[lo], G.mul(u, -FLARE_MM));
  out[hi] = G.add(out[hi], G.mul(u, FLARE_MM));
  return out;
}

// Summary for feasibility, the plan set and the panel --------------------------------------------------------------------------------

/**
 * { ways: [{ id, kind, kindLabel, material, label, lengthM, widthM, areaM2 }], byMaterial: [{ material, label, areaM2, lengthM }], totalM2,
 *   drivewayM2, roadM2 }. Areas include the crossover and turning heads.
 */
export function pavedSummary(project) {
  const ways = getWays(project).map((w) => {
    const g = wayGeometry(project, w);
    return { id: w.id, kind: w.kind, kindLabel: KINDS[w.kind].label, material: w.material, label: `${MATERIALS[w.material].label} ${KINDS[w.kind].label.toLowerCase()}`, lengthM: g.lengthMm / 1000, widthM: w.widthMm / 1000, areaM2: g.areaM2, crossoverM2: g.crossoverM2, headM2: g.headM2 };
  });
  const by = new Map();
  for (const w of ways) {
    const e = by.get(w.material) || { material: w.material, label: MATERIALS[w.material].label, areaM2: 0, lengthM: 0 };
    e.areaM2 += w.areaM2; e.lengthM += w.lengthM; by.set(w.material, e);
  }
  const order = MATERIAL_IDS;
  return {
    ways,
    byMaterial: [...by.values()].sort((a, b) => order.indexOf(a.material) - order.indexOf(b.material)),
    totalM2: ways.reduce((s, w) => s + w.areaM2, 0),
    drivewayM2: ways.filter((w) => w.kind === 'driveway').reduce((s, w) => s + w.areaM2, 0),
    roadM2: ways.filter((w) => w.kind === 'road').reduce((s, w) => s + w.areaM2, 0),
  };
}

// The automatic driveway stands aside ----------------------------------------------------------------------------------------------

/** The drawn driveway in the shape deriveDriveway returns, or null when none is drawn. */
export function manualDriveway(project) {
  const way = getWays(project).find((w) => w.kind === 'driveway' && w.kerbEdge != null);
  if (!way) return null;
  const g = wayGeometry(project, way);
  const body = g.pieces.find((p) => p.role === 'body');
  const cross = g.pieces.find((p) => p.role === 'crossover');
  const door = garageDoor(project);
  const reserve = reserveFor(project, way.kerbEdge);
  return {
    ok: true, manual: true, wayId: way.id, material: way.material, widthMm: way.widthMm, centre: g.centre, left: g.left, right: g.right,
    polygon: body ? body.ring : g.outline, extraPolygons: g.pieces.filter((p) => p.role !== 'crossover' && p !== body).map((p) => p.ring),
    lengthMm: g.lengthMm, minRadiusM: g.minRadiusM, doorMid: door?.mid || g.centre.at(-1), kerbPoint: g.centre[0], edge: way.kerbEdge,
    crossover: { polygon: cross ? cross.ring : [], from: g.centre[0], to: g.centre[0], widthMm: way.widthMm, flareMm: FLARE_MM },
    door, straight: way.pts.length === 2, edited: true, edgeStart: reserve ? reserve.lines.property[0] : null, edgeU: reserve?.u || null,
    edgeLenMm: reserve ? dist(reserve.lines.property[0], reserve.lines.property[1]) : 0, endOffsetMm: 0, pis: way.pts.slice(1, -1), radiusM: way.radiusMm / 1000,
    insideLot: !g.outsideLot,
  };
}

// Snapping -----------------------------------------------------------------------------------------------------------------------

const nearestOnRing = (p, ring) => {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const pr = G.projectToSegment(p, a, b);
    if (!best || pr.d < best.d) best = { d: pr.d, x: pr.point.x, y: pr.point.y, edge: i };
  }
  return best;
};

/** The point nearest to p inside (or on) the lot ring. */
export function clampToLot(project, p) {
  const lot = lotOf(project);
  if (!lot || G.pointInPolygon(p, lot.boundary)) return { x: p.x, y: p.y };
  const n = nearestOnRing(p, lot.boundary);
  return n ? { x: n.x, y: n.y } : { x: p.x, y: p.y };
}

/** Project p onto the kerb line of a frontage, kept between the frontage ends. */
export function kerbPointFor(reserve, p, widthMm = 0) {
  const [a, b] = reserve.lines.property;
  const o = G.mul(reserve.outward, reserve.vergeM * 1000);
  const ka = G.add(a, o);
  const kb = G.add(b, o);
  const len = dist(ka, kb);
  const t = G.clamp(G.dot(G.sub(p, ka), reserve.u), Math.min(widthMm / 2 + FLARE_MM, len / 2), Math.max(len - widthMm / 2 - FLARE_MM, len / 2));
  return G.add(ka, G.mul(reserve.u, t));
}

export const SNAP_LABEL = { door: 'Garage door', end: 'End of existing pavement', kerb: 'Kerb: crossover and layback added', corner: 'Lot corner', boundary: 'Lot boundary', building: 'Building edge', grid: 'Grid', free: 'No snap' };

/**
 * Snap a plan point for the drawing tools. opts: { mmPerPx, alt, widthMm, exclude (way id whose own ends are ignored), allowKerb }.
 * Returns { x, y, kind, text, kerbEdge? }; kind is one of door, end, kerb, corner, boundary, building, grid, free.
 * Priority: garage door, the ends of existing pavement, the kerb, lot corners and boundary, building edges, then a 100 mm grid. Alt turns it off
 * (the point is still kept inside the lot unless it is on the verge, where it goes to the kerb).
 */
export function snapWayPoint(project, p, opts = {}) {
  const { mmPerPx = 10, alt = false, widthMm = 3500, exclude = null, allowKerb = true } = opts;
  const tol = 12 * mmPerPx;
  const lot = lotOf(project);
  const reserves = lot ? roadReserve(lot) : [];
  const out = (kind, q, extra = {}) => ({ x: r1(q.x), y: r1(q.y), kind, text: SNAP_LABEL[kind], ...extra });

  // The verge: a point on it (or within a few pixels of the frontage or the kerb) goes to the kerb, whatever else is near.
  if (allowKerb) {
    for (const r of reserves) {
      const side = G.dot(G.sub(p, r.lines.property[0]), r.outward); // distance out from the property line
      const along = G.dot(G.sub(p, r.lines.property[0]), r.u);
      const len = dist(r.lines.property[0], r.lines.property[1]);
      const inBand = side > -tol * 0.4 && side <= r.vergeM * 1000 + tol * 1.5;
      if (inBand && along > -widthMm && along < len + widthMm) return out('kerb', kerbPointFor(r, p, widthMm), { kerbEdge: r.edge });
    }
  }
  if (alt) return out('free', lot && !G.pointInPolygon(p, lot.boundary) ? clampToLot(project, p) : p);

  const door = garageDoor(project);
  if (door && dist(p, door.mid) <= tol * 1.4) return out('door', door.mid);
  for (const w of getWays(project)) {
    if (w.id === exclude) continue;
    for (const q of [w.pts[0], w.pts.at(-1)]) if (dist(p, q) <= tol * 1.3) return out('end', q, { kerbEdge: w.kerbEdge != null && q === w.pts[0] ? w.kerbEdge : undefined });
  }
  if (lot) {
    for (const v of lot.boundary) if (dist(p, v) <= tol) return out('corner', v);
    const n = nearestOnRing(p, lot.boundary);
    if (n && n.d <= tol) return out('boundary', n);
  }
  for (const ring of buildingRings(project)) {
    const n = nearestOnRing(p, ring);
    if (n && n.d <= tol) return out('building', n);
  }
  const q = { x: Math.round(p.x / 100) * 100, y: Math.round(p.y / 100) * 100 };
  const inside = lot ? clampToLot(project, q) : q;
  if (lot && (inside.x !== q.x || inside.y !== q.y)) return out('boundary', inside);
  return out('grid', q);
}

/** Lock a point to 15 degree steps from `from` (Shift while drawing). */
export function lockAngle(p, from) {
  if (!from) return p;
  const d = { x: p.x - from.x, y: p.y - from.y };
  const l = Math.hypot(d.x, d.y);
  const a = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: r1(from.x + Math.cos(a) * l), y: r1(from.y + Math.sin(a) * l) };
}

// Edits (call inside store.apply) --------------------------------------------------------------------------------------------------

function list(project) {
  if (!project.site) project.site = {};
  if (!Array.isArray(project.site.paved)) project.site.paved = [];
  return project.site.paved;
}

const nextId = (project) => {
  let n = 0;
  for (const w of list(project)) { const m = /^pw_(\d+)$/.exec(String(w?.id || '')); if (m) n = Math.max(n, Number(m[1])); }
  return `pw_${n + 1}`;
};

/** Keep the points of a way legal: first point on the kerb (kerbed ways) or inside the lot, every other point inside the lot. */
function legalPoints(project, pts, kerbEdge, widthMm) {
  const reserve = kerbEdge != null ? reserveFor(project, kerbEdge) : null;
  return pts.map((p, i) => {
    if (i === 0 && reserve) return rp(kerbPointFor(reserve, p, widthMm));
    return rp(clampToLot(project, p));
  });
}

/** A way with every point made legal (kerb point on the kerb, the rest inside the lot), for live previews while dragging. */
export function legalWay(project, wayIn) {
  const w = clean(wayIn);
  if (!w) return wayIn;
  return { ...w, pts: dedupe(legalPoints(project, w.pts, w.kerbEdge, w.widthMm)) };
}

function dedupe(pts, tol = 20) {
  const out = [];
  for (const p of pts) if (!out.length || dist(p, out.at(-1)) > tol) out.push(p);
  return out;
}

/**
 * Add a way. spec: { kind, material, widthMm, radiusMm, pts, kerbEdge }. A kerb point at the far end is turned round so the kerb end is first.
 * Returns the stored way. Throws a plain message when it cannot be made.
 */
export function addWay(project, spec) {
  if (list(project).length >= MAX_WAYS) throw new Error(`That is the most drivable ways one design holds (${MAX_WAYS}).`);
  const kind = KINDS[spec.kind] ? spec.kind : 'driveway';
  let pts = dedupe((spec.pts || []).filter((p) => finite(p?.x) && finite(p?.y))).slice(0, MAX_POINTS);
  let kerbEdge = Number.isInteger(spec.kerbEdge) ? spec.kerbEdge : null;
  if (spec.endKerbEdge != null && kerbEdge == null) { pts = pts.slice().reverse(); kerbEdge = spec.endKerbEdge; }
  if (pts.length < 2) throw new Error('Pick at least two points.');
  const widthMm = clampWidth(kind, spec.widthMm);
  const legal = dedupe(legalPoints(project, pts, kerbEdge, widthMm));
  if (legal.length < 2) throw new Error('Those points are too close together.');
  const way = { id: nextId(project), kind, material: MATERIALS[spec.material] ? spec.material : defaultMaterial(project, kind), widthMm, radiusMm: clampRadius(spec.radiusMm), pts: legal, kerbEdge, heads: [] };
  list(project).push(way);
  syncCommercialMirror(project);
  return way;
}

function entry(project, id) {
  const e = hasWayRaw(project, id);
  if (!e) throw new Error('That driveway or road is gone.');
  return e;
}

/** Change width, material, radius or kind of a way. */
export function updateWay(project, id, patch = {}) {
  const e = entry(project, id);
  if (patch.kind && KINDS[patch.kind]) e.kind = patch.kind;
  if (patch.material && MATERIALS[patch.material]) e.material = patch.material;
  if (patch.widthMm != null) e.widthMm = clampWidth(e.kind, patch.widthMm);
  else e.widthMm = clampWidth(e.kind, e.widthMm);
  if (patch.radiusMm != null) e.radiusMm = clampRadius(patch.radiusMm);
  e.pts = legalPoints(project, e.pts, e.kerbEdge, e.widthMm);
  syncCommercialMirror(project);
  return e;
}

export function removeWay(project, id) {
  const l = list(project);
  const i = l.findIndex((w) => w?.id === id);
  if (i < 0) throw new Error('That driveway or road is gone.');
  l.splice(i, 1);
  if (!l.length) delete project.site.paved;
  syncCommercialMirror(project);
}

export function moveVertex(project, id, index, p) {
  const e = entry(project, id);
  if (index < 0 || index >= e.pts.length) throw new Error('That corner is gone.');
  e.pts[index] = { x: p.x, y: p.y };
  e.pts = legalPoints(project, e.pts, e.kerbEdge, e.widthMm);
  syncCommercialMirror(project);
  return e;
}

export function insertVertex(project, id, segment, p) {
  const e = entry(project, id);
  if (e.pts.length >= MAX_POINTS) throw new Error('That way has the most points it can hold.');
  if (segment < 0 || segment >= e.pts.length - 1) throw new Error('Pick a point on the line.');
  e.pts.splice(segment + 1, 0, rp(clampToLot(project, p)));
  syncCommercialMirror(project);
  return e;
}

export function removeVertex(project, id, index) {
  const e = entry(project, id);
  if (e.pts.length <= 2) throw new Error('A driveway or road needs at least two points. Delete it instead.');
  if (index < 0 || index >= e.pts.length) throw new Error('That corner is gone.');
  e.pts.splice(index, 1);
  e.pts = legalPoints(project, e.pts, e.kerbEdge, e.widthMm);
  syncCommercialMirror(project);
  return e;
}

/** Split a way at an interior point into two ways that share that point. Returns [first, second]. */
export function splitWay(project, id, index) {
  const e = entry(project, id);
  if (index <= 0 || index >= e.pts.length - 1) throw new Error('Pick a corner between the two ends to split at.');
  if (list(project).length >= MAX_WAYS) throw new Error('That is the most ways one design holds.');
  const second = { ...e, id: nextId(project), pts: e.pts.slice(index).map((p) => ({ ...p })), kerbEdge: null, heads: (e.heads || []).filter((h) => h.end === 'end').map((h) => ({ ...h })) };
  e.pts = e.pts.slice(0, index + 1);
  e.heads = (e.heads || []).filter((h) => h.end === 'start');
  list(project).splice(list(project).indexOf(e) + 1, 0, second);
  syncCommercialMirror(project);
  return [e, second];
}

/** The ends of two ways that meet: { a: 'start' | 'end', b: 'start' | 'end', gap } for the closest pair within tol (mm), or null. */
export function touchingEnds(wa, wb, tol = 400) {
  let best = null;
  for (const [ea, pa] of [['start', wa.pts[0]], ['end', wa.pts.at(-1)]]) {
    for (const [eb, pb] of [['start', wb.pts[0]], ['end', wb.pts.at(-1)]]) {
      const d = dist(pa, pb);
      if (d <= tol && (!best || d < best.gap)) best = { a: ea, b: eb, gap: d };
    }
  }
  return best;
}

/** The first other way that touches this one at an end, or null. */
export function joinCandidate(project, id, tol = 400) {
  const me = getWay(project, id);
  if (!me) return null;
  for (const o of getWays(project)) {
    if (o.id === id) continue;
    const t = touchingEnds(me, o, tol);
    if (t) return { other: o.id, ...t };
  }
  return null;
}

/** Join two ways whose ends meet into one (the first keeps its width, material and kind). Returns the joined way. */
export function joinWays(project, idA, idB, tol = 400) {
  if (idA === idB) throw new Error('Pick two different ways to join.');
  const a = entry(project, idA);
  const b = entry(project, idB);
  const t = touchingEnds(clean(a), clean(b), tol);
  if (!t) throw new Error('Those two ends are not touching. Snap one to the other first.');
  if (a.kerbEdge != null && b.kerbEdge != null) throw new Error('Both of those start at the kerb, so they cannot be joined into one.');
  if ((a.kerbEdge != null && t.a === 'start') || (b.kerbEdge != null && t.b === 'start')) throw new Error('Those meet at the kerb, so they cannot be joined into one.');
  const flip = (hs) => hs.map((h) => ({ ...h, end: h.end === 'start' ? 'end' : 'start' }));
  let A = { pts: a.pts.map((p) => ({ ...p })), heads: (a.heads || []).slice(), kerb: a.kerbEdge };
  let B = { pts: b.pts.map((p) => ({ ...p })), heads: (b.heads || []).slice(), kerb: b.kerbEdge };
  if (t.a === 'start') A = { pts: A.pts.reverse(), heads: flip(A.heads), kerb: null }; // touching end first becomes the last
  if (t.b === 'end') B = { pts: B.pts.reverse(), heads: flip(B.heads), kerb: null };
  let pts = dedupe([...A.pts, ...B.pts], 60);
  let heads = [...A.heads.filter((h) => h.end === 'start'), ...B.heads.filter((h) => h.end === 'end')];
  let kerb = a.kerbEdge != null ? a.kerbEdge : b.kerbEdge;
  if (b.kerbEdge != null && t.b === 'end') { pts = pts.reverse(); heads = flip(heads); } // the kerb end of b ended up last: turn the chain round
  a.pts = pts;
  a.kerbEdge = kerb ?? null;
  a.heads = heads;
  list(project).splice(list(project).indexOf(b), 1);
  syncCommercialMirror(project);
  return a;
}

/** Add (or replace) a turning head at an end of a way. Returns the way. */
export function addHead(project, id, end = 'end', type = 'bulb') {
  const e = entry(project, id);
  if (!HEADS[type]) throw new Error('Pick a turning circle or a hammerhead.');
  if (end === 'start' && e.kerbEdge != null) throw new Error('The kerb end of a way cannot have a turning head.');
  e.heads = [...(e.heads || []).filter((h) => h.end !== end), { end, type }];
  syncCommercialMirror(project);
  return e;
}

export function removeHead(project, id, end) {
  const e = entry(project, id);
  e.heads = (e.heads || []).filter((h) => h.end !== end);
  syncCommercialMirror(project);
}

// Commercial: drawn ways are mirrored as hardstand areas so every pavement quantity, cost, plan and the feasibility pick them up -------------

const MIRROR = 'hs_w';

/**
 * In a commercial layout, keep one hardstand area per piece of every drawn way (id hs_w<way number>_<piece>, `way` set), in the material's
 * pavement type. Pieces of ways that are gone are removed. Call after any change to the ways. Does nothing in a residential design.
 */
export function syncCommercialMirror(project) {
  const c = project?.commercial;
  if (project?.mode !== 'commercial' || !c) return;
  const keep = (Array.isArray(c.pavements) ? c.pavements : []).filter((o) => !(o && o.way));
  const mirrors = [];
  for (const w of getWays(project)) {
    const g = wayGeometry(project, w);
    const num = String(w.id).replace(/\D/g, '') || '0';
    g.pieces.forEach((pc, k) => mirrors.push({ id: `${MIRROR}${num}_${k + 1}`, type: MATERIALS[w.material].type, polygon: pc.ring.map(rp), way: w.id, role: pc.role }));
  }
  c.pavements = [...mirrors, ...keep];
}

/** Material id of a pavement type that a way can use (for labels), or null. */
export const materialForType = (type) => MATERIAL_IDS.find((m) => MATERIALS[m].type === type) || null;

// For the plan set and the engineering sheets ----------------------------------------------------------------------------------------

/** The plan set hatch kind for a material (eng/kit.js HATCH). */
export const HATCH_KIND = Object.freeze({ concrete: 'concrete', asphalt: 'bitumen', gravel: 'gravel', pavers: 'pavers' });
/** The sheet label for a material, in capitals. */
export const SHEET_LABEL = Object.freeze({ concrete: 'CONCRETE', asphalt: 'ASPHALT', gravel: 'GRAVEL', pavers: 'PAVERS' });

/**
 * The drawn ways other than the one that stands in for the automatic driveway (that one is already drawn and counted as the driveway):
 * [{ way, geom }]. The plan set draws these itself, with the hatch of their material.
 */
export function extraWays(project) {
  const drive = manualDriveway(project);
  return getWays(project).filter((w) => !drive || w.id !== drive.wayId).map((w) => ({ way: w, geom: wayGeometry(project, w) }));
}

/** Area inside the lot of the extra ways (body and turning heads, not the crossover), m2: what to take off the remaining site area. */
export function extraPavedInLotM2(project) {
  let m2 = extraWays(project).reduce((s, e) => s + e.geom.bodyM2 + e.geom.headM2, 0);
  const drive = manualDriveway(project); // the driveway's own turning heads are not part of its polygon
  if (drive) m2 += wayGeometry(project, getWay(project, drive.wayId)).headM2;
  return m2;
}

/** The area of a way's pavement that lies over the building (m2). Under about 1.5 m2 is just the end of a drive meeting the garage door. */
export function overBuildingM2(project, geom) {
  const rings = buildingRings(project).map((r) => cleanRing(r)).filter((r) => r.length >= 3);
  if (!rings.length) return 0;
  let m2 = 0;
  for (const pc of geom.pieces) {
    if (pc.role === 'crossover') continue;
    for (const br of rings) for (const rg of boolean([pc.ring], [br], 'inter')) m2 += ringArea(rg);
  }
  return m2;
}

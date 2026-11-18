// Hardstand drawing: the pure side of the Hardstand tool (2D plan and top view). A drawn hardstand area is one entry of
// project.commercial.pavements with an id that starts "hs_": { id, type, polygon }. pavementAreas() turns it into an area exactly like an
// auto assigned one, so kerbs, markings, the 3D surface, quantities, cost and the plan set follow with no extra code.
//
// Overlap rule (one rule, no merge step): the NEWER drawn area cuts what lies under it. New areas go to the front of the list, and
// pavementAreas() subtracts each drawn area from every area behind it. Nothing is destroyed, so moving or deleting the newer area brings the
// older one back whole, and the quantities never count a square metre twice.
//
// Everything here works on plain data (plan mm, y down) and edits a commercial spec in place; the caller wraps an edit in one store.apply.

import { polyArea, absArea, pointInPoly, bbox, bboxOverlap } from './geom.js';
import { boolean, clipTo, holeFree, groups, cleanRing, inRegion, orient } from './polybool.js';
import { pavementById, isPavementType, PAVEMENTS } from './pavements.js';
import { pavementAreas, pavementModel, pavementCost } from './logic.js';
import { layoutUnits } from '../../layout.js';
import { buildingsOf } from '../buildings.js';
import { cpConfig, CARPARK_DEFAULTS, longestEdgeAngle } from './carpark.js';

// roads.js registers itself here (it imports this file, so this file cannot import it)
export const roadsHook = { setRoad: null, addRoad: null };
export const HS_PREFIX = 'hs_';
export const GRID_MM = 500;
export const SNAP_PX = 10;
export const OVERLAP_RULE = 'A newer area cuts the older area it covers. Nothing is lost: move or delete the newer area and the older one shows whole again, and no square metre is counted twice.';
export const BUILDING_WARNING = 'Crosses a building. Hardstand is not blocked here, check the layout.';

const r1 = Math.round;
const num = Number.isFinite;
export const baseId = (id) => String(id || '').split('~')[0];
export const isHardstandId = (id) => String(id || '').startsWith(HS_PREFIX);

/** The area the polygon encloses in m2 (positive). */
export const areaM2 = (poly) => absArea(poly) / 1e6;

// The pavement model with the drawn hardstand areas cut into it, cached while nothing that feeds it changes (the plan redraws on every pan).
// null when the layout has no drawn area.
let hsCache = { key: '', model: null };
export function hardstandModel(project) {
  const c = project?.commercial;
  if (!Array.isArray(c?.pavements) || !c.pavements.some((o) => isHardstandId(o?.id))) return null;
  const key = JSON.stringify([c.pavements, c.rows, c.parking, c.waste, c.buildings, c.yards, c.pavementOptions, c.crossovers, project.site?.lot?.frontEdges, project.site?.lot?.boundary]);
  if (hsCache.key !== key) hsCache = { key, model: pavementModel(c, project.site?.lot || null) };
  return hsCache.model;
}

/** Pavement types the picker offers: every catalogue pavement, with its use. */
export function hardstandTypes() {
  return PAVEMENTS.map((p) => ({ id: p.id, label: p.label, short: p.short, use: p.use, colour: p.colour, where: p.where }));
}

const ptsOf = (ring) => (Array.isArray(ring) ? ring.filter((q) => num(q?.x) && num(q?.y)).map((q) => ({ x: q.x, y: q.y })) : []);

/** The drawn hardstand areas as stored: [{ id, type, polygon, index }] in the list order (newest first). */
export function hardstandList(commercial) {
  const out = [];
  (Array.isArray(commercial?.pavements) ? commercial.pavements : []).forEach((o, index) => {
    if (o && isHardstandId(o.id) && Array.isArray(o.polygon) && o.polygon.length >= 3 && isPavementType(o.type)) out.push({ id: o.id, type: o.type, polygon: ptsOf(o.polygon), index, road: o.road || null, carpark: o.carpark || null });
  });
  return out;
}

// Context -------------------------------------------------------------------------------------------------------------------------

/**
 * What a drawn area snaps to and is checked against: the lot boundary, the setback line, the buildings, and the pavement areas in use.
 * { lot, envelope, buildings: [{ id, label, ring }], areas: [{ id, type, ring }] }. `exclude` leaves one drawn area out (the one being edited).
 */
export function hsContext(project, { exclude = null } = {}) {
  const c = project?.commercial || {};
  const lot = ptsOf(project?.site?.lot?.boundary);
  const env = ptsOf(project?.site?.lot?.envelope);
  const buildings = [];
  layoutUnits(c).forEach((u) => buildings.push({ id: `unit${u.n}`, label: `Unit ${u.n}`, ring: ptsOf(u.poly) }));
  for (const b of buildingsOf(c)) buildings.push({ id: b.id, label: `Building ${b.n ?? ''}`.trim(), ring: ptsOf(b.outline) });
  const areas = pavementAreas(c).filter((a) => !exclude || baseId(a.id) !== exclude).map((a) => ({ id: a.id, type: a.type, ring: ptsOf(a.polygon), drawn: a.role === 'hardstand' }));
  return { lot: lot.length >= 3 ? lot : null, envelope: env.length >= 3 ? env : null, buildings: buildings.filter((b) => b.ring.length >= 3), areas };
}

// Snapping ------------------------------------------------------------------------------------------------------------------------

function nearestOnEdges(p, rings) {
  let best = null;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { d, q, a, b };
    }
  }
  return best;
}

/**
 * Snap a world point. Priority: a corner of the lot boundary, the setback line, a building or an existing pavement; then the nearest point
 * on one of those edges; then the 0.5 m grid. `alt` turns every snap off (the point is only rounded to 1 mm).
 * Returns { x, y, kind: 'corner' | 'edge' | 'grid' | 'free', source, edge?: [a, b] }; source names what it snapped to.
 */
export function snapPoint(world, ctx, { mmPerPx = 10, alt = false, gridMm = GRID_MM, tolPx = SNAP_PX } = {}) {
  if (alt) return { x: r1(world.x), y: r1(world.y), kind: 'free', source: null };
  const tol = tolPx * mmPerPx;
  const sources = [
    ['lot boundary', ctx.lot ? [ctx.lot] : []],
    ['setback line', ctx.envelope ? [ctx.envelope] : []],
    ['building', (ctx.buildings || []).map((b) => b.ring)],
    ['existing pavement', (ctx.areas || []).map((a) => a.ring)],
  ];
  let bestV = null;
  for (const [name, rings] of sources) for (const ring of rings) for (const v of ring) {
    const d = Math.hypot(v.x - world.x, v.y - world.y);
    if (d <= tol && (!bestV || d < bestV.d)) bestV = { d, x: v.x, y: v.y, source: name };
  }
  if (bestV) return { x: r1(bestV.x), y: r1(bestV.y), kind: 'corner', source: bestV.source };
  let bestE = null;
  for (const [name, rings] of sources) {
    const n = nearestOnEdges(world, rings);
    if (n && n.d <= tol && (!bestE || n.d < bestE.d)) bestE = { ...n, source: name };
  }
  if (bestE) {
    // along the edge, also land on the grid when a grid line is close (so a point on a boundary still reads 0.5 m steps)
    return { x: r1(bestE.q.x), y: r1(bestE.q.y), kind: 'edge', source: bestE.source, edge: [bestE.a, bestE.b] };
  }
  return { x: r1(world.x / gridMm) * gridMm, y: r1(world.y / gridMm) * gridMm, kind: 'grid', source: null };
}

export const snapLabel = (s) => (!s || s.kind === 'free' ? 'No snap' : s.kind === 'grid' ? 'Grid 0.5 m' : `${s.kind === 'corner' ? 'Corner of' : 'On'} ${s.source}`);

// Shapes --------------------------------------------------------------------------------------------------------------------------

/** The four corners of a rectangle dragged from p0 to p1; `along` (a unit vector) turns it to follow an edge. */
export function rectPolygon(p0, p1, along = null) {
  const u = along && Math.hypot(along.x, along.y) > 0 ? { x: along.x / Math.hypot(along.x, along.y), y: along.y / Math.hypot(along.x, along.y) } : { x: 1, y: 0 };
  const v = { x: -u.y, y: u.x };
  const d = { x: p1.x - p0.x, y: p1.y - p0.y };
  const du = d.x * u.x + d.y * u.y;
  const dv = d.x * v.x + d.y * v.y;
  const at = (a, b) => ({ x: r1(p0.x + u.x * a + v.x * b), y: r1(p0.y + u.y * a + v.y * b) });
  return [at(0, 0), at(du, 0), at(du, dv), at(0, dv)];
}

/** Direction (unit) of the snapped edge, turned to the nearest of its two ways to the +x axis, or null when the edge is within 1 degree of an axis. */
export function edgeDirection(snap) {
  if (!snap?.edge) return null;
  const [a, b] = snap.edge;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1) return null;
  let u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  if (u.x < 0) u = { x: -u.x, y: -u.y };
  const ang = Math.abs((Math.atan2(u.y, u.x) * 180) / Math.PI);
  return ang < 1 || Math.abs(ang - 90) < 1 || ang > 179 ? null : u;
}

/** Length of a polygon outline in metres. */
export function perimeterM(poly) {
  let s = 0;
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; s += Math.hypot(b.x - a.x, b.y - a.y); });
  return s / 1000;
}

/** Readout for a shape: { areaM2, perimeterM, w, d } (w and d, in metres, for a four sided rectangle). */
export function measure(poly) {
  const out = { areaM2: areaM2(poly), perimeterM: perimeterM(poly), w: null, d: null };
  if (poly.length === 4) {
    const l = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) / 1000;
    out.w = l(poly[0], poly[1]);
    out.d = l(poly[1], poly[2]);
  }
  return out;
}

/** Warnings (never blocks): the buildings the polygon crosses and whether any of it lies outside the lot. */
export function drawnWarnings(poly, ctx) {
  const out = { buildings: [], outsideLot: false, text: [] };
  const ring = cleanRing(poly);
  if (ring.length < 3) return out;
  const bb = bbox(ring);
  for (const b of ctx.buildings || []) {
    if (!bboxOverlap(bb, bbox(b.ring))) continue;
    const a = boolean([ring], [b.ring], 'inter').reduce((s, r) => s + polyArea(r), 0);
    if (a > 5e4) out.buildings.push(b.label); // more than 0.05 m2 of overlap
  }
  if (ctx.lot) {
    const inside = boolean([ring], [ctx.lot], 'inter').reduce((s, r) => s + polyArea(r), 0);
    if (inside < Math.abs(polyArea(ring)) - 5e4) out.outsideLot = true;
  }
  if (out.buildings.length) out.text.push(`Crosses ${out.buildings.join(', ')}. Hardstand is not blocked, check the layout.`);
  if (out.outsideLot) out.text.push('Part of this lies outside the lot and is cut off at the boundary.');
  return out;
}

// Editing the spec --------------------------------------------------------------------------------------------------------------

export const nextHardstandId = (c) => `${HS_PREFIX}${nextNumber(c)}`;
function nextNumber(c) {
  let n = 0;
  for (const o of c.pavements || []) { const m = /^hs_(\d+)/.exec(String(o?.id || '')); if (m) n = Math.max(n, Number(m[1])); }
  return n + 1;
}

const entry = (c, id) => (c.pavements || []).find((o) => o && o.id === id) || null;
const own = (poly) => poly.map((p) => ({ x: r1(p.x), y: r1(p.y) }));

/** The pieces of a polygon inside the lot (the lot ring may be null: no clipping). Returns { pieces, clipped }. */
export function clipToLot(poly, lot) {
  const ring = cleanRing(poly);
  if (ring.length < 3 || Math.abs(polyArea(ring)) < 1e4) return { pieces: [], clipped: false };
  if (!lot) return { pieces: [ring], clipped: false };
  const pieces = clipTo(ring, lot);
  const total = pieces.reduce((s, r) => s + Math.abs(polyArea(r)), 0);
  const clipped = total < Math.abs(polyArea(ring)) - 1e4;
  // Not cut: keep the corners as drawn (a corner added on a straight edge is kept, so it can be dragged).
  if (!clipped && pieces.length === 1) return { pieces: [poly.map((q) => ({ x: r1(q.x), y: r1(q.y) })).filter((q, i, a) => !i || q.x !== a[i - 1].x || q.y !== a[i - 1].y)], clipped };
  return { pieces, clipped };
}

/** Add a drawn area, clipped to the lot. Returns { ids, clipped, outside }. The new area is first in the list, so it sits on top. */
export function addHardstand(c, { type, polygon, lot = null, carpark = null }) {
  if (!isPavementType(type)) throw new Error('Choose a pavement type.');
  const { pieces, clipped } = clipToLot(polygon, lot);
  if (!pieces.length) return { ids: [], clipped, outside: true };
  if (!Array.isArray(c.pavements)) c.pavements = [];
  let n = nextNumber(c);
  const ids = [];
  const made = pieces.map((p) => { const id = `${HS_PREFIX}${n++}`; ids.push(id); return { id, type, polygon: own(p), ...(carpark ? { carpark: { ...carpark } } : {}) }; });
  c.pavements.unshift(...made);
  return { ids, clipped, outside: false };
}

/** Replace the polygon of a drawn area (moved, a vertex dragged, added or removed), clipped to the lot. The largest piece keeps the id. */
export function setHardstandPolygon(c, id, polygon, lot = null) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  const { pieces, clipped } = clipToLot(polygon, lot);
  if (!pieces.length) return { ids: [id], clipped, outside: true };
  const sorted = pieces.slice().sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  e.polygon = own(sorted[0]);
  delete e.road; // a free reshape of the outline turns a road into a plain area
  const ids = [id];
  let n = nextNumber(c);
  const extra = sorted.slice(1).map((p) => { const nid = `${HS_PREFIX}${n++}`; ids.push(nid); return { id: nid, type: e.type, polygon: own(p), ...(e.carpark ? { carpark: { ...e.carpark, removed: [], shifts: {} } } : {}) }; });
  if (extra.length) c.pavements.splice(c.pavements.indexOf(e) + 1, 0, ...extra);
  return { ids, clipped, outside: false };
}

export function moveHardstand(c, id, dx, dy, lot = null) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  if (e.road) { // a road moves by its centre line (roads.js rebuilds the outline)
    return roadsHook.setRoad(c, id, { centre: e.road.centre.map((p) => ({ x: p.x + dx, y: p.y + dy })) }, lot);
  }
  return setHardstandPolygon(c, id, e.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy })), lot);
}

export function setHardstandType(c, id, type) {
  if (!isPavementType(type)) throw new Error('Choose a pavement type.');
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  e.type = type;
}

export function removeHardstand(c, id) {
  const i = (c.pavements || []).findIndex((o) => o && o.id === id);
  if (i < 0) throw new Error('That hardstand area is gone.');
  c.pavements.splice(i, 1);
}

/** A copy of an area, shifted 2 m across and down (the other way when that falls outside the lot). Returns { ids }. */
export function duplicateHardstand(c, id, lot = null, offset = 2000) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  if (e.road) {
    for (const k of [offset, -offset]) {
      const r = roadsHook.addRoad(c, { kind: e.road.kind, centre: e.road.centre.map((p) => ({ x: p.x + k, y: p.y + k })), widthMm: e.road.widthMm, type: e.type, lot });
      if (!r.outside) return r;
    }
    throw new Error('There is no room inside the lot for a copy.');
  }
  for (const k of [offset, -offset]) {
    const poly = e.polygon.map((p) => ({ x: p.x + k, y: p.y + k }));
    const r = addHardstand(c, { type: e.type, polygon: poly, lot });
    if (!r.outside) return r;
  }
  throw new Error('There is no room inside the lot for a copy.');
}

/** Insert a vertex on edge `edge` (between vertex edge and edge + 1) at point p. Returns the new vertex index. */
export function insertVertex(c, id, edge, p) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  e.polygon.splice(edge + 1, 0, { x: r1(p.x), y: r1(p.y) });
  return edge + 1;
}

export function removeVertex(c, id, index) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  if (e.polygon.length <= 3) throw new Error('An area needs at least three corners. Delete it instead.');
  e.polygon.splice(index, 1);
}

/** The vertex or edge of a polygon nearest to p within `tol` mm: { kind: 'vertex', index } | { kind: 'edge', index, point } | null. Vertices win. */
export function pickPart(poly, p, tol) {
  let best = null;
  poly.forEach((v, i) => { const d = Math.hypot(v.x - p.x, v.y - p.y); if (d <= tol && (!best || d < best.d)) best = { kind: 'vertex', index: i, d }; });
  if (best) return best;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= tol && (!best || d < best.d)) best = { kind: 'edge', index: i, point: q, d };
  });
  return best;
}

/** The topmost drawn area at a point (the list is newest first, so the first hit is on top), or null. */
export function hardstandAt(c, p) {
  return hardstandList(c).find((a) => pointInPoly(p, a.polygon)) || null;
}

// Fill area -----------------------------------------------------------------------------------------------------------------------

/**
 * Fill the open ground around `p`: the lot minus the buildings and the pavement already there. Returns { pieces } (hole free polygons, more
 * than one when buildings stand inside the space) or { error } when the point is not in open ground.
 */
export function fillRegion(p, ctx) {
  if (!ctx.lot) return { error: 'Fill needs the lot boundary. Look up the lot first.' };
  if (!pointInPoly(p, ctx.lot)) return { error: 'That point is outside the lot.' };
  for (const b of ctx.buildings) if (pointInPoly(p, b.ring)) return { error: `That point is inside ${b.label}. Click open ground.` };
  for (const a of ctx.areas) if (pointInPoly(p, a.ring)) return { error: 'That ground is already paved. Click open ground, or draw over it to replace it.' };
  let region = [ctx.lot];
  const bb = (r) => bbox(r);
  const obstacles = [...ctx.buildings.map((b) => b.ring), ...ctx.areas.map((a) => a.ring)];
  for (const o of obstacles) {
    if (!bboxOverlap(bb(ctx.lot), bb(o))) continue;
    region = boolean(region, [o], 'diff');
  }
  const g = groups(region).find((x) => pointInPoly(p, x.outer) && !x.holes.some((h) => pointInPoly(p, orient([h], false)[0])));
  if (!g) return { error: 'Could not find a closed space there. Draw the area instead.' };
  const pieces = holeFree([g.outer, ...g.holes]);
  if (!pieces.length) return { error: 'There is no open ground there.' };
  return { pieces };
}

// Line marking prompts -------------------------------------------------------------------------------------------------------------

const centroidOf = (poly) => { let a = 0; let cx = 0; let cy = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; const f = p.x * q.y - q.x * p.y; a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f; }); return a ? { x: cx / (3 * a), y: cy / (3 * a) } : poly[0]; };

/** Inside point near the centroid (the centroid itself unless the shape bends round it). */
export function labelPoint(poly) {
  const c = centroidOf(poly);
  if (pointInPoly(c, poly)) return c;
  const bb = bbox(poly);
  let best = null;
  for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
    const q = { x: bb.minX + ((bb.maxX - bb.minX) * i) / 20, y: bb.minY + ((bb.maxY - bb.minY) * j) / 20 };
    if (pointInPoly(q, poly)) { const d = Math.hypot(q.x - c.x, q.y - c.y); if (!best || d < best.d) best = { d, q }; }
  }
  return best ? best.q : poly[0];
}

/** Angle in degrees of the longest edge of a polygon. */
export function longEdgeDeg(poly) {
  let best = { l: 0, a: 0 };
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; const l = Math.hypot(q.x - p.x, q.y - p.y); if (l > best.l) best = { l, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI }; });
  return Math.round(best.a * 10) / 10;
}

/**
 * Line marking prompts for the drawn areas that carry vehicles: [{ areaId, text, marking? }] where `marking` is a marking item that can be
 * added to project.commercial.markings (an arrow, or a keep clear box). Prompts only: nothing is added until the person agrees.
 */
export function markingPrompts(commercial, ids = null) {
  const out = [];
  const want = ids ? new Set(ids.map(baseId)) : null;
  for (const a of hardstandList(commercial)) {
    if (want && !want.has(a.id)) continue;
    const t = pavementById(a.type);
    if (!t || a.type === 'gravel-yard') continue;
    const vehicular = t.use.includes('car') || t.use.includes('truck');
    if (!vehicular || (t.use.length === 1 && t.use[0] === 'pedestrian')) continue;
    const m2 = areaM2(a.polygon);
    if (m2 < 20) continue;
    const at = labelPoint(a.polygon);
    const rot = longEdgeDeg(a.polygon);
    const truck = t.use.includes('truck');
    out.push(truck
      ? { areaId: a.id, text: `${t.short}, ${m2.toFixed(0)} m2: a keep clear box or directional arrows may be wanted on this truck area. Line marking is designed to AS 1742 and AS/NZS 2890, check with council.`, marking: { type: 'keep-clear', x: r1(at.x), y: r1(at.y), rotationDeg: rot } }
      : { areaId: a.id, text: `${t.short}, ${m2.toFixed(0)} m2: bay lines or directional arrows may be wanted on this car area. Line marking is designed to AS 1742 and AS/NZS 2890, check with council.`, marking: { type: 'arrow-straight', x: r1(at.x), y: r1(at.y), rotationDeg: rot } });
  }
  return out;
}

/** Add a marking prompt's marking to project.commercial.markings. */
export function addPromptMarking(c, prompt) {
  if (!prompt?.marking) return;
  if (!Array.isArray(c.markings)) c.markings = [];
  c.markings.push({ ...prompt.marking });
}

// Summary -------------------------------------------------------------------------------------------------------------------------

/**
 * Quantities and cost for the panel: { drawn: [{ id, type, label, areaM2 }], byType: [{ type, label, areaM2 }], totalM2, drawnM2, cost, ... }.
 * `byType` and `cost` cover every pavement area in use (auto assigned and drawn alike), from the same model the plan set and feasibility read.
 */
export function hardstandSummary(commercial, lot = null) {
  const model = pavementModel(commercial, lot);
  const pc = pavementCost(commercial, { lot, model });
  const drawn = model.areas.filter((a) => a.role === 'hardstand');
  const drawnM2 = drawn.reduce((s, a) => s + a.areaM2, 0);
  const byDrawn = new Map();
  for (const a of drawn) { const e = byDrawn.get(a.type) || { type: a.type, label: pavementById(a.type).short, areaM2: 0 }; e.areaM2 += a.areaM2; byDrawn.set(a.type, e); }
  return {
    drawn: hardstandList(commercial).map((a) => ({ id: a.id, type: a.type, label: pavementById(a.type).short, areaM2: areaM2(a.polygon) })),
    drawnByType: [...byDrawn.values()],
    drawnM2,
    byType: model.quantities.byType.map((e) => ({ type: e.type, label: e.label, areaM2: e.areaM2 })),
    totalM2: model.quantities.totalAreaM2,
    pavementCost: pc.groups.pavements,
    siteWorks: pc.value,
    model,
  };
}

export { inRegion };


// Dynamic editing: rotate, resize, car park settings ----------------------------------------------------------------------------------

const cen = (poly) => { const a = polyArea(poly); if (Math.abs(a) < 1) return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length }; return centroidOf(poly); };
export const centreOf = cen;

/** Rotate a polygon by `deg` about `about` (default its centre). */
export function rotatePolygon(poly, deg, about = null) {
  const o = about || cen(poly);
  const a = (deg * Math.PI) / 180; const co = Math.cos(a); const si = Math.sin(a);
  return poly.map((p) => ({ x: r1(o.x + (p.x - o.x) * co - (p.y - o.y) * si), y: r1(o.y + (p.x - o.x) * si + (p.y - o.y) * co) }));
}

/** True when the polygon is a four cornered rectangle (any rotation, corners square to within 1 degree). */
export function isRect(poly) {
  if (!Array.isArray(poly) || poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i]; const b = poly[(i + 1) % 4]; const c = poly[(i + 2) % 4];
    const u = { x: b.x - a.x, y: b.y - a.y }; const v = { x: c.x - b.x, y: c.y - b.y };
    const l = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    if (l < 1 || Math.abs((u.x * v.x + u.y * v.y) / l) > 0.0175) return false;
  }
  return true;
}

/**
 * Resize a rectangle by dragging a corner (kind 'corner', index = the corner) or an edge midpoint (kind 'edge', index = the edge, from vertex
 * index to index + 1) to point p. The opposite corner or edge stays put and the shape stays a rectangle at its own angle.
 */
export function resizeRect(poly, kind, index, p) {
  const n = 4;
  const out = poly.map((q) => ({ ...q }));
  if (kind === 'corner') {
    const o = poly[(index + 2) % n]; const n1 = poly[(index + 1) % n]; const n3 = poly[(index + 3) % n];
    const lu = Math.hypot(n1.x - o.x, n1.y - o.y) || 1; const lv = Math.hypot(n3.x - o.x, n3.y - o.y) || 1;
    const ou = { x: (n1.x - o.x) / lu, y: (n1.y - o.y) / lu }; const ov = { x: (n3.x - o.x) / lv, y: (n3.y - o.y) / lv };
    const d = { x: p.x - o.x, y: p.y - o.y };
    const a = d.x * ou.x + d.y * ou.y; const b = d.x * ov.x + d.y * ov.y;
    out[index] = { x: r1(o.x + ou.x * a + ov.x * b), y: r1(o.y + ou.y * a + ov.y * b) };
    out[(index + 1) % n] = { x: r1(o.x + ou.x * a), y: r1(o.y + ou.y * a) };
    out[(index + 3) % n] = { x: r1(o.x + ov.x * b), y: r1(o.y + ov.y * b) };
    return out;
  }
  const a = poly[index]; const b = poly[(index + 1) % n];
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nrm = { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const t = (p.x - mid.x) * nrm.x + (p.y - mid.y) * nrm.y;
  out[index] = { x: r1(a.x + nrm.x * t), y: r1(a.y + nrm.y * t) };
  out[(index + 1) % n] = { x: r1(b.x + nrm.x * t), y: r1(b.y + nrm.y * t) };
  return out;
}

/** Angle (degrees, 0 to 180) of every edge of the lot, setback line and buildings: what a rotating hardstand snaps to. */
export function edgeAngles(ctx) {
  const set = [];
  const rings = [ctx.lot, ctx.envelope, ...(ctx.buildings || []).map((b) => b.ring)].filter(Boolean);
  for (const ring of rings) ring.forEach((a, i) => { const b = ring[(i + 1) % ring.length]; if (Math.hypot(b.x - a.x, b.y - a.y) > 1000) set.push((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180 + 180) % 180); });
  return set;
}

/** Snap a polygon's long edge angle change: turns `deg` into a nicer turn when the result lines up with an edge or a 15 degree step. */
export function snapTurn(poly, deg, ctx, { alt = false, shift = false } = {}) {
  if (alt) return Math.round(deg * 10) / 10;
  if (shift) return Math.round(deg / 15) * 15;
  const base = longestEdgeAngle(poly);
  const want = base + deg;
  for (const e of edgeAngles(ctx)) for (const k of [0, 90]) {
    let d = (((want - e - k) % 180) + 270) % 180 - 90;
    if (Math.abs(d) <= 2.5) return Math.round((deg - d) * 10) / 10;
  }
  return Math.round(deg * 2) / 2;
}

/** Set (or merge into) the car park fill of a drawn area; `patch` null removes the fill. Returns the stored settings or null. */
export function setHardstandCarpark(c, id, patch) {
  const e = entry(c, id);
  if (!e) throw new Error('That hardstand area is gone.');
  if (e.road) throw new Error('A road cannot hold a car park. Draw an area.');
  if (patch === null) { delete e.carpark; return null; }
  const merged = { ...CARPARK_DEFAULTS, ...(e.carpark || {}), ...patch };
  if (patch.bayAngle !== undefined) { merged.removed = []; merged.shifts = {}; }
  e.carpark = { ...merged, removed: [...(merged.removed || [])], shifts: { ...(merged.shifts || {}) } };
  cpConfig(e.carpark);
  return e.carpark;
}

/** Slide one bay row along its length by dMm (keeps the sum of earlier slides). */
export function shiftBayRow(c, id, row, dMm) {
  const e = entry(c, id);
  if (!e?.carpark) throw new Error('That area has no car park fill.');
  const shifts = { ...(e.carpark.shifts || {}) };
  shifts[row] = r1((Number(shifts[row]) || 0) + dMm);
  e.carpark = { ...e.carpark, shifts };
}

/** Delete (or bring back) one bay by its key "row:col". */
export function removeBay(c, id, key, back = false) {
  const e = entry(c, id);
  if (!e?.carpark) throw new Error('That area has no car park fill.');
  const set = new Set(e.carpark.removed || []);
  if (back) set.delete(key); else set.add(key);
  e.carpark = { ...e.carpark, removed: [...set] };
}

/** Turn a polygon into a rotated copy of itself to the long edge angle (used to align a car park with its hardstand). */
export const hardstandAngle = (poly) => longestEdgeAngle(poly);

// Roads, driveways and pavements (footpaths) drawn by clicking points: the pure side. A drawn road is a hardstand entry of
// project.commercial.pavements ({ id: 'hs_N', type, polygon }) that also carries its centre line: { road: { kind, centre: [pt, pt, ...], widthMm } }.
// The polygon is always derived from the centre line and the width (corridor()), clipped to the lot, so the pavement model, kerbs, quantities,
// feasibility, the 3D surface, the 2D plan and the plan set read a road exactly like any hand drawn hardstand: no second pipeline.
//
// Also here: snapping a road point to the street frontage, a building door, the end of another road or a generated aisle; picking the generated
// site works (aisles, footpaths, aprons, crossovers) so they can be selected and removed one by one (siteRemoved.ids); turning a generated
// aisle into a road the person can edit; and the access report the checks read. Plan mm, y down. No DOM.

import { polyArea, absArea, segCross, bbox, pointInPoly } from './geom.js';
import { boolean, holeFree, cleanRing } from './polybool.js';
import { isPavementType } from './pavements.js';
import { HS_PREFIX, isHardstandId, clipToLot, hsContext, snapPoint, nextHardstandId, roadsHook } from './hardstand.js';
import { buildingsOf, siteWorksOf } from '../buildings.js';
import { layoutUnits } from '../../layout.js';

/** Types of drawn corridor, with the default width and surface. A car park or hardstand is an area (the Hardstand tool's rectangle and polygon). */
export const ROAD_KINDS = Object.freeze([
  { id: 'road', label: 'Road', widthMm: 7000, minMm: 3000, maxMm: 20000, type: 'asphalt-ac10-truck', hint: 'Two way road for cars and trucks, 7 m' },
  { id: 'driveway', label: 'Driveway', widthMm: 6000, minMm: 2500, maxMm: 15000, type: 'asphalt-ac10-car', hint: 'Driveway from the street to the building, 6 m' },
  { id: 'pavement', label: 'Pavement (footpath)', widthMm: 1500, minMm: 900, maxMm: 6000, type: 'concrete-footpath', hint: 'Footpath, 1.5 m' },
]);
export const roadKind = (id) => ROAD_KINDS.find((k) => k.id === id) || ROAD_KINDS[0];
export const isRoadKind = (id) => ROAD_KINDS.some((k) => k.id === id);
export const MIN_ROAD_MM = 1000; // shortest centre line that makes a road

const r1 = Math.round;
const num = Number.isFinite;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampW = (kind, w) => { const k = roadKind(kind); return Math.min(k.maxMm, Math.max(k.minMm, num(Number(w)) ? Math.round(Number(w)) : k.widthMm)); };

/** Clean a centre line: finite points, rounded to 1 mm, with repeated points dropped. */
export function cleanCentre(centre) {
  const out = [];
  for (const p of Array.isArray(centre) ? centre : []) {
    if (!num(p?.x) || !num(p?.y)) continue;
    const q = { x: r1(p.x), y: r1(p.y) };
    if (!out.length || dist(out[out.length - 1], q) > 1) out.push(q);
  }
  return out;
}

export const centreLengthM = (centre) => centre.reduce((s, p, i) => (i ? s + dist(centre[i - 1], p) : 0), 0) / 1000;

// Corridor ------------------------------------------------------------------------------------------------------------------------

const unit = (a, b) => { const l = dist(a, b) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };

function simple(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const t = segCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]);
      if (t != null && t > 1e-6 && t < 1 - 1e-6) return false;
    }
  }
  return true;
}

/** One side of the corridor, offset `h` mm to the left of the direction of travel (mitre joins, bevelled when the corner is sharp). */
function sideOffset(pts, h) {
  const out = [];
  const nrm = (u) => ({ x: u.y, y: -u.x });
  const L = pts.length;
  for (let i = 0; i < L; i++) {
    if (i === 0) { const n = nrm(unit(pts[0], pts[1])); out.push({ x: pts[0].x + n.x * h, y: pts[0].y + n.y * h }); continue; }
    if (i === L - 1) { const n = nrm(unit(pts[L - 2], pts[L - 1])); out.push({ x: pts[i].x + n.x * h, y: pts[i].y + n.y * h }); continue; }
    const n0 = nrm(unit(pts[i - 1], pts[i]));
    const n1 = nrm(unit(pts[i], pts[i + 1]));
    const m = { x: n0.x + n1.x, y: n0.y + n1.y };
    const cos = n0.x * n1.x + n0.y * n1.y;
    if (1 + cos < 0.35) { out.push({ x: pts[i].x + n0.x * h, y: pts[i].y + n0.y * h }, { x: pts[i].x + n1.x * h, y: pts[i].y + n1.y * h }); continue; }
    const k = h / (1 + cos);
    out.push({ x: pts[i].x + m.x * k, y: pts[i].y + m.y * k });
  }
  return out;
}

/** The pavement outline of a centre line and width: a simple counter clockwise ring (the union of the segments when a sharp bend folds it). */
export function corridor(centre, widthMm) {
  const pts = cleanCentre(centre);
  if (pts.length < 2 || !(widthMm > 0)) return [];
  const h = widthMm / 2;
  const left = sideOffset(pts, h);
  const right = sideOffset(pts.slice().reverse(), h);
  let ring = [...left, ...right].map((p) => ({ x: r1(p.x), y: r1(p.y) }));
  ring = ring.filter((p, i, a) => !i || dist(p, a[i - 1]) > 0);
  if (ring.length < 3 || !simple(ring)) {
    // fold: union of a rectangle per segment and a square at each joint
    let region = [];
    const rect = (a, b) => { const u = unit(a, b); const n = { x: u.y * h, y: -u.x * h }; return [{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }]; };
    for (let i = 0; i + 1 < pts.length; i++) region = boolean(region, [rect(pts[i], pts[i + 1])], 'union');
    for (let i = 1; i + 1 < pts.length; i++) region = boolean(region, [[{ x: pts[i].x - h, y: pts[i].y - h }, { x: pts[i].x + h, y: pts[i].y - h }, { x: pts[i].x + h, y: pts[i].y + h }, { x: pts[i].x - h, y: pts[i].y + h }]], 'union');
    const pieces = holeFree(region).sort((p, q) => Math.abs(polyArea(q)) - Math.abs(polyArea(p)));
    ring = pieces[0] ? pieces[0].map((p) => ({ x: r1(p.x), y: r1(p.y) })) : [];
  }
  const clean = cleanRing(ring);
  const out = clean.length >= 3 ? clean : ring;
  return polyArea(out) < 0 ? out.slice().reverse() : out;
}

// The spec ------------------------------------------------------------------------------------------------------------------------

/** The drawn roads as stored: [{ id, kind, type, centre, widthMm, polygon }]. */
export function roadList(commercial) {
  const out = [];
  for (const o of Array.isArray(commercial?.pavements) ? commercial.pavements : []) {
    if (!o || !isHardstandId(o.id) || !o.road || !isRoadKind(o.road.kind)) continue;
    const centre = cleanCentre(o.road.centre);
    if (centre.length < 2 || !isPavementType(o.type)) continue;
    out.push({ id: o.id, kind: o.road.kind, type: o.type, centre, widthMm: clampW(o.road.kind, o.road.widthMm), polygon: Array.isArray(o.polygon) ? o.polygon.map((p) => ({ x: p.x, y: p.y })) : [] });
  }
  return out;
}
export const roadById = (c, id) => roadList(c).find((r) => r.id === id) || null;
const entryOf = (c, id) => (c.pavements || []).find((o) => o && o.id === id) || null;

function build(centre, widthMm, lot) {
  const ring = corridor(centre, widthMm);
  if (ring.length < 3) return { polygon: null, clipped: false };
  const { pieces, clipped } = clipToLot(ring, lot);
  if (!pieces.length) return { polygon: null, clipped };
  const best = pieces.slice().sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)))[0];
  return { polygon: best.map((p) => ({ x: r1(p.x), y: r1(p.y) })), clipped: clipped && pieces.length >= 1 };
}

/** Add a road. Returns { ids, clipped, outside }. The new road goes first in the list, so it sits on top (the newer area cuts the older one). */
export function addRoad(c, { kind = 'road', centre, widthMm = null, type = null, lot = null }) {
  const k = roadKind(kind);
  const pts = cleanCentre(centre);
  if (pts.length < 2 || centreLengthM(pts) * 1000 < MIN_ROAD_MM) throw new Error('A road needs two points at least 1 m apart.');
  const t = type && isPavementType(type) ? type : k.type;
  const w = clampW(k.id, widthMm ?? k.widthMm);
  const { polygon, clipped } = build(pts, w, lot);
  if (!polygon) return { ids: [], clipped, outside: true };
  if (!Array.isArray(c.pavements)) c.pavements = [];
  const id = nextHardstandId(c);
  c.pavements.unshift({ id, type: t, polygon, road: { kind: k.id, centre: pts, widthMm: w } });
  return { ids: [id], clipped, outside: false };
}

/** Change a road: { centre?, widthMm?, kind?, type? }. Rebuilds the outline. Returns { ids, clipped, outside }. */
export function setRoad(c, id, patch, lot = null) {
  const e = entryOf(c, id);
  if (!e?.road) throw new Error('That road is gone.');
  const kind = patch.kind && isRoadKind(patch.kind) ? patch.kind : e.road.kind;
  const centre = patch.centre ? cleanCentre(patch.centre) : cleanCentre(e.road.centre);
  if (centre.length < 2) throw new Error('A road needs two points at least.');
  const widthMm = clampW(kind, patch.widthMm ?? e.road.widthMm);
  const { polygon, clipped } = build(centre, widthMm, lot);
  if (!polygon) return { ids: [id], clipped, outside: true };
  if (patch.type !== undefined) { if (!isPavementType(patch.type)) throw new Error('Choose a pavement type.'); e.type = patch.type; }
  e.polygon = polygon;
  e.road = { kind, centre, widthMm };
  return { ids: [id], clipped, outside: false };
}

export function moveRoad(c, id, dx, dy, lot = null) {
  const e = entryOf(c, id);
  if (!e?.road) throw new Error('That road is gone.');
  return setRoad(c, id, { centre: e.road.centre.map((p) => ({ x: p.x + dx, y: p.y + dy })) }, lot);
}

/** Insert a centre line point after point `seg` (the middle of that segment when `p` is not given). Returns the new point index. */
export function insertRoadPoint(c, id, seg, p = null, lot = null) {
  const e = entryOf(c, id);
  if (!e?.road) throw new Error('That road is gone.');
  const a = e.road.centre[seg]; const b = e.road.centre[seg + 1];
  if (!a || !b) throw new Error('There is no such segment.');
  const q = p || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const centre = e.road.centre.slice();
  centre.splice(seg + 1, 0, { x: r1(q.x), y: r1(q.y) });
  setRoad(c, id, { centre }, lot);
  return seg + 1;
}

export function removeRoadPoint(c, id, index, lot = null) {
  const e = entryOf(c, id);
  if (!e?.road) throw new Error('That road is gone.');
  if (e.road.centre.length <= 2) throw new Error('A road needs two points at least. Delete it instead.');
  const centre = e.road.centre.slice();
  centre.splice(index, 1);
  setRoad(c, id, { centre }, lot);
}

/** The handles of a road: its points, the middle of each segment, and the width handle (on the left edge of the longest segment). */
export function roadHandles(road) {
  const out = [];
  road.centre.forEach((p, i) => out.push({ kind: 'point', index: i, x: p.x, y: p.y }));
  let best = -1; let bl = 0;
  road.centre.forEach((p, i) => {
    const q = road.centre[i + 1];
    if (!q) return;
    const l = dist(p, q);
    out.push({ kind: 'mid', index: i, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    if (l > bl) { bl = l; best = i; }
  });
  if (best >= 0) {
    const a = road.centre[best]; const b = road.centre[best + 1];
    const u = unit(a, b);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    out.push({ kind: 'width', index: best, x: m.x + u.y * road.widthMm / 2, y: m.y - u.x * road.widthMm / 2 });
  }
  return out;
}

/** The width a drag of the width handle (on segment `seg`) to world point p gives: twice its distance from the centre line, snapped to 100 mm. */
export function widthFromPoint(road, seg, p) {
  const a = road.centre[seg]; const b = road.centre[seg + 1];
  if (!a || !b) return road.widthMm;
  const u = unit(a, b);
  const d = Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
  return clampW(road.kind, Math.round((d * 2) / 100) * 100);
}

/** The road under a point (the newest on top), or null. */
export function roadAt(c, p) {
  for (const r of roadList(c)) if (r.polygon.length >= 3 && pointInPoly(p, r.polygon)) return r;
  return null;
}

// Snapping ------------------------------------------------------------------------------------------------------------------------

const nearestOnSeg = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
};

/** The doors of the buildings and strata units, where a driveway or path should end: [{ x, y, label }]. */
export function doorPoints(c) {
  const out = [];
  for (const u of layoutUnits(c || {})) out.push({ x: r1((u.frontA.x + u.frontB.x) / 2), y: r1((u.frontA.y + u.frontB.y) / 2), label: `Unit ${u.n} door` });
  for (const b of buildingsOf(c || {})) {
    const xs = b.local?.outline?.map((q) => q.x) || []; const ys = b.local?.outline?.map((q) => q.y) || [];
    if (!xs.length) continue;
    const a = ((b.place.rotationDeg || 0) * Math.PI) / 180;
    const lx = (Math.min(...xs) + Math.max(...xs)) / 2; const ly = Math.min(...ys);
    out.push({ x: r1(b.place.x + Math.cos(a) * lx - Math.sin(a) * ly), y: r1(b.place.y + Math.sin(a) * lx + Math.cos(a) * ly), label: `${b.label || 'Building'} door` });
  }
  return out;
}

/** The street edges of the lot: [[a, b]] (the front edges of the boundary). */
export function frontageEdges(lot) {
  const b = lot?.boundary;
  const fe = lot?.frontEdges;
  if (!Array.isArray(b) || b.length < 3 || !Array.isArray(fe)) return [];
  return fe.filter((i) => b[i] && b[(i + 1) % b.length]).map((i) => [b[i], b[(i + 1) % b.length]]);
}

/**
 * What a road point snaps to: { frontage: [[a, b]], doors, ends: [pt], lines: [[a, b]], base } where `ends` are the end points of the other drawn
 * roads, `lines` the centre lines of the other drawn roads and the generated aisles, and `base` the Hardstand snapping context.
 * `exclude` leaves one drawn road out (the one being edited).
 */
export function roadSnapContext(project, { exclude = null } = {}) {
  const c = project?.commercial || {};
  const lot = project?.site?.lot || null;
  const others = roadList(c).filter((r) => r.id !== exclude);
  const ends = others.flatMap((r) => [r.centre[0], r.centre[r.centre.length - 1]]);
  const lines = [];
  for (const r of others) for (let i = 0; i + 1 < r.centre.length; i++) lines.push([r.centre[i], r.centre[i + 1]]);
  for (const a of siteWorksOf(c)?.aisles || []) if (Array.isArray(a.centre) && a.centre.length >= 2) lines.push([a.centre[0], a.centre[1]]);
  return { frontage: frontageEdges(lot), doors: doorPoints(c), ends, lines, base: hsContext(project, { exclude }) };
}

/**
 * Snap a road point. Priority: a building door, the end of another road, the street frontage (the nearest point of the front boundary), the
 * centre line of another road or aisle, then the Hardstand snapping (lot corners, setbacks, buildings, grid). `alt` turns it all off.
 * Returns { x, y, kind: 'door' | 'road-end' | 'frontage' | 'road' | (hardstand kinds), source, text }.
 */
export function snapRoadPoint(world, rctx, { mmPerPx = 10, alt = false, tolPx = 12 } = {}) {
  if (alt) return { x: r1(world.x), y: r1(world.y), kind: 'free', source: null, text: 'No snap' };
  const tol = tolPx * mmPerPx;
  let best = null;
  const take = (d, cand) => { if (d <= tol && (!best || d < best.d)) best = { d, ...cand }; };
  for (const dp of rctx.doors) take(dist(world, dp), { x: dp.x, y: dp.y, kind: 'door', source: dp.label, text: `On ${dp.label}` });
  if (best) return finish(best);
  for (const e of rctx.ends) take(dist(world, e), { x: e.x, y: e.y, kind: 'road-end', source: 'road end', text: 'End of another road' });
  if (best) return finish(best);
  for (const [a, b] of rctx.frontage) {
    // a corner of the frontage wins over its edge, so a road can start exactly at the lot corner
    for (const v of [a, b]) take(dist(world, v) * 0.8, { x: v.x, y: v.y, kind: 'frontage', source: 'street frontage', text: 'Corner of the street frontage' });
    const q = nearestOnSeg(world, a, b);
    take(dist(world, q), { x: q.x, y: q.y, kind: 'frontage', source: 'street frontage', text: 'On the street frontage' });
  }
  if (best) return finish(best);
  for (const [a, b] of rctx.lines) { const q = nearestOnSeg(world, a, b); take(dist(world, q), { x: q.x, y: q.y, kind: 'road', source: 'road', text: 'On another road' }); }
  if (best) return finish(best);
  const s = snapPoint(world, rctx.base, { mmPerPx, alt: false });
  return { ...s, text: undefined };
}
const finish = (b) => ({ x: r1(b.x), y: r1(b.y), kind: b.kind, source: b.source, text: b.text });

/** The label of a road snap result. */
export const roadSnapLabel = (s) => (s?.text ? s.text : null);

/** `p` turned to the nearest 15 degrees from `from` when `lock` is set (Shift while drawing). */
export function lockTo15(p, from, lock) {
  if (!lock || !from) return p;
  const d = { x: p.x - from.x, y: p.y - from.y };
  const l = Math.hypot(d.x, d.y);
  const a = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: r1(from.x + Math.cos(a) * l), y: r1(from.y + Math.sin(a) * l) };
}

// Generated site works: pick, remove, make editable ---------------------------------------------------------------------------

export const SITE_ITEM_LABELS = Object.freeze({ crossovers: 'Entry or exit', aisles: 'Aisle', pavedAisles: 'Aisle', footpaths: 'Footpath', aprons: 'Apron', forecourts: 'Forecourt', landscape: 'Landscaping' });
const PICK_ORDER = ['crossovers', 'footpaths', 'forecourts', 'aprons', 'pavedAisles', 'aisles', 'landscape'];

/**
 * The generated site works item under a point: { id, list, label, polygon, ids } or null. `ids` is everything that goes when it is removed (a paved
 * aisle takes the aisle centre lines inside it). Items the person already removed are not there (siteWorksOf filters them).
 */
export function siteItemAt(c, p) {
  const sw = siteWorksOf(c);
  if (!sw) return null;
  for (const list of PICK_ORDER) {
    for (const it of sw[list] || []) {
      const poly = it?.polygon;
      if (!Array.isArray(poly) || poly.length < 3 || !it.id || !pointInPoly(p, poly)) continue;
      return siteItemInfo(c, it, list);
    }
  }
  return null;
}

/** The generated item with this id (still there), as siteItemAt describes it, or null. */
export function siteItemById(c, id) {
  const sw = siteWorksOf(c);
  if (!sw || !id) return null;
  for (const list of PICK_ORDER) { const it = (sw[list] || []).find((x) => x?.id === id); if (it?.polygon) return siteItemInfo(c, it, list); }
  return null;
}

function siteItemInfo(c, it, list) {
  const ids = [it.id];
  if (list === 'pavedAisles') {
    for (const a of siteWorksOf(c)?.aisles || []) {
      if (!Array.isArray(a.centre) || a.centre.length < 2) continue;
      const m = { x: (a.centre[0].x + a.centre[1].x) / 2, y: (a.centre[0].y + a.centre[1].y) / 2 };
      if (pointInPoly(m, it.polygon) && !ids.includes(a.id)) ids.push(a.id);
    }
  }
  return { id: it.id, list, label: `${SITE_ITEM_LABELS[list] || 'Site works'} ${it.id}`, polygon: it.polygon.map((q) => ({ x: q.x, y: q.y })), ids };
}

/** Remove a generated item (and what goes with it) through siteRemoved.ids. Pure on the project object. Returns the ids removed. */
export function removeGenerated(p, id) {
  const c = p?.commercial;
  if (!c) return [];
  const info = siteItemById(c, id);
  const ids = info ? info.ids : [id];
  const r = { kinds: Array.isArray(c.siteRemoved?.kinds) ? [...c.siteRemoved.kinds] : [], ids: [...(c.siteRemoved?.ids || [])] };
  for (const x of ids) if (!r.ids.includes(x)) r.ids.push(x);
  c.siteRemoved = r;
  return ids;
}

/**
 * Turn a generated aisle into a drawn road the person can reshape: removes the generated aisle and adds a road along its centre line with its
 * width. Returns { id } of the new road, or null when the item is not an aisle with a centre line.
 */
export function makeEditable(c, id, lot = null) {
  const sw = siteWorksOf(c);
  const info = siteItemById(c, id);
  if (!sw || !info) return null;
  let centre = null; let width = null;
  const aisle = (sw.aisles || []).find((a) => a.id === id) || (sw.aisles || []).find((a) => info.ids.includes(a.id));
  if (aisle?.centre?.length >= 2) { centre = [aisle.centre[0], aisle.centre[1]]; width = aisle.widthMm; }
  else if (info.list === 'pavedAisles' || info.list === 'footpaths' || info.list === 'aprons') {
    const bb = bbox(info.polygon);
    const horiz = bb.maxX - bb.minX >= bb.maxY - bb.minY;
    const w = horiz ? bb.maxY - bb.minY : bb.maxX - bb.minX;
    centre = horiz ? [{ x: bb.minX, y: (bb.minY + bb.maxY) / 2 }, { x: bb.maxX, y: (bb.minY + bb.maxY) / 2 }] : [{ x: (bb.minX + bb.maxX) / 2, y: bb.minY }, { x: (bb.minX + bb.maxX) / 2, y: bb.maxY }];
    width = w;
  }
  if (!centre) return null;
  const kind = info.list === 'footpaths' ? 'pavement' : 'road';
  const r = addRoad(c, { kind, centre, widthMm: width, lot });
  if (!r.ids.length) return null;
  const p = { commercial: c };
  removeGenerated(p, id);
  return { id: r.ids[0], removed: info.ids };
}

// Access report -------------------------------------------------------------------------------------------------------------

/** Where a polyline touches the street: true when one of its ends is within `tolMm` of a front edge. */
export function touchesFrontage(centre, lot, tolMm = 400) {
  const edges = frontageEdges(lot);
  if (!edges.length || !centre?.length) return false;
  return [centre[0], centre[centre.length - 1]].some((e) => edges.some(([a, b]) => dist(e, nearestOnSeg(e, a, b)) <= tolMm));
}

/**
 * What the drawn roads give the site access: { roads, fromStreet: [road], widthMm (widest road or driveway that reaches the street, or null),
 * doorsServed: [label], doorsUnserved: [label] }. A door is served when a road or driveway passes within 4 m of it or when it lies on the pavement.
 */
export function roadAccess(c, lot = null) {
  const roads = roadList(c).filter((r) => r.kind !== 'pavement');
  const fromStreet = roads.filter((r) => touchesFrontage(r.centre, lot));
  const doors = doorPoints(c);
  const near = (d) => roads.some((r) => (r.polygon.length >= 3 && pointInPoly(d, r.polygon)) || r.centre.some((p, i) => { const q = r.centre[i + 1]; return q ? dist(d, nearestOnSeg(d, p, q)) <= 4000 + r.widthMm / 2 : false; }));
  return {
    roads,
    fromStreet,
    widthMm: fromStreet.length ? Math.max(...fromStreet.map((r) => r.widthMm)) : null,
    doorsServed: doors.filter(near).map((d) => d.label),
    doorsUnserved: doors.filter((d) => !near(d)).map((d) => d.label),
  };
}

export { HS_PREFIX, absArea };

roadsHook.setRoad = setRoad;
roadsHook.addRoad = addRoad;

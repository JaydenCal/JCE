// Rotate tool, the pure side (no DOM). Angles are degrees, clockwise on screen (plan y is down), the same sense as G.rotatePoint,
// rotationDeg on rows, buildings and the waste enclosure, and the gold turn ring.
//
// A rotation is a rigid turn of one or more TARGETS about a PIVOT. Targets are { kind, id? }:
//   house      the whole house with its outbuildings, and the tanks beside it (residential)
//   furniture, stairs   one item on the active level
//   way        a drawn driveway, road or footpath (project.site.paved)
//   building   a catalogue building (commercial)
//   row        a base row of strata units and its mirrored partner
//   estate     a drawn strata estate: its rows, bays, entry, aisles, footpaths and car park turn as one piece
//   carpark    an extra bay strip (commercial.parking.extra)
//   waste      the waste enclosure
//   hardstand  a drawn hardstand area or road (commercial.pavements)
//   group      everything on the site that can turn: the whole development
// Everything derived (a building's paving and parking, the unit rectangles, the 3D model) is regenerated from the turned spec, the way the
// gold ring does, so nothing twists or detaches. One call is one project edit: the caller wraps it in a single store.apply.

import * as G from '../model/geometry.js';
import { lotOf, rotateHouse, footprint } from '../model/placement.js';
import { turnHouseBy } from '../site/site-items.js';
import { buildingHull, orientedBox } from '../site/lotplan.js';
import { getWays, wayGeometry } from '../site/pavedways.js';
import { isCommercial, normaliseCommercial } from '../commercial/schema.js';
import { materialise } from '../commercial/materialise.js';
import { rowPoly, rowFrame, rowLength } from '../commercial/layout.js';
import { buildingsOf } from '../commercial/catalogue/buildings.js';
import { frontRotation } from '../commercial/catalogue/fit.js';
import { rowsSignature } from '../commercial/estate.js';
import { estateOf } from '../commercial/parking.js';
import { hardstandList } from '../commercial/catalogue/pavements/hardstand.js';
import { parkingLayout } from '../commercial/parking.js';

export const STEP_DEG = 15;
export const FINE_DEG = 1;
export const LOT_SNAP_DEG = 3; // within this of a lot edge angle the turn snaps square to it

const r0 = Math.round;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Wrap to [0, 360). */
export const wrap360 = (d) => ((((Number(d) || 0) % 360) + 360) % 360);
/** Wrap to (-180, 180]. */
export const wrap180 = (d) => { const w = wrap360(d); return w > 180 ? w - 360 : w; };
/** The angle of a screen vector from a centre, in degrees clockwise from east (y down). */
export const angleFrom = (c, p) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
/** Smallest signed step from angle a to angle b. */
export const shortest = (a, b) => wrap180(b - a);

/** Accumulate a drag: `prev` is the last raw reading (or null), `total` the running sum; the sum follows the pointer through the 180 degree seam. */
export function accumulate(total, prev, raw) {
  const d = shortest(0, raw);
  if (prev == null) return { total: d, prev: d };
  return { total: total + shortest(prev, d), prev: d };
}

const rot = (p, c, deg) => { const q = G.rotatePoint(p, c, deg); return { x: r0(q.x), y: r0(q.y) }; };
const rotVec = (v, deg) => { const a = (deg * Math.PI) / 180; return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) }; };

// Lot angles ---------------------------------------------------------------------------------------------------------------------------

/** The lot edges as angles: [{ index, deg (0..180 of the edge line), front: bool, a, b }]. */
export function lotAlignments(project) {
  const lot = lotOf(project);
  if (!lot?.boundary || lot.boundary.length < 3) return [];
  const n = lot.boundary.length;
  const fronts = new Set((lot.frontEdges || []).filter((e) => Number.isInteger(e) && e >= 0 && e < n));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lot.boundary[i];
    const b = lot.boundary[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    out.push({ index: i, deg: r3(wrap360(angleFrom(a, b)) % 180), front: fronts.has(i), a, b });
  }
  return out;
}

/** The smallest turn in [-45, 45) that makes an orientation `base` square (parallel or perpendicular) to a line at `lineDeg`. */
export const squareDelta = (base, lineDeg) => ((((lineDeg - base + 45) % 90) + 90) % 90) - 45;

// Targets ------------------------------------------------------------------------------------------------------------------------------

const rowsOf = (p) => p.commercial?.rows || [];
const srcRow = (c, id) => { const r = c.rows.find((x) => x.id === id); return r?.mirrorOf && c.rows.some((x) => x.id === r.mirrorOf) ? c.rows.find((x) => x.id === r.mirrorOf) : r; };

export const sameTarget = (a, b) => a.kind === b.kind && (a.id ?? null) === (b.id ?? null);

/** True when the project has something the group can turn. */
export function groupTargets(project) {
  const out = [];
  if (isCommercial(project) && project.commercial) {
    const c = project.commercial;
    for (const b of c.buildings || []) out.push({ kind: 'building', id: b.id });
    if (estateOf(c)) out.push({ kind: 'estate' });
    else {
      for (const r of c.rows || []) if (!r.mirrorOf) out.push({ kind: 'row', id: r.id });
      (c.parking?.extra || []).forEach((_, i) => out.push({ kind: 'carpark', id: i }));
    }
    if (c.waste) out.push({ kind: 'waste' });
    for (const h of hardstandList(c)) out.push({ kind: 'hardstand', id: h.id });
  } else if (lotOf(project) && footprint(project)) out.push({ kind: 'house' });
  for (const w of getWays(project)) out.push({ kind: 'way', id: w.id });
  return out;
}

/** The outline points of a target (plan mm), for the highlight and the centre. `ctx.furnSize(f)` sizes furniture. */
export function pointsOf(project, t, ctx = {}) {
  const c = project.commercial;
  switch (t.kind) {
    case 'house': { try { return buildingHull(project); } catch { return []; } }
    case 'furniture':
    case 'stairs': {
      for (const l of project.levels || []) {
        const it = (t.kind === 'furniture' ? l.furniture : l.stairs).find((x) => x.id === t.id);
        if (!it) continue;
        if (t.kind === 'stairs') return G.rectCorners(it.x, it.y, it.width || 1000, it.length || 3600, it.rotation || 0);
        const s = ctx.furnSize?.(it) || { w: 600, d: 600 };
        return G.rectCorners(it.x, it.y, s.w || 600, s.d || 600, it.rotation || 0);
      }
      return [];
    }
    case 'way': {
      const w = getWays(project).find((x) => x.id === t.id);
      if (!w) return [];
      try { const g = wayGeometry(project, w); const pts = (g.body || []).flat(); if (pts.length) return pts; } catch { /* fall back to the points */ }
      return w.pts.map((q) => ({ x: q.x, y: q.y }));
    }
    case 'building': { const b = buildingsOf(c || {}).find((x) => x.id === t.id); return b ? [...b.outline] : []; }
    case 'row': { const r = srcRow(c, t.id); return r ? [r, ...rowsOf(project).filter((x) => x.mirrorOf === r.id)].flatMap((x) => rowPoly(x, c.rows)) : []; }
    case 'estate': {
      const e = estateOf(c);
      if (!e) return [];
      const pts = c.rows.filter((r) => !r.mirrorOf).flatMap((r) => [r, ...c.rows.filter((x) => x.mirrorOf === r.id)].flatMap((x) => rowPoly(x, c.rows)));
      for (const k of ['paved', 'aprons', 'foot', 'bayPolys']) for (const it of e.network[k] || []) pts.push(...(it.polygon || []));
      return pts;
    }
    case 'carpark': { const lay = parkingLayout(c); const row = lay.rows.find((r) => r.rowId === `extra-${Number(t.id) + 1}`); return row ? row.slots.flatMap((s) => s.poly) : []; }
    case 'waste': return c?.waste ? G.rectCorners(c.waste.x, c.waste.y, c.waste.widthMm || 4000, c.waste.depthMm || 3000, c.waste.rotationDeg || 0) : [];
    case 'hardstand': return hardstandList(c || {}).find((h) => h.id === t.id)?.polygon || [];
    case 'group': return groupTargets(project).flatMap((x) => pointsOf(project, x, ctx));
    default: return [];
  }
}

/** The label for a target or a selection. */
export function labelOf(project, t) {
  switch (t.kind) {
    case 'house': return project.mode === 'commercial' ? 'Building' : 'House';
    case 'furniture': return 'Furniture';
    case 'stairs': return 'Stairs';
    case 'way': { const w = getWays(project).find((x) => x.id === t.id); return w ? (w.kind === 'road' ? 'Road' : w.kind === 'pavement' ? 'Footpath' : 'Driveway') : 'Pavement'; }
    case 'building': return buildingsOf(project.commercial || {}).find((x) => x.id === t.id)?.label || 'Building';
    case 'row': return 'Strata units';
    case 'estate': return 'Strata estate';
    case 'carpark': return 'Car park';
    case 'waste': return 'Waste enclosure';
    case 'hardstand': return hardstandList(project.commercial || {}).find((h) => h.id === t.id)?.road ? 'Road' : 'Hardstand';
    case 'group': return 'Whole development';
    default: return 'Item';
  }
}
export const selectionLabel = (project, sel) => (!sel.length ? '' : sel.length === 1 ? labelOf(project, sel[0]) : sel.some((t) => t.kind === 'group') ? 'Whole development' : `${sel.length} items`);

/** Expand a selection: a group becomes every target; duplicates drop. */
export function expand(project, sel) {
  const out = [];
  for (const t of sel) for (const x of t.kind === 'group' ? groupTargets(project) : [t]) if (!out.some((y) => sameTarget(x, y))) out.push(x);
  return out;
}

/** The centre of a selection: the middle of the box round all its points (the pivot unless a custom one is picked). */
export function centreOf(project, sel, ctx = {}) {
  const pts = expand(project, sel).flatMap((t) => pointsOf(project, t, ctx));
  if (!pts.length) return null;
  const bb = G.bbox(pts);
  return { x: r0((bb.minX + bb.maxX) / 2), y: r0((bb.minY + bb.maxY) / 2) };
}

/** The direction a target faces or runs, in degrees (what "square to the lot" lines up). */
export function orientationOf(project, t) {
  const c = project.commercial;
  switch (t.kind) {
    case 'building': return Number(c?.buildings?.find((b) => b.id === t.id)?.place?.rotationDeg) || 0;
    case 'row': return Number(srcRow(c, t.id)?.rotationDeg) || 0;
    case 'estate': return Number(rowsOf(project).find((r) => !r.mirrorOf)?.rotationDeg) || 0;
    case 'carpark': return Number(c?.parking?.extra?.[t.id]?.rotationDeg) || 0;
    case 'waste': return Number(c?.waste?.rotationDeg) || 0;
    case 'furniture': case 'stairs': {
      for (const l of project.levels || []) { const it = (t.kind === 'furniture' ? l.furniture : l.stairs).find((x) => x.id === t.id); if (it) return Number(it.rotation) || 0; }
      return 0;
    }
    case 'house': { try { return orientedBox(buildingHull(project))?.angleDeg || 0; } catch { return 0; } }
    case 'way': { const w = getWays(project).find((x) => x.id === t.id); return w ? longestEdgeAngle(w.pts) : 0; }
    case 'hardstand': {
      const h = hardstandList(c || {}).find((x) => x.id === t.id);
      const centre = (c?.pavements || []).find((x) => x.id === t.id)?.road?.centre;
      return centre?.length > 1 ? longestEdgeAngle(centre) : h ? longestEdgeAngle(h.polygon, true) : 0;
    }
    case 'group': { const first = groupTargets(project).find((x) => ['building', 'row', 'estate', 'house'].includes(x.kind)) || groupTargets(project)[0]; return first ? orientationOf(project, first) : 0; }
    default: return 0;
  }
}
function longestEdgeAngle(pts, closed = false) {
  let best = 0; let ang = 0;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > best) { best = d; ang = angleFrom(a, b); }
  }
  return ang;
}

// Alignment -----------------------------------------------------------------------------------------------------------------------------

/** The turn that squares the primary target to the nearest lot edge ('boundary') or to the street frontage ('frontage'). Returns { deg, label } or null. */
export function alignDelta(project, sel, mode) {
  const all = expand(project, sel);
  const primary = all[0];
  const lines = lotAlignments(project);
  if (!primary || !lines.length) return null;
  const base = orientationOf(project, primary);
  const front = lines.filter((l) => l.front);
  if (mode === 'frontage') {
    const lot = lotOf(project);
    const f = front[0] || lines[0];
    // A building faces the street exactly (its front to the frontage). Units and estates only square up, so a row never flips to face the other way.
    if (primary.kind === 'building' && lot) return { deg: r3(shortest(base, frontRotation(lot))), label: 'frontage' };
    return { deg: r3(squareDelta(base, f.deg)), label: 'frontage' };
  }
  let best = null;
  for (const l of lines) {
    const d = squareDelta(base, l.deg);
    if (!best || Math.abs(d) < Math.abs(best.deg)) best = { deg: r3(d), label: l.front ? 'frontage' : 'boundary', index: l.index };
  }
  return best;
}

/**
 * Snap a raw turn. Default: 15 degree steps, but within LOT_SNAP_DEG of squaring up to a lot edge it lands exactly square to it.
 * Shift: free, 1 degree steps, no lot snap. Returns { deg, snap: 'step' | 'fine' | 'lot' | 'frontage', label? }.
 */
export function snapTurn(raw, { shift = false, base = null, lines = [], step = STEP_DEG, tol = LOT_SNAP_DEG } = {}) {
  if (shift) return { deg: Math.round(raw / FINE_DEG) * FINE_DEG, snap: 'fine' };
  if (base != null && lines.length) {
    let best = null;
    for (const l of lines) {
      // every turn that leaves the target square to this edge: delta0 + k * 90
      const d0 = squareDelta(base, l.deg);
      const k = Math.round((raw - d0) / 90);
      const d = r3(d0 + k * 90);
      const off = Math.abs(raw - d);
      if (off <= tol && (!best || off < best.off || (off === best.off && l.front && !best.front))) best = { off, deg: d, front: l.front, index: l.index };
    }
    if (best) return { deg: best.deg, snap: best.front ? 'frontage' : 'lot', index: best.index };
  }
  return { deg: Math.round(raw / step) * step, snap: 'step' };
}

// Applying a turn ----------------------------------------------------------------------------------------------------------------------

const turnRowAbout = (r, c, deg) => { const q = rot(r, c, deg); r.x = q.x; r.y = q.y; r.rotationDeg = r3(wrap360((r.rotationDeg || 0) + deg)); };
const turnPoly = (poly, c, deg) => { if (Array.isArray(poly)) for (let i = 0; i < poly.length; i++) poly[i] = rot(poly[i], c, deg); };

function turnEstate(p, c0, deg, pv) {
  const e = c0.estate;
  for (const r of c0.rows) if (!r.mirrorOf) turnRowAbout(r, pv, deg);
  for (const x of c0.parking?.extra || []) turnRowAbout(x, pv, deg);
  const n = e.network;
  for (const k of ['paved', 'aprons', 'foot', 'landscape', 'aisles', 'crossovers', 'bayPolys']) {
    for (const it of n[k] || []) {
      turnPoly(it.polygon, pv, deg);
      if (Array.isArray(it.centre)) turnPoly(it.centre, pv, deg);
      if (k === 'crossovers') { const q = rot(it, pv, deg); it.x = q.x; it.y = q.y; if (it.dir) it.dir = rotVec(it.dir, deg); }
    }
  }
  // The window and the balance of the lot are rectangles in the street frame: a turned estate no longer has one.
  n.window = null;
  e.balance = null;
  e.sig = rowsSignature(c0.rows);
  if (c0.layout) c0.layout.sig = e.sig;
  delete c0.siteWorks;
}

function turnTarget(p, t, deg, pv, flags) {
  const c = p.commercial;
  switch (t.kind) {
    case 'house': rotateHouse(p, deg, pv); flags.house = true; break;
    case 'furniture': case 'stairs':
      for (const l of p.levels || []) {
        const it = (t.kind === 'furniture' ? l.furniture : l.stairs).find((x) => x.id === t.id);
        if (!it) continue;
        const q = rot(it, pv, deg); it.x = q.x; it.y = q.y; it.rotation = r3(wrap360((Number(it.rotation) || 0) + deg));
      }
      break;
    case 'way': {
      const w = (p.site?.paved || []).find((x) => x?.id === t.id);
      if (w) w.pts = w.pts.map((q) => ({ ...q, ...rot(q, pv, deg) }));
      break;
    }
    case 'building': {
      const b = c?.buildings?.find((x) => x.id === t.id);
      if (b) { const q = rot(b.place, pv, deg); b.place = { ...b.place, x: q.x, y: q.y, rotationDeg: r3(wrap360((b.place.rotationDeg || 0) + deg)) }; flags.regen = true; }
      break;
    }
    case 'row': { const r = srcRow(c, t.id); if (r) { turnRowAbout(r, pv, deg); flags.regen = true; } break; }
    case 'estate': if (estateOf(c)) { turnEstate(p, c, deg, pv); flags.regen = true; } break;
    case 'carpark': { const x = c?.parking?.extra?.[t.id]; if (x) { turnRowAbout(x, pv, deg); flags.regen = true; } break; }
    case 'waste': if (c?.waste) { const q = rot(c.waste, pv, deg); c.waste = { ...c.waste, x: q.x, y: q.y, rotationDeg: r3(wrap360((c.waste.rotationDeg || 0) + deg)) }; flags.regen = true; } break;
    case 'hardstand': {
      const e = (c?.pavements || []).find((x) => x.id === t.id);
      if (e) { turnPoly(e.polygon, pv, deg); if (e.road?.centre) turnPoly(e.road.centre, pv, deg); flags.regen = true; }
      break;
    }
    default: break;
  }
}

/**
 * Turn the selection by `deg` about `pivot` (null: the middle of the selection). Mutates `project`; wrap it in ONE store.apply (or a
 * previewFn). A lone house goes through turnHouseBy, so its driveway and tanks settle the way the ring does. Returns true when something turned.
 */
export function applyTurn(project, sel, deg, pivot = null, ctx = {}) {
  if (!Number.isFinite(deg) || Math.abs(deg) < 1e-9) return false;
  const targets = expand(project, sel);
  if (!targets.length) return false;
  const pv = pivot || centreOf(project, targets, ctx);
  if (!pv) return false;
  const flags = { regen: false, house: false };
  const loneHouse = targets.length === 1 && targets[0].kind === 'house';
  if (loneHouse) {
    turnHouseBy(project, deg, pv, { quiet: true });
    return true;
  }
  const whole = sel.some((t) => t.kind === 'group');
  for (const t of targets) turnTarget(project, t, deg, pv, flags);
  if (whole && project.site?.tanks?.length && !targets.some((t) => t.kind === 'house')) for (const k of project.site.tanks) { const q = rot(k, pv, deg); k.x = q.x; k.y = q.y; }
  if (whole && isCommercial(project) && project.commercial) {
    const c = project.commercial;
    if (c.hydrant) { const q = rot(c.hydrant, pv, deg); c.hydrant = { ...c.hydrant, x: q.x, y: q.y }; }
    for (const y of c.yards || []) turnPoly(y.polygon, pv, deg);
    for (const x of c.crossovers || []) { const q = rot(x, pv, deg); x.x = q.x; x.y = q.y; }
    delete c.siteWorks;
    flags.regen = true;
  }
  if (flags.regen && isCommercial(project)) { project.commercial = normaliseCommercial(project.commercial); materialise(project); }
  return true;
}

// Picking -------------------------------------------------------------------------------------------------------------------------------

const near = (p, a, b) => G.projectToSegment(p, a, b).d;

/**
 * The target under a world point, or null. `ctx`: { tolMm (a pick tolerance in mm for lines), hitFurniture(world) -> { kind, id } | null }.
 * Order: small things first (furniture, waste enclosure), then buildings and units, bays, hardstand and roads, drawn ways.
 */
export function pickTarget(project, world, ctx = {}) {
  const tol = ctx.tolMm || 300;
  const c = project.commercial;
  const f = ctx.hitFurniture?.(world);
  if (f && (f.kind === 'furniture' || f.kind === 'stairs')) return { kind: f.kind, id: f.id };
  if (isCommercial(project) && c) {
    if (c.waste && G.pointInPolygon(world, G.rectCorners(c.waste.x, c.waste.y, c.waste.widthMm || 4000, c.waste.depthMm || 3000, c.waste.rotationDeg || 0))) return { kind: 'waste' };
    for (const b of buildingsOf(c)) if (G.pointInPolygon(world, b.outline)) return { kind: 'building', id: b.id };
    for (const r of c.rows || []) {
      if (!G.pointInPolygon(world, rowPoly(r, c.rows))) continue;
      return estateOf(c) ? { kind: 'estate' } : { kind: 'row', id: srcRow(c, r.id).id };
    }
    if (!estateOf(c)) {
      const lay = parkingLayout(c);
      const hit = lay.rows.find((r) => r.extra && r.slots.some((s) => G.pointInPolygon(world, s.poly)));
      if (hit) return { kind: 'carpark', id: Number(String(hit.rowId).replace('extra-', '')) - 1 };
    } else {
      const e = estateOf(c);
      for (const k of ['bayPolys', 'aprons', 'foot', 'paved']) for (const it of e.network[k] || []) if (it.polygon && G.pointInPolygon(world, it.polygon)) return { kind: 'estate' };
    }
    for (const h of hardstandList(c)) if (G.pointInPolygon(world, h.polygon)) return { kind: 'hardstand', id: h.id };
  } else if (lotOf(project) && footprint(project)) {
    for (const l of project.levels || []) {
      for (const r of l.rooms || []) if (r.status !== 'demolish' && Array.isArray(r.polygon) && r.polygon.length >= 3 && G.pointInPolygon(world, r.polygon)) return { kind: 'house' };
      for (const w of l.walls || []) { if (w.kind !== 'exterior' || w.status === 'demolish') continue; try { if (G.pointInPolygon(world, G.wallPolygon(w))) return { kind: 'house' }; } catch { /* degenerate */ } }
    }
  }
  for (const w of getWays(project)) {
    let g = null;
    try { g = wayGeometry(project, w); } catch { g = null; }
    if ((g?.body || []).some((ring) => G.pointInPolygon(world, ring))) return { kind: 'way', id: w.id };
    for (let i = 0; i < w.pts.length - 1; i++) if (near(world, w.pts[i], w.pts[i + 1]) <= Math.max(tol, (w.widthMm || 3000) / 2)) return { kind: 'way', id: w.id };
  }
  return null;
}

/** Everything the tool needs to know about a selection, in one place (used by the panel readout). */
export function describeSelection(project, sel, ctx = {}) {
  const targets = expand(project, sel);
  return { label: selectionLabel(project, sel), count: targets.length, centre: centreOf(project, sel, ctx), facing: targets[0] ? r3(wrap360(orientationOf(project, targets[0]))) : null };
}

export { rowFrame, rowLength };

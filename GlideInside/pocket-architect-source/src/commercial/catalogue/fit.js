// Fitting a catalogue type to a lot: the building turned to face the street, standing as far back as the setback envelope allows, with its
// apron, canopy, docks and car parking in the yard in front. Pure: no DOM, no three. Same intent as layouts.js for strata rows.

import * as G from '../../model/geometry.js';
import { lotOf } from '../../model/placement.js';
import { isCommercial } from '../schema.js';
import { typeById, STRATA_ID } from './types/index.js';
import { newBuilding, presetsOf, siteWorksOf } from './buildings.js';
import { buildingParking } from './bays.js';
import { buildingsOf } from './buildings.js';
import { toWorld } from './frame.js';
import { layoutUnits } from '../layout.js';
import { parkingLayout } from '../parking.js';

export const BEST_PRESET = 'best';
const EMPTY = { solid: [], loose: [] }; // choosing a type replaces whatever is on the lot
const TOL = 5; // mm: the card's setback check is exact, so placement must not borrow more than rounding

const distSeg = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const WALL_MARGIN = 100; // mm: walls stand about 80 mm outside the footprint outline, and the setback check measures the walls
const insideBy = (p, poly, m) => G.pointInPolygon(p, poly) && poly.every((a, i) => distSeg(p, a, poly[(i + 1) % poly.length]) >= m);
const inside = (p, poly) => G.pointInPolygon(p, poly) || poly.some((a, i) => distSeg(p, a, poly[(i + 1) % poly.length]) <= TOL);
const envelopeOf = (lot) => (Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : lot.boundary);
const extent = (pts, ax) => { const v = pts.map((q) => q.x * ax.x + q.y * ax.y); return [Math.min(...v), Math.max(...v)]; };

/** Rotation (deg) that turns a building's front (local -y) toward the street edge of the lot. */
export function frontRotation(lot) {
  const n = lot.boundary.length;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = lot.boundary[e0];
  const b = lot.boundary[(e0 + 1) % n];
  const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const e = { x: (b.x - a.x) / el, y: (b.y - a.y) / el };
  let nrm = { x: -e.y, y: e.x };
  const cx = lot.boundary.reduce((s, q) => s + q.x, 0) / n;
  const cy = lot.boundary.reduce((s, q) => s + q.y, 0) / n;
  if ((cx - a.x) * nrm.x + (cy - a.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
  const deg = (Math.atan2(-nrm.x, nrm.y) * 180) / Math.PI;
  return Math.round(deg * 100) / 100;
}

const segX = (p, q, a, b) => {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
};
/** True when two closed polygons overlap (a vertex of one inside the other, or edges cross). */
export function polysOverlap(A, B) {
  if (A.some((p) => G.pointInPolygon(p, B)) || B.some((p) => G.pointInPolygon(p, A))) return true;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segX(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return false;
}

/** The solid and paved polygons of the buildings already on the lot (world mm): { solid: [outlines], loose: [extras and bays] }. */
export function occupiedBy(project, exceptId = null) {
  const c = project.commercial;
  const bs = buildingsOf({ ...c, buildings: (c.buildings || []).filter((b) => b.id !== exceptId) });
  const bays = buildingParking({ ...c, siteWorks: null, buildings: (c.buildings || []).filter((b) => b.id !== exceptId) }).rows.flatMap((r) => r.slots.map((x) => x.poly));
  const sw = siteWorksOf(c);
  const lanes = sw ? [...(sw.pavedAisles || []).map((a) => a.polygon), ...(sw.forecourts || []).map((a) => a.polygon)] : [];
  const rowsSolid = layoutUnits(c).map((u) => u.poly);
  const rowsLoose = parkingLayout(c).rows.flatMap((r) => r.slots.map((x) => x.poly));
  return { solid: [...bs.map((b) => b.outline), ...rowsSolid], loose: [...bs.flatMap((b) => b.extras.map((e) => e.polygon)), ...bays, ...rowsLoose, ...lanes] };
}

const bboxOfLocal = (pts) => ({ minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) });

/** The local-frame shapes of one building record: outline, the roofed/paved extras and every bay polygon (at place 0,0,0 world == local). */
function localShapes(project, rec) {
  const c = { ...project.commercial, siteWorks: null, buildings: [{ ...rec, place: { x: 0, y: 0, rotationDeg: 0 } }] };
  const [b] = buildingsOf(c);
  if (!b) return null;
  const bays = buildingParking(c).rows.flatMap((r) => r.slots.map((s) => s.poly));
  return { outline: b.outline, extras: b.extras.map((e) => e.polygon), bays };
}

/** The first pose in order of preference where the outline is in the envelope and everything else is in the lot. Null when none. */
const STREET_TYPES = new Set(['service-station', 'kiosk', 'drive-through', 'car-wash']);
export function placeBuilding(project, rec, occ = null, strict = false) {
  const lot = lotOf(project);
  if (!lot || !Array.isArray(lot.boundary) || lot.boundary.length < 3) return null;
  const env = envelopeOf(lot);
  const sh = localShapes(project, rec);
  if (!sh) return null;
  const others = occ || ((project.commercial?.buildings?.length || project.commercial?.rows?.length) ? occupiedBy(project, rec.id) : { solid: [], loose: [] });
  const ub = bboxOfLocal(sh.outline);
  const ab = bboxOfLocal([...sh.outline, ...sh.extras.flat(), ...sh.bays.flat()]);
  const front = frontRotation(lot);
  const fa = [0.5, 0, 1, 0.25, 0.75];
  // Buildings the public drive up to stand near the street (a short drive in); the rest start at the rear and leave the front for the car park.
  const fb = STREET_TYPES.has(rec.type) ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] : [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0];
  for (const k of [0, 2, 1, 3]) {
    const deg = Math.round((((front + k * 90) % 360) + 360) % 360 * 100) / 100;
    const a = (deg * Math.PI) / 180;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    const v = { x: -Math.sin(a), y: Math.cos(a) };
    const [es0, es1] = extent(env, u);
    const [et0, et1] = extent(env, v);
    const [ls0, ls1] = extent(lot.boundary, u);
    const [lt0, lt1] = extent(lot.boundary, v);
    const sLo = Math.max(es0 - ub.minX + WALL_MARGIN, ls0 - ab.minX);
    const sHi = Math.min(es1 - ub.maxX - WALL_MARGIN, ls1 - ab.maxX);
    const tLo = Math.max(et0 - ub.minY + WALL_MARGIN, lt0 - ab.minY);
    const tHi = Math.min(et1 - ub.maxY - WALL_MARGIN, lt1 - ab.maxY);
    if (sLo > sHi + 1 || tLo > tHi + 1) continue;
    for (const fy of fb) for (const fx of fa) {
      const A = Math.min(sHi, Math.max(sLo, Math.round((sLo + (sHi - sLo) * fx) / 100) * 100)); // rounded to 100 mm but never past the limit
      const B = Math.min(tHi, Math.max(tLo, Math.round((tLo + (tHi - tLo) * fy) / 100) * 100));
      const place = { x: Math.round(u.x * A + v.x * B), y: Math.round(u.y * A + v.y * B), rotationDeg: deg };
      const w = (p) => toWorld(place, p);
      if (!sh.outline.every((p) => insideBy(w(p), env, WALL_MARGIN - 1))) continue;
      if (![...sh.extras.flat(), ...sh.bays.flat()].every((p) => inside(w(p), lot.boundary))) continue;
      if (others.solid.length || others.loose.length) {
        const out = sh.outline.map(w);
        const mine = [...sh.extras, ...sh.bays].map((q) => q.map(w));
        if (others.solid.some((o) => polysOverlap(out, o) || mine.some((m) => polysOverlap(m, o)))) continue;
        if (others.loose.some((o) => polysOverlap(out, o))) continue;
        // Keep the way in clear: a strip in front of the door must not meet another building, and a paved apron must not sit on another's.
        if (strict) {
          const door = [{ x: ub.minX, y: ub.minY - 9000 }, { x: ub.maxX, y: ub.minY - 9000 }, { x: ub.maxX, y: ub.minY }, { x: ub.minX, y: ub.minY }].map(w);
          if (others.solid.some((o) => polysOverlap(door, o))) continue;
          if (sh.extras.map((q) => q.map(w)).some((m) => others.loose.some((o) => polysOverlap(m, o)))) continue;
        }
      }
      return place;
    }
  }
  return null;
}

/** Where a block that does not fit stands: turned to the street, centred on the envelope, so the card can show it red. */
function fallbackPlace(project, rec) {
  const lot = lotOf(project);
  const env = envelopeOf(lot);
  const sh = localShapes(project, rec);
  const ub = sh ? bboxOfLocal(sh.outline) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const deg = frontRotation(lot);
  const a = (deg * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  const [s0, s1] = extent(env, u);
  const [t0, t1] = extent(env, v);
  const A = (s0 + s1) / 2 - (ub.minX + ub.maxX) / 2;
  const B = (t0 + t1) / 2 - (ub.minY + ub.maxY) / 2;
  return { x: Math.round(u.x * A + v.x * B), y: Math.round(u.y * A + v.y * B), rotationDeg: deg };
}

/** Presets biggest first (by the GFA each makes). */
export function presetsBySize(project, def) {
  return presetsOf(def)
    .map((p) => { const rec = newBuilding(def.id, { presetId: p.id }); const b = buildingsOf({ ...project.commercial, buildings: [rec] })[0]; return { preset: p, gfa: b?.gfaM2 || 0 }; })
    .sort((a, b) => b.gfa - a.gfa)
    .map((x) => x.preset);
}

/**
 * chooseBuilding(project, typeId, presetId = 'best') -> { id, label, typeId, presetId, buildings: [rec], tooBig } or null.
 * Best fit takes the biggest preset that fits, else the smallest preset parked (tooBig) so the card can show it red.
 */
export function chooseBuilding(project, typeId, presetId = BEST_PRESET) {
  const def = typeById(typeId);
  const lot = lotOf(project);
  if (!def || typeId === STRATA_ID || !lot || !isCommercial(project) || !Array.isArray(lot.boundary) || lot.boundary.length < 3) return null;
  const list = presetId === BEST_PRESET ? presetsBySize(project, def) : presetsOf(def).filter((p) => p.id === presetId);
  if (!list.length) return null;
  for (const preset of list) {
    const rec = newBuilding(typeId, { presetId: preset.id });
    const place = placeBuilding(project, rec, EMPTY);
    if (place) return { id: `${typeId}:${preset.id}`, label: `${def.label}, ${preset.label}`, typeId, presetId: preset.id, buildings: [{ ...rec, place, presetId: preset.id }], tooBig: false };
  }
  const small = list[list.length - 1];
  const rec = newBuilding(typeId, { presetId: small.id });
  return { id: `${typeId}:${small.id}`, label: `${def.label}, ${small.label}`, typeId, presetId: small.id, buildings: [{ ...rec, place: fallbackPlace(project, rec), presetId: small.id }], tooBig: true };
}

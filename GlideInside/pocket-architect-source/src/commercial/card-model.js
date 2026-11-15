// What the commercial lot card shows, derived from the project (no DOM): the stats line, the unit list, the status lines, the feasibility
// headline and the camera poses for the Street, 3D and Walk inside views. Wording follows the housing card: plain words, indicative figures,
// "check with council", never a claim of approval.

import { lotOf } from '../model/placement.js';
import { setbackStatusLine, TOO_BIG } from '../site/lot-checks.js';
import { layoutUnits, mezzanineOf, facadeLayout } from './layout.js';
import { commercialStats, lotAreaM2 } from './stats.js';
import { isCommercial } from './schema.js';
import { zoneClass } from './zones.js';
import { feasibility, money, pct1 } from './feasibility.js';
import { unitGfas } from './feasibility.js';
import { parkingLayout } from './parking.js';
import { buildingsOf } from './catalogue/buildings.js';
import { buildingParking } from './catalogue/bays.js';
import { toWorld, dirToWorld } from './catalogue/frame.js';
import { runBuilding } from './catalogue/materialise.js';

const fmt = (n) => Number(n).toLocaleString('en-AU');
const fmt1 = (n) => Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** The stats line: units, GFA, parking (shown against needed) and site coverage. [{ key, label, value }] */
export function commercialCardStats(project) {
  if (!isCommercial(project)) return [];
  const s = commercialStats(project);
  const out = [
    { key: 'units', label: s.units === 1 ? 'Unit' : 'Units', value: String(s.units) },
    { key: 'gfa', label: 'GFA m²', value: fmt(Math.round(s.gfaM2)) },
    { key: 'parking', label: 'Parking bays', value: `${s.parking.provided} / ${s.parking.required}` },
  ];
  if (s.buildingCount) out.splice(s.units ? 1 : 0, s.units ? 0 : 1, { key: 'buildings', label: s.buildingCount === 1 ? 'Building' : 'Buildings', value: String(s.buildingCount) });
  if (s.coveragePct != null) out.push({ key: 'coverage', label: 'Site coverage', value: s.coveragePct > 0 && s.coveragePct < 0.1 ? '<0.1%' : `${fmt1(s.coveragePct)}%` });
  return out;
}

/** The zone line under the lot line: "E4 General Industrial zone", or a plain "Zone not known" for a lot with none. */
export function zoneLine(lot) {
  const z = zoneClass(lot);
  return z.text ? `${z.text} zone` : 'Zone not looked up, check with council';
}

/** Units for the quick view: [{ n, size, ground, mezz, gfa, row }] with m2 figures rounded to one place. */
export function unitList(project) {
  if (!isCommercial(project)) return [];
  const c = project.commercial;
  const gf = unitGfas(c);
  const rowNo = new Map(c.rows.map((r, i) => [r.id, i + 1]));
  const units = layoutUnits(c).map((u, i) => ({
    n: u.n,
    size: `${Math.round(u.w / 100) / 10} x ${Math.round(u.d / 100) / 10} m`,
    ground: Math.round(gf[i].ground * 10) / 10,
    mezz: Math.round(gf[i].mezz * 10) / 10,
    gfa: Math.round(gf[i].gfa * 10) / 10,
    row: rowNo.get(u.rowId) || 1,
  }));
  // Catalogue buildings follow the strata units: n is B1, B2 ... and the size is the footprint.
  const bs = buildingsOf(c).map((b) => {
    const xs = b.local.outline.map((q) => q.x);
    const ys = b.local.outline.map((q) => q.y);
    const upper = Number(b.q.upperM2) || 0;
    return { n: `B${b.n}`, label: b.label, size: `${Math.round((Math.max(...xs) - Math.min(...xs)) / 100) / 10} x ${Math.round((Math.max(...ys) - Math.min(...ys)) / 100) / 10} m`, ground: Math.round(b.groundM2 * 10) / 10, mezz: Math.round(upper * 10) / 10, gfa: Math.round(b.gfaM2 * 10) / 10, row: 0, building: true };
  });
  return [...units, ...bs];
}

/**
 * The two status lines under the card. The first is the housing card's setback line (building against the indicative envelope, "check with
 * council" while the setbacks are flagged); a layout that could not be fitted reads "Too big for this block". The second is the parking line.
 * { setback: { state, text }, parking: { state, text } }, state 'inside' | 'outside' | 'check' | 'none'.
 */
export function commercialStatus(project) {
  if (!isCommercial(project)) return { setback: { state: 'none', text: '' }, parking: { state: 'none', text: '' } };
  let setback = setbackStatusLine(project);
  if (project.commercial.layout?.tooBig && setback.state === 'outside') setback = { state: 'outside', text: TOO_BIG };
  const s = commercialStats(project);
  const need = s.parking.required;
  const got = s.parking.provided;
  const acc = s.parking.accessible;
  let parking;
  if (!s.units && !s.buildingCount) parking = { state: 'none', text: '' };
  else if (got < need) parking = { state: 'check', text: `Parking short: ${got} ${got === 1 ? 'bay' : 'bays'} shown, ${need} indicated, check with council` };
  else if (acc.provided < acc.required) parking = { state: 'check', text: `Accessible bays short: ${acc.provided} of ${acc.required}, check with council` };
  else parking = { state: 'inside', text: `Parking: ${got} ${got === 1 ? 'bay' : 'bays'} shown, ${need} indicated` };
  // The parking row must lie inside the lot.
  const lot = lotOf(project);
  if (lot && (s.units || s.buildingCount)) {
    const park = parkingLayout(project.commercial);
    const bpark = buildingParking(project.commercial);
    const inside = (q) => pointInside(q, lot.boundary);
    if ([...park.rows, ...bpark.rows].some((r) => r.slots.some((sl) => sl.poly.some((q) => !inside(q))))) parking = { state: 'outside', text: 'Parking extends outside the lot, check the layout' };
  }
  return { setback, parking };
}

function pointInside(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (inside) return true;
  // on the boundary counts as inside (5 mm)
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= 5) return true;
  }
  return false;
}

/** The feasibility headline (values only, the margin stays in the details panel): { value, rent, text } or null when it cannot be worked out. Indicative, ex GST. */
export function feasibilityHeadline(project) {
  if (!isCommercial(project) || !(project.commercial.rows.length || project.commercial.buildings?.length)) return null;
  let f = null;
  try { f = feasibility(project.commercial, project.site?.lot); } catch { f = null; }
  if (!f || !(f.gfa > 0)) return null;
  const m = f.mid;
  return { value: money(m.realisation), rent: money(m.grossRent), text: `Indicative gross realisation ${money(m.realisation)}, indicative gross rent ${money(m.grossRent)} per year`, f };
}

/**
 * One plain line for the demo and the Check step: units, floor area, parking and the indicative margin, with the reason when the margin is
 * negative. Indicative and ex GST. Returns { text, tone } ('ok' margin positive, 'note' negative and explained) or null.
 */
export function commercialSummaryLine(project) {
  if (!isCommercial(project)) return null;
  const s = commercialStats(project);
  if (!(s.units || s.buildingCount)) return null;
  let f = null;
  try { f = feasibility(project.commercial, project.site?.lot); } catch { f = null; }
  if (!f || !(f.gfa > 0)) return null;
  const parts = [];
  if (s.units) parts.push(`${fmt(s.units)} ${s.units === 1 ? 'unit' : 'units'}`);
  if (s.buildingCount) parts.push(`${fmt(s.buildingCount)} ${s.buildingCount === 1 ? 'building' : 'buildings'}`);
  parts.push(`${fmt(Math.round(s.gfaM2))} m² GFA`);
  parts.push(`${s.parking.provided} parking bays (${s.parking.required} indicated)`);
  const m = f.mid;
  const pct = m.marginSalePct;
  const head = parts.join(', ');
  if (pct >= 0) return { tone: 'ok', text: `${head}. Indicative margin if sold: ${pct1(pct)} on cost, ex GST. Change any rate to test your own figures.` };
  const why = m.land + m.siteWorks > m.build * 0.6
    ? 'land and site works take a large share of the cost at this site size'
    : 'build and site costs run above the sale rate in this area';
  return { tone: 'note', text: `${head}. Indicative margin if sold: ${pct1(pct)} on cost, ex GST. It is negative because ${why}. Enter your own land price and rates to test it.` };
}

// Camera poses ---------------------------------------------------------------------------------------------------------------------
// Metres in world space: X = plan x / 1000, Z = plan y / 1000, Y up. Same convention as src/viewer3d/room-logic.js.
// The points the exterior views frame: the units and buildings, plus the canopies that belong to a building (a fuel canopy is most of a service station).
const CANOPY_KINDS = ['canopy', 'awning', 'fuel-canopy', 'truck-canopy'];
const unitPoints = (project) => [...layoutUnits(project.commercial).flatMap((u) => u.poly), ...buildingsOf(project.commercial).flatMap((b) => [...b.outline, ...(b.extras || []).filter((e) => CANOPY_KINDS.includes(e.kind)).flatMap((e) => e.polygon)])];

function streetFrame(lot) {
  const bd = lot?.boundary;
  const fe = (lot?.frontEdges || []).find((i) => Number.isInteger(i) && i >= 0 && i < (bd?.length || 0));
  if (!bd || fe == null) return null;
  const a = bd[fe];
  const b = bd[(fe + 1) % bd.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = { x: bd.reduce((t, q) => t + q.x, 0) / bd.length, y: bd.reduce((t, q) => t + q.y, 0) / bd.length };
  let n = { x: -u.y, y: u.x };
  if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
  return { n, u, mid };
}

/** 'street': eye level from the road in front of the lot, looking at the units. '3d': a three quarter view from the street side. */
export function exteriorPose(project, kind = '3d') {
  const lot = lotOf(project);
  const pts = isCommercial(project) ? unitPoints(project) : [];
  const sf = streetFrame(lot);
  if (!lot || !sf || !pts.length) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const r = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
  const hMax = Math.min(16000, Math.max(6000, ...project.levels.map((l) => (l.elevation || 0) + Math.max(0, ...(l.walls || []).map((w) => Number(w.height) || 0)))));
  if (kind === 'street') {
    // Eye level (1.7 m) square on to the buildings from the street side, far enough back that the whole frontage is in the picture and
    // no further: never further out than the far side of the road, and inside the lot when the buildings sit well back from the street.
    const along = (q) => (q.x - sf.mid.x) * sf.u.x + (q.y - sf.mid.y) * sf.u.y;
    const depth = (q) => -((q.x - sf.mid.x) * sf.n.x + (q.y - sf.mid.y) * sf.n.y); // metres into the lot from the frontage, in mm
    const us = pts.map(along);
    const uc = (Math.min(...us) + Math.max(...us)) / 2;
    const half = (Math.max(...us) - Math.min(...us)) / 2;
    const front = Math.min(...pts.map(depth));
    const fov = 58;
    const tanH = Math.tan((fov / 2) * (Math.PI / 180)) * 0.95; // usable horizontal half angle: the lot card covers the left of the view, so the clear part is about as wide as it is tall
    const back = Math.max(12000, (half * 1.18) / tanH, (hMax * 1.25) / Math.tan((fov / 2) * (Math.PI / 180)) * 0.62);
    // Stand on the street side of the boundary (6 m out or more) whenever the buildings still fill the picture from there; walk into the
    // lot only when they sit so far back that they would be small.
    const sCam = front + 6000 <= back * 1.35 ? Math.max(-19000, Math.min(front - back, -6000)) : front - back * 1.3;
    const pos = { x: sf.mid.x + sf.u.x * uc - sf.n.x * sCam, y: sf.mid.y + sf.u.y * uc - sf.n.y * sCam };
    const tgt = { x: sf.mid.x + sf.u.x * uc - sf.n.x * front, y: sf.mid.y + sf.u.y * uc - sf.n.y * front };
    return { position: { x: pos.x / 1000, y: 1.7, z: pos.y / 1000 }, target: { x: tgt.x / 1000, y: Math.min(4.2, hMax * 0.42 / 1000), z: tgt.y / 1000 }, fov };
  }
  // Three quarter hero view from the street side: low enough to read the facades, high enough to show the roof and the car park.
  const a = (34 * Math.PI) / 180;
  const dir = { x: sf.n.x * Math.cos(a) + sf.u.x * Math.sin(a), y: sf.n.y * Math.cos(a) + sf.u.y * Math.sin(a) };
  const dist = Math.max(26000, r * 2.45 + hMax * 0.6);
  return { position: { x: (c.x + dir.x * dist) / 1000, y: dist * 0.36 / 1000, z: (c.y + dir.y * dist) / 1000 }, target: { x: c.x / 1000, y: Math.min(3.5, hMax * 0.3 / 1000), z: c.y / 1000 }, fov: 38 };
}

// A clear standing spot inside a catalogue building: the point of its largest ground floor room that is furthest from every wall of that
// room, then stepped back along the longest clear run so most of the room is in view, keeping 1.6 m off the wall behind. Plan mm in,
// a pose in metres out; null when the building has no indoor room.
const segDist = (p, a, c) => { const dx = c.x - a.x; const dy = c.y - a.y; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]; const b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const clearance = (p, poly) => (inPoly(p, poly) ? Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]))) : -1);
const polyAreaAbs = (poly) => Math.abs(poly.reduce((t, a, i) => { const c = poly[(i + 1) % poly.length]; return t + a.x * c.y - c.x * a.y; }, 0)) / 2;
export function clearSpotPose(b, project) {
  let rooms = [];
  try { rooms = runBuilding(b, project).rooms.filter((r) => !r.outdoor && r.polygon?.length >= 3 && (r.level || 'Ground') === 'Ground'); } catch { rooms = []; }
  if (!rooms.length) return null;
  const poly = rooms.reduce((a, c) => (polyAreaAbs(c.polygon) > polyAreaAbs(a.polygon) ? c : a)).polygon;
  const xs = poly.map((q) => q.x); const ys = poly.map((q) => q.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  let best = null;
  const N = 24;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = { x: x0 + ((x1 - x0) * i) / N, y: y0 + ((y1 - y0) * j) / N };
    const c = clearance(p, poly);
    if (!best || c > best.c) best = { p, c };
  }
  if (!best || best.c < 400) return null;
  // The four directions of the building's own axes; the run in each is how far one can walk before clearance drops under 0.5 m.
  const u = dirToWorld(b.place, { x: 1, y: 0 }); const f = dirToWorld(b.place, { x: 0, y: 1 });
  const run = (d) => { let t = 0; while (t < 120000 && clearance({ x: best.p.x + d.x * (t + 500), y: best.p.y + d.y * (t + 500) }, poly) >= 500) t += 500; return t; };
  const dirs = [f, { x: -f.x, y: -f.y }, u, { x: -u.x, y: -u.y }].map((d) => ({ d, t: run(d) }));
  const fwd = dirs.reduce((a, c) => (c.t > a.t + 1 ? c : a));
  const back = dirs.find((c) => c.d.x === -fwd.d.x && c.d.y === -fwd.d.y) || { t: 0 };
  const step = Math.max(0, back.t - 1100); // run() already keeps 0.5 m clear; this leaves 1.6 m to the wall behind
  const stand = { x: best.p.x - fwd.d.x * step, y: best.p.y - fwd.d.y * step };
  const ahead = Math.max(3000, fwd.t + step);
  const look = { x: stand.x + fwd.d.x * ahead, y: stand.y + fwd.d.y * ahead };
  return { position: { x: stand.x / 1000, y: 1.6, z: stand.y / 1000 }, target: { x: look.x / 1000, y: 1.55, z: look.y / 1000 }, fov: 70, levelId: null };
}

/** Standing inside unit `n` (1 based), in line with its first roller door a little way in from the front, looking toward the rear. */
export function unitWalkPose(project, n = 1) {
  if (!isCommercial(project)) return null;
  const units = layoutUnits(project.commercial);
  const isB = typeof n === 'string' && /^B\d+$/.test(n);
  const u = isB ? null : (units.find((x) => x.n === n) || units[0]);
  if (!u) {
    // A catalogue building: in from the front edge at the middle of the frontage, looking toward the rear.
    const bl = buildingsOf(project.commercial);
    const b = (isB && bl.find((x) => x.n === Number(n.slice(1)))) || bl[0];
    if (!b) return null;
    // Stand in a clear spot of the building's largest ground floor room, looking down its longest run (never against a wall).
    const clear = clearSpotPose(b, project);
    if (clear) return clear;
    const xs = b.local.outline.map((q) => q.x);
    const ys = b.local.outline.map((q) => q.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y0 = Math.min(...ys);
    const depth = Math.max(...ys) - y0;
    const standAt = toWorld(b.place, { x: cx, y: y0 + depth * 0.25 });
    const look = toWorld(b.place, { x: cx, y: y0 + depth * 0.8 });
    return { position: { x: standAt.x / 1000, y: 1.6, z: standAt.y / 1000 }, target: { x: look.x / 1000, y: 1.5, z: look.y / 1000 }, fov: 70, levelId: null };
  }
  const fr = u.frame;
  const fl = facadeLayout(u.spec);
  const along = u.x0 + (fl.doors[0] ? fl.doors[0].offset : u.w / 2);
  const at = (x, depth) => ({ x: fr.o.x + fr.u.x * x + fr.f.x * depth, y: fr.o.y + fr.u.y * x + fr.f.y * depth });
  const standAt = at(along, Math.max(u.d * 0.6, u.d - 3500));
  const look = at(along, Math.min(u.d * 0.2, 4000));
  return { position: { x: standAt.x / 1000, y: 1.6, z: standAt.y / 1000 }, target: { x: look.x / 1000, y: 1.5, z: look.y / 1000 }, fov: 70, levelId: null };
}

/** The unit's mezzanine area in m2, for the list. */
export const mezzOf = (project, n) => { const u = layoutUnits(project.commercial).find((x) => x.n === n); const m = u ? mezzanineOf(u.spec) : null; return m?.enabled ? m.areaM2 : 0; };
export { lotAreaM2 };

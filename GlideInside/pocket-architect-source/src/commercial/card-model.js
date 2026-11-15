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
import { toWorld } from './catalogue/frame.js';

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
  if (s.coveragePct != null) out.push({ key: 'coverage', label: 'Site coverage', value: `${fmt1(s.coveragePct)}%` });
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
  else if (got < need) parking = { state: 'check', text: `Parking short: ${got} bays shown, ${need} indicated, check with council` };
  else if (acc.provided < acc.required) parking = { state: 'check', text: `Accessible bays short: ${acc.provided} of ${acc.required}, check with council` };
  else parking = { state: 'inside', text: `Parking: ${got} bays shown, ${need} indicated` };
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
const unitPoints = (project) => [...layoutUnits(project.commercial).flatMap((u) => u.poly), ...buildingsOf(project.commercial).flatMap((b) => b.outline)];

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
  const hMax = Math.max(...project.levels.map((l) => (l.elevation || 0) + (l.height || 0)), 6000);
  if (kind === 'street') {
    // 14 m into the road reserve from the middle of the frontage, eye 1.7 m, looking at the middle of the building.
    const pos = { x: sf.mid.x + sf.n.x * 14000, y: sf.mid.y + sf.n.y * 14000 };
    return { position: { x: pos.x / 1000, y: 1.7, z: pos.y / 1000 }, target: { x: c.x / 1000, y: Math.min(3.2, hMax / 2000), z: c.y / 1000 }, fov: 58 };
  }
  const a = (32 * Math.PI) / 180;
  const dir = { x: sf.n.x * Math.cos(a) + sf.u.x * Math.sin(a), y: sf.n.y * Math.cos(a) + sf.u.y * Math.sin(a) };
  const dist = Math.max(30000, r * 2.15);
  return { position: { x: (c.x + dir.x * dist) / 1000, y: dist * 0.5 / 1000, z: (c.y + dir.y * dist) / 1000 }, target: { x: c.x / 1000, y: 2.2, z: c.y / 1000 }, fov: 38 };
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

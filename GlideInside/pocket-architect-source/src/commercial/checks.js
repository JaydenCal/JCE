// The checks list. Same wording style as the housing lot checks: plain words, indicative figures, "check with council", and never a
// claim of approval. Pure: no DOM.

import { lotChecks } from '../site/lot-checks.js';
import { lotOf } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { layoutUnits, facadeLayout, mezzanineOf, officeOf, OFFICE_MIN_WIDTH_MM } from './layout.js';
import { parkingLayout, doorStrips } from './parking.js';
import { commercialStats } from './stats.js';
import { zoneClass, effectiveClass, RESIDENTIAL_NOTE } from './zones.js';
import { defaultRulesFor } from './rules.js';
import { bollardsFor, pointInPoly, BOLLARD_NOTE } from './bollards.js';
import { ACCESSIBLE_BAY } from './rules.js';
import { facts } from './dataset.js';
import { buildingsOf } from './catalogue/buildings.js';
import { buildingParking } from './catalogue/bays.js';
import { effectiveRules } from '../site/custom-rules.js';

const m = (mm) => (mm / 1000).toFixed(2);
const ACCESS_FACT = { class_5: 'accessibleClass5', class_6: 'accessibleClass6', class_7: 'accessibleClass7', class_8: 'accessibleClass8' };
export const ACCESS_CHECK = 'Accessible bay count below the indicative requirement, check with council and an access consultant';

/** The dataset status and tooltip for a check that rests on a dataset value. */
function tipFor(key) {
  if (!key) return {};
  const f = facts(key);
  return { status: f.status, tip: f.tip };
}

/** commercialChecks(project) -> [{ id, kind: 'warn' | 'info', text }]. Warnings first. */
export function commercialChecks(project) {
  const c = project.commercial;
  const out = [];
  const warn = (id, text, key = null) => out.push({ id, kind: 'warn', text, ...tipFor(key) });
  const info = (id, text, key = null) => out.push({ id, kind: 'info', text, ...tipFor(key) });
  if (!c) return out;
  const lot = lotOf(project);
  const units = layoutUnits(c);
  const bsAll = buildingsOf(c);

  // Zone
  const z = zoneClass(project.site?.lot);
  const cls = effectiveClass(project);
  if (lot && (z.cls === 'residential' || z.cls === 'other') && !lot.customRules?.on) warn('zone', RESIDENTIAL_NOTE);
  else if (lot && z.cls === 'unknown' && !c.zoneClass) warn('zone', 'Zone not known for this lot, choose the zone class and check with council');
  else if (lot?.customRules?.on) info('zone', 'Custom rules in use. Setbacks and rates are the values you entered, check them against the local rule');
  else if (cls) info('zone', `${defaultRulesFor(cls).label} zone class. Setbacks and rates are indicative, check with council`);

  // Setbacks and boundary, same checker as the housing mode (the generated rooms and walls are the footprint).
  if (lot && (units.length || bsAll.length)) {
    const lc = lotChecks(project);
    for (const msg of lc.messages) warn(`lot-${msg.kind}-${msg.edge}`, msg.text.replace(/^House /, 'Building '));
  }

  // Side and rear setbacks that the council leaves to the BCA (Tamworth and Gunnedah industrial): 0 m shown, never an invented 3 m.
  const sbs = lot?.setbacks;
  if (sbs && (sbs.side?.bca || sbs.rear?.bca)) info('setbacks-bca', `Side and rear setbacks: ${sbs.side?.basis || sbs.rear?.basis}. ${sbs.side?.note || sbs.rear?.note}`);

  // Rows overlapping each other (mirrored partners share a wall and are not overlaps).
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (units[i].rowId === units[j].rowId) continue;
      if (G.convexOverlap(units[i].poly, units[j].poly, 100)) { warn(`overlap-${units[i].n}-${units[j].n}`, `Unit ${units[i].n} overlaps unit ${units[j].n}, move one of the rows`); break; }
    }
  }

  // Catalogue buildings: overlaps with each other and with the rows, extras (apron, canopy) over the boundary, and the checks of each type.
  const bName = (b) => `${b.label} ${b.n}`;
  for (let i = 0; i < bsAll.length; i++) {
    const b = bsAll[i];
    for (let j = i + 1; j < bsAll.length; j++) if (G.convexOverlap(b.outline, bsAll[j].outline, 100)) warn(`boverlap-${b.n}-${bsAll[j].n}`, `${bName(b)} overlaps ${bName(bsAll[j])}, move one of them`);
    for (const u of units) if (G.convexOverlap(b.outline, u.poly, 100)) { warn(`boverlap-${b.n}-u${u.n}`, `${bName(b)} overlaps unit ${u.n}, move one of them`); break; }
    if (lot) for (const e of b.extras) {
      if (!['apron', 'canopy', 'fuel-canopy', 'yard'].includes(e.kind)) continue;
      if (e.polygon.some((q) => !pointInPoly(q, lot.boundary))) { warn(`bextra-${b.n}-${e.kind}`, `${bName(b)}: the ${(e.label || e.kind).toString().toLowerCase().replace('-', ' ')} extends outside the lot boundary, check the layout`); }
    }
    let tc = [];
    try { tc = b.def.checks ? b.def.checks(b.params) || [] : []; } catch { tc = []; }
    for (const t of tc) (t.kind === 'info' ? info : warn)(`b${b.n}-${t.id}`, `${bName(b)}: ${t.text}`);
  }

  // Per unit design checks
  for (const u of units) {
    const s = u.spec;
    const fl = facadeLayout(s);
    for (const is of fl.issues) warn(`u${u.n}-${is.id}`, `Unit ${u.n}: ${is.text}`);
    const d = s.doors;
    const ds = fl.doors[0];
    if (ds && ds.h + 400 > s.heightMm) warn(`u${u.n}-shutter`, `Unit ${u.n}: roller door head at ${m(ds.h)} m leaves under 0.40 m for the shutter at a ${m(s.heightMm)} m unit height, check with the door supplier`);
    const partyRear = u.mirrored || c.rows.some((r) => r.mirrorOf === u.row.id);
    if (d.rear && partyRear) warn(`u${u.n}-reardoor`, `Unit ${u.n}: no rear door, the rear wall is a shared party wall`);
    if (s.windows.rear !== 'none' && partyRear) info(`u${u.n}-rearwin`, `Unit ${u.n}: no rear window, the rear wall is a shared party wall`);
    const of = officeOf(s);
    if (of.enabled && !of.fits) warn(`u${u.n}-office`, `Unit ${u.n}: no room for the office beside the roller doors, widen the unit or shrink the door set`);
    else if (of.enabled && of.widthMm < OFFICE_MIN_WIDTH_MM) warn(`u${u.n}-office`, `Unit ${u.n}: the office beside the roller door is only ${m(of.widthMm)} m wide, widen the unit or shrink the door set`);
    const mz = mezzanineOf(s);
    if (mz.enabled) {
      const min = mz.minClear;
      const minB = mz.minClearBelow;
      const unv = facts('mezzClear').status === 'UNVERIFIED' ? ', unverified minimum' : '';
      if (mz.clearBelow < minB) warn(`u${u.n}-mzlow`, `Unit ${u.n}: clear height under the mezzanine is ${m(mz.clearBelow)} m, below the ${m(minB)} m minimum${unv}, check with council and the NCC`, 'mezzClear');
      if (mz.clearAbove < min) warn(`u${u.n}-mzhigh`, `Unit ${u.n}: clear height above the mezzanine is ${m(mz.clearAbove)} m, below the ${m(min)} m minimum, check with council and the NCC`, 'ceilingRoom');
      // The room the mezzanine sits in is the unit less the enclosed office.
      const limit = Math.min(200, ((u.w * u.d) / 1e6 - of.areaM2) / 3);
      if (mz.areaM2 > limit) warn(`u${u.n}-mzstorey`, `Unit ${u.n}: the ${mz.areaM2.toFixed(1)} m² mezzanine is above ${limit.toFixed(1)} m² (the lesser of 200 m² and one third of the room), so it may count as a storey, check with council and the NCC`, 'mezzStorey');
      if (mz.fellBack) info(`u${u.n}-mzbay`, `Unit ${u.n}: the bay beside the roller doors is under ${m(OFFICE_MIN_WIDTH_MM)} m wide, so the mezzanine is shown at the rear across the full width`);
      const stairRun = mz.stair.lengthMm;
      // A front mezzanine has its stair behind it in the same bay; a rear one has the stair in front of it, past the ground office.
      const need = mz.position === 'front' ? mz.depthMm + stairRun : mz.depthMm + stairRun + (s.office.enabled ? s.office.depthMm : 0);
      if (need > u.d) warn(`u${u.n}-stair`, `Unit ${u.n}: the ${mz.stair.type === 'L' ? 'L' : 'straight'} stair does not fit ${mz.position === 'front' ? 'behind' : 'beside'} a ${m(mz.depthMm)} m deep mezzanine in a ${m(u.d)} m deep unit`);
      if (mz.stair.widthMm + 600 > mz.widthMm) warn(`u${u.n}-stairw`, `Unit ${u.n}: the mezzanine bay is too narrow for the stair`);
    }
    if (s.windows.side && !(u.first || u.last)) info(`u${u.n}-sidewin`, `Unit ${u.n}: side windows apply to end units only, none drawn on party walls`);
  }

  // Coverage
  const stats = commercialStats(project);
  const rules = effectiveRules(project, cls || 'industrial');
  if (stats.coveragePct != null && stats.coveragePct > rules.coverageMaxPct) warn('coverage', rules.custom ? `Site coverage is ${stats.coveragePct}%, above the ${rules.coverageMaxPct}% maximum you set` : `Site coverage is ${stats.coveragePct}%, above the indicative ${rules.coverageMaxPct}% maximum, check with council`);

  // Parking
  const park = parkingLayout(c);
  const bpark = buildingParking(c);
  if (c.parking?.enabled !== false && (units.length || bsAll.length)) {
    const acc = stats.parking.accessible;
    const need = acc.required;
    if (acc.provided < need) warn('accessible', `${ACCESS_CHECK} (${acc.provided} of ${need})`, ACCESS_FACT[c.buildingClass] || 'accessibleClass8');
    else if (need > 0) info('accessible', `Accessible bays: ${acc.provided} provided against ${need} indicative. Each has a ${m(ACCESSIBLE_BAY.sharedZoneMm)} m shared zone and needs ${m(ACCESSIBLE_BAY.headroomMm)} m headroom, check AS 2890.6 and an access consultant`, 'bay');
    if (stats.parking.provided < stats.parking.required) warn('parking', `Bays shown (${stats.parking.provided}) are fewer than the ${stats.parking.required} indicated at the rate in use, check with council`, 'parkingUnits');
    for (const pr of park.rows) {
      const bad = pr.slots.some((sl) => sl.poly.some((q) => lot && !pointInPoly(q, lot.boundary)));
      if (bad) warn(`park-lot-${pr.rowId}`, 'A parking row extends outside the lot boundary, check the layout');
      if (pr.slots.some((sl) => units.some((u) => G.convexOverlap(sl.poly, u.poly, 100)))) warn(`park-unit-${pr.rowId}`, 'A parking row overlaps a unit, increase the aisle or move the row');
    }
    // Roller doors always face an apron: the strip in front of each bayless row must stay clear of other buildings and inside the lot.
    for (const s of doorStrips(c, park)) {
      const hitsBuilding = units.some((u) => u.rowId !== s.rowId && G.convexOverlap(s.poly, u.poly, 100)) || bsAll.some((b) => G.convexOverlap(s.poly, b.outline, 100));
      const outside = lot && s.poly.some((q) => !pointInPoly(q, lot.boundary));
      if (hitsBuilding || outside) warn(`door-apron-${s.rowId}`, `The roller doors of one row have less than the ${m(s.off)} m truck apron in front of them${hitsBuilding ? ' (a building is in the way)' : ' (the lot boundary is in the way)'}, move the row or the building`);
    }
    for (const pr of bpark.rows) {
      if (lot && pr.slots.some((sl) => sl.poly.some((q) => !pointInPoly(q, lot.boundary)))) warn(`park-lot-${pr.rowId}`, 'A parking row extends outside the lot boundary, check the layout');
      if (pr.slots.some((sl) => bsAll.some((b) => G.convexOverlap(sl.poly, b.outline, 100)) || units.some((u) => G.convexOverlap(sl.poly, u.poly, 100)))) warn(`park-bldg-${pr.rowId}`, 'A parking row overlaps a building, move the building or the row');
    }
  }
  if (units.some((u) => mezzanineOf(u.spec).enabled)) info('barrier', 'Barrier height at the mezzanine edge is 1000 mm and at the stair 865 mm, check the NCC', 'barrier');
  const awc = units.filter((u) => u.spec.office.enabled && u.spec.office.accessibleWc);
  if (awc.length) info('awc', `Accessible WC shown in the office of ${awc.map((u) => `unit ${u.n}`).join(', ')}, internal layout to be confirmed with an access consultant`);
  if (c.bollards?.enabled !== false && units.length) info('bollards', `${bollardsFor(c).length} bollards placed. ${BOLLARD_NOTE}`);
  return [...out.filter((x) => x.kind === 'warn'), ...out.filter((x) => x.kind === 'info')];
}

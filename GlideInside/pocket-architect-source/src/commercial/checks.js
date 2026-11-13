// The checks list. Same wording style as the housing lot checks: plain words, indicative figures, "check with council", and never a
// claim of approval. Pure: no DOM.

import { lotChecks } from '../site/lot-checks.js';
import { lotOf } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { layoutUnits, facadeLayout, mezzanineOf } from './layout.js';
import { parkingLayout } from './parking.js';
import { commercialStats } from './stats.js';
import { zoneClass, effectiveClass, RESIDENTIAL_NOTE } from './zones.js';
import { defaultRulesFor } from './rules.js';
import { bollardsFor, pointInPoly, BOLLARD_NOTE } from './bollards.js';
import { ACCESSIBLE_BAY } from './rules.js';

const m = (mm) => (mm / 1000).toFixed(2);
export const ACCESS_CHECK = 'Accessible bay count below the indicative requirement, check with council and an access consultant';

/** commercialChecks(project) -> [{ id, kind: 'warn' | 'info', text }]. Warnings first. */
export function commercialChecks(project) {
  const c = project.commercial;
  const out = [];
  const warn = (id, text) => out.push({ id, kind: 'warn', text });
  const info = (id, text) => out.push({ id, kind: 'info', text });
  if (!c) return out;
  const lot = lotOf(project);
  const units = layoutUnits(c);

  // Zone
  const z = zoneClass(project.site?.lot);
  const cls = effectiveClass(project);
  if (lot && (z.cls === 'residential' || z.cls === 'other') && !c.zoneClass) warn('zone', RESIDENTIAL_NOTE);
  else if (lot && z.cls === 'unknown' && !c.zoneClass) warn('zone', 'Zone not known for this lot, choose the zone class and check with council');
  else if (cls) info('zone', `${defaultRulesFor(cls).label} zone class. Setbacks and rates are indicative, check with council`);

  // Setbacks and boundary, same checker as the housing mode (the generated rooms and walls are the footprint).
  if (lot && units.length) {
    const lc = lotChecks(project);
    for (const msg of lc.messages) warn(`lot-${msg.kind}-${msg.edge}`, msg.text.replace(/^House /, 'Building '));
  }

  // Rows overlapping each other (mirrored partners share a wall and are not overlaps).
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (units[i].rowId === units[j].rowId) continue;
      if (G.convexOverlap(units[i].poly, units[j].poly, 100)) { warn(`overlap-${units[i].n}-${units[j].n}`, `Unit ${units[i].n} overlaps unit ${units[j].n}, move one of the rows`); break; }
    }
  }

  // Per unit design checks
  for (const u of units) {
    const s = u.spec;
    const fl = facadeLayout(s);
    for (const is of fl.issues) warn(`u${u.n}-${is.id}`, `Unit ${u.n}: ${is.text}`);
    const d = s.doors;
    const ds = fl.doors[0];
    if (ds && ds.h + 400 > s.heightMm) warn(`u${u.n}-shutter`, `Unit ${u.n}: roller door head at ${m(ds.h)} m leaves under 0.40 m for the shutter at a ${m(s.heightMm)} m unit height, check with the door supplier`);
    if (d.rear && (u.mirrored || u.row.id && c.rows.some((r) => r.mirrorOf === u.row.id))) warn(`u${u.n}-reardoor`, `Unit ${u.n}: no rear door, the rear wall is a shared party wall`);
    const mz = mezzanineOf(s);
    if (mz.enabled) {
      const min = mz.minClear;
      if (mz.clearBelow < min) warn(`u${u.n}-mzlow`, `Unit ${u.n}: clear height under the mezzanine is ${m(mz.clearBelow)} m, below the ${m(min)} m minimum, check with council and the NCC`);
      if (mz.clearAbove < min) warn(`u${u.n}-mzhigh`, `Unit ${u.n}: clear height above the mezzanine is ${m(mz.clearAbove)} m, below the ${m(min)} m minimum, check with council and the NCC`);
      if (mz.position === 'front' && ds && ds.h > mz.clearBelow) warn(`u${u.n}-mzdoor`, `Unit ${u.n}: roller door head at ${m(ds.h)} m is above the front mezzanine soffit at ${m(mz.clearBelow)} m, move the mezzanine to the rear or lower the door`);
      const stairRun = mz.stair.lengthMm;
      if (mz.depthMm + stairRun + (s.office.enabled && mz.position === 'rear' ? s.office.depthMm : 0) > u.d) warn(`u${u.n}-stair`, `Unit ${u.n}: the ${mz.stair.type === 'L' ? 'L' : 'straight'} stair does not fit beside a ${m(mz.depthMm)} m deep mezzanine in a ${m(u.d)} m deep unit`);
      if (mz.stair.widthMm + 600 > u.w) warn(`u${u.n}-stairw`, `Unit ${u.n}: the unit is too narrow for the mezzanine stair`);
    }
    if (s.windows.side && !(u.first || u.last)) info(`u${u.n}-sidewin`, `Unit ${u.n}: side windows apply to end units only, none drawn on party walls`);
  }

  // Coverage
  const stats = commercialStats(project);
  const rules = defaultRulesFor(cls || 'industrial');
  if (stats.coveragePct != null && stats.coveragePct > rules.coverageMaxPct) warn('coverage', `Site coverage is ${stats.coveragePct}%, above the indicative ${rules.coverageMaxPct}% maximum, check with council`);

  // Parking
  const park = parkingLayout(c);
  if (c.parking?.enabled !== false && units.length) {
    const need = park.accessible.required;
    if (park.accessible.provided < need) warn('accessible', `${ACCESS_CHECK} (${park.accessible.provided} of ${need})`);
    else if (need > 0) info('accessible', `Accessible bays: ${park.accessible.provided} provided against ${need} indicative. Each has a ${m(ACCESSIBLE_BAY.sharedZoneMm)} m shared zone and needs ${m(ACCESSIBLE_BAY.headroomMm)} m headroom, check AS 2890.6 and an access consultant`);
    if (stats.parking.provided < stats.parking.required) warn('parking', `Bays shown (${stats.parking.provided}) are fewer than the ${stats.parking.required} indicated at the rate in use, check with council`);
    for (const pr of park.rows) {
      const bad = pr.slots.some((sl) => sl.poly.some((q) => lot && !pointInPoly(q, lot.boundary)));
      if (bad) warn(`park-lot-${pr.rowId}`, 'A parking row extends outside the lot boundary, check the layout');
      if (pr.slots.some((sl) => units.some((u) => G.convexOverlap(sl.poly, u.poly, 100)))) warn(`park-unit-${pr.rowId}`, 'A parking row overlaps a unit, increase the aisle or move the row');
    }
  }
  const awc = units.filter((u) => u.spec.office.enabled && u.spec.office.accessibleWc);
  if (awc.length) info('awc', `Accessible WC shown in the office of ${awc.map((u) => `unit ${u.n}`).join(', ')}, internal layout to be confirmed with an access consultant`);
  if (c.bollards?.enabled !== false && units.length) info('bollards', `${bollardsFor(c).length} bollards placed. ${BOLLARD_NOTE}`);
  return [...out.filter((x) => x.kind === 'warn'), ...out.filter((x) => x.kind === 'info')];
}

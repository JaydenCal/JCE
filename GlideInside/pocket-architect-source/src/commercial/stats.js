// Live numbers for the stats strip: unit count and size mix, GFA (ground and mezzanine separately), site coverage, parking required.

import { layoutUnits, mezzanineOf, officeOf } from './layout.js';
import { parkingLayout } from './parking.js';
import { DEFAULT_PARKING_RATE, DEFAULT_OFFICE_RATE, accessibleRequired } from './rules.js';
import { buildingTotals } from './catalogue/buildings.js';
import { buildingParking } from './catalogue/bays.js';
import { bboxOf } from './catalogue/frame.js';
import { carparkSummary } from './catalogue/pavements/logic.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** The lot area in m2: the looked up area, else the boundary polygon area. */
export function lotAreaM2(lot) {
  if (!lot) return null;
  if (Number.isFinite(lot.areaM2) && lot.areaM2 > 0) return lot.areaM2;
  const b = lot.boundary;
  if (!Array.isArray(b) || b.length < 3) return null;
  let a = 0;
  for (let i = 0; i < b.length; i++) { const p = b[i]; const q = b[(i + 1) % b.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2 / 1e6;
}

/** stats(project) -> { units, mix:[{ label, count }], groundGfaM2, mezzGfaM2, gfaM2, footprintM2, coveragePct, parking:{ ratePerM2, required, provided, accessible } }. */
export function commercialStats(project) {
  const c = project.commercial;
  const units = layoutUnits(c);
  const mix = new Map();
  let ground = 0;
  let mezz = 0;
  let office = 0;
  let officeMezz = 0;
  for (const u of units) {
    const label = `${(u.w / 1000).toFixed(1)} x ${(u.d / 1000).toFixed(1)} m`;
    mix.set(label, (mix.get(label) || 0) + 1);
    ground += (u.w * u.d) / 1e6;
    office += officeOf(u.spec).areaM2;
    const m = mezzanineOf(u.spec);
    if (m.enabled) { mezz += m.areaM2; if (m.use === 'office') { office += m.areaM2; officeMezz += m.areaM2; } }
  }
  const rowsGfa = ground + mezz;
  // Catalogue buildings (project.commercial.buildings) add their own floor area, parking and mix on top of the rows.
  const bt = buildingTotals(c);
  const bp = buildingParking(c);
  for (const b of bt.buildings) {
    const bb = bboxOf(b.local.outline);
    mix.set(`${b.label} ${((bb.maxX - bb.minX) / 1000).toFixed(1)} x ${((bb.maxY - bb.minY) / 1000).toFixed(1)} m`, (mix.get(`${b.label} ${((bb.maxX - bb.minX) / 1000).toFixed(1)} x ${((bb.maxY - bb.minY) / 1000).toFixed(1)} m`) || 0) + 1);
  }
  ground += bt.groundM2;
  mezz += bt.upperM2;
  office += bt.perUse.office || 0;
  const gfa = ground + mezz;
  const lotM2 = lotAreaM2(project.site?.lot);
  const rate = Number.isFinite(c?.rates?.parkingPerM2Gfa) ? c.rates.parkingPerM2Gfa : DEFAULT_PARKING_RATE;
  const park = parkingLayout(c);
  const cp = carparkSummary(c);
  const officeRate = Number.isFinite(c?.rates?.officePerM2) ? c.rates.officePerM2 : DEFAULT_OFFICE_RATE;
  const split = office > 0 && c?.rates?.officeSeparate !== false;
  // Fractions round up once, on the total (Tamworth DCP, Step 3 Industrial Parking: fractions round up to the next whole space).
  // The office area is the ground office/amenity plus the mezzanine offices; the rest of the GFA is at the general rate.
  const rowsOffice = office - (bt.perUse.office || 0);
  const otherRaw = (split ? rowsGfa - rowsOffice : rowsGfa) * rate;
  const officeRaw = split ? rowsOffice * officeRate : 0;
  const rowsRequired = Math.ceil(otherRaw + officeRaw - 1e-9);
  const required = rowsRequired + bp.required;
  // NCC D4D6 is a rate on the bays of the class as a whole: when the unit rows and the buildings each carry accessible bays, the requirement is taken once on
  // the total rather than rounded up separately for each group.
  const accTable = Number.isFinite(c?.parking?.accessiblePerBays) && c.parking.accessiblePerBays > 0 ? { perBays: c.parking.accessiblePerBays } : (c?.buildingClass || 'class_8');
  const accSum = park.accessible.required + bp.accessible.required + cp.required;
  const accRequired = park.accessible.required > 0 && bp.accessible.required > 0 && park.accessible.override == null ? Math.min(accSum, accessibleRequired(required, accTable)) : accSum;
  return {
    units: units.length,
    buildings: bt.buildings.map((b) => ({ n: b.n, id: b.id, type: b.type, label: b.label, planLabel: b.planLabel, gfaM2: r1(b.gfaM2), groundM2: r1(b.groundM2), perUse: Object.fromEntries(Object.entries(b.q.perUse || {}).map(([k, v]) => [k, r1(v)])) })),
    buildingCount: bt.count,
    perUse: Object.fromEntries(Object.entries(bt.perUse).map(([k, v]) => [k, r1(v)])),
    mix: [...mix].map(([label, count]) => ({ label, count })),
    groundGfaM2: r1(ground),
    mezzGfaM2: r1(mezz),
    gfaM2: r1(gfa),
    footprintM2: r1(ground),
    officeM2: r1(office),
    officeMezzM2: r1(officeMezz),
    lotM2: lotM2 == null ? null : Math.round(lotM2),
    coveragePct: lotM2 ? ((ground / lotM2) * 100 < 0.1 ? (ground / lotM2) * 100 : r1((ground / lotM2) * 100)) : null,
    parking: { ratePerM2: rate, officeRatePerM2: officeRate, officeSplit: split, split: { officeM2: r1(split ? rowsOffice : 0), otherM2: r1(split ? rowsGfa - rowsOffice : rowsGfa), officeSpaces: Math.round(officeRaw * 100) / 100, otherSpaces: Math.round(otherRaw * 100) / 100 }, required, buildingRequired: bp.required, provided: park.totalBays + bp.totalBays + cp.bays, carparkBays: cp.bays, accessible: { ...park.accessible, required: accRequired, provided: park.accessible.provided + bp.accessible.provided + cp.accessible } },
  };
}

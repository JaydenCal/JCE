// The cited commercial rules dataset (src/commercial/data/*.json, copied from the research dataset of 13/11/2026; the same files are
// published under website-live/plan-studio/data/commercial/). Every value carries a status: VERIFIED_PRIMARY (read from the primary
// text), VERIFIED_SECONDARY (read in a document that quotes the standard, verify against the standard) or UNVERIFIED (do not rely on it).
// UNVERIFIED values are never presented as settled: facts() returns the status and statusText() the words the UI shows.

import accessible from './data/accessible.json' with { type: 'json' };
import rates from './data/rates.json' with { type: 'json' };
import mezzanine from './data/mezzanine.json' with { type: 'json' };
import bollards from './data/bollards.json' with { type: 'json' };
import vehicles from './data/vehicles.json' with { type: 'json' };
import tamworth from './data/councils/tamworth.json' with { type: 'json' };
import gunnedah from './data/councils/gunnedah.json' with { type: 'json' };

export const DATASET = Object.freeze({ accessible, rates, mezzanine, bollards, vehicles, councils: { tamworth, gunnedah } });

const at = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/** The words shown for a status. UNVERIFIED is never softened. */
export function statusText(status) {
  if (status === 'VERIFIED_PRIMARY') return 'read from the primary text, check with council';
  if (status === 'VERIFIED_SECONDARY') return 'indicative, verify against the standard';
  return 'unverified, do not rely on this value';
}

const A = 'as_nzs_2890_6_dimensions_2009_edition';
const REG = {
  accessibleClass5: ['accessible', 'spaces_required.by_class.class_5_office'],
  accessibleClass6: ['accessible', 'spaces_required.by_class.class_6_retail'],
  accessibleClass7: ['accessible', 'spaces_required.by_class.class_7b_warehouse_storage'],
  accessibleClass8: ['accessible', 'spaces_required.by_class.class_8_factory_workshop'],
  bay: ['accessible', `${A}.dedicated_bay`],
  sharedZone: ['accessible', `${A}.shared_area_beside_bay`],
  headroom: ['accessible', `${A}.headroom`],
  accessibleBollard: ['bollards', 'accessible_shared_zone.requirement'],
  accessibleBollardOffset: ['bollards', 'accessible_shared_zone.position_offset_800_pm_50'],
  accessibleBollardHeight: ['bollards', 'accessible_shared_zone.height_and_diameter'],
  parkingUnits: ['councilTamworth', 'parking_rates.local_distribution_warehouse_units_e3_e4_e5'],
  parkingOffice: ['councilTamworth', 'parking_rates.ancillary_office'],
  mezzStorey: ['mezzanine', 'storey_counting.single_mezzanine_counts_as_storey'],
  ceilingRoom: ['mezzanine', 'ceiling_heights_ncc_2022.class_5_6_7_8_general_rooms'],
  ceilingStore: ['mezzanine', 'ceiling_heights_ncc_2022.bathrooms_storerooms_garages_car_parks_and_similar_any_building'],
  mezzClear: ['mezzanine', 'ceiling_heights_ncc_2022.mezzanine_specific_above_and_below'],
  barrier: ['mezzanine', 'stairs_and_barriers.barrier_height_all_other_locations'],
  barrierStair: ['mezzanine', 'stairs_and_barriers.barrier_height_stairs_and_ramps_1_in_20_or_steeper'],
  mrvLength: ['vehicles', 'design_vehicles_as_2890_2.MRV.length_m'],
  mrvWidth: ['vehicles', 'design_vehicles_as_2890_2.MRV.width_m'],
  mrvHeight: ['vehicles', 'design_vehicles_as_2890_2.MRV.height_m'],
  mrvRadius: ['vehicles', 'design_vehicles_as_2890_2.MRV.turning_radius_m'],
  aisle: ['vehicles', 'aisle_90_degree.bay_2_4'],
};
const ROOTS = { accessible, rates, mezzanine, bollards, vehicles, councilTamworth: tamworth, councilGunnedah: gunnedah };

/** facts(key) -> { value, status, clause, source, note, tip }. tip is the tooltip text: the clause and the status words. */
export function facts(key) {
  const [root, path] = REG[key] || [];
  const o = root ? at(ROOTS[root], path) : null;
  if (!o) return { value: null, status: 'UNVERIFIED', clause: null, source: null, note: null, tip: 'No source, unverified' };
  return { value: o.value, status: o.status, clause: o.clause || null, source: o.source_url || null, note: o.note || null, tip: `${o.clause ? `${o.clause}. ` : ''}Status: ${statusText(o.status)}` };
}

/** Parking rates: 1 space per 75 m2 for unit complexes (Tamworth DCP, Gunnedah DCP 2025 industry rate), office 1 per 40 m2. */
export const PARKING_M2_PER_SPACE = facts('parkingUnits').value?.per_m2 ?? 75;
export const OFFICE_M2_PER_SPACE = facts('parkingOffice').value?.per_m2 ?? 40;

/** Accessible bays required for a total bay count by NCC class key: class_5, class_6, class_7, class_8. Class 6 is 1 per 50 to 1000. */
export function accessibleBaysFor(totalBays, cls = 'class_8') {
  if (!(totalBays > 0)) return 0;
  if (cls === 'class_6') return totalBays <= 1000 ? Math.ceil(totalBays / 50) : 20 + Math.ceil((totalBays - 1000) / 100);
  return Math.max(1, Math.ceil(totalBays / 100));
}

export const NCC_CLASSES = Object.freeze([
  ['class_8', 'Class 8 workshop or factory'],
  ['class_7', 'Class 7 warehouse or storage'],
  ['class_5', 'Class 5 office'],
  ['class_6', 'Class 6 shop or showroom'],
]);

/** The MRV design vehicle as the dataset gives it. The turning radius is null in the data and stays an editable field. */
export function mrvDefaults() {
  return { code: 'MRV', lengthM: facts('mrvLength').value, widthM: facts('mrvWidth').value, heightM: facts('mrvHeight').value, turningRadiusM: facts('mrvRadius').value ?? null };
}

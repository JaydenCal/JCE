// The building type registry. One explicit import per type module, listed alphabetically by file name so parallel branches merge with
// one line each. Add your import below, then add its name to TYPES (also one per line, alphabetical).
// Each type module follows INTERFACE.md and FRAMEWORK.md. 'strata-units' is the existing rows code behind the same interface.

import { withConstruction } from '../construction.js';
import { TYPES_B } from './index-typesB.js';
import { TYPES_C } from './index-typesC.js';
import showroom from './showroom.js';
import strataUnits from './strata-units.js';
import warehouse from './warehouse.js';

export const STRATA_ID = 'strata-units';

// Every type carries the construction system parameters (metal clad, tilt-up, precast and so on, see ../construction.js).
export const TYPES = [
  ...TYPES_B,
  ...TYPES_C,
  showroom,
  strataUnits,
  warehouse,
].map(withConstruction);

export const typeById = (id) => TYPES.find((t) => t.id === id) || null;

/** The categories in the order the picker lists them, with their labels. */
export const CATEGORIES = Object.freeze([
  { id: 'industrial', label: 'Industrial' },
  { id: 'storage', label: 'Storage' },
  { id: 'retail', label: 'Retail' },
  { id: 'office', label: 'Office' },
  { id: 'automotive', label: 'Automotive' },
  { id: 'community', label: 'Community' },
]);

/** Types for the pickers: strata units first, then by category order and label. */
export function typesForPicker() {
  const rank = (t) => (t.id === STRATA_ID ? -1 : Math.max(0, CATEGORIES.findIndex((c) => c.id === t.category)));
  return [...TYPES].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

const ICON_BY_ID = {
  'strata-units': 'bt-strata', warehouse: 'bt-warehouse', 'portal-shed': 'bt-warehouse', 'transport-depot': 'bt-warehouse', 'self-storage': 'bt-storage',
  'cold-store': 'bt-cold', showroom: 'bt-retail', 'retail-strip': 'bt-retail', 'drive-through': 'bt-drive', office: 'bt-office',
  'vehicle-workshop': 'bt-auto', 'machinery-dealership': 'bt-auto', 'service-station': 'bt-fuel', 'community-centre': 'bt-community',
};

/** The icon name (see ui/icons.js) of a type for the pickers: its own, by id, else by category. */
export function typeIconName(t) {
  if (t?.icon) return t.icon;
  if (ICON_BY_ID[t?.id]) return ICON_BY_ID[t.id];
  return { storage: 'bt-storage', retail: 'bt-retail', office: 'bt-office', automotive: 'bt-auto', community: 'bt-community' }[t?.category] || 'bt-warehouse';
}

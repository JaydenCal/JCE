// Batch D building types: garages, sheds, industrial sheds, attached housing and mixed use. Imported by the catalogue registry.
import { TYPES_GARAGE } from './garage.js';
import { TYPES_SHEDS } from './sheds.js';
import { TYPES_INDUSTRIAL_SHEDS } from './industrial-sheds.js';
import { TYPES_HOUSING } from './housing.js';

export const TYPES_D = [...TYPES_GARAGE, ...TYPES_SHEDS, ...TYPES_INDUSTRIAL_SHEDS, ...TYPES_HOUSING];
export default TYPES_D;

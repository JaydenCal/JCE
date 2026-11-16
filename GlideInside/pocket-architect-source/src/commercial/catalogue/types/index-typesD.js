// Batch D building types: garages, sheds, industrial sheds, attached housing and mixed use. Imported by the catalogue registry.
import { TYPES_GARAGE } from './garage.js';
import { TYPES_SHEDS } from './sheds.js';

export const TYPES_D = [...TYPES_GARAGE, ...TYPES_SHEDS];
export default TYPES_D;

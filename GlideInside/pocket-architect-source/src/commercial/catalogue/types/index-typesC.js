import office from './office.js';
import retailStrip from './retail-strip.js';
import driveThrough from './drive-through.js';
import serviceStation from './service-station.js';
import coldStore from './cold-store.js';
import communityCentre from './community-centre.js';

/** Types C: merge into TYPES in index.js. */
export const TYPES_C = [office, retailStrip, driveThrough, serviceStation, coldStore, communityCentre];
export { office, retailStrip, driveThrough, serviceStation, coldStore, communityCentre };
export default TYPES_C;
export const TYPES = TYPES_C;

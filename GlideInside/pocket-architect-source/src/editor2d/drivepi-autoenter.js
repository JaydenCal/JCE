// Click the driveway with Select or Move house and the Driveway PIs tool takes over (residential plan). Pure: no DOM, no canvas.
// The click that switched the tool is replayed into the Driveway PIs tool as a centreline click (nearest PI selected, or a PI added where the
// line was clicked). Escape, or a click off the driveway, goes back to the tool the person was on.
import * as D from '../site/drivepi.js';
import * as G from '../model/geometry.js';
import { onHouse } from './tool-movehouse.js';

export const DRIVE_ENTER_FROM = ['select', 'movehouse'];
const HANDLE_PX = 10;

/**
 * What a plan click at world point `w` (mm) means for the driveway. Returns null when it is not on the driveway (or the driveway cannot be
 * edited, the click is on the house, or the design is commercial), else { hit } where hit is the centreline hit ({ kind: 'pi' | 'end' | 'line' })
 * or null for a click on the driveway surface away from the centreline (the tool switches but nothing is added).
 */
export function driveClick(project, w, scale) {
  if (!project || project.mode === 'commercial') return null;
  const st = D.driveEditState(project);
  if (!st.ok) return null;
  if (onHouse(project, w)) return null;
  const tol = HANDLE_PX / Math.max(1e-6, scale);
  const hit = D.driveHit(st, w, tol);
  if (hit) return { hit };
  const poly = st.d.polygon;
  if (Array.isArray(poly) && poly.length > 2 && G.pointInPolygon(w, poly)) return { hit: null };
  return null;
}

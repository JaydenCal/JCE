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

/**
 * The points the Driveway PI tool needs in view when it opens: the building and the spot on the street frontage nearest to it (where a
 * driveway starts). Plan mm. Empty when there is no building or no frontage.
 */
export function driveWorksPoints(project, hull) {
  const lot = project?.site?.lot;
  const b = lot?.boundary;
  if (!Array.isArray(b) || b.length < 3 || !hull?.length) return [];
  const c = G.polygonCentroid(hull);
  const pts = [...hull];
  let best = null;
  for (const i of lot.frontEdges || []) {
    if (!Number.isInteger(i) || i < 0 || i >= b.length) continue;
    const pr = G.projectToSegment(c, b[i], b[(i + 1) % b.length]);
    if (!best || pr.d < best.d) best = pr;
  }
  if (!best) return [];
  pts.push(best.point);
  return pts;
}

/** True when every point is on screen (inside `margin` px of the edges of the area left clear by overlay cards). */
export function allInView(view, size, pts, { margin = 36, inset = {} } = {}) {
  const l = (inset.left || 0) + margin;
  const t = (inset.top || 0) + margin;
  const r = size.w - (inset.right || 0) - margin;
  const bt = size.h - (inset.bottom || 0) - margin;
  return pts.every((p) => {
    const x = p.x * view.scale + view.ox;
    const y = p.y * view.scale + view.oy;
    return x >= l && x <= r && y >= t && y <= bt;
  });
}

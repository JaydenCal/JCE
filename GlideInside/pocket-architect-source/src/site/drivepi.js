// Driveway PI editing for the residential plan: add, move and delete the bend points (PIs) of the driveway, slide its kerb end along the
// frontage, and reset to the automatic route. Mirrors the road tool's PI editing (pavedways.js) but works on the project's own stored
// driveway (project.site.driveway, see lotplan.js), so the automatic driveway, the plan, the 3D model and the exports all follow it.
//
// The first point is always the garage door and the last is always on the kerb: only the interior PIs are free, and the kerb end can
// only slide along the street frontage. Every change is checked: a driveway that would run through the house or off the lot is refused
// and the project is left as it was. The functions mutate the project they are given (call them inside store.apply to get one undo step).

import * as G from '../model/geometry.js';
import { deriveDriveway, storedDriveway, setStoredDriveway, MAX_DRIVE_PIS, roadReserve, nearestOnBuilding, buildingRings } from './lotplan.js';
import { lotOf } from '../model/placement.js';

const round = (q) => ({ x: Math.round(q.x), y: Math.round(q.y) });

/** What the editor needs to know: { ok, reason, manual, d, pis, edited, routed, radiusM, widthMm, endOffsetMm }. */
export function driveEditState(project) {
  let d = null;
  try { d = deriveDriveway(project); } catch { d = null; }
  if (!d) return { ok: false, reason: 'no_driveway', d: null, canDraw: canDraw(project) };
  if (!d.ok) return { ok: false, reason: d.reason || 'no_driveway', d };
  if (d.manual) return { ok: false, reason: 'manual', manual: true, d };
  const st = storedDriveway(project);
  return { ok: true, drawn: !!st?.drawn, d, manual: false, edited: !!d.edited, routed: !!d.routed, pis: (d.pis || []).map((q) => ({ x: q.x, y: q.y })), radiusM: st?.radiusM || (d.routed ? 5 : 6), widthMm: st?.widthMm || null, endOffsetMm: d.endOffsetMm };
}

/** A driveway can be drawn when the lot is loaded, a building stands on it and the street frontage is known. */
export function canDraw(project) {
  const lot = lotOf(project);
  return !!lot && roadReserve(lot).length > 0 && buildingRings(project).length > 0;
}

export const DRAW_HINT = 'No driveway yet. Click the street frontage to start, click to add PIs, then double click or press Enter at the building to finish. Escape cancels.';

/** The nearest point on the kerb of a street frontage to a world point: { point, edge, offsetMm, distMm } or null. */
export function kerbSnap(project, pt) {
  const lot = lotOf(project);
  if (!lot) return null;
  let best = null;
  for (const r of roadReserve(lot)) {
    const a = lot.boundary[r.edge];
    const b = lot.boundary[(r.edge + 1) % lot.boundary.length];
    const off = G.add(G.add(a, G.mul(r.outward, r.vergeM * 1000)), G.mul(r.u, 0));
    const len = G.dist(a, b);
    const s = Math.min(len, Math.max(0, G.dot(G.sub(pt, off), r.u)));
    const point = G.add(off, G.mul(r.u, s));
    const d = G.dist(point, pt);
    if (!best || d < best.distMm) best = { point, edge: r.edge, offsetMm: s, distMm: d };
  }
  return best;
}

/**
 * Create a driveway from the points the person clicked: pts[0] on the street frontage, any PIs, and the last point at the building. The last point
 * is moved onto the building outline. Stored on project.site.driveway ({ drawn: true, start, edge, endOffsetMm, pis }) so it is edited, shown in 3D
 * and drawn in the plan sets like the automatic one, with no garage door needed (granny flat, shed house). Returns { ok, reason }.
 */
export function createDrawnDriveway(project, pts, { widthMm = 3500, radiusM = 5 } = {}) {
  if (!Array.isArray(pts) || pts.length < 2) return { ok: false, reason: 'Click the frontage, then at least one more point at the building.' };
  if (!canDraw(project)) return { ok: false, reason: 'Place a building on a lot with a confirmed street frontage first.' };
  const snap = kerbSnap(project, pts[0]);
  if (!snap) return { ok: false, reason: 'Start on the street frontage.' };
  const start = nearestOnBuilding(project, pts.at(-1));
  const before = project.site.driveway ? structuredClone(project.site.driveway) : undefined;
  setStoredDriveway(project, { endOffsetMm: snap.offsetMm, pis: pts.slice(1, -1), radiusM, widthMm, drawn: true, start, edge: snap.edge });
  const after = deriveDriveway(project);
  if (after?.ok && after.edited) return { ok: true };
  if (before === undefined) delete project.site.driveway; else project.site.driveway = before;
  return { ok: false, reason: 'That driveway could not be drawn there. Start on the street frontage and end at the building.' };
}

/** Delete a drawn driveway. Returns true when one was removed. */
export function deleteDrawnDriveway(project) {
  if (!storedDriveway(project)?.drawn) return false;
  setStoredDriveway(project, null);
  return true;
}

/** The reason a driveway cannot be edited, in plain words, or '' when it can. */
export function driveEditBlock(state) {
  if (state.ok) return '';
  if (state.canDraw) return DRAW_HINT;
  if (state.reason === 'manual') return 'This driveway was drawn with the Road or pavement tool. Edit its points with that tool, or delete it to go back to the automatic driveway.';
  if (state.reason === 'door_faces_away') return 'The garage door faces away from the street and there is no room to route the driveway round the house.';
  return 'To draw a driveway, place a building on a lot and confirm its street frontage first.';
}

/** The corner points of the driveway's control line: garage door, the PIs, kerb end. */
export function driveControl(d, pis = d.pis || []) {
  return [d.doorMid, ...pis, d.kerbPoint];
}

/** The nearest point on the drawn centreline, and the index a new PI there would take among the existing PIs. */
export function nearestOnCentre(d, pt, pis = d.pis || []) {
  let best = null;
  for (let i = 0; i + 1 < d.centre.length; i++) {
    const pr = G.projectToSegment(pt, d.centre[i], d.centre[i + 1]);
    if (!best || pr.d < best.d) best = { d: pr.d, point: pr.point };
  }
  if (!best) return null;
  const ctl = driveControl(d, pis);
  let seg = 0; let sd = Infinity;
  for (let k = 0; k + 1 < ctl.length; k++) {
    const dd = G.projectToSegment(best.point, ctl[k], ctl[k + 1]).d;
    if (dd < sd - 1e-6) { sd = dd; seg = k; }
  }
  return { point: best.point, d: best.d, index: seg };
}

/** What is under a point: { kind: 'pi', index } | { kind: 'end' } | { kind: 'line', point, index } | null. Handles win over the line. */
export function driveHit(state, pt, tolMm) {
  if (!state.ok) return null;
  const { d, pis } = state;
  for (let i = 0; i < pis.length; i++) if (G.dist(pt, pis[i]) <= tolMm) return { kind: 'pi', index: i };
  if (G.dist(pt, d.kerbPoint) <= tolMm) return { kind: 'end' };
  const n = nearestOnCentre(d, pt, pis);
  if (n && n.d <= tolMm) return { kind: 'line', point: n.point, index: n.index };
  return null;
}

function validate(project, before, why) {
  const after = deriveDriveway(project);
  if (after?.ok && after.edited) return { ok: true };
  if (before === undefined) delete project.site.driveway; else project.site.driveway = before;
  return { ok: false, reason: why };
}

/** The value to store for an edit: the current driveway, seeded from the automatic route's bends the first time. */
function baseValue(project) {
  const s = driveEditState(project);
  if (!s.ok) return null;
  const st = storedDriveway(project);
  return { endOffsetMm: s.endOffsetMm, pis: s.edited ? s.pis : s.d.autoPis || [], radiusM: s.radiusM, widthMm: s.widthMm, ...(st?.drawn ? { drawn: true, start: st.start, edge: st.edge } : {}) };
}

function commit(project, value, why) {
  const before = project.site.driveway ? structuredClone(project.site.driveway) : undefined;
  setStoredDriveway(project, value);
  let r = validate(project, before, why);
  // A route round the house may need a tighter curve than the 6 m default to stay clear.
  if (!r.ok) for (const radiusM of [4, 2.5]) {
    if (value.radiusM <= radiusM) continue;
    setStoredDriveway(project, { ...value, radiusM });
    r = validate(project, before, why);
    if (r.ok) break;
  }
  return r;
}

/** Add a PI at a point on the centreline (the nearest point is used). Returns { ok, index, reason }. */
export function addDrivewayPI(project, pt) {
  const s = driveEditState(project);
  if (!s.ok) return { ok: false, reason: driveEditBlock(s) };
  const v = baseValue(project);
  if (v.pis.length >= MAX_DRIVE_PIS) return { ok: false, reason: `A driveway can have up to ${MAX_DRIVE_PIS} PIs.` };
  const n = nearestOnCentre(s.d, pt, v.pis);
  if (!n) return { ok: false, reason: 'Click on the driveway centreline to add a PI.' };
  const at = round(n.point);
  const ctlIndex = n.index;
  const pis = v.pis.slice();
  pis.splice(ctlIndex, 0, at);
  const r = commit(project, { ...v, pis }, 'A PI there would put the driveway through the house or off the lot.');
  return r.ok ? { ok: true, index: ctlIndex } : r;
}

/** Move PI `index` to a point. */
export function moveDrivewayPI(project, index, pt) {
  const s = driveEditState(project);
  if (!s.ok) return { ok: false, reason: driveEditBlock(s) };
  const v = baseValue(project);
  if (!(index >= 0 && index < v.pis.length)) return { ok: false, reason: 'That PI is not on the driveway.' };
  const pis = v.pis.slice();
  pis[index] = round(pt);
  return commit(project, { ...v, pis }, 'The driveway cannot go through the house or off the lot. The PI stays where it was.');
}

/** Delete PI `index`. */
export function deleteDrivewayPI(project, index) {
  const s = driveEditState(project);
  if (!s.ok) return { ok: false, reason: driveEditBlock(s) };
  const v = baseValue(project);
  if (!(index >= 0 && index < v.pis.length)) return { ok: false, reason: 'That PI is not on the driveway.' };
  const pis = v.pis.slice();
  pis.splice(index, 1);
  return commit(project, { ...v, pis }, 'Without that PI the driveway would run through the house or off the lot, so it stays.');
}

/** Slide the end on the kerb to a point (it is projected onto the frontage, so it stays on the kerb). */
export function moveDrivewayEnd(project, pt) {
  const s = driveEditState(project);
  if (!s.ok) return { ok: false, reason: driveEditBlock(s) };
  const v = baseValue(project);
  const off = G.dot(G.sub(pt, s.d.edgeStart), s.d.edgeU);
  return commit(project, { ...v, endOffsetMm: off }, 'The driveway cannot end there. It stays where it was.');
}

/** Set the radius (metres) used to round every PI. */
export function setDrivewayRadius(project, radiusM) {
  const s = driveEditState(project);
  if (!s.ok) return { ok: false, reason: driveEditBlock(s) };
  const v = baseValue(project);
  return commit(project, { ...v, radiusM: Math.min(30, Math.max(2, radiusM)) }, 'That radius would put the driveway through the house or off the lot.');
}

/** Reset to auto: drop the stored edit so the automatic driveway comes back. Returns true when there was an edit to drop. */
export function resetDrivewayToAuto(project) {
  const had = !!project?.site?.driveway;
  setStoredDriveway(project, null);
  return had;
}

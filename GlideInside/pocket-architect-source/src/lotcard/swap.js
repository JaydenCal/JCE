// Change the design placed on the lot (the lot card carousel). The previous design is cleared and the new one goes in with the same
// auto placement as the portal's first placement (src/portal/auto-place.js): garage to the street, centred on the frontage behind
// the front setback, inside the envelope where it can. One undo step. The lot, the colour scheme and the title block stay.

import { placeHouse, defaultPose } from '../portal/place-house.js';
import { autoPose } from '../portal/auto-place.js';
import { lotOf } from '../model/placement.js';
import { settleSiteItems } from '../site/site-items.js';
import { fitPlan, marginIn, buildableArea } from '../site/fit-advice.js';
import { buildingHull } from '../site/lotplan.js';
import * as G from '../model/geometry.js';

/**
 * When the garage to the street pose does not fit, the house turned to suit the lot (parallel to a side boundary on a skewed or tapering
 * lot) often does. Returns the pose for placeHouse with `turnedDeg`, or null when no turn fits. Same search as the fit card's Auto fit.
 */
export function turnedPose(base, house, pose) {
  try {
    const scratch = structuredClone(base);
    placeHouse(scratch, house, pose);
    const plan = fitPlan(scratch);
    if (!plan?.auto?.fits) return null;
    const hull = buildingHull(scratch);
    const c = G.polygonCentroid(hull);
    const at = G.rotatePoint({ x: pose.x, y: pose.y }, c, plan.auto.deg);
    const rot = (((pose.rotation || 0) + plan.auto.deg + 540) % 360) - 180;
    const next = { ...pose, x: Math.round(at.x + plan.auto.dx), y: Math.round(at.y + plan.auto.dy), rotation: Math.round(rot * 10) / 10 };
    // Check the pose as placeHouse will make it (rounding included).
    const check = structuredClone(base);
    placeHouse(check, house, next);
    const area = buildableArea(check);
    if (!area?.polygon || marginIn(buildingHull(check), area.polygon) < 0) return null;
    return { pose: next, turnedDeg: plan.auto.deg };
  } catch { return null; }
}

/** The pose a design would take on this project's lot (same rules as autoPose, with defaultPose when there is no lot). */
export function poseFor(project, house) {
  const base = structuredClone(project);
  base.levels = base.levels.map((l) => ({ ...l, walls: [], openings: [], rooms: [], furniture: [], stairs: [] }));
  base.site = { ...(base.site || {}), tanks: [] };
  if (lotOf(base)) {
    const a = autoPose(base, house);
    if (a.pose && (a.tooBig || a.fits === false)) {
      const t = turnedPose(base, house, a.pose);
      if (t) return { pose: t.pose, fits: true, tooBig: false, turnedDeg: t.turnedDeg };
    }
    if (a.pose) return { pose: a.pose, fits: a.fits, tooBig: !!a.tooBig };
  }
  return { pose: defaultPose(base, house), fits: null, tooBig: false };
}

/**
 * swapHouse(store, house, { id, name }) replaces what is on the lot with `house` (a project JSON). Returns { fits, tooBig } where fits is
 * true, false or null (unknown) as autoPose reports it and tooBig is true when no position or turn fits the setbacks.
 */
export function swapHouse(store, house, { id = null, name = '' } = {}) {
  const h = structuredClone(house);
  h.name = name || h.name || 'House';
  const { pose, fits, tooBig, turnedDeg = 0 } = poseFor(store.project, h);
  store.apply('Change house design', (p) => {
    p.levels = [];
    p.site.tanks = [];
    placeHouse(p, h, pose);
    settleSiteItems(p);
    // The design name follows the chosen home (top bar, saved file, DXF and title block), unless the person typed their own name.
    if (!p.nameEdited && h.name) p.name = String(h.name).slice(0, 80);
    p.placedHouse = tooBig ? { id, name: h.name, tooBig: true } : { id, name: h.name };
    if (turnedDeg) p.placedHouse.turnedToFit = Math.round(turnedDeg); // turned off square to the street so it fits this lot
  });
  const first = [...store.project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  if (first) store.setUI({ activeLevelId: first.id, selection: null });
  return { fits, tooBig, turnedDeg };
}
